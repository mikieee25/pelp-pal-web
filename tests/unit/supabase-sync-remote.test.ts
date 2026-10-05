import { describe, expect, it, vi } from 'vitest';
import { SupabaseSyncRemote } from '@/lib/supabase/remote-source';

describe('SupabaseSyncRemote', () => {
  it('falls back to the deployed four-argument pull RPC during schema rollout', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.pull_sync_changes(p_activity_cursor, p_conflict_cursor, p_deletion_cursor, p_limit, p_revision_cursor) in the schema cache',
        },
      })
      .mockResolvedValueOnce({
        data: { revisions: [], activities: [], conflicts: [] },
        error: null,
      });
    const remote = new SupabaseSyncRemote({ rpc } as never);

    await expect(remote.pullSyncChanges({ revision: 0, activity: 0, conflict: 0, deletion: 0 }))
      .resolves.toEqual({ revisions: [], activities: [], conflicts: [], deletions: [] });

    expect(rpc).toHaveBeenNthCalledWith(1, 'pull_sync_changes', {
      p_revision_cursor: 0,
      p_activity_cursor: 0,
      p_conflict_cursor: 0,
      p_limit: 100,
      p_deletion_cursor: 0,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'pull_sync_changes', {
      p_revision_cursor: 0,
      p_activity_cursor: 0,
      p_conflict_cursor: 0,
      p_limit: 100,
    });
  });

  it('does not hide unrelated pull RPC errors', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied for function pull_sync_changes' },
    });
    const remote = new SupabaseSyncRemote({ rpc } as never);

    await expect(remote.pullSyncChanges({ revision: 0, activity: 0, conflict: 0, deletion: 0 }))
      .rejects.toThrow('pull_sync_changes failed: permission denied for function pull_sync_changes');
    expect(rpc).toHaveBeenCalledOnce();
  });
});
