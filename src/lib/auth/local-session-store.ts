const storageKey = 'pelp-pal-local-session';

export type LocalSession = { username: string; authUserId?: string };

export function saveLocalSession(username: string, authUserId?: string): void {
  const normalized = username.trim().toLowerCase();
  if (!normalized) throw new Error('Username is required.');
  localStorage.setItem(storageKey, JSON.stringify({ username: normalized, authUserId } satisfies LocalSession));
}

export function getLocalSession(): LocalSession | null {
  const value = localStorage.getItem(storageKey);
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      const session = parsed as Record<string, unknown>;
      if (typeof session.username === 'string') return { username: session.username, authUserId: typeof session.authUserId === 'string' ? session.authUserId : undefined };
    }
  } catch {
    localStorage.removeItem(storageKey);
  }
  return null;
}

export function clearLocalSession(): void {
  localStorage.removeItem(storageKey);
}
