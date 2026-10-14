import type { OfficialProductRecord } from '@/lib/db/records';

export type { OfficialProductRecord };

export type LabelValidityStatus = {
  kind: 'valid' | 'expiring' | 'expired' | 'unavailable';
  label: string;
  daysRemaining?: number;
};

export async function hashDoeToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashDoeUrlToken(value: string): Promise<string | undefined> {
  try {
    const url = new URL(value);
    const token = url.search.slice(1);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'pelp.doe.gov.ph' || url.pathname !== '/vapproved.php') return undefined;
    if (url.hash || url.username || url.password || url.port || !token || token.includes('&') || !/^[A-Za-z0-9+\/%=_-]{20,200}$/.test(token)) return undefined;
    return hashDoeToken(token);
  } catch {
    return undefined;
  }
}

function manilaDate(value: Date | string = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function getLabelValidityStatus(validFrom?: string, validUntil?: string, now: Date | string = new Date()): LabelValidityStatus {
  if (!validFrom || !validUntil) return { kind: 'unavailable', label: 'Validity unavailable' };
  const today = manilaDate(now);
  if (today > validUntil) return { kind: 'expired', label: 'Expired', daysRemaining: dateDifference(today, validUntil) };
  if (today < validFrom) return { kind: 'valid', label: 'Valid', daysRemaining: dateDifference(today, validUntil) };
  const daysRemaining = dateDifference(today, validUntil);
  return daysRemaining > 0 && daysRemaining <= 30
    ? { kind: 'expiring', label: `Expires in ${daysRemaining} days`, daysRemaining }
    : { kind: 'valid', label: 'Valid', daysRemaining };
}

function dateDifference(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
