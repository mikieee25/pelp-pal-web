import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repository = vi.hoisted(() => ({
  getCurrentStore: vi.fn(), listSavedStores: vi.fn(), finishCurrentStore: vi.fn(),
  getDashboardCounts: vi.fn(), deleteSavedStore: vi.fn(), switchCurrentStore: vi.fn(),
}));
vi.mock('@/lib/db/browser', () => ({ getBrowserRepository: () => repository }));

import { CurrentStorePanel } from '@/features/store/current-store-panel';

describe('CurrentStorePanel action menu', () => {
  beforeEach(() => {
    repository.getCurrentStore.mockResolvedValue({ storeId: 'store-1', name: 'North Store', location: 'NCR' });
    repository.listSavedStores.mockResolvedValue([]);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('anchors the action popup to the store card instead of the viewport edge', async () => {
    render(<CurrentStorePanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Store actions' }));
    await waitFor(() => expect(screen.getByRole('menu', { name: 'Store actions' })).toBeInTheDocument());
    expect(screen.getByRole('menu', { name: 'Store actions' })).toHaveClass('absolute', 'right-2', 'top-full');
    expect(screen.getByRole('menu', { name: 'Store actions' }).parentElement).toHaveClass('relative');
  });
});
