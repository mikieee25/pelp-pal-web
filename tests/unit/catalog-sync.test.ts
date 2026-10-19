import { describe, expect, it, vi } from 'vitest';
import { sha256 } from 'hash-wasm';
import { parseCatalogRows, syncCatalog, syncMasterlistCatalog } from '@/features/catalog/catalog-sync';

const { getCurrentAccount } = vi.hoisted(() => ({ getCurrentAccount: vi.fn() }));
vi.mock('@/features/auth/account-password', () => ({ getCurrentAccount }));

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

  it('downloads and caches a newer masterlist for an authenticated personnel account', async () => {
    const replaceCatalog = vi.fn().mockResolvedValue(undefined);
    const repository = {
      getCatalogManifestState: vi.fn().mockResolvedValue(undefined),
      getCatalogProductCount: vi.fn().mockResolvedValue(0),
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
      rpc: vi.fn(),
    };
    getCurrentAccount.mockResolvedValue({ role: 'admin', isActive: true });

    await syncMasterlistCatalog(client as never, repository as never);

    expect(replaceCatalog).toHaveBeenCalledWith('masterlist', [
      { id: 'product-1', catalogScope: 'masterlist' },
    ], expect.objectContaining({ version: 2, rowCount: 1 }));
  });

  it('repairs an empty local catalog even when its cached manifest is unchanged', async () => {
    const replaceCatalog = vi.fn().mockResolvedValue(undefined);
    const repository = {
      getCatalogManifestState: vi.fn().mockResolvedValue({
        catalogRole: 'masterlist', version: manifest.version, integrityHash: manifest.integrity_hash,
        rowCount: manifest.row_count, schemaVersion: manifest.schema_version, storagePath: manifest.storage_path,
      }),
      getCatalogProductCount: vi.fn().mockResolvedValue(0),
      replaceCatalog,
    };
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: manifest, error: null }) })) })),
      })),
      storage: { from: vi.fn(() => ({ download: vi.fn().mockResolvedValue({
        data: { arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify([{ id: 'product-1' }])).buffer) }, error: null,
      }) })) },
    };
    getCurrentAccount.mockResolvedValue({ role: 'admin', isActive: true });

    const result = await syncMasterlistCatalog(client as never, repository as never);

    expect(result.status).toBe('updated');
    expect(replaceCatalog).toHaveBeenCalledOnce();
  });

  it('verifies and stores a catalog when Web Crypto is unavailable on an HTTP LAN origin', async () => {
    const payloadBytes = new TextEncoder().encode(JSON.stringify([{ id: 'product-1' }]));
    const httpManifest = { ...manifest, integrity_hash: await sha256(payloadBytes) };
    const replaceCatalog = vi.fn().mockResolvedValue(undefined);
    const repository = {
      getCatalogManifestState: vi.fn().mockResolvedValue(undefined),
      getCatalogProductCount: vi.fn().mockResolvedValue(0),
      replaceCatalog,
    };
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: httpManifest, error: null }) })) })),
      })),
      storage: { from: vi.fn(() => ({ download: vi.fn().mockResolvedValue({
        data: { arrayBuffer: vi.fn().mockResolvedValue(payloadBytes.buffer) }, error: null,
      }) })) },
    };
    const originalCrypto = globalThis.crypto;
    getCurrentAccount.mockResolvedValue({ role: 'admin', isActive: true });
    vi.stubGlobal('crypto', { subtle: undefined });

    try {
      await expect(syncMasterlistCatalog(client as never, repository as never)).resolves.toMatchObject({ status: 'updated' });
      expect(replaceCatalog).toHaveBeenCalledOnce();
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });

  it('downloads the assigned guest catalog instead of the masterlist', async () => {
    const replaceCatalog = vi.fn().mockResolvedValue(undefined);
    const guestBytes = new TextEncoder().encode(JSON.stringify([{ id: 'guest-1' }]));
    const digest = await crypto.subtle.digest('SHA-256', guestBytes);
    const guestHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const guestManifest = { ...manifest, catalog_role: 'guestlist', integrity_hash: guestHash };
    const repository = {
      getCatalogManifestState: vi.fn().mockResolvedValue(undefined),
      getCatalogProductCount: vi.fn().mockResolvedValue(0),
      replaceCatalog,
    };
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: guestManifest, error: null }) })),
        })),
      })),
      storage: {
        from: vi.fn(() => ({
          download: vi.fn().mockResolvedValue({
            data: { arrayBuffer: vi.fn().mockResolvedValue(guestBytes.buffer) },
            error: null,
          }),
        })),
      },
      rpc: vi.fn(),
    };
    getCurrentAccount.mockResolvedValue({ role: 'guest', isActive: true });

    await syncCatalog(client as never, repository as never);

    expect(replaceCatalog).toHaveBeenCalledWith('guestlist', [{ id: 'guest-1', catalogScope: 'guestlist' }], expect.objectContaining({ version: 2 }));
  });
});
