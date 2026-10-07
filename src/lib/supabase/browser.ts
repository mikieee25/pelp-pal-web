import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPublicEnv } from '@/lib/config/env';
import type { Database } from './database.types';

let browserClient: SupabaseClient<Database> | undefined;
let deviceClient: SupabaseClient<Database> | undefined;

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  browserClient ??= createBrowserClient('pelp-pal-web-auth');
  return browserClient;
}

/**
 * The enrolled browser is a separate Supabase identity from the signed-in
 * personnel account. Sync RLS resolves the device through auth.uid(), so this
 * client must keep its anonymous device session isolated from account login.
 */
export function getSupabaseDeviceClient(): SupabaseClient<Database> {
  deviceClient ??= createBrowserClient('pelp-pal-web-device-auth');
  return deviceClient;
}

function createBrowserClient(storageKey: string): SupabaseClient<Database> {
  if (typeof window === 'undefined') {
    throw new Error('The Supabase browser client can only be created in a browser.');
  }
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
  return createClient<Database>(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey,
    },
  });
}
