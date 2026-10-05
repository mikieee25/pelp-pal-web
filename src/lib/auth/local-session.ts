import { verifyFlutterArgon2id } from './local-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

export type LocalAccountCredentials = {
  username: string;
  passwordHash: string;
  isActive: boolean;
};

export type LocalAuthenticationResult =
  | { ok: true; username: string }
  | { ok: false; reason: 'inactive' | 'invalid' };

export type OnlineAccount = {
  id: string;
  organization_id: string;
  username: string;
  display_name: string;
  role: string;
  is_active: boolean;
  credential_version: number;
  must_change_password: boolean;
};

function isOnlineAccount(value: unknown): value is OnlineAccount {
  if (!value || typeof value !== 'object') return false;
  const account = value as Record<string, unknown>;
  return (
    typeof account.id === 'string' &&
    typeof account.organization_id === 'string' &&
    typeof account.username === 'string' &&
    typeof account.display_name === 'string' &&
    typeof account.role === 'string' &&
    typeof account.is_active === 'boolean' &&
    typeof account.credential_version === 'number' &&
    typeof account.must_change_password === 'boolean'
  );
}

export async function signInWithCredentials(username: string, password: string): Promise<OnlineAccount> {
  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername || !password) throw new Error('Invalid credentials.');

  const client = getSupabaseBrowserClient();
  const { data, error } = await client.functions.invoke('account-login', {
    body: { username: normalizedUsername, password },
  });
  if (error || !data || typeof data !== 'object') throw new Error('Invalid credentials.');
  const payload = data as { session?: { access_token?: string; refresh_token?: string }; account?: OnlineAccount };
  if (
    !payload.session?.access_token ||
    !payload.session.refresh_token ||
    !isOnlineAccount(payload.account) ||
    !payload.account.is_active ||
    payload.account.username.trim().toLowerCase() !== normalizedUsername
  ) {
    throw new Error('Invalid credentials.');
  }
  const { data: sessionData, error: sessionError } = await client.auth.setSession({
    access_token: payload.session.access_token,
    refresh_token: payload.session.refresh_token,
  });
  if (sessionError || !sessionData.session?.user?.id) throw new Error('Unable to establish a session.');
  return payload.account;
}

export async function resetAccountPassword(targetUsername: string, temporaryPassword: string): Promise<void> {
  const client = getSupabaseBrowserClient();
  const { error } = await client.functions.invoke('admin-reset-password', {
    body: { target_username: targetUsername.trim().toLowerCase(), temporary_password: temporaryPassword },
  });
  if (error) throw new Error('Password reset failed.');
}

export async function authenticateLocalAccount(
  account: LocalAccountCredentials,
  username: string,
  password: string,
): Promise<LocalAuthenticationResult> {
  const normalizedUsername = username.trim().toLowerCase();
  if (!account.isActive) return { ok: false, reason: 'inactive' };
  if (account.username.trim().toLowerCase() !== normalizedUsername) return { ok: false, reason: 'invalid' };
  return (await verifyFlutterArgon2id(password, account.passwordHash))
    ? { ok: true, username: normalizedUsername }
    : { ok: false, reason: 'invalid' };
}
