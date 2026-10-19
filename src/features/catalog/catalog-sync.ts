import type { SupabaseClient } from '@supabase/supabase-js';
import { sha256 } from 'hash-wasm';
import { getBrowserRepository } from '@/lib/db/browser';
import { getCurrentAccount } from '@/features/auth/account-password';
import type { LocalRepository } from '@/lib/db/repository';
import type { CatalogManifestState, CatalogRecord } from '@/lib/db/records';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { Database } from '@/lib/supabase/database.types';

type CatalogManifest = Pick<Database['public']['Tables']['catalog_manifests']['Row'], 'catalog_role' | 'version' | 'integrity_hash' | 'row_count' | 'schema_version' | 'storage_path'>;
type CatalogRepository = Pick<LocalRepository, 'getCatalogManifestState' | 'getCatalogProductCount' | 'replaceCatalog'>;

export type CatalogSyncResult =
  | { status: 'skipped'; reason: 'catalog-scope'; catalogRole?: 'masterlist' | 'guestlist' }
  | { status: 'unchanged'; version: number; rowCount: number; catalogRole: 'masterlist' | 'guestlist' }
  | { status: 'updated'; version: number; rowCount: number; catalogRole: 'masterlist' | 'guestlist' };

export async function syncCatalog(
  client: SupabaseClient<Database> = getSupabaseBrowserClient(),
  repository: CatalogRepository = getBrowserRepository(),
): Promise<CatalogSyncResult> {
  const account = await getCurrentAccount(client);
  return syncCatalogRole(account.role === 'guest' ? 'guestlist' : 'masterlist', client, repository);
}

export async function syncMasterlistCatalog(
  client: SupabaseClient<Database> = getSupabaseBrowserClient(),
  repository: CatalogRepository = getBrowserRepository(),
): Promise<CatalogSyncResult> {
  return syncCatalog(client, repository);
}

async function syncCatalogRole(
  catalogRole: 'masterlist' | 'guestlist',
  client: SupabaseClient<Database>,
  repository: CatalogRepository,
): Promise<CatalogSyncResult> {
  const { data: rawManifest, error: manifestError } = await client
    .from('catalog_manifests')
    .select('catalog_role, version, integrity_hash, row_count, schema_version, storage_path')
    .eq('catalog_role', catalogRole)
    .maybeSingle();
  if (manifestError) throw new Error(`Could not read the masterlist manifest: ${manifestError.message}`);
  if (!rawManifest) throw new Error('The published masterlist manifest was not found.');
  const manifest = rawManifest as CatalogManifest;

  const cached = await repository.getCatalogManifestState(catalogRole);
  const cachedProductCount = await repository.getCatalogProductCount(catalogRole);
  if (isSameManifest(cached, manifest) && cachedProductCount === manifest.row_count) {
    return { status: 'unchanged', version: manifest.version, rowCount: manifest.row_count, catalogRole };
  }

  const { data: file, error: downloadError } = await client.storage
    .from('catalogs')
    .download(manifest.storage_path);
  if (downloadError) throw new Error(`Could not download the ${catalogRole}: ${downloadError.message}`);

  const bytes = await file.arrayBuffer();
  const actualHash = await sha256Hex(bytes);
  if (normalizeHash(actualHash) !== normalizeHash(manifest.integrity_hash)) {
    throw new Error(`The downloaded ${catalogRole} failed its integrity check.`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`The downloaded ${catalogRole} is not valid JSON.`);
  }

  const rows = parseCatalogRows(payload, manifest, catalogRole);
  await repository.replaceCatalog(catalogRole, rows, {
    version: manifest.version,
    integrityHash: manifest.integrity_hash,
    rowCount: manifest.row_count,
    schemaVersion: manifest.schema_version,
    storagePath: manifest.storage_path,
  });

  return { status: 'updated', version: manifest.version, rowCount: rows.length, catalogRole };
}

export function parseCatalogRows(payload: unknown, manifest: Pick<CatalogManifest, 'row_count'>, catalogRole: 'masterlist' | 'guestlist' = 'masterlist'): CatalogRecord[] {
  if (!Array.isArray(payload)) throw new Error('The catalog payload must be a JSON array.');
  if (payload.length !== manifest.row_count) {
    throw new Error(`The masterlist row count (${payload.length}) does not match its manifest (${manifest.row_count}).`);
  }

  return payload.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`The catalog row at index ${index} is invalid.`);
    }
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id.trim()) {
      throw new Error(`The catalog row at index ${index} has no valid id.`);
    }
    return { ...row, id: row.id.trim(), catalogScope: catalogRole } as CatalogRecord;
  });
}

function isSameManifest(cached: CatalogManifestState | undefined, manifest: CatalogManifest): boolean {
  return cached?.version === manifest.version
    && cached.integrityHash === manifest.integrity_hash
    && cached.rowCount === manifest.row_count
    && cached.schemaVersion === manifest.schema_version
    && cached.storagePath === manifest.storage_path;
}

function normalizeHash(value: string): string {
  return value.trim().replace(/^sha256[:=-]/i, '').toLowerCase();
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return sha256(new Uint8Array(bytes));
}
