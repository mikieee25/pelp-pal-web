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
  it('keeps preview report data collapsed while rendering safe zero-state values', async () => {
    mocks.listCompletedInspections.mockResolvedValue([]);
    mocks.getReportDraft.mockResolvedValue(undefined);
    mocks.saveReportDraft.mockResolvedValue(undefined);
    render(<ReportView />);

    expect(await screen.findByText('Preview report data')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview report data' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('table', { name: /non-compliance results/i })).toBeInTheDocument();
    expect(screen.getAllByTestId('report-mobile-compliance-card')).toHaveLength(5);
    expect(screen.getAllByTestId('report-mobile-breakdown-card')).toHaveLength(5);
    expect(screen.getAllByTestId('report-mobile-emv-card')).toHaveLength(5);
    expect(screen.getByTestId('report-mobile-nc-empty')).toBeInTheDocument();
    expect(screen.getByTestId('report-nc-table')).toHaveAttribute('data-sticky-first-column', 'true');
    expect(screen.getAllByTestId('table-scroll-cue')).toHaveLength(4);
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /download word report/i })).toBeInTheDocument();
    expect(screen.getByTestId('action-bar')).toContainElement(screen.getByRole('button', { name: /download word report/i }));
    expect(screen.getByRole('heading', { name: 'Report details' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Store and inspection' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Store contacts' })).toBeInTheDocument();
    expect(screen.getByTestId('report-address-row')).toHaveClass('md:col-span-2');
    expect(screen.getByTestId('report-acknowledged-row')).toHaveClass('md:col-span-2');
    expect(screen.getByRole('heading', { name: 'Findings and recommendations' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /include evidence photos/i })).not.toBeChecked();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('filters by finished store and autosaves editable report details', async () => {
    mocks.listCompletedInspections.mockResolvedValue([
      { id: 'inspection-1', status: 'completed', storeId: 'store-1', storeName: 'First Store', controlNumber: 'ACU-1', model: 'M1', productType: 'Air Conditioners', outcome: 'compliant' },
      { id: 'inspection-2', status: 'completed', storeId: 'store-2', storeName: 'Second Store', controlNumber: 'REF-1', model: 'R1', productType: 'REF', outcome: 'non_compliant', labeling: 'registered_only' },
    ]);
    mocks.getReportDraft.mockResolvedValue(undefined);
    mocks.saveReportDraft.mockResolvedValue(undefined);
    render(<ReportView />);

    const selector = screen.getByRole('button', { name: /finished store/i });
    fireEvent.click(selector);
    fireEvent.click(await screen.findByRole('option', { name: 'Second Store' }));
    await waitFor(() => expect(mocks.getReportDraft).toHaveBeenCalledWith('name:second store'));
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.queryByText('M1')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Region / province'), { target: { value: 'NCR' } });
    await waitFor(() => expect(mocks.saveReportDraft).toHaveBeenCalledWith(expect.objectContaining({ storeKey: 'name:second store', regionProvince: 'NCR' })), { timeout: 1000 });
  });
});
