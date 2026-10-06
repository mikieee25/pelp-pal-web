import { describe, expect, it, vi } from 'vitest';
import { changeCurrentAccountPassword, getCurrentAccount } from '@/features/auth/account-password';

function client() {
  return {
    rpc: vi.fn(),
    auth: { updateUser: vi.fn() },
  };
}

describe('account password flow', () => {
  it('reads the signed-in account and maps the forced-change flag', async () => {
    const supabase = client();
    supabase.rpc.mockResolvedValue({
      data: {
        account_id: 'account-1',
        organization_id: 'org-1',
        username: 'maog',
        role: 'admin',
        is_active: true,
        credential_version: 1,
        must_change_password: true,
      },
      error: null,
    });

    await expect(getCurrentAccount(supabase as never)).resolves.toMatchObject({
      id: 'account-1',
      username: 'maog',
      mustChangePassword: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('current_account');
  });

  it('changes Auth password before clearing the forced-change flag', async () => {
    const supabase = client();
    supabase.auth.updateUser.mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null });
    supabase.rpc.mockResolvedValue({ data: 2, error: null });

    await expect(changeCurrentAccountPassword('account-1', 'new-password', supabase as never)).resolves.toBeUndefined();
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'new-password' });
    expect(supabase.rpc).toHaveBeenCalledWith('bump_credential_version', { p_account_id: 'account-1' });
  });

  it('does not clear the forced-change flag when the Auth update fails', async () => {
    const supabase = client();
    supabase.auth.updateUser.mockResolvedValue({ data: { user: null }, error: new Error('weak password') });

    await expect(changeCurrentAccountPassword('account-1', 'weak', supabase as never)).rejects.toThrow(/weak password/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
