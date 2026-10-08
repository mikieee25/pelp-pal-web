import { describe, expect, it, vi } from 'vitest';
import { SupabaseSyncRemote } from '@/lib/supabase/remote-source';
import { SYNC_PULL_PAGE_LIMIT } from '@/lib/sync/constants';

describe('SupabaseSyncRemote', () => {
  it('surfaces a pull RPC signature error without retrying a legacy call', async () => {
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
