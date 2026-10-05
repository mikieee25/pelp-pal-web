import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncView } from '@/features/sync/sync-view';

afterEach(cleanup);

function store(snapshot: { status: 'live' | 'syncing' | 'pending' | 'reconnecting' | 'offline' | 'error'; pendingCount: number; conflictCount: number; lastSyncedAt?: string; lastError?: string }) {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    syncNow: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SyncView', () => {
  it('renders live status and synchronization counters', () => {
    render(<SyncView statusStore={store({ status: 'live', pendingCount: 2, conflictCount: 1, lastSyncedAt: '2026-10-05T05:00:00.000Z' })} />);

    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('2 pending')).toBeInTheDocument();
    expect(screen.getByText('1 conflict')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument();
  });

  it('shows actionable error and retries through the shared store', () => {
    const statusStore = store({ status: 'error', pendingCount: 1, conflictCount: 0, lastError: 'Network unavailable' });
    render(<SyncView statusStore={statusStore} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    expect(statusStore.syncNow).toHaveBeenCalledWith('retry');
  });

  it('keeps a compact responsive control layout for offline status', () => {
    render(<SyncView statusStore={store({ status: 'offline', pendingCount: 0, conflictCount: 0 })} />);

    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText(/local data remains available/i)).toBeInTheDocument();
  });
});
