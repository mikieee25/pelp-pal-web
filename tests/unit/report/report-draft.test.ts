import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { PELPPalDatabase } from '@/lib/db/database';
import { LocalRepository } from '@/lib/db/repository';
import { createEmptyReportDraft } from '@/features/report/report-draft';

const databases: PELPPalDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('report drafts', () => {
  it('saves and reloads drafts independently for finished stores', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    const first = { ...createEmptyReportDraft('store-1'), storeName: 'First Store' };
    const second = { ...createEmptyReportDraft('store-2'), storeName: 'Second Store' };

    await repository.saveReportDraft(first);
    await repository.saveReportDraft(second);

    await expect(repository.getReportDraft('store-1')).resolves.toMatchObject({ storeName: 'First Store' });
    await expect(repository.getReportDraft('store-2')).resolves.toMatchObject({ storeName: 'Second Store' });
  });
});
