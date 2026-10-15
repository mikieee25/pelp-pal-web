import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  store: undefined as undefined | { getSnapshot: () => Record<string, unknown>; subscribe: (listener: () => void) => () => void },
}));

vi.mock('@/features/sync/sync-runtime-boundary', () => ({
  useSyncRuntimeStatusStore: () => mocks.store,
}));

import { SyncStatusPill } from '@/components/app-shell/sync-status-pill';

describe('SyncStatusPill', () => {
  afterEach(() => {
    cleanup();
    mocks.store = undefined;
    vi.restoreAllMocks();
  });

  it.each([
    ['syncing', { status: 'syncing', pendingCount: 0, conflictCount: 0 }, 'Syncing…'],
    ['attention', { status: 'live', pendingCount: 0, conflictCount: 2, failedCount: 1 }, '3 need attention'],
    ['waiting', { status: 'live', pendingCount: 4, retryingCount: 1, conflictCount: 0 }, '4 waiting'],
    ['photos waiting', { status: 'live', pendingCount: 0, conflictCount: 0, evidencePendingCount: 2, evidenceLastError: 'Storage rejected the photo' }, '2 photos waiting'],
    ['offline', { status: 'live', pendingCount: 0, conflictCount: 0 }, 'Offline'],
    ['up to date', { status: 'live', pendingCount: 0, conflictCount: 0, realtimeState: 'connected' }, 'Up to date'],
  ])('renders the %s state', (_name, snapshot, label) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: label !== 'Offline' });
    mocks.store = { getSnapshot: () => snapshot, subscribe: () => () => undefined };

    render(<SyncStatusPill />);

    expect(screen.getByTestId('sync-status-pill')).toHaveAttribute('aria-label', label);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/sync');
  });

  it('renders the compact mobile label alongside the full label', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const snapshot = { status: 'live', pendingCount: 2, conflictCount: 0 };
    mocks.store = { getSnapshot: () => snapshot, subscribe: () => () => undefined };

    render(<SyncStatusPill />);

    expect(screen.getByTestId('sync-status-pill-compact-label')).toHaveTextContent('2');
    expect(screen.getByTestId('sync-status-pill-full-label')).toHaveTextContent('2 waiting');
  });

  it('describes the last sync and polling fallback in its tooltip title', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const snapshot = { status: 'live', pendingCount: 0, conflictCount: 0, realtimeState: 'disconnected' as const, pollingActive: true, lastSyncedAt: new Date().toISOString() };
    mocks.store = { getSnapshot: () => snapshot, subscribe: () => () => undefined };

    render(<SyncStatusPill />);

    fireEvent.mouseOver(screen.getByTestId('sync-status-pill'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Last synced just now.*Polling fallback/);
  });

  it('includes the photo upload failure reason in its tooltip', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const snapshot = { status: 'live', pendingCount: 0, conflictCount: 0, evidenceFailedCount: 1, evidenceLastError: 'Storage rejected the photo' };
    mocks.store = { getSnapshot: () => snapshot, subscribe: () => () => undefined };
    render(<SyncStatusPill />);
    fireEvent.mouseOver(screen.getByTestId('sync-status-pill'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Storage rejected the photo');
  });
});
