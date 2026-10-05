import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCompletedInspections: vi.fn(),
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => ({
    listCompletedInspections: mocks.listCompletedInspections,
  }),
}));

vi.mock('@/lib/animation/gsap', () => ({
  fadeUp: () => () => {},
}));

import { SummaryView } from '@/features/summary/summary-view';

describe('SummaryView', () => {
  beforeEach(() => {
    mocks.listCompletedInspections.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('always renders the zero-filled compliance report when there are no inspections', async () => {
    render(<SummaryView />);

    expect(screen.getByRole('heading', { name: 'Compliance Summary' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Air-conditioner 0 0 0 0 N\/A/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Total: 0 0 0 0 N\/A/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Non-Compliance Breakdown Summary/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Summary of EMV Results/i })).toBeInTheDocument();
    await waitFor(() => expect(mocks.listCompletedInspections).toHaveBeenCalledOnce());
  });

  it('aggregates a completed inspection into its product type row', async () => {
    mocks.listCompletedInspections.mockResolvedValue([
      {
        id: 'inspection-1',
        storeId: 'store-1',
        storeName: 'Sample Store',
        controlNumber: 'ACU-0001',
        model: 'MODEL-1',
        productType: 'Air Conditioners',
        labeling: 'with_label',
        placement: 'passing',
        visualQuality: 'failing',
        productDetails: 'passing',
        outcome: 'non_compliant',
        username: 'sample',
        completedAt: '2026-10-05T01:00:00.000Z',
      },
    ]);

    render(<SummaryView />);

    await waitFor(() => expect(screen.getByRole('row', { name: /Air-conditioner 1 1 0 1 0%/i })).toBeInTheDocument());
    expect(screen.getByText(/MODEL-1/)).toBeInTheDocument();
  });
});
