import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCompletedInspections: vi.fn(),
  getReportDraft: vi.fn(),
  saveReportDraft: vi.fn(),
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => mocks,
}));

import { ReportView } from '@/features/report/report-view';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReportView', () => {
  it('renders all report tables with safe zero-state values', async () => {
    mocks.listCompletedInspections.mockResolvedValue([]);
    mocks.getReportDraft.mockResolvedValue(undefined);
    mocks.saveReportDraft.mockResolvedValue(undefined);
    render(<ReportView />);

    expect(await screen.findByRole('heading', { name: 'Compliance Summary' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /compliance summary/i })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /non-compliance breakdown/i })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /summary of emv/i })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /non-compliance results/i })).toBeInTheDocument();
    expect(screen.getAllByTestId('table-scroll-container')).toHaveLength(4);
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /download word report/i })).toBeInTheDocument();
  });

  it('filters by finished store and autosaves editable report details', async () => {
    mocks.listCompletedInspections.mockResolvedValue([
      { id: 'inspection-1', status: 'completed', storeId: 'store-1', storeName: 'First Store', controlNumber: 'ACU-1', model: 'M1', productType: 'Air Conditioners', outcome: 'compliant' },
      { id: 'inspection-2', status: 'completed', storeId: 'store-2', storeName: 'Second Store', controlNumber: 'REF-1', model: 'R1', productType: 'REF', outcome: 'non_compliant', labeling: 'registered_only' },
    ]);
    mocks.getReportDraft.mockResolvedValue(undefined);
    mocks.saveReportDraft.mockResolvedValue(undefined);
    render(<ReportView />);

    const selector = screen.getByRole('combobox', { name: 'Finished store' });
    fireEvent.mouseDown(selector);
    await screen.findByRole('option', { name: 'First Store' });
    fireEvent.click(screen.getByRole('option', { name: 'Second Store' }));
    await waitFor(() => expect(mocks.getReportDraft).toHaveBeenCalledWith('store-2'));
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.queryByText('M1')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Region / province'), { target: { value: 'NCR' } });
    await waitFor(() => expect(mocks.saveReportDraft).toHaveBeenCalledWith(expect.objectContaining({ storeKey: 'store-2', regionProvince: 'NCR' })), { timeout: 1000 });
  });
});
