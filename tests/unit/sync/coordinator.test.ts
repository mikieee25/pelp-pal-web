import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { PELPPalDatabase } from '@/lib/db/database';
import { LocalRepository } from '@/lib/db/repository';
import { SyncCoordinator } from '@/lib/sync/coordinator';
import { SYNC_PULL_PAGE_LIMIT } from '@/lib/sync/constants';
import { SyncConflictError } from '@/lib/supabase/remote-source';

const databases: PELPPalDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('SyncCoordinator', () => {
  it('pushes a queued item once and marks it acknowledged', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    repository.setCatalogRole('masterlist');
    await database.syncState.put({ id: 'catalog-manifest:masterlist', catalogRole: 'masterlist', version: 7, integrityHash: 'hash', rowCount: 1, schemaVersion: 1, storagePath: 'masterlist.json', updatedAt: new Date().toISOString() });
    await repository.enqueueOutbox({
      id: 'outbox-1',
      aggregateId: 'inspection-1',
      status: 'pending',
      nextAttemptAt: new Date(0).toISOString(),
      payload: { inspectionId: 'inspection-1' },
    });

    const pushed: string[] = [];
    let pulls = 0;
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => {
        pulls += 1;
        return { revisions: [], activities: [], conflicts: [], deletions: [] };
      },
      pushOutbox: async (item) => { pushed.push(item.id); },
    });

    await coordinator.syncNow('manual');

    expect(pushed).toEqual(['outbox-1']);
    expect(await repository.getOutbox('outbox-1')).toMatchObject({ status: 'synced' });
    expect(pulls).toBe(2);
    expect(coordinator.getStatus()).toBe('live');
    expect(coordinator.getSnapshot()).toMatchObject({ status: 'live', pendingCount: 0, conflictCount: 0, failedCount: 0, catalogVersion: 7 });
    expect(coordinator.getSnapshot().lastSyncedAt).toEqual(expect.any(String));
    expect(coordinator.getSnapshot().lastUploadAt).toEqual(expect.any(String));
  });

  it('reports local and remotely available inspection counts after synchronization', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    await database.inspections.put({ id: 'inspection-1', status: 'completed' });
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async () => undefined,
      getAvailableInspectionCount: async () => 2,
    });

    await coordinator.syncNow('manual', 'download');

    expect(coordinator.getSnapshot()).toMatchObject({
      localInspectionCount: 1,
      remoteInspectionCount: 2,
    });
  });

  it('reports explicit zero-change download and upload results', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    await repository.enqueueOutbox({
      id: 'outbox-counted',
      aggregateId: 'inspection-counted',
      status: 'pending',
      nextAttemptAt: new Date(0).toISOString(),
      payload: {},
    });
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async () => undefined,
    });

    await coordinator.syncNow('manual', 'download');
    expect(coordinator.getSnapshot().lastOperationResult).toMatchObject({
      operation: 'download',
      downloadedCount: 0,
      unchangedCount: 1,
    });

    await coordinator.syncNow('manual', 'upload');
    expect(coordinator.getSnapshot().lastOperationResult).toMatchObject({
      operation: 'upload',
      uploadedCount: 1,
      retryingCount: 0,
      conflictedCount: 0,
    });
  });

  it('serializes overlapping sync requests', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    let pulls = 0;
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => {
        pulls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await waiting;
        active -= 1;
        return { revisions: [], activities: [], conflicts: [], deletions: [] };
      },
      pushOutbox: async () => undefined,
    });

    const first = coordinator.syncNow('manual');
    const second = coordinator.syncNow('realtime');
    release();
    await Promise.all([first, second]);

    expect(pulls).toBe(2);
    expect(maxActive).toBe(1);
  });

  it('separates upload and download operations', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    repository.setCatalogRole('masterlist');
    await database.syncState.put({ id: 'catalog-manifest:masterlist', catalogRole: 'masterlist', version: 7, integrityHash: 'hash', rowCount: 1, schemaVersion: 1, storagePath: 'masterlist.json', updatedAt: new Date().toISOString() });
    await repository.enqueueOutbox({
      id: 'outbox-1',
      aggregateId: 'inspection-1',
      status: 'pending',
      nextAttemptAt: new Date(0).toISOString(),
      payload: {},
    });

    let pulls = 0;
    let pushes = 0;
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => {
        pulls += 1;
        return { revisions: [], activities: [], conflicts: [], deletions: [] };
      },
      pushOutbox: async () => { pushes += 1; },
    });

    await coordinator.syncNow('manual', 'upload');
    expect(pushes).toBe(1);
    expect(pulls).toBe(0);

    await coordinator.syncNow('manual', 'download');
    expect(pushes).toBe(1);
    expect(pulls).toBe(1);
    expect(coordinator.getSnapshot().lastDownloadAt).toEqual(expect.any(String));
  });

  it('stops after one short pull page', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    let pulls = 0;
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => {
        pulls += 1;
        return { revisions: [{ id: 'revision-1', change_cursor: 1 }], activities: [], conflicts: [], deletions: [] };
      },
      pushOutbox: async () => undefined,
    });

    await coordinator.syncNow('manual', 'download');

    expect(pulls).toBe(1);
  });

  it('fetches another page when a pull stream reaches the page limit', async () => {
    let cursor = 0;
    const repository = {
      recoverStaleOutbox: async () => undefined,
      getCursorState: async () => ({ revision: cursor, activity: 0, conflict: 0, deletion: 0 }),
      applyPullPage: async (page: { revisions: Array<{ change_cursor: number }> }) => {
        cursor = Math.max(cursor, ...page.revisions.map((row) => row.change_cursor));
      },
      getDueOutbox: async () => [],
      getSyncStatusCounts: async () => ({ pendingCount: 0, conflictCount: 0, failedCount: 0 }),
      getDevice: async () => undefined,
      getCatalogManifestState: async () => undefined,
      getCompletedInspectionCount: async () => 0,
    } as unknown as LocalRepository;
    let pulls = 0;
    const fullRevisionPage = Array.from({ length: SYNC_PULL_PAGE_LIMIT }, (_, index) => ({
      id: `revision-${index + 1}`,
      change_cursor: index + 1,
    }));
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => {
        pulls += 1;
        return pulls === 1
          ? { revisions: fullRevisionPage, activities: [], conflicts: [], deletions: [] }
          : { revisions: [], activities: [], conflicts: [], deletions: [] };
      },
      pushOutbox: async () => undefined,
    });

    await coordinator.syncNow('manual', 'download');

    expect(pulls).toBe(2);
  });

  it('does not run a post-push pull when a full sync has no outbox item', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    let pulls = 0;
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => {
        pulls += 1;
        return { revisions: [], activities: [], conflicts: [], deletions: [] };
      },
      pushOutbox: async () => undefined,
    });

    await coordinator.syncNow('manual', 'full');

    expect(pulls).toBe(1);
  });

  it('keeps a failed item and schedules bounded retry backoff', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    const now = Date.now();
    await repository.enqueueOutbox({
      id: 'outbox-retry',
      aggregateId: 'inspection-1',
      status: 'pending',
      nextAttemptAt: new Date(now - 1).toISOString(),
      payload: {},
    });

    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async () => { throw new Error('network unavailable'); },
    });

    await expect(coordinator.syncNow('manual')).rejects.toThrow('network unavailable');
    const item = await repository.getOutbox('outbox-retry');
    expect(item).toMatchObject({ status: 'retry', attempts: 1, lastError: { code: 'REMOTE_PUSH_FAILED' } });
    expect(Date.parse(String(item?.nextAttemptAt))).toBeGreaterThan(now);
  });

  it('keeps inspection sync successful and performs the post-push pull when a photo upload fails', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    repository.setAccountScope({ accountId: 'a', organizationId: 'org-1', key: 'org-1:a' });
    await repository.saveEvidenceImage('inspection-photo-failure', new Blob(['photo']), {
      fileName: 'photo.jpg', capturedAt: '2026-10-05T02:00:00.000Z',
    });
    await repository.completeInspection('inspection-photo-failure', { storeName: 'Store', controlNumber: 'ACU-1' });
    const evidence = (await repository.listEvidenceImages('inspection-photo-failure'))[0];
    let pulls = 0;
    const now = Date.now();
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => {
        pulls += 1;
        return { revisions: [], activities: [], conflicts: [], deletions: [] };
      },
      pushOutbox: async () => [{
        evidenceId: evidence.id, inspectionId: evidence.inspectionId,
        remotePath: `org-1/inspection-photo-failure/${evidence.id}.jpg`, sha256: evidence.sha256!, needsUpload: true,
      }],
      uploadEvidence: async () => { throw new Error('Evidence upload failed: StorageError (status 400): rejected'); },
    });

    await expect(coordinator.syncNow('manual', 'full')).resolves.toBeUndefined();

    expect(pulls).toBe(2);
    expect(coordinator.getSnapshot()).toMatchObject({ status: 'live', evidenceFailedCount: 1, evidencePendingCount: 0 });
    const photo = (await database.evidenceUploads.toArray())[0];
    expect(photo).toMatchObject({ status: 'failed', attempts: 1 });
    expect(Date.parse(photo.nextAttemptAt)).toBeGreaterThan(now);
    expect(await repository.getDueOutbox()).toEqual([]);
  });

  it('limits independent evidence uploads to two at a time', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    const blob = new Blob(['photo']);
    await database.evidenceUploads.bulkPut(Array.from({ length: 3 }, (_, index) => ({
      id: `local:photo-${index}`, evidenceId: `photo-${index}`, inspectionId: 'inspection-concurrency', remotePath: `org/inspection/photo-${index}.jpg`,
      sha256: `hash-${index}`, status: 'pending' as const, attempts: 0, nextAttemptAt: new Date(0).toISOString(),
    })));
    await database.evidenceBlobs.bulkPut(Array.from({ length: 3 }, (_, index) => ({
      id: `photo-${index}`, inspectionId: 'inspection-concurrency', blob,
      displayOrder: index, capturedAt: '', fileName: `photo-${index}.jpg`, mimeType: 'image/jpeg', size: blob.size,
    })));
    let active = 0;
    let maxActive = 0;
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async () => undefined,
      uploadEvidence: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return 'hash';
      },
    });

    await coordinator.syncNow('manual', 'download');

    expect(maxActive).toBe(2);
    expect(await database.evidenceUploads.where('status').equals('uploaded').count()).toBe(3);
  });

  it('caps photo retry backoff at five minutes', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    const blob = new Blob(['photo']);
    await database.evidenceUploads.put({ id: 'local:retry-photo', evidenceId: 'retry-photo', inspectionId: 'retry-inspection', remotePath: 'org/retry-inspection/retry-photo.jpg', sha256: 'hash', status: 'failed', attempts: 20, nextAttemptAt: new Date(0).toISOString() });
    await database.evidenceBlobs.put({ id: 'retry-photo', inspectionId: 'retry-inspection', blob, displayOrder: 0, capturedAt: '', fileName: 'photo.jpg', mimeType: 'image/jpeg', size: blob.size });
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async () => undefined,
      uploadEvidence: async () => { throw new Error('transient'); },
    });

    const startedAt = Date.now();
    await coordinator.syncNow('manual', 'download');
    const failed = await database.evidenceUploads.get('local:retry-photo');

    expect(failed?.attempts).toBe(21);
    expect(Date.parse(failed!.nextAttemptAt) - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(Date.parse(failed!.nextAttemptAt) - startedAt).toBeGreaterThan(4 * 60 * 1000);
  });

  it('retries delayed uploads immediately when the user starts a manual upload', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    await repository.enqueueOutbox({
      id: 'outbox-delayed-retry',
      aggregateId: 'inspection-1',
      status: 'retry',
      nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      payload: {},
    });
    const pushed: string[] = [];
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async (item) => { pushed.push(item.id); },
    });

    await coordinator.syncNow('manual', 'upload');

    expect(pushed).toEqual(['outbox-delayed-retry']);
    expect(await repository.getOutbox('outbox-delayed-retry')).toMatchObject({ status: 'synced' });
  });

  it('recovers stale pushing items after a browser interruption', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    await repository.enqueueOutbox({
      id: 'stale-pushing',
      aggregateId: 'inspection-1',
      status: 'pushing',
      nextAttemptAt: new Date(0).toISOString(),
      updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      payload: {},
    });
    const pushed: string[] = [];
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async (item) => { pushed.push(item.id); },
    });

    await coordinator.syncNow('startup');

    expect(pushed).toEqual(['stale-pushing']);
    expect(await repository.getOutbox('stale-pushing')).toMatchObject({ status: 'synced' });
  });

  it('continues uploading later items after one item fails', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    for (const id of ['poison', 'healthy']) {
      await repository.enqueueOutbox({ id, aggregateId: id, status: 'pending', nextAttemptAt: new Date(0).toISOString(), payload: {} });
    }
    const pushed: string[] = [];
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async (item) => { pushed.push(item.id); if (item.id === 'poison') throw new Error('poison'); },
    });

    await expect(coordinator.syncNow('manual', 'upload')).rejects.toThrow('poison');

    expect(pushed).toEqual(['healthy', 'poison']);
    expect(await repository.getOutbox('healthy')).toMatchObject({ status: 'synced' });
    expect(await repository.getOutbox('poison')).toMatchObject({ status: 'retry' });
  });

  it('runs a queued full sync after an upload is already in flight', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    let pulls = 0;
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => { pulls += 1; return { revisions: [], activities: [], conflicts: [], deletions: [] }; },
      pushOutbox: async () => { await waiting; },
    });
    await repository.enqueueOutbox({ id: 'upload-1', aggregateId: 'upload-1', status: 'pending', nextAttemptAt: new Date(0).toISOString(), payload: {} });

    const upload = coordinator.syncNow('manual', 'upload');
    const full = coordinator.syncNow('realtime', 'full');
    release();
    await Promise.all([upload, full]);

    expect(pulls).toBe(1);
  });

  it('runs a queued sync after the in-flight sync fails', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    let rejectFirst!: (error: Error) => void;
    const firstPush = new Promise<void>((_, reject) => { rejectFirst = reject; });
    let resolvePushStarted!: () => void;
    const pushStarted = new Promise<void>((resolve) => { resolvePushStarted = resolve; });
    let pulls = 0;
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => {
        pulls += 1;
        return { revisions: [], activities: [], conflicts: [], deletions: [] };
      },
      pushOutbox: async () => {
        resolvePushStarted();
        await firstPush;
      },
    });
    await repository.enqueueOutbox({ id: 'failing-upload', aggregateId: 'failing-upload', status: 'pending', nextAttemptAt: new Date(0).toISOString(), payload: {} });

    const first = coordinator.syncNow('manual', 'upload');
    void first.catch(() => undefined);
    const firstOutcome = first.then(() => undefined, (error: unknown) => error);
    const queued = coordinator.syncNow('realtime', 'download');
    await pushStarted;
    rejectFirst(new Error('temporary push failure'));

    await expect(firstOutcome).resolves.toMatchObject({ message: 'temporary push failure' });
    await expect(queued).resolves.toBeUndefined();
    expect(pulls).toBe(1);
  });

  it('rejects a pull page that has rows but does not advance its cursor', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    await repository.applyPullPage({ revisions: [{ id: 'revision-1', change_cursor: 4 }], activities: [], conflicts: [], deletions: [] });
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [{ id: 'revision-1', change_cursor: 4 }], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async () => undefined,
    });

    await expect(coordinator.syncNow('manual', 'download')).rejects.toThrow(/progress/i);
  });

  it('rebuilds and retries an absent-server conflict once', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    const revision = (id: string, number: number) => ({ id, inspection_id: 'missing-server', revision: number, base_revision: number - 1, payload: {} });
    await repository.enqueueOutbox({
      id: 'missing-server-rev-1', aggregateId: 'missing-server', kind: 'inspection', status: 'pending', nextAttemptAt: new Date(0).toISOString(),
      payload: { inspection_id: 'missing-server', revisions: [revision('rev-1', 1)], events: [{ id: 'event-1' }] },
    });
    await repository.enqueueOutbox({
      id: 'missing-server-rev-2', aggregateId: 'missing-server', kind: 'inspection', status: 'pending', nextAttemptAt: new Date(0).toISOString(),
      payload: { inspection_id: 'missing-server', revisions: [revision('rev-2', 2)], events: [{ id: 'event-2' }] },
    });
    let pushes = 0;
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async () => {
        pushes += 1;
        if (pushes === 1) throw new SyncConflictError('missing server head', 0);
      },
    });

    await coordinator.syncNow('manual', 'upload');

    expect(pushes).toBe(2);
    expect(await database.outbox.where('aggregateId').equals('missing-server').toArray()).toMatchObject([
      { status: 'synced', payload: { revisions: [{ revision: 1 }, { revision: 2 }], events: [{ id: 'event-1' }, { id: 'event-2' }] } },
    ]);
    expect(coordinator.getSnapshot()).toMatchObject({ conflictCount: 0, failedCount: 0 });
  });

  it('keeps a real server conflict blocked and does not rebuild it', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    await repository.enqueueOutbox({ id: 'real-conflict', aggregateId: 'real-conflict', kind: 'inspection', status: 'pending', nextAttemptAt: new Date(0).toISOString(), payload: {} });
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async () => { throw new SyncConflictError('newer server revision', 3, 'server-rev-3'); },
    });

    await expect(coordinator.syncNow('manual', 'upload')).rejects.toThrow('newer server revision');
    await expect(repository.getOutbox('real-conflict')).resolves.toMatchObject({ status: 'conflict', lastError: { serverHead: 3, serverHeadId: 'server-rev-3' } });
  });

  it('repairs a stored absent-server conflict during manual upload', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    await repository.enqueueOutbox({
      id: 'stored-missing-server', aggregateId: 'stored-missing-server', kind: 'inspection', status: 'conflict', nextAttemptAt: new Date(0).toISOString(),
      lastError: { code: 'SYNC_CONFLICT', message: 'missing server head', serverHead: 0 },
      payload: { inspection_id: 'stored-missing-server', revisions: [{ id: 'rev-1', revision: 1, base_revision: 0, payload: {} }], events: [] },
    });
    let pushes = 0;
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async () => { pushes += 1; },
    });

    await coordinator.syncNow('manual', 'upload');

    expect(pushes).toBe(1);
    await expect(repository.getOutbox('stored-missing-server')).resolves.toMatchObject({ status: 'synced' });
  });

  it('guards against repeatedly rebuilding the same absent-server conflict', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    await repository.enqueueOutbox({ id: 'loop-conflict', aggregateId: 'loop-conflict', kind: 'inspection', status: 'pending', nextAttemptAt: new Date(0).toISOString(), payload: {} });
    let pushes = 0;
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async () => { pushes += 1; throw new SyncConflictError('still missing', 0); },
    });

    await expect(coordinator.syncNow('manual', 'upload')).rejects.toThrow('still missing');
    expect(pushes).toBe(2);
    await expect(repository.getOutbox('loop-conflict')).resolves.toBeUndefined();
    const remaining = await database.outbox.where('aggregateId').equals('loop-conflict').toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ status: 'conflict', lastError: { serverHead: 0 } });
  });
});
