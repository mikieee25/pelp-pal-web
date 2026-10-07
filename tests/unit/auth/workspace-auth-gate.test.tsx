import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceAuthGate, sanitizeNextPath } from '@/features/auth/workspace-auth-gate';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

const replace = vi.fn();
const router = { replace };
const clearLocalSession = vi.fn();
const getLocalSession = vi.fn();
const getCurrentAccount = vi.fn();
let session: unknown = null;
let authStateCallback: ((event: string, nextSession: unknown) => void) | undefined;

vi.mock('next/navigation', () => ({
  usePathname: () => '/lookup',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams('q=air'),
}));

vi.mock('@/lib/supabase/browser', () => ({
  getSupabaseBrowserClient: vi.fn(),
}));

vi.mock('@/lib/auth/local-session-store', () => ({
  clearLocalSession: (...args: unknown[]) => clearLocalSession(...args),
  getLocalSession: (...args: unknown[]) => getLocalSession(...args),
}));

vi.mock('@/features/auth/account-password', () => ({
  getCurrentAccount: (...args: unknown[]) => getCurrentAccount(...args),
}));

describe('WorkspaceAuthGate', () => {
  beforeEach(() => {
    replace.mockReset();
    clearLocalSession.mockReset();
    getLocalSession.mockReset();
    getLocalSession.mockReturnValue(null);
    getCurrentAccount.mockReset();
    getCurrentAccount.mockResolvedValue({ mustChangePassword: false });
    session = null;
    authStateCallback = undefined;
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      auth: {
        getUser: async () => ({ data: { user: session ? { id: 'user-1' } : null }, error: null }),
        onAuthStateChange: (callback: (event: string, nextSession: unknown) => void) => {
          authStateCallback = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
      },
    } as never);
  });

  afterEach(cleanup);

  it('does not render workspace content while the session is pending', async () => {
    let resolveSession!: (value: unknown) => void;
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      auth: {
        getUser: () => new Promise((resolve) => { resolveSession = resolve; }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
    } as never);

    render(<WorkspaceAuthGate><div>Workspace content</div></WorkspaceAuthGate>);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Workspace content')).not.toBeInTheDocument();
    resolveSession({ data: { user: null }, error: null });
  });

  it('redirects signed-out users without rendering workspace content', async () => {
    render(<WorkspaceAuthGate><div>Workspace content</div></WorkspaceAuthGate>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Flookup%3Fq%3Dair'));
    expect(clearLocalSession).toHaveBeenCalledOnce();
    expect(screen.queryByText('Workspace content')).not.toBeInTheDocument();
  });

  it('renders workspace content for a valid session', async () => {
    session = { user: { id: 'user-1' } };

    render(<WorkspaceAuthGate><div>Workspace content</div></WorkspaceAuthGate>);

    expect(await screen.findByText('Workspace content')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects accounts with an assigned password to the password-change screen', async () => {
    session = { user: { id: 'user-1' } };
    getCurrentAccount.mockResolvedValue({ mustChangePassword: true });

    render(<WorkspaceAuthGate><div>Workspace content</div></WorkspaceAuthGate>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/change-password?next=%2Flookup%3Fq%3Dair'));
    expect(screen.queryByText('Workspace content')).not.toBeInTheDocument();
  });

  it('redirects when a valid session later signs out', async () => {
    session = { user: { id: 'user-1' } };

    render(<WorkspaceAuthGate><div>Workspace content</div></WorkspaceAuthGate>);
    await screen.findByText('Workspace content');

    authStateCallback?.('SIGNED_OUT', null);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Flookup%3Fq%3Dair'));
    expect(clearLocalSession).toHaveBeenCalledOnce();
  });

  it('does not redirect for a transient auth event without a session payload', async () => {
    session = { user: { id: 'user-1' } };

    render(<WorkspaceAuthGate><div>Workspace content</div></WorkspaceAuthGate>);
    await screen.findByText('Workspace content');

    authStateCallback?.('TOKEN_REFRESHED', null);

    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps a previously signed-in local workspace available when auth is temporarily offline', async () => {
    getLocalSession.mockReturnValue({ username: 'user-1' });
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockRejectedValue(new Error('Failed to fetch')),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
    } as never);

    render(<WorkspaceAuthGate><div>Workspace content</div></WorkspaceAuthGate>);

    expect(await screen.findByText('Workspace content')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(clearLocalSession).not.toHaveBeenCalled();
  });

  it('redirects to login when the Supabase client cannot initialize', async () => {
    vi.mocked(getSupabaseBrowserClient).mockImplementationOnce(() => {
      throw new Error('Missing Supabase configuration.');
    });

    render(<WorkspaceAuthGate><div>Workspace content</div></WorkspaceAuthGate>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Flookup%3Fq%3Dair'));
    expect(screen.queryByText('Workspace content')).not.toBeInTheDocument();
    expect(clearLocalSession).toHaveBeenCalledOnce();
  });

  it('redirects to login when the account check fails', async () => {
    session = { user: { id: 'user-1' } };
    getCurrentAccount.mockRejectedValue(new Error('Account service unavailable.'));

    render(<WorkspaceAuthGate><div>Workspace content</div></WorkspaceAuthGate>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Flookup%3Fq%3Dair'));
    expect(screen.queryByText('Workspace content')).not.toBeInTheDocument();
    expect(clearLocalSession).toHaveBeenCalledOnce();
  });

  it.each([
    ['https://example.com', '/dashboard'],
    ['//example.com', '/dashboard'],
    ['javascript:alert(1)', '/dashboard'],
    ['/lookup?q=air', '/lookup?q=air'],
  ])('sanitizes next value %s to %s', (value, expected) => {
    expect(sanitizeNextPath(value)).toBe(expected);
  });
});
