import type { AccountScope } from "@/lib/db/records";
import { isAccountExpired } from "@/features/auth/account-policy";

const storageKey = "pelp-pal:verified-offline-account:v1";

type VerifiedAccountInput = {
  id: string;
  organization_id: string;
  username: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  expires_at?: string | null;
};

type StoredAccount = AccountScope & {
  authUserId: string;
  username: string;
  role: string;
  expiresAt?: string | null;
};

export function saveVerifiedOfflineAccount(
  account: VerifiedAccountInput,
  authUserId: string,
): void {
  if (
    !account.is_active ||
    account.must_change_password ||
    !authUserId ||
    !account.id ||
    !account.organization_id ||
    isAccountExpired(account.role, account.expires_at ?? undefined)
  ) {
    throw new Error(
      "Only an active, verified account can be prepared for offline use.",
    );
  }
  const value: StoredAccount = {
    authUserId,
    accountId: account.id,
    organizationId: account.organization_id,
    key: `${account.organization_id}:${account.id}`,
    username: account.username.toLowerCase(),
    role: account.role,
    expiresAt: account.expires_at ?? null,
  };
  localStorage.setItem(storageKey, JSON.stringify(value));
}

export function readVerifiedOfflineAccount(
  authUserId: string,
  username?: string,
): (AccountScope & { role: string; expiresAt?: string | null }) | undefined {
  if (!authUserId) return undefined;
  try {
    const value = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    ) as Partial<StoredAccount> | null;
    if (
      !value ||
      value.authUserId !== authUserId ||
      (username && value.username !== username.toLowerCase()) ||
      !value.accountId ||
      !value.organizationId ||
      !value.role ||
      value.key !== `${value.organizationId}:${value.accountId}` ||
      isAccountExpired(value.role, value.expiresAt ?? undefined)
    )
      return undefined;
    return {
      accountId: value.accountId,
      organizationId: value.organizationId,
      key: value.key,
      username: value.username,
      role: value.role,
      ...(value.expiresAt ? { expiresAt: value.expiresAt } : {}),
    };
  } catch {
    return undefined;
  }
}

export function clearVerifiedOfflineAccount(): void {
  localStorage.removeItem(storageKey);
}
