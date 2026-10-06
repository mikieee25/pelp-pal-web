import { describe, expect, it } from 'vitest';
import { inspectMasterlistFile } from '@/features/catalog/catalog-publish-validation';

function file(value: unknown, name = 'masterlist.json'): File {
  const contents = JSON.stringify(value);
  const result = new File([contents], name, { type: 'application/json' });
  Object.defineProperty(result, 'arrayBuffer', { value: async () => new TextEncoder().encode(contents).buffer });
  return result;
}

describe('inspectMasterlistFile', () => {
  it('returns metadata for a valid catalog', async () => {
    const result = await inspectMasterlistFile(file([
      { id: '2', product_type: 'Television Sets', source_version: 1 },
      { id: '1', product_type: 'Air Conditioners', source_version: 1 },
    ]));

    expect(result.rowCount).toBe(2);
    expect(result.productTypes).toEqual(['Air Conditioners', 'Television Sets']);
    expect(result.schemaVersion).toBe(1);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ['wrong file name', [{ id: '1', product_type: 'AC', source_version: 1 }], 'catalog.json', /masterlist\.json/i],
    ['non-array JSON', { id: '1' }, 'masterlist.json', /non-empty JSON array/i],
    ['missing id', [{ product_type: 'AC', source_version: 1 }], 'masterlist.json', /row 1.*id/i],
    ['blank id', [{ id: '  ', product_type: 'AC', source_version: 1 }], 'masterlist.json', /row 1.*id/i],
    ['missing product type', [{ id: '1', source_version: 1 }], 'masterlist.json', /product_type/i],
    ['unsupported schema', [{ id: '1', product_type: 'AC', source_version: 2 }], 'masterlist.json', /schema version/i],
  ])('rejects %s', async (_label, payload, name, message) => {
    await expect(inspectMasterlistFile(file(payload, name))).rejects.toThrow(message);
  });

  it('rejects duplicate ids with the duplicate value', async () => {
    await expect(inspectMasterlistFile(file([
      { id: 'same', product_type: 'AC', source_version: 1 },
      { id: 'same', product_type: 'AC', source_version: 1 },
    ]))).rejects.toThrow(/same/);
  });

  it('rejects an empty file', async () => {
    const empty = new File([], 'masterlist.json');
    Object.defineProperty(empty, 'arrayBuffer', { value: async () => new ArrayBuffer(0) });
    await expect(inspectMasterlistFile(empty)).rejects.toThrow(/empty/i);
  });
});
