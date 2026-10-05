import { getBrowserRepository } from '@/lib/db/browser';
import { RealtimeCoordinator } from '@/lib/realtime/coordinator';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { SupabaseSyncRemote } from '@/lib/supabase/remote-source';
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
  const device = await repository.getDevice();
  if (!device?.enrolled) return undefined;

  const client = getSupabaseBrowserClient();
  const coordinator = new SyncCoordinator(repository, new SupabaseSyncRemote(client));
  const statusStore = new SyncStatusStore(coordinator);
  const stopRealtime = new RealtimeCoordinator(client, coordinator).start();
  const onOnline = () => { void coordinator.syncNow('online').catch(() => undefined); };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void coordinator.syncNow('resume').catch(() => undefined);
    }
  };

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibilityChange);

  const stop = () => {
    stopRealtime();
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    statusStore.dispose();
    if (runtime?.coordinator === coordinator) runtime = undefined;
  };

  runtime = { coordinator, statusStore, stop };
  void coordinator.syncNow('startup').catch(() => undefined);
  return runtime;
}
