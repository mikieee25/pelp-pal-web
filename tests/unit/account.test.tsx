import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDevice: vi.fn(),
  getLocalSession: vi.fn(),
  clearLocalSession: vi.fn(),
  signOut: vi.fn(),
  router: { replace: vi.fn() },
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
});
