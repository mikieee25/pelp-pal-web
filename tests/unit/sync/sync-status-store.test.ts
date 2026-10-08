import { describe, expect, it, vi } from 'vitest';
import { SyncStatusStore } from '@/features/sync/sync-status-store';

describe('SyncStatusStore', () => {
  it('combines sync and realtime snapshots and notifies on either source', () => {
    let notifyCoordinator!: () => void;
    let notifyRealtime!: () => void;
    let realtimeState: 'connected' | 'reconnecting' | 'disconnected' = 'disconnected';
    const coordinator = {
      getSnapshot: vi.fn(() => ({ status: 'live' as const, pendingCount: 0, conflictCount: 0 })),
      subscribe: vi.fn((listener: () => void) => {
        notifyCoordinator = listener;
        return () => undefined;
      }),
      syncNow: vi.fn(),
    };
    const realtime = {
      getSnapshot: () => ({ state: realtimeState }),
      subscribe: vi.fn((listener: () => void) => {
        notifyRealtime = listener;
        return () => undefined;
      }),
    };
    const store = new SyncStatusStore(coordinator as never, realtime);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.getSnapshot()).toMatchObject({ status: 'live', realtimeState: 'disconnected' });

    realtimeState = 'connected';
    notifyRealtime();
    expect(store.getSnapshot()).toMatchObject({ realtimeState: 'connected' });

    notifyCoordinator();
    expect(listener).toHaveBeenCalledTimes(2);
    store.dispose();
  });
});
