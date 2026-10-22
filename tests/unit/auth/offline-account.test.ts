import { beforeEach, describe, expect, it } from 'vitest';
import { clearVerifiedOfflineAccount, readVerifiedOfflineAccount, saveVerifiedOfflineAccount } from '@/lib/auth/offline-account';

describe('verified offline account', () => {
  beforeEach(() => localStorage.clear());

  const account = { id: 'account-a', organization_id: 'org-a', username: 'alice', role: 'inspector', is_active: true, must_change_password: false };

  it('restores only the matching auth identity and rejects a different account', () => {
    saveVerifiedOfflineAccount(account, 'auth-a');
    expect(readVerifiedOfflineAccount('auth-a')).toEqual({ accountId: 'account-a', organizationId: 'org-a', key: 'org-a:account-a', username: 'alice', role: 'inspector' });
    expect(readVerifiedOfflineAccount('auth-b')).toBeUndefined();
  });

  it('rejects inactive and password-change accounts and clears on sign-out', () => {
    expect(() => saveVerifiedOfflineAccount({ ...account, is_active: false }, 'auth-a')).toThrow();
    expect(() => saveVerifiedOfflineAccount({ ...account, must_change_password: true }, 'auth-a')).toThrow();
    saveVerifiedOfflineAccount(account, 'auth-a');
    clearVerifiedOfflineAccount();
    expect(readVerifiedOfflineAccount('auth-a')).toBeUndefined();
  });
});
