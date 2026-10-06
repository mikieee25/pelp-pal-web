import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishMasterlist } from '@/features/catalog/catalog-publish-client';
import type { Database } from '@/lib/supabase/database.types';
import type { MasterlistInspection } from '@/features/catalog/catalog-publish-validation';

const inspection: MasterlistInspection = {
  fileName: 'masterlist.json',
  sizeBytes: 42,
  rowCount: 2,
  duplicateIds: [],
  productTypes: ['AC'],
  sha256: 'a'.repeat(64),
  schemaVersion: 1,
};

function client(overrides: Record<string, unknown> = {}) {
  const functions = {
    invoke: vi.fn()
      .mockResolvedValueOnce({ data: { upload_path: 'org/masterlist/incoming/upload.json', token: 'token' }, error: null })
      .mockResolvedValueOnce({ data: {
        catalog_role: 'masterlist', version: 2, row_count: 2, integrity_hash: inspection.sha256,
        storage_path: 'org/masterlist/masterlist-v2.json', published_at: '2026-10-06T00:00:00Z',
      }, error: null }),
  };
  const storage = { from: vi.fn(() => ({ uploadToSignedUrl: vi.fn().mockResolvedValue({ data: {}, error: null }) })) };
  return { functions, storage, ...overrides };
}

describe('publishMasterlist', () => {
  it('initiates, uploads, finalizes, and maps the result', async () => {
    const supabase = client();
    const result = await publishMasterlist(new File(['[]'], 'masterlist.json'), inspection, supabase as unknown as SupabaseClient<Database>);

    expect(supabase.functions.invoke).toHaveBeenNthCalledWith(1, 'catalog-publish', expect.objectContaining({
      body: expect.objectContaining({ action: 'initiate', catalog_role: 'masterlist', row_count: 2 }),
    }));
    expect(supabase.storage.from).toHaveBeenCalledWith('catalogs');
    expect(result).toEqual(expect.objectContaining({ catalogRole: 'masterlist', version: 2, rowCount: 2 }));
  });

  it('stops before upload when initiation fails', async () => {
    const supabase = client();
    supabase.functions.invoke.mockReset().mockResolvedValue({ data: null, error: { message: 'not allowed' } });
    await expect(publishMasterlist(new File(['[]'], 'masterlist.json'), inspection, supabase as unknown as SupabaseClient<Database>)).rejects.toThrow(/start.*not allowed/i);
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  it('stops before finalization when upload fails', async () => {
    const supabase = client();
    supabase.storage.from.mockReturnValue({ uploadToSignedUrl: vi.fn().mockResolvedValue({ error: { message: 'offline' } }) });
    await expect(publishMasterlist(new File(['[]'], 'masterlist.json'), inspection, supabase as unknown as SupabaseClient<Database>)).rejects.toThrow(/upload.*offline/i);
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
  });
});
