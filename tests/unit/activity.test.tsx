import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listActivity: vi.fn(),
  getCatalogEcpTypes: vi.fn(),
  getCurrentStore: vi.fn(),
  listSavedStores: vi.fn(),
  finishCurrentStore: vi.fn(),
  deleteInspection: vi.fn(),
  restoreDeletedInspection: vi.fn(),
  deleteSavedStore: vi.fn(),
  router: { push: vi.fn() },
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => mocks,
}));

vi.mock('@/lib/animation/gsap', () => ({
  fadeUp: () => () => {},
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
}));

vi.mock('@/features/lookup/qr-scanner-dialog', () => ({
  QrScannerDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">QR scanner</div> : null,
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
    mocks.getCatalogEcpTypes.mockResolvedValue(['Air Conditioners', 'Electric Fans']);
    mocks.getCurrentStore.mockResolvedValue({ id: 'current', storeId: 'NCR-20261005-001', name: 'North Store', location: 'NCR' });
    mocks.listSavedStores.mockResolvedValue([]);
    mocks.deleteInspection.mockResolvedValue(undefined);
    mocks.restoreDeletedInspection.mockResolvedValue(undefined);
    mocks.deleteSavedStore.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows completed inspection activity and active store actions', async () => {
    render(<ActivityView />);

    expect(screen.getByRole('heading', { name: /activity/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('North Store')).toBeInTheDocument());
    expect(screen.getByText('ACU-0001')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ACU-0001', level: 4 })).toBeInTheDocument();
    expect(screen.getAllByText('Compliant').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('group', { name: 'Activity outcome filter' })).toHaveClass('MuiToggleButtonGroup-fullWidth');
    expect(screen.getByRole('link', { name: /edit store/i })).toHaveAttribute('href', '/store?returnTo=%2Factivity');
    expect(screen.getByRole('button', { name: /finish store/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /store actions/i }));
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' });
    fireEvent.click(screen.getByRole('menuitem', { name: /delete store/i }));
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' });
    fireEvent.click(screen.getByRole('dialog', { name: /delete store/i }).querySelector('button')!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /delete store/i })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /collapse store details/i }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /edit store/i })).not.toBeInTheDocument());
  });

  it('offers a delete action for the active store', async () => {
    render(<ActivityView />);

    await waitFor(() => expect(screen.getByText('North Store')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /store actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /delete store/i }));
    expect(screen.getByRole('dialog', { name: /delete store/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('dialog', { name: /delete store/i }).querySelector('button:last-child')!);

    await waitFor(() => expect(mocks.deleteSavedStore).toHaveBeenCalledWith('NCR-20261005-001'));
  });

  it('shows a useful empty state when no completed activity exists', async () => {
    mocks.listActivity.mockResolvedValue([]);

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByText(/no completed inspections yet/i)).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /product type/i }));
    expect(screen.getByRole('option', { name: 'Air Conditioners' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Electric Fans' })).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: 'ACU-0002', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ACU-0001', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'FAN-0003', level: 4 })).toBeInTheDocument();
    expect(screen.queryAllByText('Model Number Code')).toHaveLength(0);
    expect(screen.getAllByText('Inspected by')).toHaveLength(3);
    expect(screen.getByText('inspector-2')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Edit inspection' })).toHaveLength(3);
    expect(screen.getAllByRole('link', { name: 'Edit inspection' }).find((link) => link.getAttribute('href') === '/inspect/inspection-2')).toBeTruthy();
  });

  it('groups repeated product inspections and hides duplicate revision events', async () => {
    mocks.listActivity.mockResolvedValue([
      { id: 'activity-3', inspectionId: 'inspection-3', storeName: 'North Store', location: 'NCR', productType: 'Air Conditioners', controlNumber: 'ACU-0002', outcome: 'non_compliant', username: 'inspector-2', revision: 1, createdAt: '2026-10-05T03:00:00.000Z', eventType: 'inspection_completed' },
      { id: 'activity-2-revision-2', inspectionId: 'inspection-2', storeName: 'North Store', location: 'NCR', productType: 'Air Conditioners', controlNumber: 'ACU-0002', outcome: 'compliant', username: 'inspector-1', revision: 2, createdAt: '2026-10-05T02:00:00.000Z', eventType: 'inspection_updated' },
      { id: 'activity-2-revision-1', inspectionId: 'inspection-2', storeName: 'North Store', location: 'NCR', productType: 'Air Conditioners', controlNumber: 'ACU-0002', outcome: 'compliant', username: 'inspector-1', revision: 1, createdAt: '2026-10-05T01:00:00.000Z', eventType: 'inspection_completed' },
    ]);

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ACU-0002', level: 4 })).toBeInTheDocument());
    expect(screen.getByText('Air Conditioners · 2 inspections')).toBeInTheDocument();
    expect(screen.getByText('2 completed inspections')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'ACU-0002', level: 4 })).toHaveLength(1);
    expect(screen.queryByText('Revision 1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /expand acu-0002 inspections/i }));
    expect(await screen.findByRole('heading', { name: 'Inspection 1', level: 5 })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: /Inspection [12]/, level: 5 })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Edit inspection' }).find((link) => link.getAttribute('href') === '/inspect/inspection-2')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'View' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'View' }).find((link) => link.getAttribute('href') === '/inspect/inspection-2?view=1')).toBeTruthy();
    expect(screen.queryByText('Revision 1')).not.toBeInTheDocument();
  });

  it('groups control numbers that use visually equivalent Unicode separators', async () => {
    mocks.listActivity.mockResolvedValue([
      { id: 'air-king-1', inspectionId: 'air-king-inspection-1', storeName: 'Air King Air Conditioning', location: 'Mindanao', productType: 'Air Conditioners', controlNumber: 'ACU-0049-00275', outcome: 'compliant', username: 'vja', createdAt: '2026-10-07T03:00:00.000Z', eventType: 'inspection_completed' },
      { id: 'air-king-2', inspectionId: 'air-king-inspection-2', storeName: 'Air King Air Conditioning', location: 'Mindanao', productType: 'Air Conditioners', controlNumber: 'ACU‑0049‑00275', outcome: 'compliant', username: 'vja', createdAt: '2026-10-06T03:00:00.000Z', eventType: 'inspection_completed' },
    ]);

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Air King Air Conditioning', level: 3 })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /expand acu-0049-00275 inspections/i })).toBeInTheDocument();
  });

  it('opens quick actions for QR scanning or catalog search', async () => {
    render(<ActivityView />);

    const quickActions = screen.getByRole('button', { name: /open quick actions/i });
    expect(quickActions).toHaveStyle({ position: 'fixed' });
    fireEvent.click(quickActions);
    expect(screen.getByRole('menuitem', { name: /scan qr code/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /search catalog/i })).toHaveAttribute('href', '/lookup');

    fireEvent.click(screen.getByRole('menuitem', { name: /scan qr code/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent('QR scanner');
  });

  it('deletes an inspection after the action is revealed by a swipe', async () => {
    render(<ActivityView />);

    const card = await screen.findByRole('heading', { name: 'ACU-0001', level: 4 });
    const cardSurface = card.closest('[data-inspection-card]');
    expect(cardSurface).not.toBeNull();
    fireEvent.touchStart(cardSurface!, { touches: [{ clientX: 320, clientY: 120 }] });
    fireEvent.touchMove(cardSurface!, { touches: [{ clientX: 200, clientY: 120 }] });
    fireEvent.touchEnd(cardSurface!);

    fireEvent.click(await screen.findByRole('button', { name: /delete inspection acu-0001/i }));
    expect(screen.getByRole('dialog', { name: /delete inspection/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('dialog', { name: /delete inspection/i }).querySelector('button:last-child')!);

    await waitFor(() => expect(mocks.deleteInspection).toHaveBeenCalledWith('inspection-1'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'ACU-0001', level: 4 })).not.toBeInTheDocument());
  });

  it('toggles the delete action when the three-dot action is tapped', async () => {
    render(<ActivityView />);

    await screen.findByRole('heading', { name: 'ACU-0001', level: 4 });
    const deleteButton = screen.getByRole('button', { name: /delete inspection acu-0001/i });
    expect(deleteButton).toHaveAttribute('tabindex', '-1');
    const actionsButton = screen.getByRole('button', { name: /inspection actions for acu-0001/i });
    fireEvent.click(actionsButton);
    expect(deleteButton).toHaveAttribute('tabindex', '0');
    fireEvent.click(actionsButton);
    expect(deleteButton).toHaveAttribute('tabindex', '-1');
  });

  it('offers undo after deleting an inspection locally', async () => {
    render(<ActivityView />);

    await screen.findByRole('heading', { name: 'ACU-0001', level: 4 });
    fireEvent.click(screen.getByRole('button', { name: /inspection actions for acu-0001/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete inspection acu-0001/i }));
    fireEvent.click(screen.getByRole('dialog', { name: /delete inspection/i }).querySelector('button:last-child')!);

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'ACU-0001', level: 4 })).not.toBeInTheDocument());
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

    render(<ActivityView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'South Store', level: 3 })).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /store/i }));
    expect(screen.getByRole('option', { name: 'South Store' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'South Store' }));
    await waitFor(() => expect(screen.getByText('1 completed inspection')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'North Store', level: 3 })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'South Store', level: 3 })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: /inspector/i }));
    expect(screen.getByRole('option', { name: 'inspector-1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'inspector-2' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /expand puregold clark inspections/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ACU-0001', level: 4 })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /expand puregold clark inspections/i }));
    expect(await screen.findByRole('heading', { name: 'ACU-0001', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /collapse puregold clark inspections/i })).toBeInTheDocument();
  });
});
