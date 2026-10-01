import { describe, expect, it } from 'vitest';
import { ensureAnonymousSession } from '@/lib/auth/session-bootstrap';

describe('ensureAnonymousSession', () => {
  it('signs in anonymously when no session exists', async () => {
    let signedIn = 0;
    const client = {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        signInAnonymously: async () => { signedIn += 1; return { data: { session: { user: { id: 'user-1' } } }, error: null }; },
      },
    };

    await expect(ensureAnonymousSession(client as never)).resolves.toMatchObject({ user: { id: 'user-1' } });
    expect(signedIn).toBe(1);
  });
});
