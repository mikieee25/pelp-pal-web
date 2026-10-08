import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncView } from '@/features/sync/sync-view';

const mocks = vi.hoisted(() => ({
  syncCatalog: vi.fn(),
}));

vi.mock('@/features/catalog/catalog-sync', () => ({
  syncCatalog: (...args: unknown[]) => mocks.syncCatalog(...args),
}));

afterEach(cleanup);

function store(snapshot: { status: 'live' | 'syncing' | 'pending' | 'reconnecting' | 'offline' | 'error'; realtimeState?: 'connected' | 'reconnecting' | 'disconnected'; pendingCount: number; conflictCount: number; failedCount?: number; catalogVersion?: number; lastSyncedAt?: string; lastError?: string; localInspectionCount?: number; remoteInspectionCount?: number }) {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    syncNow: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SyncView', () => {
  it('clarifies inspection upload, download, and masterlist sync actions', async () => {
    mocks.syncCatalog.mockResolvedValue({ status: 'updated', version: 8, rowCount: 120, catalogRole: 'masterlist' });
    const statusStore = store({ status: 'live', realtimeState: 'connected', pendingCount: 0, conflictCount: 0 });
    render(<SyncView statusStore={statusStore} />);

    fireEvent.click(screen.getByRole('button', { name: 'Upload inspections' }));
    expect(statusStore.syncNow).toHaveBeenCalledWith('manual', 'upload');
    fireEvent.click(screen.getByRole('button', { name: 'Download inspections' }));
    expect(statusStore.syncNow).toHaveBeenCalledWith('manual', 'download');
    expect(screen.getByRole('button', { name: 'Sync catalog' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync catalog' }));

    expect(await screen.findByText(/masterlist updated to version 8/i)).toBeInTheDocument();
    expect(mocks.syncCatalog).toHaveBeenCalledTimes(1);
  });

  it('reads a class-backed status store without losing its receiver', () => {
    class ContextBackedStore {
      private readonly snapshot = { status: 'live' as const, realtimeState: 'connected' as const, pendingCount: 0, conflictCount: 0 };

      subscribe() {
        return () => undefined;
      }

      getSnapshot() {
        return this.snapshot;
      }

      syncNow = vi.fn().mockResolvedValue(undefined);
    }

    render(<SyncView statusStore={new ContextBackedStore()} />);

    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('renders live status and synchronization counters', () => {
    render(<SyncView statusStore={store({ status: 'live', realtimeState: 'connected', pendingCount: 2, conflictCount: 1, failedCount: 1, catalogVersion: 7, lastSyncedAt: '2026-10-05T05:00:00.000Z', localInspectionCount: 12, remoteInspectionCount: 25 })} />);

    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('2 pending')).toBeInTheDocument();
    expect(screen.getByText('1 conflict')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByText('Catalog v7')).toBeInTheDocument();
    expect(screen.getByText('12 on this browser')).toBeInTheDocument();
    expect(screen.getByText('25 available remotely')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload inspections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download inspections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync catalog' })).toBeInTheDocument();

    for (const name of ['Upload inspections', 'Download inspections', 'Sync catalog']) {
      expect(screen.getByRole('button', { name })).toHaveClass('MuiButton-fullWidth');
    }
  });

  it.each([
    ['connected', 'Live'],
    ['reconnecting', 'Reconnecting'],
    ['disconnected', 'Polling'],
  ] as const)('shows %s realtime state as %s', (realtimeState, label) => {
    render(<SyncView statusStore={store({ status: 'live', realtimeState, pendingCount: 0, conflictCount: 0 })} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows actionable error and retries through the shared store', () => {
    const statusStore = store({ status: 'error', pendingCount: 1, conflictCount: 0, lastError: 'Network unavailable' });
    render(<SyncView statusStore={statusStore} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry full sync' }));
    expect(statusStore.syncNow).toHaveBeenCalledWith('retry', 'full');
  });

  it('keeps a compact responsive control layout for offline status', () => {
    render(<SyncView statusStore={store({ status: 'offline', pendingCount: 0, conflictCount: 0 })} />);

    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText(/local data remains available/i)).toBeInTheDocument();
  });
});
