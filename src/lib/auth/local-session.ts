import { verifyFlutterArgon2id } from './local-auth';

export type LocalAccountCredentials = {
  username: string;
  passwordHash: string;
  isActive: boolean;
};

export type LocalAuthenticationResult =
  | { ok: true; username: string }
  | { ok: false; reason: 'inactive' | 'invalid' };

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
