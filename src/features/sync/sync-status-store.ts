import type { SyncCoordinator, SyncReason, SyncStatus } from '@/lib/sync/coordinator';

export type SyncStatusSnapshot = {
  status: SyncStatus;
  lastSyncedAt?: string;
  pendingCount: number;
  conflictCount: number;
  lastError?: string;
};

export class SyncStatusStore {
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeCoordinator: () => void;

  constructor(private readonly coordinator: SyncCoordinator) {
    this.unsubscribeCoordinator = coordinator.subscribe(() => this.notify());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SyncStatusSnapshot {
    return this.coordinator.getSnapshot();
  }

  syncNow(reason: SyncReason): Promise<void> {
    return this.coordinator.syncNow(reason);
  }

  dispose(): void {
    this.unsubscribeCoordinator();
    this.listeners.clear();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
