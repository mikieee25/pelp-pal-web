import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceAuthGate, sanitizeNextPath } from '@/features/auth/workspace-auth-gate';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

const replace = vi.fn();
const router = { replace };
const clearLocalSession = vi.fn();
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
}));

describe('WorkspaceAuthGate', () => {
  beforeEach(() => {
    replace.mockReset();
    clearLocalSession.mockReset();
    session = null;
    authStateCallback = undefined;
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
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
        getSession: () => new Promise((resolve) => { resolveSession = resolve; }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
    } as never);

    render(<WorkspaceAuthGate><div>Workspace content</div></WorkspaceAuthGate>);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Workspace content')).not.toBeInTheDocument();
    resolveSession({ data: { session: null }, error: null });
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

  it('shows an explicit service-unavailable state when the Supabase client cannot initialize', async () => {
    vi.mocked(getSupabaseBrowserClient).mockImplementationOnce(() => {
      throw new Error('Missing Supabase configuration.');
    });

    render(<WorkspaceAuthGate><div>Workspace content</div></WorkspaceAuthGate>);

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign-in service is unavailable/i);
    expect(screen.queryByText('Workspace content')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
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
