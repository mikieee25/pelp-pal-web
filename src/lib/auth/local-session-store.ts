const storageKey = 'pelp-pal-local-session';

export type LocalSession = { username: string };

export function saveLocalSession(username: string): void {
  const normalized = username.trim().toLowerCase();
  if (!normalized) throw new Error('Username is required.');
  localStorage.setItem(storageKey, JSON.stringify({ username: normalized } satisfies LocalSession));
}

export function getLocalSession(): LocalSession | null {
  const value = localStorage.getItem(storageKey);
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && 'username' in parsed && typeof parsed.username === 'string') {
      return { username: parsed.username };
    }
  } catch {
    localStorage.removeItem(storageKey);
  }
  return null;
}

export function clearLocalSession(): void {
  localStorage.removeItem(storageKey);
}
