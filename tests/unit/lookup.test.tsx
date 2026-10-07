import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchCatalog: vi.fn(),
  getCatalogEcpTypes: vi.fn(),
  syncMasterlistCatalog: vi.fn(),
  getCurrentStore: vi.fn(),
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => ({ searchCatalog: mocks.searchCatalog, getCatalogEcpTypes: mocks.getCatalogEcpTypes, getCurrentStore: mocks.getCurrentStore }),
}));

vi.mock('@/lib/animation/gsap', () => ({
  fadeUp: () => () => {},
}));

vi.mock('@/features/catalog/catalog-sync', () => ({
  syncMasterlistCatalog: mocks.syncMasterlistCatalog,
}));

import { LookupView } from '@/app/(workspace)/lookup/lookup-view';

const product = {
  id: 'product-1',
  catalogScope: 'masterlist' as const,
  control_number: 'CN-100',
  product_type: 'Air conditioner',
  brand: 'ClearView',
  model_number: 'CV-100',
  dynamic_fields: JSON.stringify({ 'Company Name': 'ClearView Industries' }),
};

const fanProduct = {
  id: 'product-2',
  catalogScope: 'masterlist' as const,
  ecp_type: 'Electric fan',
  brand: 'BreezeWorks',
  model_number: 'BW-200',
};

describe('LookupView', () => {
  beforeEach(() => {
    mocks.searchCatalog.mockResolvedValue([product]);
    mocks.getCatalogEcpTypes.mockResolvedValue(['Air conditioner']);
    mocks.syncMasterlistCatalog.mockResolvedValue({ status: 'skipped', reason: 'not-enrolled' });
    mocks.getCurrentStore.mockResolvedValue({ id: 'current', storeId: 'STORE-1', name: 'Sample Store', location: 'NCR' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('presents local catalog results with product identity details', async () => {
    render(<LookupView />);

    expect(screen.getByText(/catalog lookup/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /search local catalog/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scan qr code/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('ClearView CV-100')).toBeInTheDocument());
    expect(mocks.searchCatalog).toHaveBeenLastCalledWith('', 10, '');
    expect(screen.getAllByText('CN-100').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Air conditioner').length).toBeGreaterThan(0);
    expect(screen.getByText('Air conditioner · Control number: CN-100')).toBeInTheDocument();
    expect(screen.queryAllByTestId('lookup-result-details')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /full product information/i }));
    expect(screen.getByText('ClearView Industries')).toBeInTheDocument();
    expect(screen.getByText(/1 product/i)).toBeInTheDocument();
  });

  it('shows the active store while looking up products', async () => {
    render(<LookupView />);

    await waitFor(() => expect(screen.getByText(/inspecting at sample store/i)).toBeInTheDocument());
    expect(screen.getByText(/NCR/i)).toBeInTheDocument();
  });

  it('starts a new inspection without using the catalog row id as the inspection id', async () => {
    render(<LookupView />);

    await waitFor(() => expect(screen.getByText('ClearView CV-100')).toBeInTheDocument());

    expect(screen.getByRole('link', { name: /inspect/i })).toHaveAttribute(
      'href',
      '/inspect/new?catalogId=product-1',
    );
  });

  it('opens the QR scanner from the lookup controls', async () => {
    render(<LookupView />);

    fireEvent.click(screen.getByRole('button', { name: /scan qr code/i }));

    expect(screen.getByRole('dialog', { name: /scan energy label/i })).toBeInTheDocument();
    expect(screen.getByText(/point your camera at the qr code/i)).toBeInTheDocument();
  });

  it('explains when the local catalog has no matching products', async () => {
    mocks.searchCatalog.mockResolvedValue([]);

    render(<LookupView />);

    await waitFor(() => expect(screen.getByText(/no catalog products are stored on this browser/i)).toBeInTheDocument());
  });

  it('filters the initially loaded catalog by product type', async () => {
    mocks.searchCatalog.mockResolvedValue([product, fanProduct]);

    render(<LookupView />);

    await waitFor(() => expect(screen.getByText('BreezeWorks BW-200')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /product type/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Air conditioner' }));

    await waitFor(() => expect(mocks.searchCatalog).toHaveBeenLastCalledWith('', 10, 'Air conditioner'));
    expect(screen.getByText('ClearView CV-100')).toBeInTheDocument();
    expect(screen.queryByText('BreezeWorks BW-200')).not.toBeInTheDocument();
    expect(screen.getByText(/1 product found/i)).toBeInTheDocument();
  });

  it('refreshes results as the local search changes', async () => {
    render(<LookupView />);

    const search = screen.getByRole('textbox', { name: /search local catalog/i });
    fireEvent.change(search, { target: { value: 'CV-100' } });

    await waitFor(() => expect(mocks.searchCatalog).toHaveBeenLastCalledWith('CV-100', 10, ''));
  });

  it('keeps long control numbers breakable inside mobile result cards', async () => {
    const longControlNumber = 'EFU-0343-2026-000027-rev.0-with-an-extra-long-suffix';
    mocks.searchCatalog.mockResolvedValue([{ ...product, control_number: longControlNumber }]);

    render(<LookupView />);

    const metadata = await screen.findByText(`Air conditioner · Control number: ${longControlNumber}`);
    expect(metadata).toHaveStyle({ overflowWrap: 'anywhere' });
  });
});
