import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCompletedInspections: vi.fn(),
  listActivity: vi.fn(),
  getCatalogByIds: vi.fn(),
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => ({
    listCompletedInspections: mocks.listCompletedInspections,
    listActivity: mocks.listActivity,
    getCatalogByIds: mocks.getCatalogByIds,
  }),
}));

vi.mock('@/lib/animation/gsap', () => ({
  fadeUp: () => () => {},
}));

import { SummaryView } from '@/features/summary/summary-view';

describe('SummaryView', () => {
  beforeEach(() => {
    mocks.listCompletedInspections.mockResolvedValue([]);
    mocks.listActivity.mockResolvedValue([]);
    mocks.getCatalogByIds.mockResolvedValue([]);
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
    expect(screen.getByRole('button', { name: /download csv/i })).toBeInTheDocument();
    expect(screen.getAllByTestId('table-scroll-container')).toHaveLength(4);
    await waitFor(() => expect(mocks.listCompletedInspections).toHaveBeenCalledOnce());
  });

  it('aggregates a completed inspection into its product type row', async () => {
    mocks.listCompletedInspections.mockResolvedValue([
      {
        id: 'inspection-1',
        catalogId: 'catalog-1',
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
    mocks.getCatalogByIds.mockResolvedValue([{ id: 'catalog-1', catalogScope: 'masterlist', dynamic_fields: JSON.stringify({ 'Company Name': 'ClearView Industries', 'Latest Average Price': 12500 }) }]);

    render(<SummaryView />);

    await waitFor(() => expect(screen.getByRole('row', { name: /Air-conditioner 1 1 0 1 0%/i })).toBeInTheDocument());
    expect(mocks.getCatalogByIds).toHaveBeenCalledWith(['catalog-1']);
    expect(screen.getByText(/MODEL-1/)).toBeInTheDocument();
    expect(screen.getByText('ClearView Industries')).toBeInTheDocument();
  });

  it('lists stores from synchronized snake_case inspection fields', async () => {
    mocks.listCompletedInspections.mockResolvedValue([
      {
        id: 'remote-inspection-1',
        store_id: 'store-remote-1',
        store_name: 'CompanyA',
        location: 'Makati',
        control_number: 'ACU-REMOTE-1',
        model_number: 'MODEL-REMOTE-1',
        product_type: 'Air Conditioners',
        outcome: 'compliant',
      },
    ]);

    render(<SummaryView />);

    await waitFor(() => expect(screen.getByRole('combobox', { name: /finished store/i })).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /finished store/i }));
    expect(screen.getByRole('option', { name: 'CompanyA' })).toBeInTheDocument();
  });

  it('populates compliance rows from synchronized ECP and checklist fields', async () => {
    mocks.listCompletedInspections.mockResolvedValue([
      {
        id: 'remote-ac-1',
        store_name: 'Abenson',
        location: 'Makati',
        control_number: 'ACU-1',
        model_number_code: 'AC-1',
        ecp_type: 'ACU',
        label_status: 'with_label',
        placement: 'passing',
        visual_quality: 'passing',
        product_details: 'passing',
        compliance_status: 'compliant',
      },
    ]);

    render(<SummaryView />);

    await waitFor(() => expect(screen.getByRole('combobox', { name: /finished store/i })).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /finished store/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Abenson' }));
    await waitFor(() => expect(screen.getByRole('row', { name: /Air-conditioner 1 1 0 0 100%/i })).toBeInTheDocument());
  });

  it('populates summary tables from the Flutter product snapshot contract', async () => {
    mocks.listCompletedInspections.mockResolvedValue([{
      id: 'flutter-led-1',
      status: 'completed',
      product_control_number: 'LED-1',
      product_snapshot: JSON.stringify({
        controlNumber: 'LED-1',
        productType: 'LED Lamps',
        brand: 'Bright',
        modelNumber: 'MODEL-LED-1',
        dynamicFields: { Company: 'Lighting Co.' },
      }),
      labeling_answer: 'with_label',
      placement_answer: 'passing',
      visual_quality_answer: 'passing',
      product_details_answer: 'passing',
      retail_price: '499',
    }]);
    mocks.listActivity.mockResolvedValue([{
      id: 'flutter-activity-1',
      inspectionId: 'flutter-led-1',
      storeName: 'Family Appliance - Buhangin',
      location: 'Mindanao',
      outcome: 'compliant',
      createdAt: '2026-10-07T00:00:00.000Z',
    }]);

    render(<SummaryView />);

    await waitFor(() => expect(screen.getByRole('combobox', { name: /finished store/i })).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /finished store/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Family Appliance - Buhangin' }));
    await waitFor(() => expect(screen.getByRole('row', { name: /Lighting Products 1 1 0 0 100%/i })).toBeInTheDocument());
  });
});
