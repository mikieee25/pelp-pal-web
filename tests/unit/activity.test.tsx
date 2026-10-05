import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listActivity: vi.fn(),
  getCatalogEcpTypes: vi.fn(),
  getCurrentStore: vi.fn(),
  finishCurrentStore: vi.fn(),
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
});
