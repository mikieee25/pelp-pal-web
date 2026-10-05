import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateLocalAccount, signInWithCredentials } from '@/lib/auth/local-session';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

vi.mock('@/lib/supabase/browser', () => ({
  getSupabaseBrowserClient: vi.fn(),
}));

const passwordHash = '$argon2id$v=19$m=19456,t=2,p=1$AAECAwQFBgcICQoLDA0ODw$-F2NoNJvnM2HQ9iXx5w_BIuiK0QtmgyVJypaTF3Gty4';

const validAccount = {
  id: 'account-1',
  organization_id: 'org-1',
  username: 'epred-1',
  display_name: 'EPRED 1',
  role: 'inspector',
  is_active: true,
  credential_version: 1,
  must_change_password: false,
};

describe('local account authentication', () => {
  beforeEach(() => {
    vi.mocked(getSupabaseBrowserClient).mockReset();
  });

  it('authenticates an active account with the Flutter-compatible hash', async () => {
    await expect(authenticateLocalAccount({ username: 'EPRED-1', passwordHash, isActive: true }, 'epred-1', 'demo-password')).resolves.toEqual({
      ok: true,
      username: 'epred-1',
    });
  });

  it('locks inactive accounts before checking the password', async () => {
    await expect(authenticateLocalAccount({ username: 'epred-1', passwordHash, isActive: false }, 'epred-1', 'demo-password')).resolves.toEqual({
      ok: false,
      reason: 'inactive',
    });
  });

  it('rejects a login response for a different username', async () => {
    const setSession = vi.fn().mockResolvedValue({ data: { session: { user: { id: 'auth-1' } } }, error: null });
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: {
            session: { access_token: 'access-token', refresh_token: 'refresh-token' },
            account: { ...validAccount, username: 'someone-else' },
          },
          error: null,
        }),
      },
      auth: { setSession },
    } as never);

    await expect(signInWithCredentials('epred-1', 'wrong-password')).rejects.toThrow('Invalid credentials.');
    expect(setSession).not.toHaveBeenCalled();
  });

  it('requires Supabase to return an established user session', async () => {
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'access-token', refresh_token: 'refresh-token' }, account: validAccount },
          error: null,
        }),
      },
      auth: { setSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    } as never);

    await expect(signInWithCredentials('epred-1', 'correct-password')).rejects.toThrow('Unable to establish a session.');
  });
});
