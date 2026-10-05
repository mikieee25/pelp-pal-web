import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDashboardCounts: vi.fn(),
  listInspectionDrafts: vi.fn(),
  getDevice: vi.fn(),
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => ({
    getDashboardCounts: mocks.getDashboardCounts,
    listInspectionDrafts: mocks.listInspectionDrafts,
    getDevice: mocks.getDevice,
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
    mocks.getDevice.mockResolvedValue({ enrolled: true });
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
    expect(screen.getByText(/this browser is enrolled and ready to sync/i)).toBeInTheDocument();
    expect(screen.getByText('Sample Store')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /resume/i })).toHaveAttribute('href', '/inspect/draft-1');
  });
});
