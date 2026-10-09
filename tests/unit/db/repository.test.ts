import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { PELPPalDatabase } from '@/lib/db/database';
import { LocalRepository } from '@/lib/db/repository';

const databases: PELPPalDatabase[] = [];

afterEach(async () => {
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

describe('LocalRepository', () => {
  it('creates one stable installation id per database', async () => {
    const repository = createRepository();

    const first = await repository.getOrCreateInstallationId();
    const second = await repository.getOrCreateInstallationId();

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
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

  it('counts local dashboard work and scopes catalog lookup to the enrolled device', async () => {
    const { database, repository } = createRepositoryWithDatabase();
    await database.device.put({
      id: 'current',
      installationId: 'installation-1',
      catalogScope: 'guestlist',
      enrolled: true,
      updatedAt: new Date().toISOString(),
    });
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
    const original = await repository.saveEvidenceImage('inspection-replace', new Blob(['old'], { type: 'image/jpeg' }), {
      fileName: 'old.jpg', capturedAt: '2026-10-05T02:00:00.000Z',
    });
    const replacement = await repository.replaceEvidenceImage(original.id, new Blob(['new'], { type: 'image/jpeg' }), {
      fileName: 'new.jpg', capturedAt: '2026-10-05T03:00:00.000Z',
    });
    expect(replacement).toMatchObject({ id: original.id, displayOrder: 0, fileName: 'new.jpg', capturedAt: '2026-10-05T03:00:00.000Z' });
    await expect(repository.listEvidenceImages('inspection-replace')).resolves.toMatchObject([{ id: original.id, fileName: 'new.jpg' }]);
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
    const { repository } = createRepositoryWithDatabase();
    await repository.saveInspectionDraft('inspection-delete', { storeName: 'Store' });
    await repository.completeInspection('inspection-delete', {
      storeName: 'Store',
      controlNumber: 'ACU-DELETE',
      outcome: 'non_compliant',
      evidenceCount: 1,
    });
    await repository.saveEvidenceImage('inspection-delete', new Blob(['image'], { type: 'image/png' }), {
      fileName: 'evidence.png',
      capturedAt: '2026-10-05T02:00:00.000Z',
    });

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
          storage_paths: [],
        }),
      }),
    ]);
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
      { id: 'synced-1', aggregateId: 'inspection-3', status: 'synced', nextAttemptAt: now },
    ]);

    await expect(repository.retryFailedOutbox()).resolves.toBe(2);
    await expect(database.outbox.get('failed-1')).resolves.toMatchObject({ status: 'retry' });
    await expect(database.outbox.get('failed-1')).resolves.not.toHaveProperty('lastError');
    await expect(database.outbox.get('retry-1')).resolves.toMatchObject({ status: 'retry' });
    await expect(database.outbox.get('retry-1')).resolves.not.toHaveProperty('lastError');
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
      name: 'Sample Appliance Center',
      location: 'NCR',
      contactName: 'Alex Santos',
    });
    await expect(repository.getCurrentStore()).resolves.toMatchObject({ name: 'Sample Appliance Center' });

    await repository.saveCurrentStore({ ...saved, name: 'Updated Appliance Center' });
    await expect(repository.getCurrentStore()).resolves.toMatchObject({ name: 'Updated Appliance Center' });
    await expect(repository.listSavedStores()).resolves.toEqual([]);

    await repository.saveCurrentStore({ storeId: 'VIS-20261005-002', name: 'South Store', location: 'Visayas' });
    await expect(repository.listSavedStores()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ storeId: 'NCR-20261005-001', name: 'Updated Appliance Center' }),
    ]));
    await expect(repository.switchCurrentStore('NCR-20261005-001')).resolves.toMatchObject({ name: 'Updated Appliance Center' });
    await expect(repository.getCurrentStore()).resolves.toMatchObject({ name: 'Updated Appliance Center' });

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
