import { describe, expect, it, vi } from 'vitest';
import { ensureAnonymousSession } from '@/lib/auth/session-bootstrap';

describe('ensureAnonymousSession', () => {
  it('signs in anonymously when no session exists', async () => {
    let signedIn = 0;
    const client = {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
      signInAnonymously: async () => { signedIn += 1; return { data: { session: { user: { id: 'user-1', is_anonymous: true } } }, error: null }; },
      },
    };

    await expect(ensureAnonymousSession(client as never)).resolves.toMatchObject({ user: { id: 'user-1' } });
    expect(signedIn).toBe(1);
  });

  it('does not reuse a signed-in account session for device synchronization', async () => {
    let signedIn = 0;
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'account-1', is_anonymous: false } } }, error: null }),
        signOut,
        signInAnonymously: async () => { signedIn += 1; return { data: { session: { user: { id: 'device-1', is_anonymous: true } } }, error: null }; },
      },
    };

    await expect(ensureAnonymousSession(client as never)).resolves.toMatchObject({ user: { id: 'device-1' } });
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(signedIn).toBe(1);
  });

  it('refreshes an expired anonymous session so the enrolled device identity is preserved', async () => {
    const refreshedSession = {
      user: { id: 'device-1', is_anonymous: true },
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
    const client = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: 'device-1', is_anonymous: true }, expires_at: 1 } },
          error: null,
        }),
        refreshSession: vi.fn().mockResolvedValue({ data: { session: refreshedSession }, error: null }),
        signInAnonymously: vi.fn(),
      },
    };

    await expect(ensureAnonymousSession(client as never)).resolves.toEqual(refreshedSession);
    expect(client.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(client.auth.signInAnonymously).not.toHaveBeenCalled();
  });
});
