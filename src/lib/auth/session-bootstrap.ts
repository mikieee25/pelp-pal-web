import type { Session, SupabaseClient } from '@supabase/supabase-js';

export async function ensureAnonymousSession(client: SupabaseClient): Promise<Session> {
  const current = await client.auth.getSession();
  if (current.error) throw new Error(`Could not restore Supabase session: ${current.error.message}`);
  if (current.data.session && !isExpired(current.data.session)) return current.data.session;

  if (current.data.session) {
    const refreshed = await client.auth.refreshSession();
    if (refreshed.error) throw new Error(`Could not refresh Supabase session: ${refreshed.error.message}`);
    if (refreshed.data.session) return refreshed.data.session;
  }

  const signedIn = await client.auth.signInAnonymously();
  if (signedIn.error) throw new Error(`Could not create anonymous session: ${signedIn.error.message}`);
  if (!signedIn.data.session) throw new Error('Supabase did not return an anonymous session.');
  return signedIn.data.session;
}

function isExpired(session: Session): boolean {
  return typeof session.expires_at === 'number' && session.expires_at * 1000 <= Date.now();
}
