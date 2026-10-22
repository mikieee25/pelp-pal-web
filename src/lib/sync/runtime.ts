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
    username: account.username,
    key: `${account.organizationId}:${account.id}`,
  };
  repository.setAccountScope(scope);
  const catalogRole = account.role === 'guest' ? 'guestlist' : 'masterlist';
  repository.setCatalogRole?.(catalogRole);
  const remote = new SupabaseSyncRemote(client);
  repository.setEvidenceDownloader((remotePath, signal) => remote.downloadEvidence(remotePath, signal));
  const coordinator = new SyncCoordinator(repository, remote, catalogRole);
  const realtime = new RealtimeCoordinator(client, coordinator);
  const statusStore = new SyncStatusStore(coordinator, realtime);
  let stopRealtime = realtime.start();
  let pollingInterval: number | undefined;
  let authTransitionTimer: number | undefined;
  let active = true;
  const onOnline = () => {
    if (!repository.getAccountScope || repository.getAccountScope()) void coordinator.syncNow('online').catch(() => undefined);
  };
  const refreshPollingState = () => {
    statusStore.setPollingActive(document.visibilityState === 'visible' && navigator.onLine);
  };
  const onVisibilityChange = () => {
    refreshPollingState();
      if (document.visibilityState === 'visible' && (!repository.getAccountScope || repository.getAccountScope())) {
      void coordinator.syncNow('resume').catch(() => undefined);
    }
  };
  const onOffline = refreshPollingState;
  const stopPolling = () => {
    if (pollingInterval !== undefined) window.clearInterval(pollingInterval);
    pollingInterval = undefined;
    statusStore.setPollingActive(false);
  };
  const startPolling = () => {
    stopPolling();
    pollingInterval = window.setInterval(() => {
      refreshPollingState();
      if (document.visibilityState !== 'visible' || !navigator.onLine || (repository.getAccountScope && !repository.getAccountScope())) return;
      void coordinator.syncNow('resume').catch(() => undefined);
    }, 45_000);
  };
  const authSubscription = client.auth.onAuthStateChange?.((event, session) => {
    if (event !== 'SIGNED_OUT' && event !== 'SIGNED_IN') return;
    if (authTransitionTimer !== undefined) window.clearTimeout(authTransitionTimer);
    coordinator.cancelForAccountChange();
    repository.setAccountScope(undefined);
    stopRealtime();
    stopPolling();
    if (event === 'SIGNED_OUT' || !session?.user) return;

    authTransitionTimer = window.setTimeout(() => {
      authTransitionTimer = undefined;
      void getCurrentAccount(client).then((nextAccount) => {
        if (!active) return;
        if (!nextAccount.isActive) return;
        const nextScope: AccountScope = {
          accountId: nextAccount.id,
          organizationId: nextAccount.organizationId,
          username: nextAccount.username,
          key: `${nextAccount.organizationId}:${nextAccount.id}`,
        };
        repository.setAccountScope(nextScope);
        const nextCatalogRole = nextAccount.role === 'guest' ? 'guestlist' : 'masterlist';
        repository.setCatalogRole?.(nextCatalogRole);
        stopRealtime = realtime.start();
        startPolling();
        refreshPollingState();
        void coordinator.syncNow('startup').catch(() => undefined);
      }).catch(() => undefined);
    }, 0);
  });
  startPolling();
  refreshPollingState();

  window.addEventListener('online', onOnline);
  window.addEventListener('online', refreshPollingState);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisibilityChange);

  const stop = () => {
    active = false;
    stopRealtime();
    window.removeEventListener('online', onOnline);
    window.removeEventListener('online', refreshPollingState);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    authSubscription?.data.subscription.unsubscribe();
    if (authTransitionTimer !== undefined) window.clearTimeout(authTransitionTimer);
    stopPolling();
    coordinator.dispose();
    statusStore.dispose();
    repository.setAccountScope(undefined);
    if (runtime?.coordinator === coordinator) runtime = undefined;
  };

  runtime = { coordinator, statusStore, stop };
  void coordinator.syncNow('startup').catch(() => undefined);
  return runtime;
}
