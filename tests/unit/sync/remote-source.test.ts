import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { EvidenceNotFoundError, parsePullPage, SupabaseSyncRemote } from '@/lib/supabase/remote-source';
import { EVIDENCE_MAX_BYTES } from '@/lib/evidence/validation';
import { SYNC_PULL_PAGE_LIMIT } from '@/lib/sync/constants';

describe('parsePullPage', () => {
  it('accepts all cursor collections', () => {
    expect(parsePullPage({ revisions: [], activities: [], conflicts: [], deletions: [] })).toEqual({
      revisions: [], activities: [], conflicts: [], deletions: [],
    });
  });

  it('rejects a missing collection instead of silently treating it as empty', () => {
    expect(() => parsePullPage({ revisions: [] })).toThrow('activities');
  });

  it('rejects rows with a non-positive or non-integer cursor', () => {
    expect(() => parsePullPage({
      revisions: [{ id: 'revision-1', change_cursor: 0 }],
      activities: [],
      conflicts: [],
      deletions: [],
    })).toThrow(/change_cursor/i);
  });

  it('normalizes legacy deletion tombstones that use inspection_id as their key', () => {
    expect(parsePullPage({
      revisions: [],
      activities: [],
      conflicts: [],
      deletions: [{ inspection_id: 'inspection-1', change_cursor: 7 }],
    }).deletions).toEqual([
      { inspection_id: 'inspection-1', change_cursor: 7, id: 'inspection-1' },
    ]);
  });
});

describe('SupabaseSyncRemote', () => {
  it('downloads a private evidence object with the caller abort signal', async () => {
    const blob = new Blob(['photo'], { type: 'image/jpeg' });
    const download = vi.fn().mockResolvedValue({ data: blob, error: null });
    const remote = new SupabaseSyncRemote({ storage: { from: vi.fn(() => ({ download })) } } as never);
    const controller = new AbortController();

    await expect(remote.downloadEvidence('org-1/inspection-1/photo.jpg', controller.signal)).resolves.toBe(blob);
    expect(download).toHaveBeenCalledWith('org-1/inspection-1/photo.jpg', {}, { signal: controller.signal });
  });

  it('maps a missing storage object to EvidenceNotFoundError', async () => {
    const download = vi.fn().mockResolvedValue({ data: null, error: { name: 'StorageApiError', status: 404, message: 'Object not found' } });
    const remote = new SupabaseSyncRemote({ storage: { from: vi.fn(() => ({ download })) } } as never);

    await expect(remote.downloadEvidence('org/inspection/photo.jpg')).rejects.toBeInstanceOf(EvidenceNotFoundError);
  });

  it('reports the number of inspections visible through the current account scope', async () => {
    const select = vi.fn().mockResolvedValue({ count: 25, error: null });
    const from = vi.fn(() => ({ select }));
    const remote = new SupabaseSyncRemote({ from } as never);

    await expect(remote.getAvailableInspectionCount()).resolves.toBe(25);
    expect(from).toHaveBeenCalledWith('inspections');
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });

  it('surfaces the deployed pull RPC error without using a legacy fallback', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.pull_sync_changes(...) in the schema cache',
      },
    });
    const remote = new SupabaseSyncRemote({ rpc } as never);

    await expect(remote.pullSyncChanges({ revision: 0, activity: 0, conflict: 0, deletion: 0 }))
      .rejects.toThrow('pull_sync_changes failed: Could not find the function');
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('pull_sync_changes', {
      p_revision_cursor: 0,
      p_activity_cursor: 0,
      p_conflict_cursor: 0,
      p_limit: SYNC_PULL_PAGE_LIMIT,
      p_deletion_cursor: 0,
    });
  });

  it('surfaces a server conflict instead of treating it as a successful push', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'conflict', server_head: 2 }, error: null });
    const remote = new SupabaseSyncRemote({ rpc } as never);

    await expect(remote.pushOutbox({
      id: 'inspection-outbox-1',
      aggregateId: 'inspection-1',
      kind: 'inspection',
      payload: {
        inspection_id: 'inspection-1',
        revisions: [{ id: 'revision-1', inspection_id: 'inspection-1', revision: 1, base_revision: 1, payload: {} }],
        events: [],
      },
      status: 'pending',
      nextAttemptAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: 'SYNC_CONFLICT', serverHead: 2 });
  });

  it('pushes inspection deletions through the sync tombstone RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'deleted' }, error: null });
    const remote = new SupabaseSyncRemote({ rpc } as never);

    await remote.pushOutbox({
      id: 'delete-outbox-1',
      aggregateId: 'inspection-1',
      kind: 'inspection_delete',
      payload: {
        inspection_id: 'inspection-1',
        product_control_number: 'ACU-0001',
        storage_paths: [],
      },
      status: 'pending',
      nextAttemptAt: new Date().toISOString(),
    });

    expect(rpc).toHaveBeenCalledWith('delete_inspection_sync', {
      p_inspection_id: 'inspection-1',
      p_product_control_number: 'ACU-0001',
      p_storage_paths: [],
    });
  });

  it('returns a single stable-path task for shared evidence across revisions and sends metadata only', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'applied' }, error: null });
    const remote = new SupabaseSyncRemote({ rpc } as never);
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
    Object.defineProperty(blob, 'arrayBuffer', { value: () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer) });

    const uploads = await remote.pushOutbox({
      id: 'inspection-outbox-1',
      aggregateId: 'inspection-1',
      kind: 'inspection',
      payload: {
        inspection_id: 'inspection-1',
        revisions: [1, 2, 3].map((revision) => ({ id: `revision-${revision}`, inspection_id: 'inspection-1', revision, base_revision: revision - 1, payload: {
          organizationId: 'org-1',
          evidence: [{ id: 'evidence-1', blob, fileName: 'camera.jpg', capturedAt: '2026-10-06T00:00:00.000Z' }],
        } })),
        events: [],
      },
      status: 'pending',
      nextAttemptAt: new Date().toISOString(),
    });

    expect(uploads).toEqual([expect.objectContaining({ evidenceId: 'evidence-1', inspectionId: 'inspection-1', remotePath: 'org-1/inspection-1/evidence-1.jpg', needsUpload: true })]);
    const request = rpc.mock.calls[0][1] as { p_revisions: Array<{ payload: { evidence: Array<Record<string, unknown>> } }> };
    expect(request.p_revisions[0].payload.evidence[0]).toMatchObject({ remote_path: 'org-1/inspection-1/evidence-1.jpg', mime_type: 'image/jpeg' });
    expect(request.p_revisions[0].payload.evidence[0]).not.toHaveProperty('blob');
  });

  it('re-wraps an empty-type Blob as an image/jpeg multipart file part', async () => {
    let uploadedBody: FormData | undefined;
    const fakeFetch: typeof fetch = async (_input, init) => {
      uploadedBody = init?.body as FormData;
      return new Response(JSON.stringify({ Key: 'inspection-evidence/org-1/inspection-1/evidence-1.jpg', Id: 'object-1' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    };
    const client = createClient('https://example.supabase.co', 'public-anon-key', {
      global: { fetch: fakeFetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const remote = new SupabaseSyncRemote(client);
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
    Object.defineProperty(blob, 'arrayBuffer', { value: () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer) });
    await remote.uploadEvidence({ evidenceId: 'evidence-1', inspectionId: 'inspection-1', remotePath: 'org-1/inspection-1/evidence-1.jpg', sha256: 'a'.repeat(64), needsUpload: true }, new Blob([blob], { type: '' }));
    expect(uploadedBody).toBeInstanceOf(FormData);
    expect((uploadedBody?.get('') as Blob).type).toBe('image/jpeg');
  });

  it('reports storage error name, status, and message for a failed photo upload', async () => {
    const upload = vi.fn().mockResolvedValue({ data: null, error: { name: 'StorageApiError', statusCode: '400', message: 'mime type rejected' } });
    const remote = new SupabaseSyncRemote({ storage: { from: vi.fn(() => ({ upload })) } } as never);
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

    await expect(remote.uploadEvidence({ evidenceId: 'photo-1', inspectionId: 'inspection-1', remotePath: 'org/inspection/photo.jpg', sha256: '', needsUpload: true }, blob))
      .rejects.toThrow('Evidence upload failed for photo-1: StorageApiError (status 400): mime type rejected');
    expect(upload).toHaveBeenCalledWith('org/inspection/photo.jpg', expect.objectContaining({ type: 'image/jpeg' }), { contentType: 'image/jpeg', upsert: true });
  });

  it('queues a replaced photo once at its existing stable path', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'applied' }, error: null });
    const remote = new SupabaseSyncRemote({ rpc } as never);
    const originalHash = 'f'.repeat(64);
    const replacement = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe1])], { type: 'image/jpeg' });
    const uploads = await remote.pushOutbox({
      id: 'replacement-outbox', aggregateId: 'inspection-1', kind: 'inspection', status: 'pending', nextAttemptAt: new Date().toISOString(),
      payload: { inspection_id: 'inspection-1', events: [], revisions: [{ id: 'revision-new', inspection_id: 'inspection-1', revision: 2, base_revision: 1, payload: {
        organizationId: 'org-1', evidence: [{ id: 'photo-1', blob: replacement, uploaded_sha256: originalHash, remote_path: 'org-1/inspection-1/photo-1.jpg' }],
      } }] },
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ remotePath: 'org-1/inspection-1/photo-1.jpg', needsUpload: true });
    expect(uploads[0].sha256).not.toBe(originalHash);
  });

  it('rejects missing local evidence before making a network call', async () => {
    const rpc = vi.fn();
    const remote = new SupabaseSyncRemote({ rpc } as never);

    await expect(remote.pushOutbox({
      id: 'inspection-outbox-missing-evidence', aggregateId: 'inspection-1', kind: 'inspection',
      payload: {
        inspection_id: 'inspection-1',
        revisions: [{ id: 'revision-1', inspection_id: 'inspection-1', revision: 1, base_revision: 0, payload: {
          organizationId: 'org-1', evidence: [{ id: 'evidence-1', fileName: 'label.jpg' }],
        } }], events: [],
      }, status: 'pending', nextAttemptAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: 'EVIDENCE_LOCAL_INVALID', message: expect.stringContaining('label.jpg') });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports invalid evidence with the file name and size context', async () => {
    const rpc = vi.fn();
    const remote = new SupabaseSyncRemote({ rpc } as never);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    Object.defineProperty(blob, 'arrayBuffer', { value: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) });

    await expect(remote.pushOutbox({
      id: 'inspection-outbox-invalid-evidence', aggregateId: 'inspection-1', kind: 'inspection',
      payload: {
        inspection_id: 'inspection-1',
        revisions: [{ id: 'revision-1', inspection_id: 'inspection-1', revision: 1, base_revision: 0, payload: {
          organizationId: 'org-1', evidence: [{ id: 'evidence-1', fileName: 'bad.png', blob }],
        } }], events: [],
      }, status: 'pending', nextAttemptAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: 'EVIDENCE_LOCAL_INVALID', message: expect.stringContaining('bad.png') });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports oversized evidence before making a network call', async () => {
    const rpc = vi.fn();
    const remote = new SupabaseSyncRemote({ rpc } as never);
    const bytes = new Uint8Array(EVIDENCE_MAX_BYTES + 1);
    bytes.set([0xff, 0xd8, 0xff]);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    Object.defineProperty(blob, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer) });

    await expect(remote.pushOutbox({
      id: 'inspection-outbox-large-evidence', aggregateId: 'inspection-1', kind: 'inspection',
      payload: {
        inspection_id: 'inspection-1',
        revisions: [{ id: 'revision-1', inspection_id: 'inspection-1', revision: 1, base_revision: 0, payload: {
          organizationId: 'org-1', evidence: [{ id: 'evidence-1', fileName: 'large.jpg', blob }],
        } }], events: [],
      }, status: 'pending', nextAttemptAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: 'EVIDENCE_LOCAL_INVALID', message: expect.stringContaining('bytes') });
    expect(rpc).not.toHaveBeenCalled();
  });
});
