import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncView } from '@/features/sync/sync-view';

const mocks = vi.hoisted(() => ({
  syncCatalog: vi.fn(),
  getEvidenceDownloadEstimate: vi.fn(),
  downloadRemoteEvidence: vi.fn(),
  startSyncRuntime: vi.fn(),
}));

vi.mock('@/features/catalog/catalog-sync', () => ({
  syncCatalog: (...args: unknown[]) => mocks.syncCatalog(...args),
}));

vi.mock('@/lib/db/browser', () => ({ getBrowserRepository: () => ({ getEvidenceDownloadEstimate: mocks.getEvidenceDownloadEstimate, downloadRemoteEvidence: mocks.downloadRemoteEvidence }) }));
vi.mock('@/lib/sync/runtime', () => ({ startSyncRuntime: (...args: unknown[]) => mocks.startSyncRuntime(...args) }));

afterEach(cleanup);

beforeEach(() => {
  mocks.getEvidenceDownloadEstimate.mockResolvedValue({ photoCount: 0, bytes: 0 });
  mocks.downloadRemoteEvidence.mockResolvedValue([]);
  mocks.startSyncRuntime.mockResolvedValue(undefined);
});

function store(snapshot: { status: 'live' | 'syncing' | 'pending' | 'reconnecting' | 'offline' | 'error'; realtimeState?: 'connected' | 'reconnecting' | 'disconnected'; pendingCount: number; conflictCount: number; organizationId?: string; failedCount?: number; evidencePendingCount?: number; evidenceFailedCount?: number; evidenceLastError?: string; catalogVersion?: number; lastSyncedAt?: string; lastError?: string; localInspectionCount?: number; remoteInspectionCount?: number; lastOperationResult?: { operation: 'full' | 'upload' | 'download'; completedAt: string; uploadedCount: number; downloadedCount: number; unchangedCount: number; retryingCount: number; conflictedCount: number; failedCount: number; error?: string } }) {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    syncNow: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SyncView', () => {
  it('provides force upload, download, full sync, and catalog actions', async () => {
    mocks.syncCatalog.mockResolvedValue({ status: 'updated', version: 8, rowCount: 120, catalogRole: 'masterlist' });
    const statusStore = store({ status: 'live', realtimeState: 'connected', pendingCount: 0, conflictCount: 0 });
    render(<SyncView statusStore={statusStore} />);

    fireEvent.click(screen.getByRole('button', { name: 'Upload inspections' }));
    expect(statusStore.syncNow).toHaveBeenCalledWith('manual', 'upload');
    fireEvent.click(screen.getByRole('button', { name: 'Download inspections' }));
    expect(statusStore.syncNow).toHaveBeenCalledWith('manual', 'download');
    fireEvent.click(screen.getByRole('button', { name: 'Sync everything' }));
    expect(statusStore.syncNow).toHaveBeenCalledWith('manual', 'full');
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
    expect(screen.getByRole('button', { name: 'Sync everything' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync catalog' })).toBeInTheDocument();

    for (const name of ['Upload inspections', 'Download inspections', 'Sync everything', 'Sync catalog']) {
      expect(screen.getByRole('button', { name })).toHaveClass('MuiButton-fullWidth');
    }
    expect(screen.getByRole('button', { name: 'Sync everything' })).toHaveClass('MuiButton-contained');
    expect(screen.getByRole('button', { name: 'Upload inspections' })).toHaveClass('MuiButton-outlined');
    expect(screen.getByTestId('sync-actions-grid')).toBeInTheDocument();
    expect(screen.getByTestId('sync-status-card')).toBeInTheDocument();
  });

  it('shows failed photo uploads separately with their reason and repair action', () => {
    render(<SyncView statusStore={store({ status: 'live', pendingCount: 0, conflictCount: 0, evidenceFailedCount: 2, evidencePendingCount: 1, evidenceLastError: 'Storage rejected photo.jpg' })} />);
    expect(screen.getByTestId('evidence-sync-state')).toHaveTextContent('3 photos waiting to upload');
    expect(screen.getByTestId('evidence-sync-state')).toHaveTextContent('Storage rejected photo.jpg');
    expect(screen.getByRole('button', { name: 'Re-upload missing photos' })).toBeInTheDocument();
  });

  it('confirms bulk photo download and reports its progress and failures', async () => {
    mocks.getEvidenceDownloadEstimate.mockResolvedValue({ photoCount: 3, bytes: 1024 * 1024 });
    mocks.downloadRemoteEvidence.mockImplementation(async (_ids: unknown, options: { onProgress: (completed: number, total: number) => void }) => {
      options.onProgress(2, 3);
      return [{ evidenceId: 'one', status: 'downloaded' }, { evidenceId: 'two', status: 'failed' }, { evidenceId: 'three', status: 'downloaded' }];
    });
    render(<SyncView statusStore={store({ status: 'live', pendingCount: 0, conflictCount: 0, organizationId: 'org-1' })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download photos for offline use' }));
    expect(await screen.findByText(/download 3 photos/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download photos' }));
    expect(await screen.findByText(/2 downloaded · 1 failed · 0 unavailable/i)).toBeInTheDocument();
  });

  it('cancels an active bulk photo download', async () => {
    let signal: AbortSignal | undefined;
    mocks.getEvidenceDownloadEstimate.mockResolvedValue({ photoCount: 2, bytes: 100 });
    mocks.downloadRemoteEvidence.mockImplementation((_ids: unknown, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))));
    });
    render(<SyncView statusStore={store({ status: 'live', pendingCount: 0, conflictCount: 0, organizationId: 'org-1' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download photos for offline use' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download photos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel download' }));
    expect(signal?.aborted).toBe(true);
  });

  it('shows the result of the last sync operation', () => {
    render(<SyncView statusStore={store({
      status: 'live',
      realtimeState: 'connected',
      pendingCount: 0,
      conflictCount: 0,
      lastOperationResult: {
        operation: 'download',
        completedAt: '2026-10-05T05:00:00.000Z',
        uploadedCount: 0,
        downloadedCount: 12,
        unchangedCount: 0,
        retryingCount: 0,
        conflictedCount: 0,
        failedCount: 0,
      },
    })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Inspection download completed: 12 downloaded');
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
