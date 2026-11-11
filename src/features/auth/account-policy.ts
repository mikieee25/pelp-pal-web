export const GUEST_ACCOUNT_LIFETIME_DAYS = 7;

export function catalogRoleForAccount(
  _role: string | undefined,
): "masterlist" | "guestlist" {
  return "masterlist";
}

export function guestExpiresAt(createdAt: Date | string): string {
  const value = new Date(createdAt);
  if (Number.isNaN(value.getTime()))
    throw new Error("Invalid account creation date.");
  value.setUTCDate(value.getUTCDate() + GUEST_ACCOUNT_LIFETIME_DAYS);
  return value.toISOString();
}

export function isAccountExpired(
  role: string | undefined,
  expiresAt: string | undefined,
  now: Date | string = new Date(),
): boolean {
  if (role !== "guest") return false;
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt);
  const current = new Date(now);
  if (Number.isNaN(expiry.getTime()) || Number.isNaN(current.getTime()))
    return true;
  return expiry.getTime() <= current.getTime();
}
