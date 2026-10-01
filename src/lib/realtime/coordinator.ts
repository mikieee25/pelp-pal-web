import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncCoordinator } from '@/lib/sync/coordinator';
import { RealtimeEventRouter } from './event-router';
import { subscribeToSyncTables } from './subscriptions';

export class RealtimeCoordinator {
  constructor(
    private readonly client: SupabaseClient,
    private readonly sync: SyncCoordinator,
  ) {}

  start(): () => void {
    const router = new RealtimeEventRouter((reason) => { void this.sync.syncNow(reason); });
    return subscribeToSyncTables(
      this.client,
      (event) => router.route(event),
      (status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') void this.sync.syncNow('retry');
      },
    );
  }
}
