import { getBrowserRepository } from '@/lib/db/browser';
import { getCurrentAccount } from '@/features/auth/account-password';
import { RealtimeCoordinator } from '@/lib/realtime/coordinator';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { SupabaseSyncRemote } from '@/lib/supabase/remote-source';
import type { AccountScope } from '@/lib/db/records';
import { SyncCoordinator } from './coordinator';
import { SyncStatusStore } from '@/features/sync/sync-status-store';

export type SyncRuntime = {
  coordinator: SyncCoordinator;
  statusStore: SyncStatusStore;
  stop: () => void;
};

let runtime: SyncRuntime | undefined;
let starting: Promise<SyncRuntime | undefined> | undefined;

export function getSyncRuntime(): SyncRuntime | undefined {
  return runtime;
}

export function startSyncRuntime(): Promise<SyncRuntime | undefined> {
  if (runtime) return Promise.resolve(runtime);
  if (starting) return starting;

  starting = createSyncRuntime().finally(() => {
    starting = undefined;
  });
  return starting;
}

async function createSyncRuntime(): Promise<SyncRuntime | undefined> {
  if (typeof window === 'undefined') return undefined;

  const repository = getBrowserRepository();
  const client = getSupabaseBrowserClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw new Error(`Could not verify the signed-in account: ${userError.message}`);
  if (!userData.user) return undefined;

  const account = await getCurrentAccount(client);
  if (!account.isActive) throw new Error('This personnel account is inactive. Sign in with an active account before syncing.');
  const scope: AccountScope = {
    accountId: account.id,
    organizationId: account.organizationId,
    key: `${account.organizationId}:${account.id}`,
  };
  repository.setAccountScope(scope);
  const catalogRole = account.role === 'guest' ? 'guestlist' : 'masterlist';
  repository.setCatalogRole?.(catalogRole);
  const coordinator = new SyncCoordinator(repository, new SupabaseSyncRemote(client), catalogRole);
  const realtime = new RealtimeCoordinator(client, coordinator);
  const statusStore = new SyncStatusStore(coordinator, realtime);
  const stopRealtime = realtime.start();
  const onOnline = () => { void coordinator.syncNow('online').catch(() => undefined); };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void coordinator.syncNow('resume').catch(() => undefined);
    }
  };
  const pollingInterval = window.setInterval(() => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    void coordinator.syncNow('resume').catch(() => undefined);
  }, 45_000);

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibilityChange);

  const stop = () => {
    stopRealtime();
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.clearInterval(pollingInterval);
    statusStore.dispose();
    if (runtime?.coordinator === coordinator) runtime = undefined;
  };

  runtime = { coordinator, statusStore, stop };
  void coordinator.syncNow('startup').catch(() => undefined);
  return runtime;
}
