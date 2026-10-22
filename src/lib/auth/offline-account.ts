import type { AccountScope } from '@/lib/db/records';

const storageKey = 'pelp-pal:verified-offline-account:v1';

type VerifiedAccountInput = {
  id: string;
  organization_id: string;
  username: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
};

type StoredAccount = AccountScope & { authUserId: string; username: string; role: string };

export function saveVerifiedOfflineAccount(account: VerifiedAccountInput, authUserId: string): void {
  if (!account.is_active || account.must_change_password || !authUserId || !account.id || !account.organization_id) {
    throw new Error('Only an active, verified account can be prepared for offline use.');
  }
  const value: StoredAccount = {
    authUserId,
    accountId: account.id,
    organizationId: account.organization_id,
    key: `${account.organization_id}:${account.id}`,
    username: account.username.toLowerCase(),
    role: account.role,
  };
  localStorage.setItem(storageKey, JSON.stringify(value));
}

export function readVerifiedOfflineAccount(authUserId: string, username?: string): (AccountScope & { role: string }) | undefined {
  if (!authUserId) return undefined;
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<StoredAccount> | null;
    if (!value || value.authUserId !== authUserId || (username && value.username !== username.toLowerCase()) || !value.accountId || !value.organizationId || !value.role ||
      value.key !== `${value.organizationId}:${value.accountId}`) return undefined;
    return { accountId: value.accountId, organizationId: value.organizationId, key: value.key, role: value.role };
  } catch {
    return undefined;
  }
}

export function clearVerifiedOfflineAccount(): void {
  localStorage.removeItem(storageKey);
}
