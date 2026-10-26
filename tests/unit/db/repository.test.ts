import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PELPPalDatabase } from '@/lib/db/database';
import { LocalRepository } from '@/lib/db/repository';
import type { AccountScope } from '@/lib/db/records';

const databases: PELPPalDatabase[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

function createRepository() {
  const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
  databases.push(database);
  return new LocalRepository(database);
}

function createRepositoryWithDatabase() {
  const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
  databases.push(database);
  return { database, repository: new LocalRepository(database) };
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('LocalRepository', () => {
  it('removes a fully synced inspection when a remote deletion arrives', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    const scope = { accountId: 'a', organizationId: 'org-1', key: 'org-1:a' };
    repository.setAccountScope(scope);
    await database.inspections.put({ id: 'synced-deletion', accountScopeKey: scope.key, status: 'completed', updatedAt: '2026-10-16T08:00:00.000Z' });
    await repository.enqueueOutbox({
      id: 'synced-deletion-outbox', aggregateId: 'synced-deletion', accountScopeKey: scope.key, status: 'synced',
      nextAttemptAt: new Date(0).toISOString(), kind: 'inspection', payload: {},
    } as never);

    await repository.applyPullPage({ revisions: [], activities: [], conflicts: [], deletions: [{
      id: 'synced-deletion-tombstone', inspection_id: 'synced-deletion', change_cursor: 1, deleted_at: '2026-10-16T09:00:00.000Z',
    }] });

    await expect(database.inspections.get('synced-deletion')).resolves.toBeUndefined();
    await expect(database.outbox.get('synced-deletion-outbox')).resolves.toBeUndefined();
    await expect(repository.listOpenConflicts()).resolves.toEqual([]);
  });

  it('preserves pending local inspection work when a remote deletion arrives', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    const scope = { accountId: 'a', organizationId: 'org-1', key: 'org-1:a' };
    repository.setAccountScope(scope);
    await database.inspections.put({
      id: 'locally-edited-inspection',
      accountScopeKey: scope.key,
      status: 'completed',
      updatedAt: '2026-10-16T10:00:00.000Z',
      storeName: 'Local store',
    });
    await repository.enqueueOutbox({
      id: 'pending-inspection-edit',
      aggregateId: 'locally-edited-inspection',
      accountScopeKey: scope.key,
      status: 'pending',
      nextAttemptAt: new Date(0).toISOString(),
      kind: 'inspection',
      payload: { inspection_id: 'locally-edited-inspection' },
    } as never);

    await repository.applyPullPage({
      revisions: [],
      activities: [],
      conflicts: [],
      deletions: [{
        id: 'remote-deletion',
        inspection_id: 'locally-edited-inspection',
        change_cursor: 1,
        deleted_at: '2026-10-16T09:00:00.000Z',
      }],
    });

    await expect(database.inspections.get('locally-edited-inspection')).resolves.toMatchObject({
      storeName: 'Local store',
    });
    await expect(database.outbox.get('pending-inspection-edit')).resolves.toMatchObject({
      status: 'conflict',
      deletionPreviousStatus: 'pending',
    });
    await expect(repository.listOpenConflicts()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        inspection_id: 'locally-edited-inspection',
        source: 'remote-deletion',
        status: 'open',
      }),
    ]));
  });

  it('lets the user keep or discard a locally edited inspection after remote deletion', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    const scope = { accountId: 'a', organizationId: 'org-1', key: 'org-1:a' };
    repository.setAccountScope(scope);
    await database.inspections.put({ id: 'keep-me', accountScopeKey: scope.key, status: 'completed', updatedAt: '2026-10-16T10:00:00.000Z' });
    await repository.enqueueOutbox({
      id: 'keep-me-outbox', aggregateId: 'keep-me', accountScopeKey: scope.key, status: 'pending',
      nextAttemptAt: new Date(0).toISOString(), kind: 'inspection', payload: { inspection_id: 'keep-me' },
    } as never);
    await repository.applyPullPage({ revisions: [], activities: [], conflicts: [], deletions: [{
      id: 'keep-me-deletion', inspection_id: 'keep-me', change_cursor: 1, deleted_at: '2026-10-16T09:00:00.000Z',
    }] });
    const [keepConflict] = await repository.listOpenConflicts();

    await repository.resolveRemoteDeletionConflict(keepConflict.id, 'keep');

    await expect(database.inspections.get('keep-me')).resolves.toBeDefined();
    await expect(database.outbox.get('keep-me-outbox')).resolves.toMatchObject({ status: 'pending' });
    await expect(repository.listOpenConflicts()).resolves.toEqual([]);

    await database.inspections.put({ id: 'discard-me', accountScopeKey: scope.key, status: 'completed' });
    await repository.enqueueOutbox({
      id: 'discard-me-outbox', aggregateId: 'discard-me', accountScopeKey: scope.key, status: 'pending',
      nextAttemptAt: new Date(0).toISOString(), kind: 'inspection', payload: { inspection_id: 'discard-me' },
    } as never);
    await repository.applyPullPage({ revisions: [], activities: [], conflicts: [], deletions: [{
      id: 'discard-me-deletion', inspection_id: 'discard-me', change_cursor: 2,
    }] });
    const discardConflict = (await repository.listOpenConflicts()).find((row) => row.inspection_id === 'discard-me');
    expect(discardConflict).toBeDefined();
    await repository.resolveRemoteDeletionConflict(discardConflict!.id, 'discard');
    await expect(database.inspections.get('discard-me')).resolves.toBeUndefined();
    await expect(database.outbox.get('discard-me-outbox')).resolves.toBeUndefined();
  });

  it('downloads and caches remote evidence once, then serves the cached blob offline', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    const scope = { accountId: 'a', organizationId: 'org-1', key: 'org-1:a' };
    repository.setAccountScope(scope);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const sha256 = await hashBytes(bytes);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const downloadEvidence = vi.fn().mockResolvedValue(blob);
    repository.setEvidenceDownloader(downloadEvidence);
    await database.inspections.put({ id: 'remote-photo-inspection', accountScopeKey: scope.key, status: 'completed', evidence: [{ id: 'remote-photo', remote_path: 'org-1/remote-photo-inspection/remote-photo.jpg', sha256, size_bytes: bytes.length }] });
    await database.evidence.put({ id: 'remote-photo', inspectionId: 'remote-photo-inspection', accountScopeKey: scope.key, displayOrder: 0, capturedAt: '', fileName: 'photo.jpg', mimeType: 'image/jpeg', size: bytes.length, sha256, remotePath: 'org-1/remote-photo-inspection/remote-photo.jpg', syncStatus: 'unavailable' });

    await expect(repository.ensureRemoteEvidence('remote-photo-inspection')).resolves.toMatchObject([{ status: 'downloaded', evidenceId: 'remote-photo' }]);
    expect(await repository.listEvidenceImages('remote-photo-inspection')).toMatchObject([{ syncStatus: 'synced', uploadedSha256: sha256 }]);
    expect(await database.evidenceBlobs.get('remote-photo')).toMatchObject({ sha256, syncStatus: 'synced' });
    vi.spyOn(database.evidenceBlobs, 'get').mockResolvedValue({ id: 'remote-photo', inspectionId: 'remote-photo-inspection', blob, sha256, uploadedSha256: sha256, syncStatus: 'synced', size: bytes.length } as never);
    vi.stubGlobal('navigator', { onLine: false });
    await expect(repository.ensureRemoteEvidence('remote-photo-inspection')).resolves.toMatchObject([{ status: 'cached', evidenceId: 'remote-photo' }]);
    expect(downloadEvidence).toHaveBeenCalledOnce();
    await expect(database.evidenceBlobs.get('remote-photo')).resolves.toMatchObject({ uploadedSha256: sha256 });
  });

  it('rejects remote evidence with a bad checksum or non-JPEG bytes', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    repository.setEvidenceDownloader(vi.fn().mockResolvedValue(new Blob([new Uint8Array([0, 1, 2])])));
    await database.inspections.put({ id: 'bad-remote-inspection', accountScopeKey: 'org-1:a', evidence: [{ id: 'bad-photo', remote_path: 'org-1/bad-remote-inspection/bad.jpg', sha256: 'a'.repeat(64), size_bytes: 3 }] });
    await database.evidence.put({ id: 'bad-photo', inspectionId: 'bad-remote-inspection', accountScopeKey: 'org-1:a', displayOrder: 0, capturedAt: '', fileName: 'bad.jpg', mimeType: 'image/jpeg', size: 3, sha256: 'a'.repeat(64), remotePath: 'org-1/bad-remote-inspection/bad.jpg', syncStatus: 'unavailable' });

    await expect(repository.ensureRemoteEvidence('bad-remote-inspection')).resolves.toMatchObject([{ status: 'failed' }]);
    await expect(database.evidenceBlobs.get('bad-photo')).resolves.toBeUndefined();
  });

  it('rejects a valid JPEG when its synchronized checksum does not match', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    repository.setEvidenceDownloader(vi.fn().mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' })));
    await database.inspections.put({ id: 'hash-mismatch-inspection', accountScopeKey: 'org-1:a', evidence: [{ id: 'mismatch-photo', remote_path: 'org-1/hash-mismatch-inspection/photo.jpg', sha256: 'a'.repeat(64), size_bytes: 4 }] });
    await database.evidence.put({ id: 'mismatch-photo', inspectionId: 'hash-mismatch-inspection', accountScopeKey: 'org-1:a', displayOrder: 0, capturedAt: '', fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 4, sha256: 'a'.repeat(64), remotePath: 'org-1/hash-mismatch-inspection/photo.jpg', syncStatus: 'unavailable' });

    await expect(repository.ensureRemoteEvidence('hash-mismatch-inspection')).resolves.toMatchObject([{ status: 'failed', message: expect.stringMatching(/checksum/i) }]);
    await expect(database.evidenceBlobs.get('mismatch-photo')).resolves.toBeUndefined();
  });

  it('remembers a missing remote object for this repository session', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    const downloadEvidence = vi.fn().mockRejectedValue(Object.assign(new Error('Object not found'), { name: 'EvidenceNotFoundError' }));
    repository.setEvidenceDownloader(downloadEvidence);
    await database.inspections.put({ id: 'missing-inspection', accountScopeKey: 'org-1:a', evidence: [{ id: 'missing-photo', remote_path: 'org-1/missing-inspection/missing.jpg', size_bytes: 4 }] });
    await database.evidence.put({ id: 'missing-photo', inspectionId: 'missing-inspection', accountScopeKey: 'org-1:a', displayOrder: 0, capturedAt: '', fileName: 'missing.jpg', mimeType: 'image/jpeg', size: 4, remotePath: 'org-1/missing-inspection/missing.jpg', syncStatus: 'unavailable' });

    await expect(repository.ensureRemoteEvidence('missing-inspection')).resolves.toMatchObject([{ status: 'unavailable' }]);
    await expect(repository.ensureRemoteEvidence('missing-inspection')).resolves.toMatchObject([{ status: 'unavailable' }]);
    expect(downloadEvidence).toHaveBeenCalledTimes(2);
  });

  it('tries canonical evidence path before a legacy recorded path', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1]);
    const hash = await hashBytes(bytes);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const download = vi.fn((path: string) => path.endsWith('/photo.jpg')
      ? Promise.resolve(blob)
      : Promise.reject(Object.assign(new Error('Object not found'), { name: 'EvidenceNotFoundError' })));
    repository.setEvidenceDownloader(download);
    await database.inspections.put({ id: 'legacy-inspection', accountScopeKey: 'org-1:a', evidence: [{
      id: 'photo', remote_path: 'org-1/legacy-inspection/photo-rev-old.jpg', sha256: hash, size_bytes: bytes.length,
    }] });
    await database.evidence.put({
      id: 'photo', inspectionId: 'legacy-inspection', accountScopeKey: 'org-1:a', displayOrder: 0,
      capturedAt: '', fileName: 'photo.jpg', mimeType: 'image/jpeg', size: bytes.length, sha256: hash,
      remotePath: 'org-1/legacy-inspection/photo-rev-old.jpg', syncStatus: 'unavailable',
    });

    await expect(repository.ensureRemoteEvidence('legacy-inspection')).resolves.toMatchObject([{ status: 'downloaded' }]);
    expect(download.mock.calls.map(([path]) => path)).toEqual([
      'org-1/legacy-inspection/photo.jpg',
    ]);
    await expect(database.evidence.get('photo')).resolves.toMatchObject({ remotePath: 'org-1/legacy-inspection/photo.jpg' });
  });

  it('treats missing canonical and legacy evidence paths as unavailable without changing sync counts', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    const download = vi.fn().mockRejectedValue(Object.assign(new Error('Object not found'), { name: 'EvidenceNotFoundError' }));
    repository.setEvidenceDownloader(download);
    await database.inspections.put({ id: 'gone-inspection', accountScopeKey: 'org-1:a', evidence: [{
      id: 'gone-photo', remote_path: 'org-1/gone-inspection/gone-photo-rev-old.jpg', size_bytes: 4,
    }] });
    await database.evidence.put({
      id: 'gone-photo', inspectionId: 'gone-inspection', accountScopeKey: 'org-1:a', displayOrder: 0,
      capturedAt: '', fileName: 'gone.jpg', mimeType: 'image/jpeg', size: 4,
      remotePath: 'org-1/gone-inspection/gone-photo-rev-old.jpg', syncStatus: 'unavailable',
    });
    const before = await repository.getSyncStatusCounts();

    await expect(repository.ensureRemoteEvidence('gone-inspection')).resolves.toMatchObject([{ status: 'unavailable' }]);
    await expect(repository.ensureRemoteEvidence('gone-inspection')).resolves.toMatchObject([{ status: 'unavailable' }]);
    expect(download).toHaveBeenCalledTimes(2);
    expect(await repository.getSyncStatusCounts()).toEqual(before);
  });

  it('falls through to the recorded path when canonical evidence fails validation', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    const expected = new Uint8Array([0xff, 0xd8, 0xff, 2]);
    const hash = await hashBytes(expected);
    const download = vi.fn()
      .mockResolvedValueOnce(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' }))
      .mockResolvedValueOnce(new Blob([expected], { type: 'image/jpeg' }));
    repository.setEvidenceDownloader(download);
    await database.inspections.put({ id: 'validation-inspection', accountScopeKey: 'org-1:a', evidence: [{
      id: 'validation-photo', remote_path: 'org-1/validation-inspection/validation-photo-rev-old.jpg', sha256: hash, size_bytes: 4,
    }] });
    await database.evidence.put({
      id: 'validation-photo', inspectionId: 'validation-inspection', accountScopeKey: 'org-1:a', displayOrder: 0,
      capturedAt: '', fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 4, sha256: hash,
      remotePath: 'org-1/validation-inspection/validation-photo-rev-old.jpg', syncStatus: 'unavailable',
    });

    await expect(repository.ensureRemoteEvidence('validation-inspection')).resolves.toMatchObject([{ status: 'downloaded' }]);
    expect(download.mock.calls.map(([path]) => path)).toEqual([
      'org-1/validation-inspection/validation-photo.jpg',
      'org-1/validation-inspection/validation-photo-rev-old.jpg',
    ]);
    await expect(database.evidence.get('validation-photo')).resolves.toMatchObject({ remotePath: 'org-1/validation-inspection/validation-photo-rev-old.jpg' });
  });

  it('limits bulk remote evidence downloads to three concurrent photos', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    const items = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, index]);
      const sha256 = await hashBytes(bytes);
      return { id: `bulk-${index}`, inspectionId: 'bulk-inspection', accountScopeKey: 'org-1:a', displayOrder: index, capturedAt: '', fileName: `${index}.jpg`, mimeType: 'image/jpeg', size: bytes.length, sha256, remotePath: `org-1/bulk-inspection/bulk-${index}.jpg`, syncStatus: 'unavailable' as const, blob: new Blob([bytes], { type: 'image/jpeg' }) };
    }));
    for (const { blob: _blob, ...item } of items) await database.evidence.put(item);
    let active = 0;
    let maximum = 0;
    repository.setEvidenceDownloader(async (_path) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result = items.find((item) => item.remotePath === _path)!.blob;
      active -= 1;
      return result;
    });

    const results = await repository.downloadRemoteEvidence();
    expect(results).toHaveLength(5);
    expect(maximum).toBeLessThanOrEqual(3);
  });

  it('does not replace a pending local photo when remote metadata differs', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    const local = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' });
    const downloadEvidence = vi.fn();
    repository.setEvidenceDownloader(downloadEvidence);
    await database.inspections.put({ id: 'local-pending-inspection', accountScopeKey: 'org-1:a', evidence: [{ id: 'pending-photo', remote_path: 'org-1/local-pending-inspection/pending.jpg', sha256: 'b'.repeat(64), size_bytes: 4 }] });
    await database.evidence.put({ id: 'pending-photo', inspectionId: 'local-pending-inspection', accountScopeKey: 'org-1:a', displayOrder: 0, capturedAt: '', fileName: 'local.jpg', mimeType: 'image/jpeg', size: local.size, sha256: 'c'.repeat(64), syncStatus: 'pending' });
    await database.evidenceBlobs.put({ id: 'pending-photo', inspectionId: 'local-pending-inspection', accountScopeKey: 'org-1:a', displayOrder: 0, capturedAt: '', fileName: 'local.jpg', mimeType: 'image/jpeg', size: local.size, sha256: 'c'.repeat(64), syncStatus: 'pending', blob: local });

    await repository.ensureRemoteEvidence('local-pending-inspection');
    expect(downloadEvidence).not.toHaveBeenCalled();
    await expect(database.evidenceBlobs.get('pending-photo')).resolves.toMatchObject({ sha256: 'c'.repeat(64), syncStatus: 'pending' });
  });

  it('caches official records without images and maps hashed DOE tokens', async () => {
    const repository = createRepository();
    await repository.saveOfficialProductRecord({
      controlNumber: 'ACU-DOE-1', fields: {}, starRating: 0, energyLabels: [], imageUrls: ['https://pelp.doe.gov.ph/primg/one.png'], sourceUrl: 'https://pelp.doe.gov.ph/vapproved.php?token', fetchedAt: '2026-10-14T00:00:00.000Z',
    });
    await repository.saveOfficialProductTokenMap('hash', 'ACU-DOE-1');
    await expect(repository.getOfficialProductRecord('ACU-DOE-1')).resolves.toMatchObject({ record: { imageUrls: [] } });
    await expect(repository.getOfficialProductTokenMap('hash')).resolves.toMatchObject({ controlNumber: 'ACU-DOE-1' });
  });

  it('shows a newly completed inspection while its store is active and after finishing it', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    const scope = { accountId: 'inspector', organizationId: 'org', key: 'org:inspector' };
    repository.setAccountScope(scope);
    const store = await repository.saveCurrentStore({ name: 'sample', location: 'NCR' });
    await repository.completeInspection('sample-inspection', { storeName: store.name, storeId: store.storeId, controlNumber: 'ACU-SAMPLE', outcome: 'compliant' });
    expect(await repository.listActivity()).toMatchObject([{ inspectionId: 'sample-inspection', storeName: 'sample', syncStatus: 'pending' }]);
    await repository.finishCurrentStore();
    expect(await repository.listActivity()).toMatchObject([{ inspectionId: 'sample-inspection', storeName: 'sample' }]);
    expect(await repository.listSavedStores()).toMatchObject([{ name: 'sample' }]);
    expect(await database.inspectionRevisions.toArray()).toMatchObject([{ accountScopeKey: scope.key }]);
  });

  it('shows older unscoped local activity only when linked to an active-scope inspection', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org', key: 'org:a' });
    await database.inspections.bulkPut([
      { id: 'mine', status: 'completed', accountScopeKey: 'org:a' },
      { id: 'other', status: 'completed', accountScopeKey: 'org:b' },
    ]);
    await database.activity.bulkPut(['mine', 'other'].map((id) => ({ id: `local-inspection-completed:${id}`, inspection_id: id, event_type: 'inspection_completed', change_cursor: 0 })));
    expect(await repository.listActivity()).toMatchObject([{ inspectionId: 'mine' }]);
    expect(await repository.listActivity()).toHaveLength(1);
  });

  it('isolates completed inspections by personnel account scope', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    const scopeA: AccountScope = { accountId: 'account-a', organizationId: 'org-1', key: 'org-1:account-a' };
    const scopeB: AccountScope = { accountId: 'account-b', organizationId: 'org-1', key: 'org-1:account-b' };
    await database.inspections.bulkPut([
      { id: 'inspection-a', status: 'completed', accountScopeKey: scopeA.key },
      { id: 'inspection-b', status: 'completed', accountScopeKey: scopeB.key },
    ]);

    await expect(repository.listInspections(scopeA)).resolves.toEqual([
      expect.objectContaining({ id: 'inspection-a' }),
    ]);
    await expect(repository.listInspections(scopeB)).resolves.toEqual([
      expect.objectContaining({ id: 'inspection-b' }),
    ]);
  });

  it('keeps a pulled inspection visible to every authorized account that synced it', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    const scopeA: AccountScope = { accountId: 'account-a', organizationId: 'org-1', key: 'org-1:account-a' };
    const scopeB: AccountScope = { accountId: 'account-b', organizationId: 'org-1', key: 'org-1:account-b' };
    const revision = {
      id: 'shared-revision',
      inspection_id: 'shared-inspection',
      revision: 1,
      change_cursor: 1,
      payload: {
        status: 'completed',
        storeId: 'VIS-20261022-DESMARK',
        storeName: 'Desmark Laviña Appliance',
        location: 'Iloilo',
        controlNumber: 'ACU-SHARED',
      },
    };

    repository.setAccountScope(scopeA);
    await repository.applyPullPage({ revisions: [revision], activities: [], conflicts: [], deletions: [] }, scopeA);
    repository.setAccountScope(scopeB);
    await repository.applyPullPage({ revisions: [revision], activities: [], conflicts: [], deletions: [] }, scopeB);

    await expect(repository.listInspections(scopeB)).resolves.toEqual([
      expect.objectContaining({ id: 'shared-inspection' }),
    ]);
    repository.setAccountScope(scopeA);
    await expect(repository.listInspections(scopeA)).resolves.toEqual([
      expect.objectContaining({ id: 'shared-inspection' }),
    ]);
    await expect(repository.listSavedStores()).resolves.toEqual([
      expect.objectContaining({ storeId: 'VIS-20261022-DESMARK', name: 'Desmark Laviña Appliance' }),
    ]);
    await expect(database.inspections.get('shared-inspection')).resolves.toMatchObject({
      visibleToScopeKeys: [scopeA.key, scopeB.key],
    });
  });

  it('resets each account pull cursor once to recover previously hidden shared records', async () => {
    const { repository } = createRepositoryWithDatabase();
    const scope: AccountScope = { accountId: 'account-a', organizationId: 'org-1', key: 'org-1:account-a' };
    repository.setAccountScope(scope);
    await repository.applyPullPage({
      revisions: [{ id: 'old-revision', change_cursor: 9 }],
      activities: [],
      conflicts: [],
      deletions: [],
    }, scope);

    await repository.prepareSharedRecordVisibility(scope);
    await expect(repository.getCursorState(scope)).resolves.toMatchObject({ revision: 0 });

    await repository.applyPullPage({
      revisions: [{ id: 'replayed-revision', change_cursor: 9 }],
      activities: [],
      conflicts: [],
      deletions: [],
    }, scope);
    await repository.prepareSharedRecordVisibility(scope);
    await expect(repository.getCursorState(scope)).resolves.toMatchObject({ revision: 9 });
  });

  it('uploads a saved store once and keeps it isolated from unauthorized account scopes', async () => {
    const { repository } = createRepositoryWithDatabase();
    const scopeA: AccountScope = { accountId: 'account-a', organizationId: 'org-1', username: 'dvdg', key: 'org-1:account-a' };
    const scopeB: AccountScope = { accountId: 'account-b', organizationId: 'org-2', username: 'other', key: 'org-2:account-b' };
    repository.setAccountScope(scopeA);
    await repository.saveCurrentStore({ storeId: 'VIS-DESMARK', name: 'Desmark Laviña Appliance', location: 'Iloilo' });

    await expect(repository.listStoreProfilesForSync(scopeA)).resolves.toEqual([
      expect.objectContaining({ storeId: 'VIS-DESMARK', name: 'Desmark Laviña Appliance' }),
    ]);
    await repository.applySyncedOrganizationStores([{
      storeId: 'remote-desmark', remoteStoreId: 'remote-desmark', name: 'Desmark Laviña Appliance', location: 'Iloilo', updatedAt: '2026-10-22T00:00:00.000Z',
    }], scopeA);
    await expect(repository.listStoreProfilesForSync(scopeA)).resolves.toEqual([]);

    repository.setAccountScope(scopeB);
    await expect(repository.listSavedStores()).resolves.toEqual([]);
  });

  it('isolates pending outbox entries by personnel account scope', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    const scopeA: AccountScope = { accountId: 'account-a', organizationId: 'org-1', key: 'org-1:account-a' };
    const scopeB: AccountScope = { accountId: 'account-b', organizationId: 'org-1', key: 'org-1:account-b' };
    await database.outbox.bulkPut([
      { id: 'outbox-a', aggregateId: 'inspection-a', accountScopeKey: scopeA.key, status: 'pending', nextAttemptAt: new Date(0).toISOString() },
      { id: 'outbox-b', aggregateId: 'inspection-b', accountScopeKey: scopeB.key, status: 'pending', nextAttemptAt: new Date(0).toISOString() },
    ]);

    await expect(repository.getPendingOutbox(scopeA)).resolves.toEqual([
      expect.objectContaining({ id: 'outbox-a' }),
    ]);
    await expect(repository.getPendingOutbox(scopeB)).resolves.toEqual([
      expect.objectContaining({ id: 'outbox-b' }),
    ]);
  });

  it('preserves unscoped local work and reports it for account reconciliation', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.inspections.put({ id: 'legacy-inspection', status: 'completed' });
    await database.outbox.put({
      id: 'legacy-outbox',
      aggregateId: 'legacy-inspection',
      status: 'pending',
      nextAttemptAt: new Date(0).toISOString(),
    });

    await expect(repository.getUnscopedRecordCounts()).resolves.toEqual({ inspections: 1, outbox: 1 });
    await expect(database.inspections.get('legacy-inspection')).resolves.toMatchObject({ id: 'legacy-inspection' });
  });

  it('applies a sync page and advances cursors in the same transaction', async () => {
    const repository = createRepository();

    await repository.applyPullPage({
      revisions: [{ id: 'revision-1', change_cursor: 4 }],
      activities: [{ id: 'activity-1', change_cursor: 3 }],
      conflicts: [],
      deletions: [],
    });

    expect(await repository.getCursorState()).toEqual({
      revision: 4,
      activity: 3,
      conflict: 0,
      deletion: 0,
    });
    expect(await repository.count('inspectionRevisions')).toBe(1);
    expect(await repository.count('activity')).toBe(1);
  });

  it('does not duplicate a revision when a page is replayed', async () => {
    const repository = createRepository();
    const page = {
      revisions: [{ id: 'revision-1', change_cursor: 4 }],
      activities: [],
      conflicts: [],
      deletions: [],
    };

    await repository.applyPullPage(page);
    await repository.applyPullPage(page);

    expect(await repository.count('inspectionRevisions')).toBe(1);
    expect((await repository.getCursorState()).revision).toBe(4);
  });

  it('reconciles a pulled completed revision into the local inspection mirror', async () => {
    const repository = createRepository();
    const page = {
      revisions: [{
        id: 'revision-1',
        inspection_id: 'inspection-1',
        revision: 1,
        change_cursor: 4,
        server_created_at: '2026-10-05T02:00:00.000Z',
        payload: {
          status: 'completed',
          storeName: 'Remote Store',
          controlNumber: 'ACU-0001',
          outcome: 'compliant',
          completedAt: '2026-10-05T02:00:00.000Z',
        },
      }],
      activities: [],
      conflicts: [],
      deletions: [],
    };

    await repository.applyPullPage(page);
    await repository.applyPullPage(page);

    await expect(repository.listCompletedInspections()).resolves.toMatchObject([
      expect.objectContaining({ id: 'inspection-1', storeName: 'Remote Store', status: 'completed' }),
    ]);
    expect(await repository.count('inspectionRevisions')).toBe(1);
  });

  it('keeps the cursor unchanged when applying a page fails', async () => {
    const repository = createRepository();

    await expect(repository.applyPullPage({
      revisions: [{ id: 'revision-1', change_cursor: 4 }],
      activities: [],
      conflicts: [],
      deletions: [{ id: undefined, change_cursor: 5 } as never],
    })).rejects.toThrow();

    expect(await repository.getCursorState()).toEqual({
      revision: 0,
      activity: 0,
      conflict: 0,
      deletion: 0,
    });
    expect(await repository.count('inspectionRevisions')).toBe(0);
  });

  it('rejects a page that moves a cursor backwards without changing local data', async () => {
    const repository = createRepository();
    await repository.applyPullPage({
      revisions: [{ id: 'revision-1', change_cursor: 4 }],
      activities: [],
      conflicts: [],
      deletions: [],
    });

    await expect(repository.applyPullPage({
      revisions: [{ id: 'revision-2', change_cursor: 3 }],
      activities: [],
      conflicts: [],
      deletions: [],
    })).rejects.toThrow(/cursor/i);
    await expect(repository.getCursorState()).resolves.toMatchObject({ revision: 4 });
    expect(await repository.count('inspectionRevisions')).toBe(1);
  });

  it('counts local dashboard work and scopes catalog lookup to the account role', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    repository.setCatalogRole('guestlist');
    await database.catalog.bulkPut([
      { id: 'guest', catalogScope: 'guestlist', model: 'Local fan' },
      { id: 'master', catalogScope: 'masterlist', model: 'Restricted fan' },
    ]);
    await repository.saveInspectionDraft('draft-1', { storeName: 'Store' });
    await repository.enqueueOutbox({
      id: 'outbox-1',
      aggregateId: 'inspection-1',
      kind: 'inspection',
      payload: {},
      status: 'pending',
      nextAttemptAt: new Date().toISOString(),
    });

    expect(await repository.getDashboardCounts()).toMatchObject({ drafts: 1, pendingSync: 1 });
    expect(await repository.searchCatalog('fan')).toEqual([
      { id: 'guest', catalogScope: 'guestlist', model: 'Local fan' },
    ]);
  });

  it('replaces one catalog scope and stores its published manifest state atomically', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.catalog.bulkPut([
      { id: 'old-master', catalogScope: 'masterlist', model: 'Old product' },
      { id: 'guest', catalogScope: 'guestlist', model: 'Guest product' },
    ]);

    await repository.replaceCatalog('masterlist', [
      { id: 'new-master', catalogScope: 'masterlist', model: 'New product' },
    ], {
      version: 2,
      integrityHash: 'hash-2',
      rowCount: 1,
      schemaVersion: 1,
      storagePath: 'masterlist.json',
    });

    expect(await database.catalog.toArray()).toEqual([
      { id: 'guest', catalogScope: 'guestlist', model: 'Guest product' },
      { id: 'new-master', catalogScope: 'masterlist', model: 'New product' },
    ]);
    await expect(repository.getCatalogManifestState('masterlist')).resolves.toMatchObject({
      version: 2,
      integrityHash: 'hash-2',
      rowCount: 1,
    });
  });

  it('filters the full catalog by product type before applying the ten-row limit', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.catalog.bulkPut([
      { id: 'tv-1', catalogScope: 'masterlist', product_type: 'Television Sets' },
      { id: 'tv-2', catalogScope: 'masterlist', product_type: 'Television Sets' },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `ac-${index + 1}`,
        catalogScope: 'masterlist' as const,
        product_type: 'Air Conditioners',
      })),
    ]);

    const rows = await repository.searchCatalog('', 10, 'Air Conditioners');

    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.product_type === 'Air Conditioners')).toBe(true);
  });

  it('returns at most ten initial catalog products', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.catalog.bulkPut(Array.from({ length: 12 }, (_, index) => ({
      id: `product-${index + 1}`,
      catalogScope: 'masterlist' as const,
    })));

    await expect(repository.searchCatalog('', 10)).resolves.toHaveLength(10);
  });

  it('loads a catalog product by id for an inspection draft', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.catalog.put({ id: 'product-1', catalogScope: 'masterlist', control_number: 'ACU-0001' });

    await expect(repository.getCatalogById('product-1')).resolves.toMatchObject({
      id: 'product-1',
      control_number: 'ACU-0001',
    });
  });

  it('lists inspection drafts with the most recently updated first', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.inspectionDrafts.bulkPut([
      { id: 'older', storeName: 'Older Store', updatedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'newer', storeName: 'Newer Store', updatedAt: '2026-10-05T00:00:00.000Z' },
    ]);

    await expect(repository.listInspectionDrafts()).resolves.toMatchObject([
      { id: 'newer', storeName: 'Newer Store' },
      { id: 'older', storeName: 'Older Store' },
    ]);
  });

  it('stores evidence image metadata and its blob locally', async () => {
    const { repository } = createRepositoryWithDatabase();
    const blob = new Blob(['image-bytes'], { type: 'image/png' });

    const evidence = await repository.saveEvidenceImage('inspection-1', blob, {
      fileName: 'label.png',
      capturedAt: '2026-10-05T02:00:00.000Z',
    });
    const saved = await repository.listEvidenceImages('inspection-1');

    expect(evidence).toMatchObject({
      inspectionId: 'inspection-1',
      fileName: 'label.png',
      mimeType: 'image/png',
      capturedAt: '2026-10-05T02:00:00.000Z',
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].blob).toBeDefined();
  });

  it('replaces an evidence image while preserving its identity and order', async () => {
    const { repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    const original = await repository.saveEvidenceImage('inspection-replace', new Blob(['old'], { type: 'image/jpeg' }), {
      fileName: 'old.jpg', capturedAt: '2026-10-05T02:00:00.000Z',
    });
    await repository.markEvidenceUploaded(original.id, 'org-1/inspection-replace/evidence-stable.jpg', 'old-hash');
    const replacement = await repository.replaceEvidenceImage(original.id, new Blob(['new'], { type: 'image/jpeg' }), {
      fileName: 'new.jpg', capturedAt: '2026-10-05T03:00:00.000Z',
    });
    expect(replacement).toMatchObject({ id: original.id, displayOrder: 0, fileName: 'new.jpg', capturedAt: '2026-10-05T03:00:00.000Z', remotePath: 'org-1/inspection-replace/evidence-stable.jpg', syncStatus: 'local' });
    expect(replacement.uploadedSha256).toBeUndefined();
    await expect(repository.listEvidenceImages('inspection-replace')).resolves.toMatchObject([{ id: original.id, fileName: 'new.jpg' }]);
  });

  it('does not queue a photo again after its hash has been uploaded', async () => {
    const { repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    const evidence = await repository.saveEvidenceImage('inspection-repeat', new Blob(['same photo']), { fileName: 'photo.jpg', capturedAt: '2026-10-05T02:00:00.000Z' });
    const task = { evidenceId: evidence.id, inspectionId: evidence.inspectionId, remotePath: 'org-1/inspection-repeat/photo.jpg', sha256: evidence.sha256!, needsUpload: true };
    await repository.registerAcknowledgedEvidence([task]);
    await repository.markEvidenceUploaded(evidence.id, task.remotePath, task.sha256);
    await repository.registerAcknowledgedEvidence([task]);

    await expect(repository.getDueEvidenceUploads()).resolves.toEqual([]);
    await expect(repository.listEvidenceImages('inspection-repeat')).resolves.toMatchObject([{ uploadedSha256: evidence.sha256, remotePath: task.remotePath }]);
  });

  it('cleans up an obsolete pending photo job when the local photo hash is already uploaded', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    const scope = { accountId: 'a', organizationId: 'org-1', key: 'org-1:a' };
    repository.setAccountScope(scope);
    const hash = 'b'.repeat(64);
    await database.evidence.put({ id: 'already-uploaded', inspectionId: 'inspection-obsolete-job', accountScopeKey: scope.key, displayOrder: 0, capturedAt: '', fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 5, sha256: hash, uploadedSha256: hash, syncStatus: 'pending' });
    await database.evidenceUploads.put({ id: 'org-1:a:already-uploaded', evidenceId: 'already-uploaded', inspectionId: 'inspection-obsolete-job', accountScopeKey: scope.key, remotePath: 'org-1/inspection-obsolete-job/already-uploaded.jpg', sha256: hash, status: 'pending', attempts: 2, nextAttemptAt: new Date(0).toISOString() });

    await expect(repository.getDueEvidenceUploads()).resolves.toEqual([]);
    await expect(database.evidenceUploads.get('org-1:a:already-uploaded')).resolves.toMatchObject({ status: 'uploaded' });
    await expect(database.evidence.get('already-uploaded')).resolves.toMatchObject({ syncStatus: 'synced' });
  });

  it('migrates an acknowledged evidence-upload failure into a photo retry task', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    const evidenceId = 'stuck-photo';
    await database.evidence.put({ id: evidenceId, inspectionId: 'inspection-stuck', accountScopeKey: 'org-1:a', displayOrder: 0, capturedAt: '2026-10-05T02:00:00.000Z', fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 5, sha256: 'legacy-hash', remotePath: `org-1/inspection-stuck/${evidenceId}-revision-1.jpg` });
    await database.inspections.put({ id: 'inspection-stuck', status: 'completed', accountScopeKey: 'org-1:a' });
    await repository.enqueueOutbox({
      id: 'stuck-outbox', aggregateId: 'inspection-stuck', accountScopeKey: 'org-1:a', kind: 'inspection', status: 'retry', nextAttemptAt: new Date(0).toISOString(),
      lastError: { message: 'Evidence upload failed for photo' },
      payload: { inspection_id: 'inspection-stuck', revisions: [] },
    });

    await repository.migrateAcknowledgedEvidenceOutbox();

    await expect(repository.getOutbox('stuck-outbox')).resolves.toMatchObject({ status: 'synced' });
    await expect(repository.getDueEvidenceUploads()).resolves.toMatchObject([{ evidenceId, inspectionId: 'inspection-stuck', remotePath: `org-1/inspection-stuck/${evidenceId}.jpg`, status: 'pending' }]);
  });

  it('keeps pulled photo metadata visible as unavailable without retrying a missing local blob', async () => {
    const { repository } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    await repository.applyPullPage({
      revisions: [{ id: 'remote-revision-1', inspection_id: 'remote-inspection-1', revision: 1, change_cursor: 1, payload: {
        status: 'completed', storeName: 'Store', evidence: [{ id: 'remote-photo-1', display_order: 0, original_file_name: 'label.jpg', mime_type: 'image/jpeg', size_bytes: 100, sha256: 'remote-hash', remote_path: 'org-1/remote-inspection-1/remote-photo-1.jpg' }],
      } }],
      activities: [], conflicts: [], deletions: [],
    });

    const [photo] = await repository.listEvidenceImages('remote-inspection-1');
    expect(photo).toMatchObject({ id: 'remote-photo-1', syncStatus: 'unavailable', remotePath: 'org-1/remote-inspection-1/remote-photo-1.jpg' });
    expect(photo.blob).toBeUndefined();
    await expect(repository.getDueEvidenceUploads()).resolves.toEqual([]);
  });

  it('rejects attaching the same photo twice to one inspection', async () => {
    const repository = createRepository();
    const details = { fileName: 'label.jpg', capturedAt: '2026-10-05T02:00:00.000Z' };
    const blob = new Blob(['same photo'], { type: 'image/jpeg' });
    await repository.saveEvidenceImage('duplicate-photo-inspection', blob, details);

    await expect(repository.saveEvidenceImage('duplicate-photo-inspection', blob, details))
      .rejects.toThrow(/already attached/i);
  });

  it('rejects a fourth evidence photo for one inspection', async () => {
    const repository = createRepository();
    for (let index = 0; index < 3; index += 1) {
      await repository.saveEvidenceImage('photo-limit-inspection', new Blob([`photo-${index}`]), {
        fileName: `photo-${index}.jpg`, capturedAt: '2026-10-05T02:00:00.000Z',
      });
    }

    await expect(repository.saveEvidenceImage('photo-limit-inspection', new Blob(['photo-6']), {
      fileName: 'photo-6.jpg', capturedAt: '2026-10-05T02:00:00.000Z',
    })).rejects.toThrow(/maximum of three photos is allowed/i);
  });

  it('does not save a downloaded photo after the account scope changes in flight', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    const scopeA = { accountId: 'a', organizationId: 'org-a', key: 'org-a:a' };
    repository.setAccountScope(scopeA);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const sha256 = await hashBytes(bytes);
    await database.inspections.put({
      id: 'remote-photo-scope', accountScopeKey: scopeA.key, status: 'completed',
      evidence: [{ id: 'photo-scope', remote_path: 'org-a/remote-photo-scope/photo-scope.jpg', sha256, size_bytes: bytes.length }],
    });
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    repository.setEvidenceDownloader(async () => { await waiting; return new Blob([bytes], { type: 'image/jpeg' }); });

    const download = repository.ensureRemoteEvidence('remote-photo-scope');
    repository.setAccountScope({ accountId: 'b', organizationId: 'org-b', key: 'org-b:b' });
    release();

    await expect(download).resolves.toEqual([]);
    await expect(database.evidenceBlobs.get('photo-scope')).resolves.toBeUndefined();
  });

  it('finishes an inspection, records activity, and removes its draft', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await repository.saveInspectionDraft('inspection-1', { storeName: 'Store', currentStep: 'checklist' });
    await repository.saveEvidenceImage('inspection-1', new Blob(['jpeg'], { type: 'image/jpeg' }), {
      fileName: 'label.jpg',
      capturedAt: '2026-10-05T02:00:00.000Z',
    });

    await repository.completeInspection('inspection-1', {
      storeName: 'Store',
      controlNumber: 'ACU-0001',
      outcome: 'non_compliant',
      evidenceCount: 1,
    });

    await expect(repository.getInspectionDraft('inspection-1')).resolves.toBeUndefined();
    await expect(repository.getInspection('inspection-1')).resolves.toMatchObject({ status: 'completed', storeName: 'Store' });
    await expect(repository.listActivity()).resolves.toMatchObject([
      expect.objectContaining({
        inspectionId: 'inspection-1',
        storeName: 'Store',
        controlNumber: 'ACU-0001',
        outcome: 'non_compliant',
        evidenceCount: 1,
      }),
    ]);
    const outbox = (await repository.getDueOutbox())[0];
    expect(outbox).toMatchObject({
      aggregateId: 'inspection-1',
      kind: 'inspection',
      status: 'pending',
      payload: expect.objectContaining({
        inspection_id: 'inspection-1',
        revisions: expect.arrayContaining([expect.objectContaining({
          inspection_id: 'inspection-1',
          revision: 1,
          base_revision: 0,
        })]),
        events: expect.arrayContaining([expect.objectContaining({
          inspection_id: 'inspection-1',
          event_type: 'inspection_completed',
        })]),
      }),
    });
    const payload = (await database.outbox.get(outbox.id))?.payload as Record<string, unknown>;
    const revisionPayload = ((payload.revisions as Array<Record<string, unknown>>)[0].payload) as Record<string, unknown>;
    expect(revisionPayload.evidence).toEqual([
      expect.objectContaining({ id: expect.any(String), original_file_name: 'label.jpg' }),
    ]);
    expect((revisionPayload.evidence as Array<Record<string, unknown>>)[0]).toHaveProperty('blob');
  });

  it('deletes an inspection locally and queues a remote deletion tombstone', async () => {
    const { repository, database } = createRepositoryWithDatabase();
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    await repository.saveInspectionDraft('inspection-delete', { storeName: 'Store' });
    await repository.completeInspection('inspection-delete', {
      storeName: 'Store',
      controlNumber: 'ACU-DELETE',
      outcome: 'non_compliant',
      evidenceCount: 1,
    });
    const savedEvidence = await repository.saveEvidenceImage('inspection-delete', new Blob(['image'], { type: 'image/png' }), {
      fileName: 'evidence.png',
      capturedAt: '2026-10-05T02:00:00.000Z',
    });
    await repository.markEvidenceUploaded(savedEvidence.id, 'org-1/inspection-delete/stored-photo.jpg', 'uploaded-sha');
    const inspectionOutbox = (await repository.getDueOutbox())[0];
    await repository.updateOutbox(inspectionOutbox.id, { status: 'synced' });

    await repository.deleteInspection('inspection-delete');

    await expect(repository.getInspection('inspection-delete')).resolves.toBeUndefined();
    await expect(repository.getInspectionDraft('inspection-delete')).resolves.toBeUndefined();
    await expect(repository.listEvidenceImages('inspection-delete')).resolves.toEqual([]);
    await expect(repository.listActivity()).resolves.toEqual([]);
    await expect(repository.getDueOutbox()).resolves.toMatchObject([
      expect.objectContaining({
        aggregateId: 'inspection-delete',
        kind: 'inspection_delete',
        payload: expect.objectContaining({
          inspection_id: 'inspection-delete',
          product_control_number: 'ACU-DELETE',
          storage_paths: ['org-1/inspection-delete/stored-photo.jpg'],
        }),
      }),
    ]);
  });

  it('removes never-synced inspection work without queuing a server deletion', async () => {
    const { repository, database } = createRepositoryWithDatabase();
    await repository.completeInspection('never-synced', {
      storeName: 'Store',
      controlNumber: 'ACU-NEVER-SYNCED',
      outcome: 'compliant',
    });

    await repository.deleteInspection('never-synced');

    expect(await database.outbox.where('aggregateId').equals('never-synced').toArray()).toEqual([]);
  });

  it('coalesces repeated unsynced edits into one ordered outbox chain', async () => {
    const { repository, database } = createRepositoryWithDatabase();
    await repository.completeInspection('repeated-edit', {
      storeName: 'Store', controlNumber: 'ACU-EDIT', outcome: 'compliant', remarks: 'first',
    });
    await repository.completeInspection('repeated-edit', {
      storeName: 'Store', controlNumber: 'ACU-EDIT', outcome: 'non_compliant', remarks: 'second',
    });

    const rows = await database.outbox.where('aggregateId').equals('repeated-edit').toArray();
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.revisions).toMatchObject([
      { revision: 1, base_revision: 0 },
      { revision: 2, base_revision: 1 },
    ]);
    expect(payload.events).toHaveLength(2);
  });

  it('makes concurrent completion submissions idempotent for one inspection revision', async () => {
    const { repository, database } = createRepositoryWithDatabase();
    await Promise.all([
      repository.completeInspection('double-complete', { storeName: 'Store', controlNumber: 'ACU-DOUBLE', outcome: 'compliant' }),
      repository.completeInspection('double-complete', { storeName: 'Store', controlNumber: 'ACU-DOUBLE', outcome: 'compliant' }),
    ]);

    const revisions = await database.inspectionRevisions.where('inspection_id').equals('double-complete').toArray();
    const outbox = await database.outbox.where('aggregateId').equals('double-complete').toArray();
    expect(revisions).toHaveLength(1);
    expect(outbox).toHaveLength(1);
  });

  it('restores a deleted inspection before its deletion is synced', async () => {
    const { repository } = createRepositoryWithDatabase();
    await repository.completeInspection('inspection-undo', {
      storeName: 'Undo Store',
      storeId: 'store-1',
      controlNumber: 'ACU-UNDO',
      outcome: 'compliant',
      username: 'inspector-1',
    });

    await repository.deleteInspection('inspection-undo');
    await repository.restoreDeletedInspection('inspection-undo');

    await expect(repository.getInspection('inspection-undo')).resolves.toMatchObject({ status: 'completed', controlNumber: 'ACU-UNDO' });
    await expect(repository.listActivity()).resolves.toMatchObject([{ inspectionId: 'inspection-undo' }]);
    await expect(repository.getDueOutbox()).resolves.toMatchObject([{ kind: 'inspection', aggregateId: 'inspection-undo' }]);
  });

  it('makes failed and retryable outbox rows available to the retry action', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    const now = new Date().toISOString();
    await database.outbox.bulkPut([
      { id: 'failed-1', aggregateId: 'inspection-1', status: 'failed', nextAttemptAt: now, attempts: 4 },
      { id: 'retry-1', aggregateId: 'inspection-2', status: 'retry', nextAttemptAt: now, attempts: 2 },
      { id: 'conflict-zero', aggregateId: 'inspection-2', status: 'conflict', nextAttemptAt: now, lastError: { code: 'SYNC_CONFLICT', serverHead: 0 } },
      { id: 'conflict-real', aggregateId: 'inspection-4', status: 'conflict', nextAttemptAt: now, lastError: { code: 'SYNC_CONFLICT', serverHead: 3 } },
      { id: 'synced-1', aggregateId: 'inspection-3', status: 'synced', nextAttemptAt: now },
    ]);

    await expect(repository.retryFailedOutbox()).resolves.toBe(3);
    await expect(database.outbox.get('failed-1')).resolves.toMatchObject({ status: 'retry' });
    await expect(database.outbox.get('failed-1')).resolves.not.toHaveProperty('lastError');
    await expect(database.outbox.get('retry-1')).resolves.toMatchObject({ status: 'retry' });
    await expect(database.outbox.get('retry-1')).resolves.not.toHaveProperty('lastError');
    await expect(database.outbox.get('conflict-zero')).resolves.toMatchObject({ status: 'retry' });
    await expect(database.outbox.get('conflict-real')).resolves.toMatchObject({ status: 'conflict' });
    await expect(database.outbox.get('synced-1')).resolves.toMatchObject({ status: 'synced' });
  });

  it('does not leave a partial completion or outbox item when the transaction fails', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await repository.saveInspectionDraft('inspection-failure', { storeName: 'Store' });

    await expect(repository.completeInspection('inspection-failure', {
      storeName: 'Store',
      invalid: new Proxy({}, { get() { throw new Error('clone failed'); } }),
    })).rejects.toThrow();

    await expect(repository.getInspectionDraft('inspection-failure')).resolves.toBeDefined();
    await expect(repository.getInspection('inspection-failure')).resolves.toBeUndefined();
    await expect(database.outbox.toArray()).resolves.toHaveLength(0);
  });

  it('persists, edits, and finishes the active store without deleting activity', async () => {
    const repository = createRepository();

    const saved = await repository.saveCurrentStore({
      storeId: 'NCR-20261005-001',
      name: 'Sample Appliance Center',
      location: 'NCR',
      address: '123 Main Street',
      contactName: 'Alex Santos',
      contactPosition: 'Manager',
      contactNumber: '09170000000',
      email: 'alex@example.com',
    });

    expect(saved).toMatchObject({
      id: 'current',
      storeId: 'NCR-20261005-001',
      name: 'SAMPLE APPLIANCE CENTER',
      location: 'NCR',
      contactName: 'Alex Santos',
    });
    await expect(repository.getCurrentStore()).resolves.toMatchObject({ name: 'SAMPLE APPLIANCE CENTER' });

    await repository.saveCurrentStore({ ...saved, name: 'Updated Appliance Center' });
    await expect(repository.getCurrentStore()).resolves.toMatchObject({ name: 'UPDATED APPLIANCE CENTER' });
    await expect(repository.listSavedStores()).resolves.toEqual([]);

    await repository.saveCurrentStore({ storeId: 'VIS-20261005-002', name: 'South Store', location: 'Visayas' });
    await expect(repository.listSavedStores()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ storeId: 'NCR-20261005-001', name: 'UPDATED APPLIANCE CENTER' }),
    ]));
    await expect(repository.switchCurrentStore('NCR-20261005-001')).resolves.toMatchObject({ name: 'UPDATED APPLIANCE CENTER' });
    await expect(repository.getCurrentStore()).resolves.toMatchObject({ name: 'UPDATED APPLIANCE CENTER' });

    await repository.applyPullPage({
      revisions: [],
      activities: [{ id: 'activity-1', change_cursor: 1, event_type: 'inspection_completed' }],
      conflicts: [],
      deletions: [],
    });
    await repository.finishCurrentStore();

    await expect(repository.getCurrentStore()).resolves.toBeUndefined();
    await expect(repository.count('activity')).resolves.toBe(1);
  });

  it('persists store names in uppercase regardless of the entered casing', async () => {
    const repository = createRepository();

    const saved = await repository.saveCurrentStore({ name: 'StoRe NaMe', location: 'NCR' });

    expect(saved.name).toBe('STORE NAME');
    await expect(repository.getCurrentStore()).resolves.toMatchObject({ name: 'STORE NAME' });
  });

  it('maps completed activity rows and filters them by outcome, product type, and inspector', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.activity.bulkPut([
      {
        id: 'activity-1',
        change_cursor: 1,
        event_type: 'inspection_completed',
        inspection_id: 'inspection-1',
        server_created_at: '2026-10-05T01:00:00.000Z',
        payload: {
          store_name: 'North Store',
          location: 'NCR',
          product_type: 'Air Conditioners',
          control_number: 'ACU-0001',
          outcome: 'compliant',
          username: 'inspector-1',
        },
      },
      {
        id: 'activity-2',
        change_cursor: 2,
        event_type: 'inspection_completed',
        inspection_id: 'inspection-2',
        server_created_at: '2026-10-05T02:00:00.000Z',
        payload: {
          store_name: 'South Store',
          location: 'Luzon',
          product_type: 'Electric Fans',
          outcome: 'non_compliant',
          username: 'inspector-2',
          evidence_count: 1,
        },
      },
      {
        id: 'activity-draft',
        change_cursor: 3,
        event_type: 'inspection_started',
        inspection_id: 'inspection-draft',
        server_created_at: '2026-10-05T03:00:00.000Z',
      },
    ]);
    await database.outbox.put({ id: 'outbox-activity-2', aggregateId: 'inspection-2', status: 'pending', nextAttemptAt: new Date().toISOString(), payload: {} });

    await expect(repository.listActivity({ outcome: 'compliant' })).resolves.toMatchObject([
      { id: 'activity-1', storeName: 'North Store', productType: 'Air Conditioners', outcome: 'compliant' },
    ]);
    await expect(repository.listActivity({ productType: 'Electric Fans' })).resolves.toMatchObject([
      { id: 'activity-2', storeName: 'South Store', outcome: 'non_compliant' },
    ]);
    await expect(repository.listActivity({ inspector: 'inspector-2' })).resolves.toMatchObject([
      { id: 'activity-2', username: 'inspector-2' },
    ]);
    await expect(repository.listActivity({ syncStatus: 'pending' })).resolves.toMatchObject([
      { id: 'activity-2', syncStatus: 'pending' },
    ]);
    await expect(repository.listActivity({ evidence: 'with', dateFrom: '2026-10-05', dateTo: '2026-10-05' })).resolves.toMatchObject([
      { id: 'activity-2', evidenceCount: 1 },
    ]);
    await expect(repository.listActivity()).resolves.toHaveLength(2);
  });

  it('builds sorted, de-duplicated faceted activity filter options', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.activity.bulkPut([
      { id: 'facet-1', change_cursor: 1, event_type: 'inspection_completed', inspection_id: 'facet-1', server_created_at: '2026-10-05T01:00:00.000Z', payload: { store_name: 'Alpha Store', product_type: 'Z Fans', username: 'zeta' } },
      { id: 'facet-2', change_cursor: 2, event_type: 'inspection_completed', inspection_id: 'facet-2', server_created_at: '2026-10-05T02:00:00.000Z', payload: { store_name: 'Alpha Store', product_type: 'A Conditioners', username: 'alpha' } },
      { id: 'facet-3', change_cursor: 3, event_type: 'inspection_completed', inspection_id: 'facet-3', server_created_at: '2026-10-05T03:00:00.000Z', payload: { store_name: 'Alpha Store', product_type: 'Z Fans', username: 'alpha' } },
      { id: 'facet-4', change_cursor: 4, event_type: 'inspection_completed', inspection_id: 'facet-4', server_created_at: '2026-10-05T04:00:00.000Z', payload: { store_name: 'Beta Store', product_type: 'B Refrigerators', username: 'beta' } },
    ]);

    await expect(repository.listActivityFilterOptions({ storeName: 'Alpha Store' })).resolves.toEqual({
      storeNames: ['Alpha Store', 'Beta Store'],
      inspectors: ['alpha', 'zeta'],
      productTypes: ['A Conditioners', 'Z Fans'],
    });
  });

  it('derives activity outcome from the linked inspection findings', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.inspections.put({
      id: 'inspection-nc',
      status: 'completed',
      storeName: 'North Store',
      productType: 'Air Conditioners',
      controlNumber: 'ACU-NC-001',
      outcome: 'compliant',
      placement: 'failing',
    });
    await database.activity.put({
      id: 'activity-nc',
      change_cursor: 1,
      event_type: 'inspection_completed',
      inspection_id: 'inspection-nc',
      server_created_at: '2026-10-05T04:00:00.000Z',
      payload: { outcome: 'compliant', placement: 'passing' },
    });

    await expect(repository.listActivity({ outcome: 'non_compliant' })).resolves.toMatchObject([
      { id: 'activity-nc', outcome: 'non_compliant', controlNumber: 'ACU-NC-001' },
    ]);
  });

  it('pages completed activity newest first without repeating rows', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.activity.bulkPut(Array.from({ length: 5 }, (_, index) => ({
      id: `activity-${index + 1}`,
      change_cursor: index + 1,
      event_type: 'inspection_completed',
      inspection_id: `inspection-${index + 1}`,
      server_created_at: `2026-10-05T0${5 - index}:00:00.000Z`,
      payload: {
        store_name: 'North Store',
        outcome: index === 4 ? 'non_compliant' : 'compliant',
      },
    })));

    const first = await repository.listActivityPage({ limit: 2, outcome: 'compliant' });
    const second = await repository.listActivityPage({ limit: 2, outcome: 'compliant', cursor: first.nextCursor });

    expect(first.rows.map((row) => row.id)).toEqual(['activity-1', 'activity-2']);
    expect(first.hasMore).toBe(true);
    expect(second.rows.map((row) => row.id)).toEqual(['activity-3', 'activity-4']);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(4);
  });

  it('uses a corrected inspection outcome instead of an old NC activity payload', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.inspections.put({ id: 'corrected', status: 'completed', outcome: 'compliant', placement: 'passing' });
    await database.activity.put({ id: 'old-event', inspection_id: 'corrected', change_cursor: 1, event_type: 'inspection_completed', payload: { outcome: 'non_compliant', placement: 'failing' } });
    expect(await repository.listActivity({ outcome: 'non_compliant' })).toEqual([]);
    expect(await repository.listActivity({ outcome: 'compliant' })).toMatchObject([{ inspectionId: 'corrected', outcome: 'compliant' }]);
  });

  it('finds an existing completed inspection for the same store, product, and inspector', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.inspections.bulkPut([
      { id: 'inspection-1', status: 'completed', storeId: 'store-1', controlNumber: 'ACU-0001', model: 'CV-100', username: 'maria' },
      { id: 'inspection-2', status: 'completed', storeId: 'store-2', controlNumber: 'ACU-0001', model: 'CV-100', username: 'maria' },
      { id: 'inspection-3', status: 'completed', storeId: 'store-1', controlNumber: 'ACU-0001', model: 'CV-100', username: 'juan' },
    ]);

    await expect(repository.findDuplicateCompletedInspection({
      inspectionId: 'new-inspection',
      storeId: 'store-1',
      controlNumber: 'ACU-0001',
      model: 'CV-100',
      username: 'maria',
    })).resolves.toMatchObject({ id: 'inspection-1' });
  });
});
