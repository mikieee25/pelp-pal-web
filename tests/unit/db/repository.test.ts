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
});
