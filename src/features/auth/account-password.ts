import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { Database } from '@/lib/supabase/database.types';

export type CurrentAccount = {
  id: string;
  organizationId: string;
  username: string;
  displayName: string;
  role: string;
  isActive: boolean;
  credentialVersion: number;
  mustChangePassword: boolean;
};

type RemoteCurrentAccount = {
  account_id: string;
  organization_id: string;
  username: string;
  display_name?: string;
  role: string;
  is_active: boolean;
  credential_version: number;
  must_change_password: boolean;
};

export async function getCurrentAccount(
  client: SupabaseClient<Database> = getSupabaseBrowserClient(),
): Promise<CurrentAccount> {
  const { data, error } = await client.rpc('current_account');
  if (error) throw new Error(`Could not read the signed-in account: ${error.message}`);
  if (!isRemoteCurrentAccount(data)) throw new Error('The signed-in account is unavailable.');
  return mapAccount(data);
}

export async function changeCurrentAccountPassword(
  accountId: string,
  newPassword: string,
  client: SupabaseClient<Database> = getSupabaseBrowserClient(),
): Promise<void> {
  const { data: updatedUser, error: passwordError } = await client.auth.updateUser({ password: newPassword });
  if (passwordError || !updatedUser.user) {
    throw new Error(passwordError?.message ?? 'Unable to change the password.');
  }

  const { error: accountError } = await client.rpc('bump_credential_version', {
    p_account_id: accountId,
  });
  if (accountError) throw new Error(`Password changed, but account status could not be updated: ${accountError.message}`);
}

function isRemoteCurrentAccount(value: unknown): value is RemoteCurrentAccount {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const account = value as Record<string, unknown>;
  return (
    typeof account.account_id === 'string' &&
    typeof account.organization_id === 'string' &&
    typeof account.username === 'string' &&
    (account.display_name === undefined || typeof account.display_name === 'string') &&
    typeof account.role === 'string' &&
    typeof account.is_active === 'boolean' &&
    typeof account.credential_version === 'number' &&
    typeof account.must_change_password === 'boolean'
  );
}

function mapAccount(value: RemoteCurrentAccount): CurrentAccount {
  return {
    id: value.account_id,
    organizationId: value.organization_id,
    username: value.username,
    displayName: value.display_name ?? value.username,
    role: value.role,
    isActive: value.is_active,
    credentialVersion: value.credential_version,
    mustChangePassword: value.must_change_password,
  };
}
