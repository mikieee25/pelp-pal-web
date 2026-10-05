import { describe, expect, it, vi } from 'vitest';
import { parseCatalogRows, syncMasterlistCatalog } from '@/features/catalog/catalog-sync';

const manifest = {
  catalog_role: 'masterlist',
  version: 2,
  integrity_hash: '42696a60028a36583d60a329d80d56cf930bc303186809daabf6c2b0bdb42d19',
  organization_id: 'org-1',
  published_at: '2026-10-05T00:00:00.000Z',
  row_count: 1,
  schema_version: 1,
  storage_path: 'masterlist.json',
};

describe('catalog sync', () => {
  it('converts a validated masterlist payload into scoped catalog records', () => {
    expect(parseCatalogRows([
      { id: 'product-1', product_type: 'Television Sets', brand: 'Devant' },
    ], manifest)).toEqual([
      { id: 'product-1', product_type: 'Television Sets', brand: 'Devant', catalogScope: 'masterlist' },
    ]);
  });

  it('rejects a masterlist whose row count does not match its manifest', () => {
    expect(() => parseCatalogRows([], manifest)).toThrow(/row count/i);
  });

  it('downloads and caches a newer masterlist for an enrolled masterlist device', async () => {
    const replaceCatalog = vi.fn().mockResolvedValue(undefined);
    const repository = {
      getDevice: vi.fn().mockResolvedValue({ catalogScope: 'masterlist', enrolled: true }),
      getCatalogManifestState: vi.fn().mockResolvedValue(undefined),
      replaceCatalog,
    };
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: manifest, error: null }) })),
        })),
      })),
      storage: {
        from: vi.fn(() => ({
          download: vi.fn().mockResolvedValue({
            data: { arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify([{ id: 'product-1' }])).buffer) },
            error: null,
          }),
        })),
      },
    };

    await syncMasterlistCatalog(client as never, repository as never);

    expect(replaceCatalog).toHaveBeenCalledWith('masterlist', [
      { id: 'product-1', catalogScope: 'masterlist' },
    ], expect.objectContaining({ version: 2, rowCount: 1 }));
  });
});
