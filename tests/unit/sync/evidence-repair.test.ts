import { describe, expect, it, vi } from 'vitest';
import { repairMissingEvidence } from '@/lib/supabase/evidence-repair';
import type { LocalEvidenceRecord } from '@/lib/db/records';

describe('repairMissingEvidence', () => {
  it('lists each inspection folder and uploads only missing objects with the stable path', async () => {
    const list = vi.fn().mockImplementation(async (folder: string) => ({
      data: folder.endsWith('inspection-a') ? [{ name: 'photo-a.jpg' }] : [],
      error: null,
    }));
    const upload = vi.fn().mockResolvedValue({ data: { path: 'uploaded' }, error: null });
    const client = { storage: { from: vi.fn(() => ({ list, upload })) } } as never;
    const evidence: LocalEvidenceRecord[] = [
      { id: 'photo-a', inspectionId: 'inspection-a', accountScopeKey: 'org:a', blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), displayOrder: 0, capturedAt: '', fileName: 'a.jpg', mimeType: '', size: 3 },
      { id: 'photo-b', inspectionId: 'inspection-b', accountScopeKey: 'org:a', blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), displayOrder: 0, capturedAt: '', fileName: 'b.jpg', mimeType: '', size: 3 },
    ];

    const results = await repairMissingEvidence(client, 'org', evidence);

    expect(list).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith('org/inspection-b/photo-b.jpg', expect.objectContaining({ type: 'image/jpeg' }), { contentType: 'image/jpeg', upsert: true });
    expect(results.map((result) => result.status)).toEqual(['already_present', 'uploaded']);
  });
});
