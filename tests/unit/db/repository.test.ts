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

  it('finishes an inspection, records activity, and removes its draft', async () => {
    const { repository } = createRepositoryWithDatabase();
    await repository.saveInspectionDraft('inspection-1', { storeName: 'Store', currentStep: 'checklist' });

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

  it('maps completed activity rows and filters them by outcome and product type', async () => {
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

    await expect(repository.listActivity({ outcome: 'compliant' })).resolves.toMatchObject([
      { id: 'activity-1', storeName: 'North Store', productType: 'Air Conditioners', outcome: 'compliant' },
    ]);
    await expect(repository.listActivity({ productType: 'Electric Fans' })).resolves.toMatchObject([
      { id: 'activity-2', storeName: 'South Store', outcome: 'non_compliant' },
    ]);
    await expect(repository.listActivity()).resolves.toHaveLength(2);
  });
});
