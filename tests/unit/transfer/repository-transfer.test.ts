import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { PELPPalDatabase } from '@/lib/db/database';
import { LocalRepository } from '@/lib/db/repository';
import type { AccountScope, OutboxRecord } from '@/lib/db/records';
import type { TransferBundle } from '@/lib/transfer/transfer-codec';

const databases: PELPPalDatabase[] = [];
const scope: AccountScope = { accountId: 'account-current', organizationId: 'org-1', key: 'org-1:account-current' };

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

function createRepository() {
  const database = new PELPPalDatabase(`transfer-${crypto.randomUUID()}`);
  databases.push(database);
  const repository = new LocalRepository(database);
  repository.setAccountScope(scope);
  return { database, repository };
}

function bundle(overrides: Partial<TransferBundle> = {}): TransferBundle {
  return {
    format: 'pelp-pal-transfer',
    schemaVersion: 1,
    exportMode: 'pending',
    exportedAt: '2026-10-12T08:00:00.000Z',
    appVersion: '0.1.0',
    organizationId: 'org-1',
    sourceAccountId: 'account-other',
    records: {
      inspections: [{ id: 'inspection-a', status: 'completed', storeName: 'Air King', currentRevision: 1 }],
      revisions: [{ id: 'revision-a', inspection_id: 'inspection-a', revision: 1, payload: { id: 'inspection-a', status: 'completed' } }],
      activities: [{ id: 'activity-a', inspection_id: 'inspection-a', event_type: 'inspection_completed' }],
      evidence: [],
      evidenceBlobs: [],
      outbox: [{ id: 'outbox-a', aggregateId: 'inspection-a', kind: 'inspection', status: 'pending', nextAttemptAt: '2026-10-12T08:00:00.000Z', payload: { inspection_id: 'inspection-a', revisions: [], events: [] } }],
    },
    ...overrides,
  };
}

describe('LocalRepository transfer recovery', () => {
  it('lists stores and filters pending recovery exports by store', async () => {
    const { database, repository } = createRepository();
    await database.inspections.bulkPut([
      { id: 'inspection-air-1', status: 'completed', storeName: 'Air King', location: 'Mindanao', accountScopeKey: scope.key },
      { id: 'inspection-air-2', status: 'completed', storeName: 'Air King', location: 'Mindanao', accountScopeKey: scope.key },
      { id: 'inspection-sample', status: 'completed', storeName: 'Sample Store', location: 'Luzon', accountScopeKey: scope.key },
    ]);
    await database.outbox.bulkPut([
      { id: 'outbox-air', aggregateId: 'inspection-air-1', status: 'pending', nextAttemptAt: new Date(0).toISOString(), accountScopeKey: scope.key },
      { id: 'outbox-sample', aggregateId: 'inspection-sample', status: 'pending', nextAttemptAt: new Date(0).toISOString(), accountScopeKey: scope.key },
    ]);

    const stores = await repository.listTransferStores();
    expect(stores).toEqual([
      { key: 'store:air king\u0000mindanao', name: 'Air King', location: 'Mindanao', inspectionCount: 2 },
      { key: 'store:sample store\u0000luzon', name: 'Sample Store', location: 'Luzon', inspectionCount: 1 },
    ]);
    const exported = await repository.exportTransferBundle('pending', ['store:sample store\u0000luzon']);
    expect(exported.records.inspections.map((row) => row.id)).toEqual(['inspection-sample']);
    expect(exported.records.outbox.map((row) => row.id)).toEqual(['outbox-sample']);
  });

  it('includes saved store profiles in recovery JSON and can restore them on another device', async () => {
    const source = createRepository();
    await source.database.stores.bulkPut([
      { id: 'current', storeId: 'VIS-20261022-001', name: 'Desmark Laviña Appliance', location: 'Mindanao', address: 'Iloilo City', updatedAt: '2026-10-22T00:00:00.000Z' },
      { id: 'store:VIS-20261022-001', storeId: 'VIS-20261022-001', name: 'Desmark Laviña Appliance', location: 'Mindanao', address: 'Iloilo City', updatedAt: '2026-10-22T00:00:00.000Z' },
    ]);

    await expect(source.repository.listTransferStores()).resolves.toContainEqual({
      key: 'store:desmark laviña appliance\u0000mindanao',
      name: 'Desmark Laviña Appliance',
      location: 'Mindanao',
      inspectionCount: 0,
    });
    const exported = await source.repository.exportTransferBundle('pending');
    expect(exported.records.stores).toEqual([
      expect.objectContaining({ storeId: 'VIS-20261022-001', name: 'Desmark Laviña Appliance', location: 'Mindanao' }),
    ]);

    const target = createRepository();
    await target.repository.mergeTransferBundle(exported);
    await expect(target.repository.listSavedStores()).resolves.toContainEqual(
      expect.objectContaining({ storeId: 'VIS-20261022-001', name: 'DESMARK LAVIÑA APPLIANCE', location: 'Mindanao' }),
    );
  });

  it('exports only active-scope pending work without cursors', async () => {
    const { database, repository } = createRepository();
    await database.inspections.bulkPut([
      { id: 'inspection-a', status: 'completed', accountScopeKey: scope.key },
      { id: 'inspection-b', status: 'completed', accountScopeKey: 'org-1:other-account' },
    ]);
    await database.outbox.bulkPut([
      { id: 'outbox-a', aggregateId: 'inspection-a', status: 'pending', nextAttemptAt: new Date(0).toISOString(), accountScopeKey: scope.key },
      { id: 'outbox-b', aggregateId: 'inspection-b', status: 'pending', nextAttemptAt: new Date(0).toISOString(), accountScopeKey: 'org-1:other-account' },
    ]);
    const exported = await repository.exportTransferBundle('pending');

    expect(exported.records.inspections.map((row) => row.id)).toEqual(['inspection-a']);
    expect(exported.records.outbox.map((row) => row.id)).toEqual(['outbox-a']);
    expect(JSON.stringify(exported)).not.toMatch(/change_cursor|syncCursors|access_token|password/i);
  });

  it('includes saved store profiles in recovery exports and imports them on another device', async () => {
    const source = createRepository();
    await source.repository.saveCurrentStore({ storeId: 'DESMARK-1', name: 'Desmark Laviña Appliance', location: 'Mindanao' });
    const stores = await source.repository.listTransferStores();
    expect(stores).toEqual([{ key: 'store:desmark laviña appliance\u0000mindanao', name: 'DESMARK LAVIÑA APPLIANCE', location: 'Mindanao', inspectionCount: 0 }]);
    const exported = await source.repository.exportTransferBundle('full');
    expect(exported.records.stores).toEqual([expect.objectContaining({ storeId: 'DESMARK-1', name: 'DESMARK LAVIÑA APPLIANCE' })]);

    const target = createRepository();
    await target.repository.mergeTransferBundle(bundle({ records: { ...bundle().records, stores: exported.records.stores } }));
    await expect(target.database.stores.get('store:DESMARK-1')).resolves.toMatchObject({ name: 'DESMARK LAVIÑA APPLIANCE', accountScopeKey: scope.key });
  });

  it('rejects another organization before changing IndexedDB', async () => {
    const { database, repository } = createRepository();
    await expect(repository.previewTransferMerge(bundle({ organizationId: 'org-2' }))).rejects.toThrow(/organization/i);
    expect(await database.inspections.count()).toBe(0);
  });

  it('merges imported work into the current account scope and is idempotent', async () => {
    const { database, repository } = createRepository();
    const first = await repository.mergeTransferBundle(bundle());
    const second = await repository.mergeTransferBundle(bundle());

    expect(first.importedCount).toBeGreaterThan(0);
    expect(second.importedCount).toBe(0);
    expect(await database.inspections.get('inspection-a')).toMatchObject({ accountScopeKey: scope.key });
    expect(await database.outbox.where('accountScopeKey').equals(scope.key).count()).toBe(1);
    expect(await database.inspectionRevisions.where('inspection_id').equals('inspection-a').count()).toBe(1);
  });

  it('preserves local data and records a conflict for equal divergent revisions', async () => {
    const { database, repository } = createRepository();
    await database.inspections.put({ id: 'inspection-a', status: 'completed', currentRevision: 1, storeName: 'Local', accountScopeKey: scope.key });
    const result = await repository.mergeTransferBundle(bundle());

    expect(result.conflictCount).toBe(1);
    expect(await database.inspections.get('inspection-a')).toMatchObject({ storeName: 'Local' });
    expect(await database.conflicts.count()).toBe(1);
    expect(await database.outbox.count()).toBe(0);
    expect(await database.inspectionRevisions.count()).toBe(0);
    expect(await database.activity.count()).toBe(0);
  });

  it('does not import history or uploads for an older skipped inspection', async () => {
    const { database, repository } = createRepository();
    await database.inspections.put({ id: 'inspection-a', currentRevision: 2, storeName: 'Newer', accountScopeKey: scope.key });
    const result = await repository.mergeTransferBundle(bundle());
    expect(result.skippedCount).toBe(1);
    expect(await database.outbox.count()).toBe(0);
    expect(await database.inspectionRevisions.count()).toBe(0);
    expect(await database.activity.count()).toBe(0);
  });
});
