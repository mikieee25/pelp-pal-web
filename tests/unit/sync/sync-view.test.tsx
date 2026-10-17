import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncView } from '@/features/sync/sync-view';
import type { SyncStatusSnapshot } from '@/features/sync/sync-status-store';

const mocks = vi.hoisted(() => ({
  syncCatalog: vi.fn(),
  getEvidenceDownloadEstimate: vi.fn(),
  downloadRemoteEvidence: vi.fn(),
  startSyncRuntime: vi.fn(),
  listOpenConflicts: vi.fn(),
  resolveRemoteDeletionConflict: vi.fn(),
}));

vi.mock('@/features/catalog/catalog-sync', () => ({ syncCatalog: (...args: unknown[]) => mocks.syncCatalog(...args) }));
vi.mock('@/lib/db/browser', () => ({ getBrowserRepository: () => ({ getEvidenceDownloadEstimate: mocks.getEvidenceDownloadEstimate, downloadRemoteEvidence: mocks.downloadRemoteEvidence, listOpenConflicts: mocks.listOpenConflicts, resolveRemoteDeletionConflict: mocks.resolveRemoteDeletionConflict }) }));
vi.mock('@/lib/sync/runtime', () => ({ startSyncRuntime: (...args: unknown[]) => mocks.startSyncRuntime(...args) }));

afterEach(cleanup);

beforeEach(() => {
  mocks.getEvidenceDownloadEstimate.mockResolvedValue({ photoCount: 0, bytes: 0 });
  mocks.downloadRemoteEvidence.mockResolvedValue([]);
  mocks.startSyncRuntime.mockResolvedValue(undefined);
  mocks.listOpenConflicts.mockResolvedValue([]);
});

function store(overrides: Partial<SyncStatusSnapshot> = {}) {
  const snapshot: SyncStatusSnapshot = { status: 'live', pendingCount: 0, conflictCount: 0, ...overrides };
  return { subscribe: () => () => undefined, getSnapshot: () => snapshot, syncNow: vi.fn().mockResolvedValue(undefined) };
}

async function openAdvanced() {
  fireEvent.click(screen.getByText('Advanced'));
  await waitFor(() => expect(document.getElementById('sync-advanced-content')).not.toHaveStyle({ display: 'none' }));
}

describe('SyncView', () => {
  it('shows the headline sync action and keeps Details and Advanced closed initially', () => {
    const statusStore = store({ lastSyncedAt: '2026-10-15T00:00:00.000Z' });
    render(<SyncView statusStore={statusStore} />);

    expect(screen.getByTestId('sync-headline')).toHaveTextContent('Everything is up to date');
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sync now' })).toHaveClass('bg-primary');
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Live')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(statusStore.syncNow).toHaveBeenCalledWith('manual', 'full');
  });

  it('shows simple label/value details, including the organization id suffix', () => {
    render(<SyncView statusStore={store({ pendingCount: 2, retryingCount: 1, conflictCount: 1, localInspectionCount: 12, remoteInspectionCount: 25, catalogVersion: 7, organizationId: 'organization-12345678', lastUploadAt: '2026-10-14T00:00:00Z', lastDownloadAt: '2026-10-14T01:00:00Z' })} />);

    fireEvent.click(screen.getByText('Details'));
    for (const label of ['Pending', 'Conflicts', 'On this device', 'On the server', 'Catalog version', 'Last upload', 'Last download', 'Organization']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('organization-12345678'.slice(-8))).toBeInTheDocument();
    expect(screen.getByText('2 (1 retrying)')).toBeInTheDocument();
  });

  it('preserves forced inspection and catalog actions inside Advanced', async () => {
    mocks.syncCatalog.mockResolvedValue({ status: 'updated', version: 8, rowCount: 120, catalogRole: 'masterlist' });
    const statusStore = store();
    render(<SyncView statusStore={statusStore} />);
    await openAdvanced();

    fireEvent.click(screen.getByRole('button', { name: 'Force upload inspections' }));
    expect(statusStore.syncNow).toHaveBeenCalledWith('manual', 'upload');
    fireEvent.click(screen.getByRole('button', { name: 'Force download inspections' }));
    expect(statusStore.syncNow).toHaveBeenCalledWith('manual', 'download');
    fireEvent.click(screen.getByRole('button', { name: 'Sync catalog' }));
    expect(await screen.findByText(/masterlist updated to version 8/i)).toBeInTheDocument();
    expect(mocks.syncCatalog).toHaveBeenCalledOnce();
  });

  it('shows photo upload issues as a small section with a single action', async () => {
    render(<SyncView statusStore={store({ evidenceFailedCount: 2, evidencePendingCount: 1, evidenceLastError: 'Storage rejected photo.jpg' })} />);
    expect(screen.getByTestId('evidence-sync-state')).toHaveTextContent('Photos waiting (3)');
    expect(screen.getByTestId('evidence-sync-state')).toHaveTextContent('Storage rejected photo.jpg');
    expect(screen.getAllByRole('button', { name: 'Photo tools' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Photo tools' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Re-upload missing photos' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Re-upload missing photos' })).toBeInTheDocument();
  });

  it('shows a compact conflict section and retains links to each conflicted inspection', async () => {
    mocks.listOpenConflicts.mockResolvedValue([
      { id: 'conflict-1', change_cursor: 1, inspection_id: 'inspection-1', product_control_number: 'ACU-1' },
      { id: 'conflict-2', change_cursor: 2, inspection_id: 'inspection-2', product_control_number: 'ACU-2' },
    ]);
    render(<SyncView statusStore={store({ conflictCount: 2 })} />);
    expect(screen.getByTestId('sync-headline')).toHaveTextContent('Needs attention');
    expect(screen.getByText('Needs review (2)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByRole('dialog', { name: 'Review sync conflicts' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Review ACU-1' })).toHaveAttribute('href', '/inspect/inspection-1');
    expect(screen.getByRole('link', { name: 'Review ACU-2' })).toHaveAttribute('href', '/inspect/inspection-2');
  });

  it('offers explicit keep and discard choices for an inspection deleted on another device', async () => {
    mocks.listOpenConflicts.mockResolvedValue([{
      id: 'remote-deletion:inspection-1:2',
      change_cursor: 2,
      inspection_id: 'inspection-1',
      source: 'remote-deletion',
    }]);
    render(<SyncView statusStore={store({ conflictCount: 1 })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

    expect(await screen.findByText(/deleted on another device/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep on this device' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard local copy' })).toBeInTheDocument();
  });

  it('deduplicates technical errors and retries the existing full-sync operation', () => {
    const message = 'RPC request timed out';
    const statusStore = store({ status: 'error', pendingCount: 1, lastError: message, lastOperationResult: {
      operation: 'full', completedAt: '', uploadedCount: 0, downloadedCount: 0, unchangedCount: 0,
      retryingCount: 0, conflictedCount: 0, failedCount: 1, error: message,
    } });
    render(<SyncView statusStore={statusStore} />);

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Sync couldn\'t finish. Try again.');
    fireEvent.click(screen.getByText('Technical details'));
    expect(screen.getAllByText(message)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(statusStore.syncNow).toHaveBeenCalledWith('retry', 'full');
  });

  it('confirms bulk photo download and reports its progress and failures', async () => {
    mocks.getEvidenceDownloadEstimate.mockResolvedValue({ photoCount: 3, bytes: 1024 * 1024 });
    mocks.downloadRemoteEvidence.mockImplementation(async (_ids: unknown, options: { onProgress: (completed: number, total: number) => void }) => {
      options.onProgress(2, 3);
      return [{ evidenceId: 'one', status: 'downloaded' }, { evidenceId: 'two', status: 'failed' }, { evidenceId: 'three', status: 'downloaded' }];
    });
    render(<SyncView statusStore={store({ organizationId: 'org-1' })} />);
    await openAdvanced();

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
    render(<SyncView statusStore={store({ organizationId: 'org-1' })} />);
    await openAdvanced();
    fireEvent.click(screen.getByRole('button', { name: 'Download photos for offline use' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download photos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel download' }));
    expect(signal?.aborted).toBe(true);
  });

  it('shows the mapped offline message once on narrow layouts', () => {
    render(<SyncView statusStore={store({ status: 'offline', pendingCount: 1, lastError: 'Browser offline' })} />);
    expect(screen.getByTestId('sync-headline')).toHaveTextContent('1 waiting to upload');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('You\'re offline. Changes will upload when you\'re back online.');
  });
});
