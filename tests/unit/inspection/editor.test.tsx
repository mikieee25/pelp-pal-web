import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInspectionDraft: vi.fn(),
  getInspection: vi.fn(),
  getCurrentStore: vi.fn(),
  getCatalogById: vi.fn(),
  listEvidenceImages: vi.fn(),
  saveEvidenceImage: vi.fn(),
  deleteEvidenceImage: vi.fn(),
  completeInspection: vi.fn(),
  findDuplicateCompletedInspection: vi.fn(),
  saveInspectionDraft: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => mocks,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
}));

vi.mock('@/lib/auth/local-session-store', () => ({
  getLocalSession: () => ({ username: 'inspector-1' }),
}));

import { InspectionEditor } from '@/features/inspection/inspection-editor';

function selectCompleteChecklist() {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /labeling requirements/i }));
  fireEvent.click(screen.getByRole('option', { name: 'With Label' }));
  screen.getAllByRole('button', { name: 'Complied' }).forEach((button) => fireEvent.click(button));
}

describe('InspectionEditor', () => {
  beforeEach(() => {
    mocks.getInspectionDraft.mockResolvedValue({ id: 'product-1', storeName: 'Sample Store', remarks: '' });
    mocks.getInspection.mockResolvedValue(undefined);
    mocks.getCurrentStore.mockResolvedValue({ id: 'current', storeId: 'STORE-1', name: 'Sample Store', location: 'NCR' });
    mocks.getCatalogById.mockResolvedValue({
      id: 'product-1',
      catalogScope: 'masterlist',
      control_number: 'ACU-0001',
      product_type: 'Air Conditioners',
      brand: 'ClearView',
      model_number: 'CV-100',
      dynamic_fields: JSON.stringify({ 'Company Name': 'ClearView Industries', 'Latest Average Price': 12500 }),
    });
    mocks.listEvidenceImages.mockResolvedValue([]);
    mocks.saveEvidenceImage.mockResolvedValue({ id: 'evidence-1', inspectionId: 'product-1', displayOrder: 0, fileName: 'label.png', mimeType: 'image/png', size: 10, capturedAt: '2026-10-05T00:00:00.000Z' });
    mocks.deleteEvidenceImage.mockResolvedValue(undefined);
    mocks.completeInspection.mockResolvedValue(undefined);
    mocks.findDuplicateCompletedInspection.mockResolvedValue(undefined);
    mocks.saveInspectionDraft.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('prefills the selected product and advances through the inspection steps', async () => {
    render(<InspectionEditor inspectionId="product-1" />);

    await waitFor(() => expect(screen.getByDisplayValue('ACU-0001')).toBeInTheDocument());
    expect(screen.getByText('ClearView Industries')).toBeInTheDocument();
    const progress = screen.getByRole('list', { name: /inspection progress/i });
    expect(within(progress).getByLabelText('1. Product')).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: /review the energy label/i })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: /inspection progress/i })).getByLabelText('2. Energy Label')).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: /continue to checklist/i }));

    expect(screen.getByRole('heading', { name: /compliance checklist/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save inspection/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Complied' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'NC' })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'NC' })[0]);
    expect(screen.getAllByRole('button', { name: 'NC' })[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('requires evidence before finishing when any checklist finding is NC', async () => {
    render(<InspectionEditor inspectionId="product-1" />);

    await waitFor(() => expect(screen.getByDisplayValue('ACU-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: /continue to checklist/i }));
    selectCompleteChecklist();
    fireEvent.click(screen.getAllByRole('button', { name: 'NC' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /save inspection/i }));

    expect(await screen.findByText(/at least one evidence image is required/i)).toBeInTheDocument();
    expect(mocks.completeInspection).not.toHaveBeenCalled();
  });

  it('does not finish until every required checklist answer is selected', async () => {
    render(<InspectionEditor inspectionId="product-1" />);

    await waitFor(() => expect(screen.getByDisplayValue('ACU-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: /continue to checklist/i }));
    fireEvent.click(screen.getByRole('button', { name: /save inspection/i }));

    expect(await screen.findByText(/complete the required checklist answers/i)).toBeInTheDocument();
    expect(mocks.completeInspection).not.toHaveBeenCalled();
  });

  it('finishes a compliant inspection locally and redirects to activity', async () => {
    render(<InspectionEditor inspectionId="product-1" />);

    await waitFor(() => expect(screen.getByDisplayValue('ACU-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: /continue to checklist/i }));
    selectCompleteChecklist();
    fireEvent.click(screen.getByRole('button', { name: /save inspection/i }));

    await waitFor(() => expect(mocks.completeInspection).toHaveBeenCalledWith(
      'product-1',
      expect.objectContaining({ evidenceCount: 0, companyName: 'ClearView Industries', retailPrice: '12500' }),
    ));
    expect(mocks.router.push).toHaveBeenCalledWith('/activity');
  });

  it('uses a generated inspection identity for a new catalog inspection', async () => {
    const generatedId = 'inspection-generated';
    vi.stubGlobal('crypto', { randomUUID: () => generatedId });

    render(<InspectionEditor inspectionId="new" catalogId="product-1" />);

    await waitFor(() => expect(mocks.getInspectionDraft).toHaveBeenCalledWith(generatedId));
    expect(mocks.getCatalogById).toHaveBeenCalledWith('product-1');
  });

  it('warns before saving a duplicate inspection but allows an explicit override', async () => {
    mocks.findDuplicateCompletedInspection.mockResolvedValue({ id: 'previous-inspection', controlNumber: 'ACU-0001', username: 'inspector-1' });
    render(<InspectionEditor inspectionId="product-1" />);

    await waitFor(() => expect(screen.getByDisplayValue('ACU-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: /continue to checklist/i }));
    selectCompleteChecklist();
    fireEvent.click(screen.getByRole('button', { name: /save inspection/i }));

    expect(await screen.findByRole('dialog', { name: /already inspected/i })).toBeInTheDocument();
    expect(mocks.completeInspection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog', { name: /already inspected/i }).querySelector('button:last-child')!);
    await waitFor(() => expect(mocks.completeInspection).toHaveBeenCalled());
  });

  it('reopens a completed product for editing and records the current username', async () => {
    mocks.getInspectionDraft.mockResolvedValue(undefined);
    mocks.getInspection.mockResolvedValue({
      id: 'product-1',
      storeName: 'Sample Store',
      controlNumber: 'ACU-0001',
      remarks: 'Previous note',
      placement: 'passing',
      visualQuality: 'passing',
      productDetails: 'passing',
      labeling: 'with_label',
      currentStep: 'checklist',
      status: 'completed',
      username: 'previous-inspector',
    });
    render(<InspectionEditor inspectionId="product-1" />);

    await waitFor(() => expect(screen.getByDisplayValue('Previous note')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /compliance checklist/i })).toBeInTheDocument();
    expect(screen.getByText('previous-inspector')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save inspection/i }));

    await waitFor(() => expect(mocks.completeInspection).toHaveBeenCalledWith(
      'product-1',
      expect.objectContaining({ username: 'inspector-1' }),
    ));
  });

  it('opens a completed product in read-only view mode without saving changes', async () => {
    mocks.getInspectionDraft.mockResolvedValue(undefined);
    mocks.getInspection.mockResolvedValue({
      id: 'product-1',
      storeName: 'Sample Store',
      controlNumber: 'ACU-0001',
      remarks: 'Previous note',
      placement: 'passing',
      visualQuality: 'passing',
      productDetails: 'passing',
      labeling: 'with_label',
      currentStep: 'checklist',
      status: 'completed',
      username: 'previous-inspector',
    });

    render(<InspectionEditor inspectionId="product-1" readOnly />);

    await waitFor(() => expect(screen.getByDisplayValue('Sample Store')).toBeInTheDocument());
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sample Store')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save inspection/i })).not.toBeInTheDocument();
    expect(mocks.saveInspectionDraft).not.toHaveBeenCalled();
    expect(mocks.completeInspection).not.toHaveBeenCalled();
  });

  it('opens evidence images in a zoomable viewer with a download action', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:evidence-1') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    mocks.listEvidenceImages.mockResolvedValue([{
      id: 'evidence-1',
      inspectionId: 'product-1',
      displayOrder: 0,
      capturedAt: '2026-10-05T00:00:00.000Z',
      fileName: 'label.png',
      mimeType: 'image/png',
      size: 10,
      blob: new Blob(['image'], { type: 'image/png' }),
    }]);

    render(<InspectionEditor inspectionId="product-1" />);

    await waitFor(() => expect(screen.getByDisplayValue('ACU-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: /continue to checklist/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /view evidence image 1/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /view evidence image 1/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('img', { name: /evidence image 1/i })).toHaveAttribute('src', 'blob:evidence-1');
    expect(within(dialog).getByRole('link', { name: /download/i })).toHaveAttribute('download', 'label.png');
    fireEvent.click(within(dialog).getByRole('button', { name: /zoom in/i }));
    expect(within(dialog).getByText('125%')).toBeInTheDocument();
  });

  it('explains why the product step cannot continue without a control number', async () => {
    mocks.getCatalogById.mockResolvedValue(undefined);
    render(<InspectionEditor inspectionId="product-1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText(/product control number is required/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inspection' })).toBeInTheDocument();
  });
});
