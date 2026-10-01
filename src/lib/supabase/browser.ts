import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPublicEnv } from '@/lib/config/env';
import type { Database } from './database.types';

let browserClient: SupabaseClient<Database> | undefined;

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (typeof window === 'undefined') {
    throw new Error('The Supabase browser client can only be created in a browser.');
  }
  if (!browserClient) {
    const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
    browserClient = createClient<Database>(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'pelp-pal-web-auth',
      },
    });
  }
  return browserClient;
}
