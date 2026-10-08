import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncCoordinator } from '@/lib/sync/coordinator';
import { RealtimeEventRouter } from './event-router';
import { subscribeToSyncTables } from './subscriptions';
import { syncDebug } from './debug';

const reconnectBaseDelayMs = 1_000;
const reconnectMaximumDelayMs = 30_000;
const reconnectStatuses = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

export type RealtimeChannelState = 'connected' | 'reconnecting' | 'disconnected';
export type RealtimeCoordinatorSnapshot = { state: RealtimeChannelState };

export class RealtimeCoordinator {
  private cleanupSubscription?: () => void;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryAttempt = 0;
  private generation = 0;
  private stopped = false;
  private snapshot: RealtimeCoordinatorSnapshot = { state: 'disconnected' };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly client: SupabaseClient,
    private readonly sync: SyncCoordinator,
  ) {}

  getSnapshot(): RealtimeCoordinatorSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): () => void {
    this.stopped = false;
    this.setState('reconnecting');
    this.subscribeChannel();
    return () => this.stop();
  }

  private subscribeChannel(): void {
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
          this.setState('connected');
          return;
        }
        if (!reconnectStatuses.has(status)) return;
        this.setState('reconnecting');
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
      this.subscribeChannel();
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
    this.setState('disconnected');
  }

  private setState(state: RealtimeChannelState): void {
    if (this.snapshot.state === state) return;
    this.snapshot = { state };
    for (const listener of this.listeners) listener();
  }
}
