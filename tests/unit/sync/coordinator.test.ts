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
    expect(coordinator.getSnapshot()).toMatchObject({ status: 'live', pendingCount: 0, conflictCount: 0 });
    expect(coordinator.getSnapshot().lastSyncedAt).toEqual(expect.any(String));
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
});
