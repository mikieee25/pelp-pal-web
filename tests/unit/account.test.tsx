import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDevice: vi.fn(),
  getLocalSession: vi.fn(),
  clearLocalSession: vi.fn(),
  signOut: vi.fn(),
  router: { replace: vi.fn() },
  syncMasterlistCatalog: vi.fn(),
  publishMasterlist: vi.fn(),
  issueEnrollmentCode: vi.fn(),
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => ({ getDevice: mocks.getDevice }),
}));

vi.mock('@/lib/auth/local-session-store', () => ({
  getLocalSession: mocks.getLocalSession,
  clearLocalSession: mocks.clearLocalSession,
}));

vi.mock('@/lib/supabase/browser', () => ({
  getSupabaseBrowserClient: () => ({ auth: { signOut: mocks.signOut } }),
}));

vi.mock('@/features/catalog/catalog-sync', () => ({
  syncMasterlistCatalog: mocks.syncMasterlistCatalog,
}));

vi.mock('@/features/catalog/catalog-publish-client', () => ({
  publishMasterlist: mocks.publishMasterlist,
}));

vi.mock('@/features/enrollment/enrollment-code-client', () => ({
  createEnrollmentCodeClient: () => ({ issue: mocks.issueEnrollmentCode }),
}));

vi.mock('@/lib/animation/gsap', () => ({
  fadeUp: () => () => {},
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
}));

import { AccountView } from '@/features/account/account-view';

describe('AccountView', () => {
  beforeEach(() => {
    mocks.getDevice.mockResolvedValue({
      id: 'current',
      installationId: 'installation-1',
      organizationId: 'org-1',
      assignedUsername: 'sample',
      assignedRole: 'epred',
      catalogScope: 'masterlist',
      enrolled: true,
      updatedAt: '2026-10-05T01:00:00.000Z',
    });
    mocks.getLocalSession.mockReturnValue({ username: 'sample' });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.issueEnrollmentCode.mockResolvedValue({
      code: '123456',
      assignedUsername: 'epred.two',
      expiresAt: '2026-10-13T00:00:00.000Z',
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the signed-in account and browser access details', async () => {
    render(<AccountView />);

    await waitFor(() => expect(screen.getByText('sample')).toBeInTheDocument());
    expect(screen.getByText(/browser is enrolled and ready to sync/i)).toBeInTheDocument();
    expect(screen.getByText(/master catalog/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view sync status/i })).toHaveAttribute('href', '/sync');
  });

  it('clears local state and signs out before returning to login', async () => {
    render(<AccountView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith('/login'));
    expect(mocks.clearLocalSession).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it('points an unenrolled browser to enrollment', async () => {
    mocks.getDevice.mockResolvedValue({ enrolled: false });

    render(<AccountView />);

    await waitFor(() => expect(screen.getByText(/this browser is not enrolled/i)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /enroll this browser/i })).toHaveAttribute('href', '/enroll');
  });

  it('shows catalog management to an enrolled administrator', async () => {
    mocks.getDevice.mockResolvedValue({
      id: 'current', enrolled: true, assignedRole: 'admin', catalogScope: 'masterlist', organizationId: 'org-1',
    });
    render(<AccountView />);
    await waitFor(() => expect(screen.getByRole('heading', { name: /catalog management/i })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /choose masterlist/i })).toBeInTheDocument();
  });

  it('does not show catalog management to an EPRED inspector', async () => {
    render(<AccountView />);
    await waitFor(() => expect(screen.getByText('sample')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: /catalog management/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /choose masterlist/i })).not.toBeInTheDocument();
  });

  it('shows enrollment-code controls to an enrolled administrator', async () => {
    mocks.getDevice.mockResolvedValue({
      id: 'current', enrolled: true, assignedRole: 'admin', assignedUsername: 'admin.one', catalogScope: 'masterlist', organizationId: 'org-1',
    });
    render(<AccountView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: /enrollment code/i })).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: /target personnel username/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate code/i })).toBeInTheDocument();
    expect(screen.queryByText('123456')).not.toBeInTheDocument();
  });

  it('displays a generated code and expiration', async () => {
    mocks.getDevice.mockResolvedValue({
      id: 'current', enrolled: true, assignedRole: 'admin', assignedUsername: 'admin.one', catalogScope: 'masterlist', organizationId: 'org-1',
    });
    render(<AccountView />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: /target personnel username/i })).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: /target personnel username/i }), { target: { value: 'epred.two' } });
    fireEvent.click(screen.getByRole('button', { name: /generate code/i }));

    await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());
    expect(screen.getByText(/expires/i)).toBeInTheDocument();
    expect(mocks.issueEnrollmentCode).toHaveBeenCalledWith('epred.two');
  });

  it('keeps the code visible and provides manual-copy guidance when clipboard access fails', async () => {
    mocks.getDevice.mockResolvedValue({
      id: 'current', enrolled: true, assignedRole: 'admin', assignedUsername: 'admin.one', catalogScope: 'masterlist', organizationId: 'org-1',
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<AccountView />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: /target personnel username/i })).toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox', { name: /target personnel username/i }), { target: { value: 'epred.two' } });
    fireEvent.click(screen.getByRole('button', { name: /generate code/i }));
    await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /copy code/i }));

    await waitFor(() => expect(screen.getByText(/copy the code manually/i)).toBeInTheDocument());
    expect(screen.getByText('123456')).toBeInTheDocument();
  });

  it('does not show enrollment-code controls to an EPRED inspector', async () => {
    render(<AccountView />);
    await waitFor(() => expect(screen.getByText('sample')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: /enrollment code/i })).not.toBeInTheDocument();
  });

  it('shows validation feedback for an invalid admin file', async () => {
    mocks.getDevice.mockResolvedValue({ enrolled: true, assignedRole: 'admin', catalogScope: 'masterlist' });
    render(<AccountView />);
    await waitFor(() => expect(screen.getByRole('button', { name: /choose masterlist/i })).toBeInTheDocument());
    const invalidFile = new File(['not-json'], 'masterlist.json');
    Object.defineProperty(invalidFile, 'arrayBuffer', { value: async () => new TextEncoder().encode('not-json').buffer });
    fireEvent.change(screen.getByLabelText(/choose masterlist/i), { target: { files: [invalidFile] } });
    await waitFor(() => expect(screen.getByText(/not valid json/i)).toBeInTheDocument());
  });
});
