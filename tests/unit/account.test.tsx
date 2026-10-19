import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  clearLocalSession: vi.fn(),
  signOut: vi.fn(),
  publishMasterlist: vi.fn(),
  syncMasterlistCatalog: vi.fn(),
  router: { replace: vi.fn() },
}));

vi.mock('@/features/auth/account-password', () => ({ getCurrentAccount: mocks.getCurrentAccount }));
vi.mock('@/lib/auth/local-session-store', () => ({ clearLocalSession: mocks.clearLocalSession }));
vi.mock('@/lib/supabase/browser', () => ({ getSupabaseBrowserClient: () => ({ auth: { signOut: mocks.signOut } }) }));
vi.mock('@/features/catalog/catalog-publish-client', () => ({ publishMasterlist: mocks.publishMasterlist }));
vi.mock('@/features/catalog/catalog-sync', () => ({ syncMasterlistCatalog: mocks.syncMasterlistCatalog }));
vi.mock('@/lib/animation/gsap', () => ({ fadeUp: () => () => {}, stateFeedback: () => () => {}, noticeFeedback: () => () => {}, setDisclosureState: () => {}, animateDisclosure: () => () => {} }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));

import { AccountView } from '@/features/account/account-view';

const epred = { id: 'account-1', organizationId: 'org-1', username: 'sample', displayName: 'Sample', role: 'epred', isActive: true, credentialVersion: 1, mustChangePassword: false };
const admin = { ...epred, id: 'account-admin', username: 'admin', role: 'admin' };

describe('AccountView', () => {
  beforeEach(() => {
    mocks.getCurrentAccount.mockResolvedValue(epred);
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.publishMasterlist.mockResolvedValue({ catalogRole: 'masterlist', version: 8, rowCount: 2, integrityHash: 'hash', storagePath: 'catalogs/8.json', publishedAt: '2026-10-19T00:00:00Z' });
    mocks.syncMasterlistCatalog.mockResolvedValue({ status: 'updated', version: 8, rowCount: 2, catalogRole: 'masterlist' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the signed-in account and account-based sync access', async () => {
    render(<AccountView />);
    await waitFor(() => expect(screen.getByText('sample')).toBeInTheDocument());
    expect(screen.getByText(/ready to sync on any signed-in browser/i)).toBeInTheDocument();
    expect(screen.getByText(/master catalog/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view sync status/i })).toHaveAttribute('href', '/sync');
    expect(within(screen.getByRole('region', { name: 'Account details' })).queryByText('org-1')).not.toBeInTheDocument();
  });

  it('keeps support information collapsed and copies the full organization id on request', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<AccountView />);
    await waitFor(() => expect(screen.getByText('sample')).toBeInTheDocument());

    const support = screen.getByRole('button', { name: /support info/i });
    expect(support).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(support);
    expect(await screen.findByText('org-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /copy organization id/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('org-1'));
    expect(screen.getByText(/app version/i)).toBeInTheDocument();
  });

  it('clears local state and signs out before returning to login', async () => {
    render(<AccountView />);
    await waitFor(() => expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith('/login'));
    expect(mocks.clearLocalSession).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it('shows catalog management only to an active administrator', async () => {
    mocks.getCurrentAccount.mockResolvedValue(admin);
    render(<AccountView />);
    await waitFor(() => expect(screen.getByRole('heading', { name: /catalog management/i })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /choose masterlist/i })).toBeInTheDocument();
  });

  it('does not show administrator tools to an EPRED account', async () => {
    render(<AccountView />);
    await waitFor(() => expect(screen.getByText('sample')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: /catalog management/i })).not.toBeInTheDocument();
  });

  it('shows validation feedback for an invalid administrator catalog file', async () => {
    mocks.getCurrentAccount.mockResolvedValue(admin);
    render(<AccountView />);
    await waitFor(() => expect(screen.getByRole('button', { name: /choose masterlist/i })).toBeInTheDocument());
    const invalidFile = new File(['not-json'], 'masterlist.json');
    Object.defineProperty(invalidFile, 'arrayBuffer', { value: async () => new TextEncoder().encode('not-json').buffer });
    fireEvent.change(screen.getByLabelText(/choose masterlist/i), { target: { files: [invalidFile] } });
    await waitFor(() => expect(screen.getByText(/not valid json/i)).toBeInTheDocument());
  });

  it('clears duplicate warnings after publishing the masterlist', async () => {
    mocks.getCurrentAccount.mockResolvedValue(admin);
    render(<AccountView />);
    await waitFor(() => expect(screen.getByRole('button', { name: /choose masterlist/i })).toBeInTheDocument());
    const contents = JSON.stringify([
      { id: 'one', control_number: 'LED-1', product_type: 'LED Lamps', brand: 'Brand A', model_number: 'M-1', source_version: 1 },
      { id: 'two', control_number: 'LED-1', product_type: 'LED Lamps', brand: 'Brand B', model_number: 'M-1', source_version: 1 },
    ]);
    const file = new File([contents], 'masterlist.json', { type: 'application/json' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(contents).buffer });
    fireEvent.change(screen.getByLabelText(/choose masterlist/i), { target: { files: [file] } });

    expect(await screen.findByText(/this is a warning; you can still publish the masterlist/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /publish masterlist/i }));
    expect(await screen.findByText(/published with 2 products/i)).toBeInTheDocument();
    expect(screen.queryByText(/this is a warning; you can still publish the masterlist/i)).not.toBeInTheDocument();
  });
});
