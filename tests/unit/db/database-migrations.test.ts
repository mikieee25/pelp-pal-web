import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { PELPPalDatabase } from '@/lib/db/database';

const databases: PELPPalDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('database migrations', () => {
  it('opens the current schema with report drafts', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    await database.open();

    expect(database.tables.map((table) => table.name)).toContain('reportDrafts');
  });
});
