import { describe, expect, it } from 'vitest';

type AccountIdentityFixture = {
  id: string;
  organization_id: string;
  username: string;
  auth_alias: string | null;
  auth_user_id: string | null;
  role: 'admin' | 'epred' | 'guest';
  is_active: boolean;
  credential_version: number;
};

const fixtureAccounts: AccountIdentityFixture[] = [
  {
    id: 'account-1',
    organization_id: 'org-1',
    username: 'maog',
    auth_alias: 'account-account-1@auth.pelp-pal.test',
    auth_user_id: 'auth-user-1',
    role: 'admin',
    is_active: true,
    credential_version: 1,
  },
  {
    id: 'account-2',
    organization_id: 'org-1',
    username: 'inspector',
    auth_alias: 'account-account-2@auth.pelp-pal.test',
    auth_user_id: 'auth-user-2',
    role: 'epred',
    is_active: true,
    credential_version: 3,
  },
  {
    id: 'account-3',
    organization_id: 'org-1',
    username: 'guest',
    auth_alias: 'account-account-3@auth.pelp-pal.test',
    auth_user_id: 'auth-user-3',
    role: 'guest',
    is_active: true,
    credential_version: 1,
  },
  {
    id: 'account-4',
    organization_id: 'org-2',
    username: 'other-org-admin',
    auth_alias: 'account-account-4@auth.pelp-pal.test',
    auth_user_id: 'auth-user-4',
    role: 'admin',
    is_active: true,
    credential_version: 1,
  },
  {
    id: 'account-5',
    organization_id: 'org-1',
    username: 'inactive',
    auth_alias: 'account-account-5@auth.pelp-pal.test',
    auth_user_id: 'auth-user-5',
    role: 'guest',
    is_active: false,
    credential_version: 2,
  },
];

const revokedLegacyDevice = {
  id: 'device-revoked-1',
  organization_id: 'org-1',
  assigned_role: 'guest',
  revoked: true,
};

function canUseOnlineIdentity(
  account: AccountIdentityFixture,
  authUserId: string,
  organizationId: string,
  knownCredentialVersion: number,
): boolean {
  return Boolean(
    account.auth_user_id &&
      account.auth_alias &&
      account.auth_user_id === authUserId &&
      account.is_active &&
      account.organization_id === organizationId &&
      account.credential_version === knownCredentialVersion,
  );
}

describe('credentials-first auth contract fixtures', () => {
  it('covers active admin, EPRED, guest, two organizations, and a revoked legacy device', () => {
    expect(fixtureAccounts.map((account) => account.role)).toEqual([
      'admin',
      'epred',
      'guest',
      'admin',
      'guest',
    ]);
    expect(new Set(fixtureAccounts.map((account) => account.organization_id))).toEqual(
      new Set(['org-1', 'org-2']),
    );
    expect(revokedLegacyDevice.revoked).toBe(true);
  });

  it('accepts an active account with a matching Auth identity and credential version', () => {
    expect(canUseOnlineIdentity(fixtureAccounts[1], 'auth-user-2', 'org-1', 3)).toBe(true);
  });

  it('rejects an account without an Auth identity', () => {
    const account = { ...fixtureAccounts[1], auth_user_id: null };
    expect(canUseOnlineIdentity(account, 'auth-user-2', 'org-1', 3)).toBe(false);
  });

  it('rejects an inactive account even when its identity matches', () => {
    expect(canUseOnlineIdentity(fixtureAccounts[4], 'auth-user-5', 'org-1', 2)).toBe(false);
  });

  it('rejects an account from another organization', () => {
    expect(canUseOnlineIdentity(fixtureAccounts[3], 'auth-user-4', 'org-1', 1)).toBe(false);
  });

  it('rejects a stale credential version', () => {
    expect(canUseOnlineIdentity(fixtureAccounts[1], 'auth-user-2', 'org-1', 2)).toBe(false);
  });
});
