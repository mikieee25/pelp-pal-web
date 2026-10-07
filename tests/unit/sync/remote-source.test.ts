import { describe, expect, it, vi } from 'vitest';
import { parsePullPage, SupabaseSyncRemote } from '@/lib/supabase/remote-source';

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
  it('reports the number of inspections visible through the current account scope', async () => {
    const select = vi.fn().mockResolvedValue({ count: 25, error: null });
    const from = vi.fn(() => ({ select }));
    const remote = new SupabaseSyncRemote({ from } as never);

    await expect(remote.getAvailableInspectionCount()).resolves.toBe(25);
    expect(from).toHaveBeenCalledWith('inspections');
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });

  it('supports the deployed four-argument pull RPC while the schema cache catches up', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.pull_sync_changes(...) in the schema cache',
        },
      })
      .mockResolvedValueOnce({
        data: { revisions: [], activities: [], conflicts: [] },
        error: null,
      });
    const remote = new SupabaseSyncRemote({ rpc } as never);

    await expect(remote.pullSyncChanges({ revision: 0, activity: 0, conflict: 0, deletion: 0 })).resolves.toEqual({
      revisions: [], activities: [], conflicts: [], deletions: [],
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'pull_sync_changes', {
      p_revision_cursor: 0,
      p_activity_cursor: 0,
      p_conflict_cursor: 0,
      p_limit: 100,
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
    })).rejects.toMatchObject({ code: 'SYNC_CONFLICT' });
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

  it('uploads JPEG evidence and sends metadata instead of a local Blob', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'applied' }, error: null });
    const upload = vi.fn().mockResolvedValue({ data: { path: 'org-1/inspection-1/evidence-1-revision-1.jpg' }, error: null });
    const remote = new SupabaseSyncRemote({ rpc, storage: { from: vi.fn(() => ({ upload })) } } as never);
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
    Object.defineProperty(blob, 'arrayBuffer', { value: () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer) });

    await remote.pushOutbox({
      id: 'inspection-outbox-1',
      aggregateId: 'inspection-1',
      kind: 'inspection',
      payload: {
        inspection_id: 'inspection-1',
        revisions: [{ id: 'revision-1', inspection_id: 'inspection-1', revision: 1, base_revision: 0, payload: {
          organizationId: 'org-1',
          evidence: [{ id: 'evidence-1', blob, fileName: 'camera.jpg', capturedAt: '2026-10-06T00:00:00.000Z' }],
        } }],
        events: [],
      },
      status: 'pending',
      nextAttemptAt: new Date().toISOString(),
    });

    expect(upload).toHaveBeenCalledWith('org-1/inspection-1/evidence-1-revision-1.jpg', blob, expect.objectContaining({ contentType: 'image/jpeg', upsert: true }));
    const request = rpc.mock.calls[0][1] as { p_revisions: Array<{ payload: { evidence: Array<Record<string, unknown>> } }> };
    expect(request.p_revisions[0].payload.evidence[0]).toMatchObject({ remote_path: 'org-1/inspection-1/evidence-1-revision-1.jpg', mime_type: 'image/jpeg' });
    expect(request.p_revisions[0].payload.evidence[0]).not.toHaveProperty('blob');
  });
});
