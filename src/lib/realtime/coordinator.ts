import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncCoordinator } from '@/lib/sync/coordinator';
import { RealtimeEventRouter } from './event-router';
import { subscribeToSyncTables } from './subscriptions';
import { syncDebug } from './debug';

const reconnectBaseDelayMs = 1_000;
const reconnectMaximumDelayMs = 30_000;
const reconnectStatuses = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

export class RealtimeCoordinator {
  private cleanupSubscription?: () => void;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryAttempt = 0;
  private generation = 0;
  private stopped = false;

  constructor(
    private readonly client: SupabaseClient,
    private readonly sync: SyncCoordinator,
  ) {}

  start(): () => void {
    this.stopped = false;
    this.subscribe();
    return () => this.stop();
  }

  private subscribe(): void {
    if (this.stopped) return;
    const generation = ++this.generation;
    const router = new RealtimeEventRouter((reason) => {
      void this.sync.syncNow(reason).catch((error: unknown) => {
        syncDebug('realtime-triggered sync failed', error);
      });
    });
    this.cleanupSubscription = subscribeToSyncTables(
      this.client,
      (event) => router.route(event),
      (status, error) => {
        if (generation !== this.generation) return;
        syncDebug('realtime coordinator observed channel status', { status, error });
        if (status === 'SUBSCRIBED') {
          this.retryAttempt = 0;
          return;
        }
        if (!reconnectStatuses.has(status)) return;
        void this.sync.syncNow('retry').catch((syncError: unknown) => {
          syncDebug('realtime recovery sync failed', syncError);
        });
        this.scheduleReconnect();
      },
    );
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return;
    this.invalidateSubscription();
    const delay = Math.min(
      reconnectMaximumDelayMs,
      reconnectBaseDelayMs * 2 ** Math.min(this.retryAttempt, 5),
    );
    this.retryAttempt += 1;
    syncDebug('scheduling realtime reconnect', { delay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.subscribe();
    }, delay);
  }

  private invalidateSubscription(): void {
    this.generation += 1;
    const cleanup = this.cleanupSubscription;
    this.cleanupSubscription = undefined;
    cleanup?.();
  }

  private stop(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    const cleanup = this.cleanupSubscription;
    this.cleanupSubscription = undefined;
    cleanup?.();
  }
}
