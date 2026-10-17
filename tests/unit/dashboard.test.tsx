import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDashboardCounts: vi.fn(),
  listActivity: vi.fn(),
  getSyncStatusCounts: vi.fn(),
  getCurrentStore: vi.fn(),
  listSavedStores: vi.fn(),
  switchCurrentStore: vi.fn(),
  subscribeChanges: vi.fn(),
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => ({
    getDashboardCounts: mocks.getDashboardCounts,
    listActivity: mocks.listActivity,
    getSyncStatusCounts: mocks.getSyncStatusCounts,
    getCurrentStore: mocks.getCurrentStore,
    listSavedStores: mocks.listSavedStores,
    switchCurrentStore: mocks.switchCurrentStore,
    subscribeChanges: mocks.subscribeChanges,
  }),
}));

vi.mock('@/lib/animation/gsap', () => ({
  fadeUp: () => () => {},
  stateFeedback: () => () => {},
  noticeFeedback: () => () => {},
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
    mocks.listActivity.mockResolvedValue([]);
    mocks.getSyncStatusCounts.mockResolvedValue({ failedCount: 0, conflictCount: 0, evidencePendingCount: 0 });
    mocks.getCurrentStore.mockResolvedValue({ id: 'current', storeId: 'STORE-1', name: 'Sample Store', location: 'NCR' });
    mocks.listSavedStores.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows task-first actions, attention items, three stats, recent rows, and one store row', async () => {
    mocks.getDashboardCounts.mockResolvedValue({ completedInspections: 12, drafts: 3, pendingSync: 2, openConflicts: 1 });
    mocks.getSyncStatusCounts.mockResolvedValue({ failedCount: 1, conflictCount: 1, evidencePendingCount: 2 });
    const recent = Array.from({ length: 6 }, (_, index) => ({
      id: `activity-${index}`,
      inspectionId: `inspection-${index}`,
      controlNumber: `ACU-000${index}`,
      brand: `Brand ${index}`,
      model: `Model ${index}`,
      productType: 'Air Conditioners',
      storeName: 'Sample Store',
      outcome: 'compliant' as const,
      createdAt: `2026-10-0${6 - index}T00:00:00.000Z`,
    }));
    mocks.listActivity.mockImplementation(async (filter?: { syncStatus?: string; limit?: number }) => {
      if (filter?.syncStatus === 'failed') return [{ ...recent[0], syncStatus: 'failed' as const }];
      if (filter?.syncStatus === 'conflict') return [{ ...recent[1], syncStatus: 'conflict' as const }];
      return recent.slice(0, filter?.limit ?? recent.length);
    });

    render(<DashboardView />);

    expect(screen.getByRole('link', { name: 'Scan label' })).toHaveAttribute('href', '/lookup?scan=1');
    expect(screen.getByRole('link', { name: 'Search catalog' })).toHaveAttribute('href', '/lookup');
    expect(await screen.findByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
    expect(screen.getAllByText('ACU-0000')).toHaveLength(2);
    expect(screen.getAllByText('ACU-0001')).toHaveLength(2);
    expect(screen.getByText('Photos waiting to upload (2)')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Recent inspections' })).getAllByRole('link')).toHaveLength(5);
    expect(screen.getByText('Store: Sample Store')).toBeInTheDocument();
    expect(screen.queryByText(/ready for field work|local-first mode|sync readiness/i)).not.toBeInTheDocument();
    expect(mocks.listActivity).toHaveBeenCalledWith({ limit: 5 });
  });

  it('shows one select-store row and hides empty attention', async () => {
    mocks.getCurrentStore.mockResolvedValue(undefined);

    render(<DashboardView />);

    expect(await screen.findByText('Select a store')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /enter store details/i })).toHaveAttribute('href', '/store?returnTo=%2Fdashboard');
  });

  it('shows the active store and switches to a saved store', async () => {
    mocks.listSavedStores.mockResolvedValue([
      { id: 'store:STORE-2', storeId: 'STORE-2', name: 'South Store', location: 'Luzon', updatedAt: '2026-10-05T00:00:00.000Z' },
    ]);
    mocks.switchCurrentStore.mockResolvedValue({ id: 'current', storeId: 'STORE-2', name: 'South Store', location: 'Luzon' });

    render(<DashboardView />);

    await waitFor(() => expect(screen.getByText('Store: Sample Store')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /switch active store/i }));
    fireEvent.click(screen.getByRole('button', { name: /south store/i }));
    const warning = await screen.findByRole('dialog', { name: /local work is still pending/i });
    fireEvent.click(within(warning).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(mocks.switchCurrentStore).toHaveBeenCalledWith('STORE-2'));
    expect(await screen.findByText('Store: South Store')).toBeInTheDocument();
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
