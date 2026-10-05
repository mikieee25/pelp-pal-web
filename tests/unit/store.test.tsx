import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentStore: vi.fn(),
  getInspection: vi.fn(),
  saveCurrentStore: vi.fn(),
}));

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => mocks,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams('returnTo=%2Finspect%2Finspection-1'),
  usePathname: () => '/inspect/inspection-1',
}));

import { StoreForm } from '@/features/store/store-form';
import { InspectionGuard } from '@/features/store/inspection-guard';

describe('StoreForm', () => {
  beforeEach(() => {
    mocks.getCurrentStore.mockResolvedValue(undefined);
    mocks.getInspection.mockResolvedValue(undefined);
    mocks.saveCurrentStore.mockResolvedValue({ id: 'current', storeId: 'NCR-20261005-001', name: 'North Store', location: 'NCR' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('requires store details before returning to the requested inspection', async () => {
    render(<StoreForm />);

    await waitFor(() => expect(screen.getByRole('textbox', { name: /store name/i })).toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox', { name: /store name/i }), { target: { value: 'North Store' } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /location/i }));
    fireEvent.click(screen.getByRole('option', { name: 'NCR' }));
    fireEvent.click(screen.getByRole('button', { name: /save store details/i }));

    await waitFor(() => expect(mocks.saveCurrentStore).toHaveBeenCalledWith(expect.objectContaining({ name: 'North Store', location: 'NCR' })));
    expect(router.push).toHaveBeenCalledWith('/inspect/inspection-1');
  });
});

describe('InspectionGuard', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('redirects an inspection start to store details when no active store exists', async () => {
    mocks.getCurrentStore.mockResolvedValue(undefined);

    render(<InspectionGuard inspectionId="inspection-1"><div>Inspection content</div></InspectionGuard>);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/store?returnTo=%2Finspect%2Finspection-1'));
    expect(screen.queryByText('Inspection content')).not.toBeInTheDocument();
  });
});
