import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listActivity: vi.fn(),
  listActivityFilterOptions: vi.fn(),
  subscribeChanges: vi.fn(),
  getCatalogEcpTypes: vi.fn(),
  getCurrentStore: vi.fn(),
  listSavedStores: vi.fn(),
  finishCurrentStore: vi.fn(),
  deleteInspection: vi.fn(),
  restoreDeletedInspection: vi.fn(),
  deleteSavedStore: vi.fn(),
  statusStore: undefined as undefined | { getSnapshot: () => Record<string, unknown>; subscribe: (listener: () => void) => () => void; syncNow: ReturnType<typeof vi.fn> },
  listActivityPage: undefined as undefined | ReturnType<typeof vi.fn>,
  router: { push: vi.fn() },
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => mocks,
}));

vi.mock('@/lib/animation/gsap', () => ({
  fadeUp: () => () => {},
  stateFeedback: () => () => {},
  noticeFeedback: () => () => {},
  setDisclosureState: () => {},
  animateDisclosure: () => () => {},
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
}));

vi.mock('@/features/lookup/qr-scanner-dialog', () => ({
  QrScannerDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">QR scanner</div> : null,
}));

vi.mock('@/features/sync/sync-runtime-boundary', () => ({
  useSyncRuntimeStatusStore: () => mocks.statusStore,
}));

import { ActivityView } from '@/features/activity/activity-view';

describe('ActivityView', () => {
  beforeEach(() => {
    mocks.listActivity.mockResolvedValue([
      {
        id: 'activity-1',
        inspectionId: 'inspection-1',
        storeName: 'North Store',
        location: 'NCR',
        productType: 'Air Conditioners',
        controlNumber: 'ACU-0001',
        brand: 'ClearView',
        model: 'CV-100',
        outcome: 'compliant',
        createdAt: '2026-10-05T01:00:00.000Z',
        eventType: 'inspection_completed',
      },
    ]);
    mocks.listActivityFilterOptions.mockResolvedValue({
      storeNames: ['North Store'],
      inspectors: ['inspector-1'],
      productTypes: ['Air Conditioners'],
    });
    mocks.getCatalogEcpTypes.mockResolvedValue(['Air Conditioners', 'Electric Fans']);
    mocks.getCurrentStore.mockResolvedValue({ id: 'current', storeId: 'NCR-20261005-001', name: 'North Store', location: 'NCR' });
    mocks.listSavedStores.mockResolvedValue([]);
    mocks.deleteInspection.mockResolvedValue(undefined);
    mocks.restoreDeletedInspection.mockResolvedValue(undefined);
    mocks.deleteSavedStore.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    mocks.listActivityPage = undefined;
    mocks.statusStore = undefined;
    vi.clearAllMocks();
  });

  it('shows completed inspection activity without an active-store banner', async () => {
    render(<ActivityView />);

    expect(screen.getByRole('heading', { name: /activity/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'North Store', level: 3 })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /north store/i })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: /north store/i }));
    expect(screen.getByText('ACU-0001')).toBeInTheDocument();
    expect(screen.getByText('ClearView · CV-100')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ACU-0001.*ClearView.*CV-100/i })).toHaveAttribute('href', '/inspect/inspection-1?view=1');
    expect(screen.getAllByText('Compliant').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('group', { name: 'Activity outcome filter' })).toHaveClass('w-full');
    expect(screen.getByTestId('activity-outcome-filter-bar')).toHaveClass('sticky');
    expect(screen.queryByText('No active store selected.')).not.toBeInTheDocument();
    expect(screen.queryByText('Local record')).not.toBeInTheDocument();
    expect(screen.getByText('Completed inspections from this device and your synced account.')).toBeInTheDocument();
  });

  it('renders inspection ListRows that open View and expose edit/delete from the overflow menu', async () => {
    render(<ActivityView />);

    fireEvent.click(await screen.findByRole('button', { name: /north store/i }));
    const viewRow = await screen.findByRole('link', { name: /ACU-0001.*CV-100/i });
    expect(viewRow).toHaveAttribute('href', '/inspect/inspection-1?view=1');
    expect(viewRow).toHaveClass('block');
    expect(screen.getByTestId('activity-store-header').parentElement?.querySelector('ol')).toHaveClass('space-y-3');
    expect(screen.getByRole('status', { name: 'Compliant status' })).toBeInTheDocument();
    expect(screen.getByTestId('activity-store-header')).toHaveClass('sticky');
    expect(screen.queryByRole('link', { name: 'Edit inspection' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /inspection actions for acu-0001/i }));
    expect(screen.getByRole('menuitem', { name: /edit inspection/i })).toHaveAttribute('href', '/inspect/inspection-1');
    expect(screen.getByRole('menuitem', { name: /delete inspection/i })).toBeInTheDocument();
  });

  it('keeps mobile activity rows to a non-wrapping control line, truncated product line, and labeled sync icon', async () => {
    mocks.listActivity.mockResolvedValue([{
      id: 'mobile-row', inspectionId: 'mobile-inspection', storeName: 'North Store', controlNumber: 'ACU-0001', brand: 'ClearView', model: 'CV-100', username: 'inspector-1', outcome: 'compliant', syncStatus: 'pending', createdAt: '2026-10-05T01:00:00.000Z',
    }]);
    render(<ActivityView />);
    fireEvent.click(await screen.findByRole('button', { name: /north store/i }));
    expect(screen.getByTestId('activity-control-line')).toHaveClass('whitespace-nowrap');
    expect(screen.getByTestId('activity-product-line')).toHaveClass('truncate');
    expect(screen.getByTestId('activity-status-line')).toHaveTextContent('inspector-1');
    expect(screen.getByTestId('sync-chip-pending')).toHaveAttribute('data-sync-icon', 'waiting');
    expect(screen.getByTestId('sync-chip-pending')).toHaveAttribute('aria-label', 'Sync status: Waiting to upload');
    expect(screen.getByTestId('sync-chip-pending')).toHaveAttribute('title', 'Waiting to upload');
  });

  it('shows a short sync error beside the activity status', async () => {
    mocks.listActivity.mockResolvedValue([{
      id: 'failed-activity',
      inspectionId: 'failed-inspection',
      storeName: 'North Store',
      controlNumber: 'ACU-FAILED',
      outcome: 'compliant',
      syncStatus: 'failed',
      syncError: 'Evidence file "label.jpg" is missing from this device.',
      createdAt: '2026-10-05T01:00:00.000Z',
    }]);

    render(<ActivityView />);

    fireEvent.click(await screen.findByRole('button', { name: /north store/i }));
    expect(await screen.findByTestId('sync-chip-failed')).toHaveAttribute('aria-label', 'Sync status: Needs attention');
    expect(screen.getByTestId('sync-chip-failed')).toHaveAttribute('title', expect.stringContaining('Evidence file "label.jpg" is missing'));
  });

  it.each([
    ['synced', 'Synced'],
    ['remote', 'From server'],
    ['pending', 'Waiting to upload'],
    ['uploading', 'Waiting to upload'],
    ['pushing', 'Uploading…'],
    ['retry', 'Retrying'],
    ['failed', 'Needs attention'],
    ['conflict', 'Needs attention'],
  ])('maps %s activity sync status to an accessible chip', async (syncStatus, label) => {
    mocks.listActivity.mockResolvedValue([{ id: 'status-activity', inspectionId: 'status-inspection', storeName: 'North Store', controlNumber: 'ACU-STATUS', outcome: 'compliant', syncStatus, createdAt: '2026-10-05T01:00:00.000Z' }]);

    render(<ActivityView />);

    fireEvent.click(await screen.findByRole('button', { name: /north store/i }));
    const chip = await screen.findByTestId(`sync-chip-${syncStatus}`);
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveAttribute('aria-label', `Sync status: ${label}`);
    expect(chip).toHaveAttribute('data-sync-icon', ['synced', 'remote'].includes(syncStatus) ? 'synced' : ['failed', 'conflict'].includes(syncStatus) ? 'attention' : 'waiting');
    expect(chip).toHaveAttribute('title', expect.stringContaining(label));
  });

  it('renders an unavailable outcome with a clear neutral chip', async () => {
    mocks.listActivity.mockResolvedValue([{
      id: 'unavailable-activity',
      inspectionId: 'unavailable-inspection',
      storeName: 'North Store',
      controlNumber: 'ACU-UNAVAILABLE',
      outcome: 'unavailable',
      createdAt: '2026-10-05T01:00:00.000Z',
    }]);

    render(<ActivityView />);

    fireEvent.click(await screen.findByRole('button', { name: /north store/i }));
    expect(await screen.findByText('Outcome unavailable')).toBeInTheDocument();
  });

  it('shows a retry action for failed inspections and sends an upload retry', async () => {
    mocks.listActivity.mockResolvedValue([{
      id: 'retry-activity',
      inspectionId: 'retry-inspection',
      storeName: 'North Store',
      controlNumber: 'ACU-RETRY',
      outcome: 'compliant',
      syncStatus: 'failed',
      syncError: 'Upload failed',
      createdAt: '2026-10-05T01:00:00.000Z',
    }]);
    const snapshot = { status: 'live' as const };
    mocks.statusStore = { getSnapshot: () => snapshot, subscribe: () => () => undefined, syncNow: vi.fn().mockResolvedValue(undefined) };

    render(<ActivityView />);

    fireEvent.click(await screen.findByRole('button', { name: /north store/i }));
    fireEvent.click(await screen.findByRole('button', { name: /inspection actions for acu-retry/i }));
    const retry = await screen.findByRole('menuitem', { name: 'Retry' });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.statusStore?.syncNow).toHaveBeenCalledWith('manual', 'upload'));
  });

  it('marks a store when one of its inspections is not synced', async () => {
    mocks.listActivity.mockResolvedValue([
      { id: 'synced-activity', inspectionId: 'synced-inspection', storeName: 'North Store', controlNumber: 'ACU-SYNCED', outcome: 'compliant', syncStatus: 'synced', createdAt: '2026-10-05T02:00:00.000Z' },
      { id: 'pending-activity', inspectionId: 'pending-inspection', storeName: 'North Store', controlNumber: 'ACU-PENDING', outcome: 'compliant', syncStatus: 'pending', createdAt: '2026-10-05T01:00:00.000Z' },
    ]);

    render(<ActivityView />);

    expect(await screen.findByLabelText('1 inspections not synced')).toBeInTheDocument();
    expect(screen.getByText('1 not synced')).toBeInTheDocument();
  });

  it('does not show active-store actions on the activity page', async () => {
    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'North Store', level: 3 })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /store actions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /edit store/i })).not.toBeInTheDocument();
  });

  it('shows a useful empty state when no completed activity exists', async () => {
    mocks.listActivity.mockResolvedValue([]);

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByText(/no completed inspections yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /product type/i }));
    expect(screen.getByRole('option', { name: 'Air Conditioners' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Electric Fans' })).toBeInTheDocument();
  });

  it('refreshes activity after a local database change', async () => {
    let notify = () => {};
    const unsubscribe = vi.fn();
    mocks.subscribeChanges.mockImplementation((listener: () => void) => { notify = listener; return unsubscribe; });
    const view = render(<ActivityView />);
    fireEvent.click(await screen.findByRole('button', { name: /north store/i }));
    await screen.findByRole('link', { name: /ACU-0001/ });
    mocks.listActivity.mockResolvedValue([{ id: 'updated-activity', inspectionId: 'inspection-1', storeName: 'North Store', controlNumber: 'ACU-UPDATED', outcome: 'non_compliant', createdAt: '2026-10-12T08:00:00.000Z' }]);
    const { act } = await import('@testing-library/react');
    act(() => notify());
    await screen.findByText('ACU-UPDATED');
    expect(screen.queryByText('ACU-0001')).not.toBeInTheDocument();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('groups inspections by store and identifies the inspector', async () => {
    mocks.listActivity.mockResolvedValue([
      { id: 'activity-2', inspectionId: 'inspection-2', storeName: 'North Store', location: 'NCR', productType: 'Air Conditioners', controlNumber: 'ACU-0002', outcome: 'non_compliant', username: 'inspector-2', createdAt: '2026-10-05T02:00:00.000Z', eventType: 'inspection_completed' },
      { id: 'activity-1', inspectionId: 'inspection-1', storeName: 'North Store', location: 'NCR', productType: 'Air Conditioners', controlNumber: 'ACU-0001', outcome: 'compliant', username: 'inspector-1', createdAt: '2026-10-05T01:00:00.000Z', eventType: 'inspection_completed' },
      { id: 'activity-3', inspectionId: 'inspection-3', storeName: 'South Store', location: 'Luzon', productType: 'Electric Fans', controlNumber: 'FAN-0003', outcome: 'compliant', username: 'inspector-1', createdAt: '2026-10-04T01:00:00.000Z', eventType: 'inspection_completed' },
    ]);

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'North Store', level: 3 })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'South Store', level: 3 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /north store/i }));
    fireEvent.click(screen.getByRole('button', { name: /south store/i }));
    expect(screen.getByRole('link', { name: /ACU-0002/ })).toHaveAttribute('href', '/inspect/inspection-2?view=1');
    expect(screen.getByRole('link', { name: /ACU-0001/ })).toHaveAttribute('href', '/inspect/inspection-1?view=1');
    expect(screen.getByRole('link', { name: /FAN-0003/ })).toHaveAttribute('href', '/inspect/inspection-3?view=1');
    expect(screen.queryAllByText('Model Number Code')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /ACU-0002/ })).toHaveAttribute('href', '/inspect/inspection-2?view=1');
    expect(screen.getByRole('status', { name: 'Non-compliant status' })).toBeInTheDocument();
    const editActions = screen.getAllByRole('button', { name: /inspection actions for acu-0002/i });
    fireEvent.click(editActions[0]!);
    expect(screen.getByRole('menuitem', { name: /edit inspection/i })).toHaveAttribute('href', '/inspect/inspection-2');
  });

  it('loads eight store groups initially and reveals more stores on demand', async () => {
    mocks.listActivity.mockResolvedValue(Array.from({ length: 9 }, (_, index) => ({
      id: `activity-${index + 1}`,
      inspectionId: `inspection-${index + 1}`,
      storeName: `Store ${index + 1}`,
      location: 'NCR',
      productType: 'Air Conditioners',
      controlNumber: `ACU-${String(index + 1).padStart(4, '0')}`,
      outcome: 'compliant',
      username: 'inspector-1',
      createdAt: `2026-10-05T0${index}:00:00.000Z`,
      eventType: 'inspection_completed',
    })));

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Store 8', level: 3 })).toBeInTheDocument());
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(8);
    expect(screen.getAllByRole('button', { name: /store \d+/i })).toHaveLength(8);
    expect(screen.queryByRole('heading', { name: 'Store 1', level: 3 })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /load more stores/i }));
    expect(await screen.findByRole('heading', { name: 'Store 1', level: 3 })).toBeInTheDocument();
  });

  it('loads more activity pages to fill the initial eight-store view', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `activity-${index + 1}`,
      inspectionId: `inspection-${index + 1}`,
      storeName: index < 50 ? 'Store 1' : 'Store 2',
      location: 'NCR',
      productType: 'Air Conditioners',
      controlNumber: `ACU-${String(index + 1).padStart(4, '0')}`,
      outcome: 'compliant' as const,
      username: 'inspector-1',
      createdAt: `2026-10-05T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
      eventType: 'inspection_completed' as const,
    }));
    const secondPage = Array.from({ length: 6 }, (_, index) => ({
      id: `activity-next-${index + 1}`,
      inspectionId: `inspection-next-${index + 1}`,
      storeName: `Store ${index + 3}`,
      location: 'NCR',
      productType: 'Air Conditioners',
      controlNumber: `ACU-NEXT-${String(index + 1).padStart(4, '0')}`,
      outcome: 'compliant' as const,
      username: 'inspector-1',
      createdAt: `2026-10-06T${String(index).padStart(2, '0')}:00:00.000Z`,
      eventType: 'inspection_completed' as const,
    }));
    mocks.listActivityPage = vi.fn()
      .mockResolvedValueOnce({ rows: firstPage, hasMore: true, nextCursor: { createdAt: firstPage.at(-1)!.createdAt, id: firstPage.at(-1)!.id } })
      .mockResolvedValueOnce({ rows: secondPage, hasMore: false });

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Store 8', level: 3 })).toBeInTheDocument());
    expect(mocks.listActivityPage).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(8);
  });

  it('migrates v1 filters while ignoring old collapsed store state', async () => {
    localStorage.setItem('pelp-pal:activity-view:v1', JSON.stringify({
      filters: { outcome: 'compliant', productType: '', storeName: '', inspector: '', syncStatus: '', evidence: 'all', dateFrom: '', dateTo: '' },
      collapsedStoreKeys: ['north store\u0000ncr'],
    }));
    mocks.listActivity.mockResolvedValue([
      { id: 'activity-north', inspectionId: 'inspection-north', storeName: 'North Store', location: 'NCR', controlNumber: 'ACU-NORTH', outcome: 'compliant', createdAt: '2026-10-05T02:00:00.000Z', eventType: 'inspection_completed' },
    ]);

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'North Store', level: 3 })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /north store/i })).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem('pelp-pal:activity-view:v1')).toBeNull();
    expect(JSON.parse(localStorage.getItem('pelp-pal:activity-view:v2') ?? '{}').filters.outcome).toBe('compliant');
  });

  it('persists an opened store and restores it after remounting', async () => {
    const view = render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /north store/i })).toHaveAttribute('aria-expanded', 'false'));
    fireEvent.click(screen.getByRole('button', { name: /north store/i }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('pelp-pal:activity-view:v2') ?? '{}').expandedStoreKeys).toEqual(['north store\u0000ncr']));
    view.unmount();

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /north store/i })).toHaveAttribute('aria-expanded', 'true'));
  });

  it('ignores malformed persisted Activity state', async () => {
    localStorage.setItem('pelp-pal:activity-view:v1', '{not valid json');
    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'North Store', level: 3 })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /north store/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('groups repeated product inspections and hides duplicate revision events', async () => {
    mocks.listActivity.mockResolvedValue([
      { id: 'activity-3', inspectionId: 'inspection-3', storeName: 'North Store', location: 'NCR', productType: 'Air Conditioners', controlNumber: 'ACU-0002', outcome: 'non_compliant', username: 'inspector-2', revision: 1, createdAt: '2026-10-05T03:00:00.000Z', eventType: 'inspection_completed' },
      { id: 'activity-2-revision-2', inspectionId: 'inspection-2', storeName: 'North Store', location: 'NCR', productType: 'Air Conditioners', controlNumber: 'ACU-0002', outcome: 'compliant', username: 'inspector-1', revision: 2, createdAt: '2026-10-05T02:00:00.000Z', eventType: 'inspection_updated' },
      { id: 'activity-2-revision-1', inspectionId: 'inspection-2', storeName: 'North Store', location: 'NCR', productType: 'Air Conditioners', controlNumber: 'ACU-0002', outcome: 'compliant', username: 'inspector-1', revision: 1, createdAt: '2026-10-05T01:00:00.000Z', eventType: 'inspection_completed' },
    ]);

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'North Store', level: 3 })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /north store/i }));
    expect(screen.getAllByRole('heading', { name: /ACU-0002 · 2 inspections · Air Conditioners/, level: 4 })).toHaveLength(1);
    expect(screen.queryByText('Revision 1')).not.toBeInTheDocument();

    expect(await screen.findByRole('link', { name: /Inspection 1/ })).toHaveAttribute('href', '/inspect/inspection-3?view=1');
    expect(screen.getByRole('link', { name: /Inspection 2/ })).toHaveAttribute('href', '/inspect/inspection-2?view=1');
    fireEvent.click(screen.getAllByRole('button', { name: /inspection actions for acu-0002/i })[1]!);
    expect(screen.getByRole('menuitem', { name: /edit inspection/i })).toHaveAttribute('href', '/inspect/inspection-2');
    expect(screen.queryByText('Revision 1')).not.toBeInTheDocument();
  });

  it('groups control numbers that use visually equivalent Unicode separators', async () => {
    mocks.listActivity.mockResolvedValue([
      { id: 'air-king-1', inspectionId: 'air-king-inspection-1', storeName: 'Air King Air Conditioning', location: 'Mindanao', productType: 'Air Conditioners', controlNumber: 'ACU-0049-00275', outcome: 'compliant', username: 'vja', createdAt: '2026-10-07T03:00:00.000Z', eventType: 'inspection_completed' },
      { id: 'air-king-2', inspectionId: 'air-king-inspection-2', storeName: 'Air King Air Conditioning', location: 'Mindanao', productType: 'Air Conditioners', controlNumber: 'ACU‑0049‑00275', outcome: 'compliant', username: 'vja', createdAt: '2026-10-06T03:00:00.000Z', eventType: 'inspection_completed' },
    ]);

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Air King Air Conditioning', level: 3 })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /air king air conditioning/i }));
    expect(screen.getByRole('button', { name: /collapse acu-0049-00275 inspections/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Inspection [12]/ })).toHaveLength(2);
  });

  it('opens quick actions for QR scanning or catalog search', async () => {
    render(<ActivityView />);

    const quickActions = screen.getByRole('button', { name: /open quick actions/i });
    expect(quickActions).toHaveClass('fixed');
    fireEvent.click(quickActions);
    expect(screen.getByRole('menuitem', { name: /scan qr code/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /search catalog/i })).toHaveAttribute('href', '/lookup');

    fireEvent.click(screen.getByRole('menuitem', { name: /scan qr code/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent('QR scanner');
  });

  it('deletes an inspection after the action is revealed by a swipe', async () => {
    render(<ActivityView />);

    fireEvent.click(await screen.findByRole('button', { name: /north store/i }));
    const card = await screen.findByRole('link', { name: /ACU-0001/ });
    const cardSurface = card.closest('[data-inspection-card]');
    expect(cardSurface).not.toBeNull();
    fireEvent.touchStart(cardSurface!, { touches: [{ clientX: 320, clientY: 120 }] });
    fireEvent.touchMove(cardSurface!, { touches: [{ clientX: 200, clientY: 120 }] });
    fireEvent.touchEnd(cardSurface!);

    fireEvent.click(await screen.findByRole('button', { name: /delete inspection acu-0001/i }));
    expect(screen.getByRole('dialog', { name: /delete inspection/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('dialog', { name: /delete inspection/i }).querySelector('button:last-child')!);

    await waitFor(() => expect(mocks.deleteInspection).toHaveBeenCalledWith('inspection-1'));
    await waitFor(() => expect(screen.queryByRole('link', { name: /ACU-0001/ })).not.toBeInTheDocument());
  });

  it('toggles the delete action when the three-dot action is tapped', async () => {
    render(<ActivityView />);

    fireEvent.click(await screen.findByRole('button', { name: /north store/i }));
    await screen.findByRole('link', { name: /ACU-0001/ });
    const actionsButton = screen.getByRole('button', { name: /inspection actions for acu-0001/i });
    fireEvent.click(actionsButton);
    expect(screen.getByRole('menuitem', { name: /edit inspection/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /delete inspection/i })).toBeInTheDocument();
  });

  it('offers undo after deleting an inspection locally', async () => {
    render(<ActivityView />);

    fireEvent.click(await screen.findByRole('button', { name: /north store/i }));
    await screen.findByRole('link', { name: /ACU-0001/ });
    fireEvent.click(screen.getByRole('button', { name: /inspection actions for acu-0001/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /delete inspection/i }));
    fireEvent.click(screen.getByRole('dialog', { name: /delete inspection/i }).querySelector('button:last-child')!);

    await waitFor(() => expect(screen.queryByRole('link', { name: /ACU-0001/ })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /delete inspection/i })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    await waitFor(() => expect(mocks.restoreDeletedInspection).toHaveBeenCalledWith('inspection-1'));
  });

  it('offers store and inspector filters', async () => {
    mocks.listActivity.mockResolvedValue([
      { id: 'activity-1', inspectionId: 'inspection-1', storeName: 'North Store', location: 'NCR', productType: 'Air Conditioners', controlNumber: 'ACU-0001', outcome: 'compliant', username: 'inspector-1', createdAt: '2026-10-05T01:00:00.000Z', eventType: 'inspection_completed' },
      { id: 'activity-2', inspectionId: 'inspection-2', storeName: 'South Store', location: 'Luzon', productType: 'Electric Fans', controlNumber: 'FAN-0002', outcome: 'compliant', username: 'inspector-2', createdAt: '2026-10-05T02:00:00.000Z', eventType: 'inspection_completed' },
    ]);
    mocks.listActivityFilterOptions.mockImplementation(async (filter: { storeName?: string }) => ({
      storeNames: ['North Store', 'South Store'],
      inspectors: filter.storeName === 'South Store' ? ['inspector-2'] : ['inspector-1', 'inspector-2'],
      productTypes: filter.storeName === 'South Store' ? ['Electric Fans'] : ['Air Conditioners', 'Electric Fans'],
    }));
    mocks.getCatalogEcpTypes.mockResolvedValue([]);

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'South Store', level: 3 })).toBeInTheDocument());
    const storeSelect = within(screen.getByTestId('desktop-activity-store-filter-label')).getByRole('button');
    fireEvent.click(storeSelect);
    expect(screen.getByRole('option', { name: 'North Store' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'South Store' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'South Store' }));
    await waitFor(() => expect(screen.getByText('1 completed inspection')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'North Store', level: 3 })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'South Store', level: 3 })).toBeInTheDocument();

    const inspectorSelect = within(screen.getByTestId('desktop-activity-inspector-filter-label')).getByRole('button');
    fireEvent.click(inspectorSelect);
    expect(screen.getByRole('option', { name: 'inspector-2' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'inspector-1' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'inspector-2' }));
    await waitFor(() => expect(screen.getByText('1 completed inspection')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /product type/i }));
    expect(screen.getByRole('option', { name: 'Electric Fans' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Air Conditioners' })).not.toBeInTheDocument();
  });

  it('opens, applies, and clears the mobile filter sheet', async () => {
    mocks.listActivity.mockResolvedValue([
      { id: 'activity-north', inspectionId: 'inspection-north', storeName: 'North Store', location: 'NCR', productType: 'Air Conditioners', outcome: 'compliant', createdAt: '2026-10-05T01:00:00.000Z' },
      { id: 'activity-south', inspectionId: 'inspection-south', storeName: 'South Store', location: 'Luzon', productType: 'Electric Fans', outcome: 'compliant', createdAt: '2026-10-05T02:00:00.000Z' },
    ]);
    mocks.listActivityFilterOptions.mockResolvedValue({
      storeNames: ['North Store', 'South Store'],
      inspectors: [],
      productTypes: ['Air Conditioners', 'Electric Fans'],
    });

    render(<ActivityView />);

    await waitFor(() => expect(mocks.listActivityFilterOptions).toHaveBeenCalled());
    const filterButton = screen.getByRole('button', { name: /open filters/i });
    fireEvent.click(filterButton);
    const sheet = screen.getByTestId('activity-filter-sheet');
    expect(within(sheet).getByText('Filters')).toBeInTheDocument();
    expect(within(sheet).getByTestId('mobile-activity-store-filter-label').querySelector('button')).toHaveClass('min-h-12');

    fireEvent.click(within(sheet).getByTestId('mobile-activity-store-filter-label').querySelector('button')!);
    fireEvent.click(await screen.findByRole('option', { name: 'South Store' }));
    fireEvent.click(within(sheet).getByRole('button', { name: /apply filters/i }));

    await waitFor(() => expect(screen.getByTestId('activity-filter-count')).toHaveTextContent('1'));
    expect(screen.getByTestId('activity-filter-chip-store')).toHaveTextContent('South Store');

    fireEvent.click(filterButton);
    fireEvent.click(within(screen.getByTestId('activity-filter-sheet')).getByRole('button', { name: /^Clear$/i }));
    expect(screen.queryByTestId('activity-filter-chip-store')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('activity-filter-count')).toHaveAttribute('data-count', '0'));
  });

  it('keeps secondary filters in the desktop More filters popover and moves deletion guidance behind help', async () => {
    mocks.listActivity.mockResolvedValue([{ id: 'activity-1', inspectionId: 'inspection-1', storeName: 'North Store', location: 'NCR', productType: 'Air Conditioners', outcome: 'compliant', createdAt: '2026-10-05T01:00:00.000Z' }]);
    mocks.listActivityFilterOptions.mockResolvedValue({ storeNames: ['North Store'], inspectors: [], productTypes: ['Air Conditioners'] });

    render(<ActivityView />);

    expect(screen.queryByText(/swipe an inspection left/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activity help' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(/swipe an inspection left/i);

    const moreFilters = screen.getByTestId('activity-more-filters');
    fireEvent.click(moreFilters);
    const panel = screen.getByRole('region', { name: 'More activity filters' });
    expect(within(panel).getByRole('button', { name: /sync status/i })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /evidence/i })).toBeInTheDocument();
    expect(within(panel).getByLabelText('From')).toHaveAttribute('type', 'date');
    fireEvent.click(within(panel).getByRole('button', { name: /sync status/i }));
    fireEvent.click((await screen.findAllByRole('option', { name: 'Needs attention' }))[1]);
    expect(moreFilters).toHaveTextContent('1');
  });

  it('keeps a selected option visible when faceted results no longer contain it', async () => {
    localStorage.setItem('pelp-pal:activity-view:v2', JSON.stringify({
      filters: { outcome: 'all', productType: 'Legacy Type', storeName: 'Legacy Store', inspector: 'legacy-user', syncStatus: '', evidence: 'all', dateFrom: '', dateTo: '' },
      expandedStoreKeys: [],
    }));
    mocks.listActivityFilterOptions.mockResolvedValue({ storeNames: ['North Store'], inspectors: ['inspector-1'], productTypes: ['Air Conditioners'] });

    render(<ActivityView />);

    await waitFor(() => expect(within(screen.getByTestId('desktop-activity-store-filter-label')).getByRole('button')).toHaveTextContent('Legacy Store'));
    expect(within(screen.getByTestId('desktop-activity-inspector-filter-label')).getByRole('button')).toHaveTextContent('legacy-user');
    expect(within(screen.getByTestId('desktop-activity-product-filter-label')).getByRole('button')).toHaveTextContent('Legacy Type');
  });

  it('collapses long inspection groups and expands them on demand', async () => {
    mocks.listActivity.mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({
      id: `activity-${index + 1}`,
      inspectionId: `inspection-${index + 1}`,
      storeName: 'Puregold Clark',
      location: 'Luzon',
      controlNumber: `ACU-${String(index + 1).padStart(4, '0')}`,
      outcome: 'unavailable',
      username: 'inspector-1',
      createdAt: `2026-10-05T0${index}:00:00.000Z`,
      eventType: 'inspection_completed',
    })));

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Puregold Clark', level: 3 })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /puregold clark/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /ACU-0001/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /puregold clark/i }));
    expect(await screen.findByRole('link', { name: /ACU-0001/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /puregold clark/i })).toHaveAttribute('aria-expanded', 'true');
  });
});
