import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { PELPPalDatabase } from '@/lib/db/database';
import { LocalRepository } from '@/lib/db/repository';
import { SyncCoordinator } from '@/lib/sync/coordinator';

const databases: PELPPalDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('SyncCoordinator', () => {
  it('pushes a queued item once and marks it acknowledged', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    await database.device.put({ id: 'current', installationId: 'install-1', catalogScope: 'masterlist', enrolled: true, updatedAt: new Date().toISOString() });
    await database.syncState.put({ id: 'catalog-manifest:masterlist', catalogRole: 'masterlist', version: 7, integrityHash: 'hash', rowCount: 1, schemaVersion: 1, storagePath: 'masterlist.json', updatedAt: new Date().toISOString() });
    await repository.enqueueOutbox({
      id: 'outbox-1',
      aggregateId: 'inspection-1',
      status: 'pending',
      nextAttemptAt: new Date(0).toISOString(),
      payload: { inspectionId: 'inspection-1' },
    });

    const pushed: string[] = [];
    const coordinator = new SyncCoordinator(repository, {
      pullSyncChanges: async () => ({ revisions: [], activities: [], conflicts: [], deletions: [] }),
      pushOutbox: async (item) => { pushed.push(item.id); },
    });

    await coordinator.syncNow('manual');

    expect(pushed).toEqual(['outbox-1']);
    expect(await repository.getOutbox('outbox-1')).toMatchObject({ status: 'synced' });
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

    expect(pulls).toBe(4);
    expect(maxActive).toBe(1);
  });

  it('separates upload and download operations', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    await database.device.put({ id: 'current', installationId: 'install-1', catalogScope: 'masterlist', enrolled: true, updatedAt: new Date().toISOString() });
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

    expect(pulls).toBe(2);
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
});
