import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchCatalog: vi.fn(),
  getCatalogEcpTypes: vi.fn(),
  syncMasterlistCatalog: vi.fn(),
  getCurrentStore: vi.fn(),
  getOfficialProductRecord: vi.fn(),
  getOfficialProductTokenMap: vi.fn(),
  saveOfficialProductRecord: vi.fn(),
  saveOfficialProductTokenMap: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => ({ searchCatalog: mocks.searchCatalog, getCatalogEcpTypes: mocks.getCatalogEcpTypes, getCurrentStore: mocks.getCurrentStore, getOfficialProductRecord: mocks.getOfficialProductRecord, getOfficialProductTokenMap: mocks.getOfficialProductTokenMap, saveOfficialProductRecord: mocks.saveOfficialProductRecord, saveOfficialProductTokenMap: mocks.saveOfficialProductTokenMap }),
}));

vi.mock('@/lib/supabase/browser', () => ({ getSupabaseBrowserClient: () => ({ functions: { invoke: mocks.invoke } }) }));

vi.mock('@/features/lookup/qr-scanner-dialog', () => ({
  QrScannerDialog: ({ open, onDetected }: { open: boolean; onDetected: (value: string) => void }) => open ? (
    <div role="dialog" aria-label="Scan energy label">
      <p>Point your camera at the QR code.</p>
      <button onClick={() => onDetected('https://pelp.doe.gov.ph/vapproved.php?AbCdEfGhIjKlMnOpQrStUvWxYz012345')}>Mock DOE scan</button>
    </div>
  ) : null,
}));

vi.mock('@/lib/animation/gsap', () => ({
  fadeUp: () => () => {},
  stateFeedback: () => () => {},
  noticeFeedback: () => () => {},
  setDisclosureState: () => {},
  animateDisclosure: () => () => {},
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

const officialRecord = {
  controlNumber: 'ACU-0049-002154-1025',
  productType: 'Air Conditioners',
  brand: 'Example',
  productName: 'Example Product',
  modelCode: 'MODEL-1',
  manufacturer: 'Example Manufacturing',
  fields: { Company: 'Example Manufacturing' },
  starRating: 4,
  energyLabels: [{ labelNumber: 'ACU-0049-002154-1025', validFrom: '2025-10-24', validUntil: '2026-10-24' }],
  imageUrls: ['https://pelp.doe.gov.ph/primg/example.png'],
  sourceUrl: 'https://pelp.doe.gov.ph/vapproved.php?AbCdEfGhIjKlMnOpQrStUvWxYz012345',
  fetchedAt: '2026-10-14T00:00:00.000Z',
};

describe('LookupView', () => {
  beforeEach(() => {
    mocks.searchCatalog.mockResolvedValue([product]);
    mocks.getCatalogEcpTypes.mockResolvedValue(['Air conditioner']);
    mocks.syncMasterlistCatalog.mockResolvedValue({ status: 'skipped', reason: 'catalog-scope' });
    mocks.getCurrentStore.mockResolvedValue({ id: 'current', storeId: 'STORE-1', name: 'Sample Store', location: 'NCR' });
    mocks.getOfficialProductRecord.mockResolvedValue(undefined);
    mocks.getOfficialProductTokenMap.mockResolvedValue(undefined);
    mocks.saveOfficialProductRecord.mockResolvedValue(undefined);
    mocks.saveOfficialProductTokenMap.mockResolvedValue(undefined);
    mocks.invoke.mockReset();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('presents local catalog results with product identity details', async () => {
    render(<LookupView />);

    expect(screen.getByRole('heading', { name: 'Find a product' })).toBeInTheDocument();
    const search = screen.getByRole('textbox', { name: /search local catalog/i });
    const scan = screen.getByRole('button', { name: /scan qr code/i });
    expect(search).toBeInTheDocument();
    expect(search.closest('form')).toContainElement(scan);
    expect(screen.getByRole('group', { name: 'Product type' })).toHaveClass('overflow-x-auto');
    await waitFor(() => expect(screen.getAllByText('CN-100').length).toBeGreaterThan(0));
    expect(mocks.searchCatalog).toHaveBeenLastCalledWith('', 10, '');
    expect(screen.getByText('ClearView · CV-100')).toBeInTheDocument();
    expect(screen.getAllByText('Air conditioner').length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId('lookup-result-details')).toHaveLength(0);
    fireEvent.click(screen.getByText('Product details'));
    expect(screen.getByText('ClearView Industries')).toBeInTheDocument();
    expect(screen.getByText(/1 product/i)).toBeInTheDocument();
  });

  it('shows the active store while looking up products', async () => {
    render(<LookupView />);

    await waitFor(() => expect(screen.getByText('Store: Sample Store')).toBeInTheDocument());
    expect(screen.getByText(/NCR/i)).toBeInTheDocument();
  });

  it('starts a new inspection without using the catalog row id as the inspection id', async () => {
    render(<LookupView />);

    await waitFor(() => expect(screen.getAllByText('CN-100').length).toBeGreaterThan(0));

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

    await waitFor(() => expect(screen.getAllByText('BW-200').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Air conditioner' }));

    await waitFor(() => expect(mocks.searchCatalog).toHaveBeenLastCalledWith('', 10, 'Air conditioner'));
    expect(screen.getAllByText('CN-100').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('BW-200')).toHaveLength(0);
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

    const controlNumber = (await screen.findAllByText(longControlNumber))[0];
    expect(controlNumber).toHaveClass('break-all');
  });

  it('shows the official record loading and success states, then matches the local catalog', async () => {
    let resolveRequest!: (value: unknown) => void;
    mocks.invoke.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    render(<LookupView />);
    fireEvent.click(screen.getByRole('button', { name: /scan qr code/i }));
    fireEvent.click(screen.getByRole('button', { name: /mock doe scan/i }));
    expect(screen.getByText(/reading the official doe record/i)).toBeInTheDocument();
    resolveRequest({ data: { record: officialRecord, cached: false, fetchedAt: officialRecord.fetchedAt }, error: null });
    await waitFor(() => expect(screen.getByText('Official record')).toBeInTheDocument());
    expect(screen.getByText('Example Product')).toBeInTheDocument();
    expect(screen.getByText('4/5 stars')).toBeInTheDocument();
    expect(mocks.searchCatalog).toHaveBeenLastCalledWith(officialRecord.controlNumber, 10, '');
  });

  it('resolves a pasted complete DOE URL through the official lookup flow', async () => {
    mocks.invoke.mockResolvedValue({ data: { record: officialRecord, cached: false, fetchedAt: officialRecord.fetchedAt }, error: null });
    render(<LookupView />);
    fireEvent.change(screen.getByRole('textbox', { name: /search local catalog/i }), { target: { value: officialRecord.sourceUrl } });

    await waitFor(() => expect(screen.getByText('Official record')).toBeInTheDocument());
    expect(mocks.invoke).toHaveBeenCalledWith('doe-product-lookup', { body: { url: officialRecord.sourceUrl, refresh: false } });
    expect(mocks.searchCatalog).toHaveBeenLastCalledWith(officialRecord.controlNumber, 10, '');
  });

  it('uses the token map and cached record for a repeated offline scan', async () => {
    mocks.getOfficialProductTokenMap.mockResolvedValue({ tokenHash: 'hash', controlNumber: officialRecord.controlNumber, lastSeenAt: officialRecord.fetchedAt });
    mocks.getOfficialProductRecord.mockResolvedValue({ controlNumber: officialRecord.controlNumber, record: { ...officialRecord, imageUrls: [] }, fetchedAt: officialRecord.fetchedAt });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(<LookupView />);
    fireEvent.click(screen.getByRole('button', { name: /scan qr code/i }));
    fireEvent.click(screen.getByRole('button', { name: /mock doe scan/i }));
    await waitFor(() => expect(screen.getByText(/saved/i)).toBeInTheDocument());
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.searchCatalog).toHaveBeenLastCalledWith(officialRecord.controlNumber, 10, '');
  });

  it('keeps a partial official response usable for catalog matching', async () => {
    mocks.invoke.mockResolvedValue({ data: { record: { ...officialRecord, productType: undefined, brand: undefined, partial: true }, cached: false }, error: null });
    render(<LookupView />);
    fireEvent.click(screen.getByRole('button', { name: /scan qr code/i }));
    fireEvent.click(screen.getByRole('button', { name: /mock doe scan/i }));
    await waitFor(() => expect(screen.getByText(/some official details could not be read/i)).toBeInTheDocument());
    expect(mocks.searchCatalog).toHaveBeenLastCalledWith(officialRecord.controlNumber, 10, '');
  });

  it.each([
    ['UPSTREAM_BLOCKED', /DOE site isn't reachable/i],
    ['UPSTREAM_TIMEOUT', /DOE site isn't reachable/i],
    ['PARSE_FAILED', /couldn't read this record/i],
    ['RATE_LIMITED', /try again later/i],
  ])('renders the %s official lookup error', async (code, message) => {
    mocks.invoke.mockResolvedValue({ data: { error: code }, error: null });
    render(<LookupView />);
    fireEvent.click(screen.getByRole('button', { name: /scan qr code/i }));
    fireEvent.click(screen.getByRole('button', { name: /mock doe scan/i }));
    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /open on doe site/i })).toBeInTheDocument();
  });
});
