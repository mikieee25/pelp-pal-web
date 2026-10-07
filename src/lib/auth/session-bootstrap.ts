import type { Session, SupabaseClient } from '@supabase/supabase-js';

export async function ensureAnonymousSession(client: SupabaseClient): Promise<Session> {
  const current = await client.auth.getSession();
  if (current.error) throw new Error(`Could not restore Supabase session: ${current.error.message}`);
  const session = current.data.session;
  if (session?.user.is_anonymous === true) {
    if (!isExpired(session)) return session;

    const refreshed = await client.auth.refreshSession();
    if (refreshed.error) throw new Error(`Could not refresh the device session: ${refreshed.error.message}`);
    if (refreshed.data.session?.user.is_anonymous === true) return refreshed.data.session;
    throw new Error('Supabase did not return an anonymous device session after refresh.');
  }

  if (session) {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw new Error(`Could not replace the device session: ${error.message}`);
  }

  const signedIn = await client.auth.signInAnonymously();
  if (signedIn.error) throw new Error(`Could not create anonymous session: ${signedIn.error.message}`);
  if (!signedIn.data.session || signedIn.data.session.user.is_anonymous !== true) {
    throw new Error('Supabase did not return an anonymous device session.');
  }
  return signedIn.data.session;
}

function isExpired(session: Session): boolean {
  return typeof session.expires_at === 'number' && session.expires_at * 1000 <= Date.now();
}
