import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { Database } from '@/lib/supabase/database.types';
import type { MasterlistInspection } from './catalog-publish-validation';

export type CatalogPublishResult = {
  catalogRole: 'masterlist';
  version: number;
  rowCount: number;
  integrityHash: string;
  storagePath: string;
  publishedAt: string;
};

type PublishClient = SupabaseClient<Database>;
type SignedUpload = { upload_path: string; token: string };
type PublishResponse = {
  catalog_role: 'masterlist';
  version: number;
  row_count: number;
  integrity_hash: string;
  storage_path: string;
  published_at: string;
};

export async function publishMasterlist(
  file: File,
  inspection: MasterlistInspection,
  client: PublishClient = getSupabaseBrowserClient(),
): Promise<CatalogPublishResult> {
  const metadata = {
    catalog_role: 'masterlist' as const,
    file_name: inspection.fileName,
    row_count: inspection.rowCount,
    sha256: inspection.sha256,
    schema_version: inspection.schemaVersion,
  };

  const initiate = await client.functions.invoke<SignedUpload>('catalog-publish', {
    body: { action: 'initiate', ...metadata },
  });
  if (initiate.error || !initiate.data?.upload_path || !initiate.data.token) {
    throw new Error(`Could not start the catalog upload: ${initiate.error?.message ?? 'The server returned an invalid upload target.'}`);
  }

  const { upload_path: uploadPath, token } = initiate.data;
  const upload = await client.storage.from('catalogs').uploadToSignedUrl(uploadPath, token, file);
  if (upload.error) throw new Error(`Could not upload the catalog: ${upload.error.message}`);

  const finalize = await client.functions.invoke<PublishResponse>('catalog-publish', {
    body: {
      action: 'finalize',
      upload_path: uploadPath,
      ...metadata,
    },
  });
  if (finalize.error || !finalize.data) {
    throw new Error(`Could not publish the catalog: ${finalize.error?.message ?? 'The server returned no publication.'}`);
  }

  const result = finalize.data;
  return {
    catalogRole: result.catalog_role,
    version: result.version,
    rowCount: result.row_count,
    integrityHash: result.integrity_hash,
    storagePath: result.storage_path,
    publishedAt: result.published_at,
  };
}
