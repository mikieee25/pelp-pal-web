import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDashboardCounts: vi.fn(),
  listInspectionDrafts: vi.fn(),
  getCurrentStore: vi.fn(),
  listSavedStores: vi.fn(),
  switchCurrentStore: vi.fn(),
  subscribeChanges: vi.fn(),
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => ({
    getDashboardCounts: mocks.getDashboardCounts,
    listInspectionDrafts: mocks.listInspectionDrafts,
    getCurrentStore: mocks.getCurrentStore,
    listSavedStores: mocks.listSavedStores,
    switchCurrentStore: mocks.switchCurrentStore,
    subscribeChanges: mocks.subscribeChanges,
  }),
}));

vi.mock('@/lib/animation/gsap', () => ({
  fadeUp: () => () => {},
}));

import { DashboardView } from '@/app/(workspace)/dashboard/dashboard-view';

describe('DashboardView', () => {
  beforeEach(() => {
    mocks.getDashboardCounts.mockResolvedValue({
      completedInspections: 12,
      drafts: 3,
      pendingSync: 2,
      openConflicts: 1,
    });
    mocks.getCurrentStore.mockResolvedValue({ id: 'current', storeId: 'STORE-1', name: 'Sample Store', location: 'NCR' });
    mocks.listSavedStores.mockResolvedValue([]);
    mocks.listInspectionDrafts.mockResolvedValue([
      { id: 'draft-1', storeName: 'Sample Store', controlNumber: 'ACU-0001', updatedAt: '2026-10-05T00:00:00.000Z' },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('presents local work and sync readiness at a glance', async () => {
    render(<DashboardView />);

    expect(screen.getByText(/field workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/work at a glance/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
    expect(screen.getByText(/sync readiness/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in with your active personnel account/i)).toBeInTheDocument();
    expect(screen.getByText('Sample Store')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /resume/i })).toHaveAttribute('href', '/inspect/draft-1');
  });

  it('offers store details when there is no active store', async () => {
    mocks.getCurrentStore.mockResolvedValue(undefined);

    render(<DashboardView />);

    await waitFor(() => expect(screen.getByText(/no active store selected/i)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /enter store details/i })).toHaveAttribute('href', '/store?returnTo=%2Fdashboard');
  });

  it('shows the active store and switches to a saved store', async () => {
    mocks.listSavedStores.mockResolvedValue([
      { id: 'store:STORE-2', storeId: 'STORE-2', name: 'South Store', location: 'Luzon', updatedAt: '2026-10-05T00:00:00.000Z' },
    ]);
    mocks.switchCurrentStore.mockResolvedValue({ id: 'current', storeId: 'STORE-2', name: 'South Store', location: 'Luzon' });

    render(<DashboardView />);

    await waitFor(() => expect(screen.getByText(/active store: sample store/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /switch active store/i }));
    fireEvent.click(screen.getByRole('button', { name: /south store/i }));
    const warning = await screen.findByRole('dialog', { name: /local work is still pending/i });
    fireEvent.click(within(warning).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(mocks.switchCurrentStore).toHaveBeenCalledWith('STORE-2'));
    expect(await screen.findByText(/active store: south store/i)).toBeInTheDocument();
  });

  it('refreshes dashboard counts after repository changes arrive while mounted', async () => {
    let notifyRepositoryChange: (() => void) | undefined;
    mocks.subscribeChanges.mockImplementation((listener: () => void) => {
      notifyRepositoryChange = listener;
      return () => {};
    });
    render(<DashboardView />);
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());

    mocks.getDashboardCounts.mockResolvedValue({ completedInspections: 13, drafts: 3, pendingSync: 2, openConflicts: 1 });
    notifyRepositoryChange?.();

    await waitFor(() => expect(screen.getByText('13')).toBeInTheDocument());
  });
});
