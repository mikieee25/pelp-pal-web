import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { PELPPalDatabase } from '@/lib/db/database';
import { LocalRepository } from '@/lib/db/repository';

const databases: PELPPalDatabase[] = [];

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.delete())));

describe('inspection draft persistence', () => {
  it('restores a draft after the repository is reopened', async () => {
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    await repository.saveInspectionDraft('inspection-1', { storeName: 'Store', currentStep: 'product' });

    expect(await repository.getInspectionDraft('inspection-1')).toMatchObject({
      id: 'inspection-1',
      storeName: 'Store',
      currentStep: 'product',
    });
  });
});
