import type { SyncCoordinator, SyncOperation, SyncReason, SyncStatus } from '@/lib/sync/coordinator';
import type { RealtimeChannelState } from '@/lib/realtime/coordinator';

export type SyncStatusSnapshot = {
  status: SyncStatus;
  realtimeState?: RealtimeChannelState;
  lastSyncedAt?: string;
  pendingCount: number;
  conflictCount: number;
  failedCount?: number;
  catalogVersion?: number;
  lastError?: string;
  operation?: SyncOperation;
  operationStartedAt?: string;
  lastUploadAt?: string;
  lastDownloadAt?: string;
  localInspectionCount?: number;
  remoteInspectionCount?: number;
  diagnosticsError?: string;
  lastOperationResult?: SyncOperationResult;
};

export type SyncOperationResult = {
  operation: SyncOperation;
  completedAt: string;
  uploadedCount: number;
  downloadedCount: number;
  unchangedCount: number;
  retryingCount: number;
  conflictedCount: number;
  failedCount: number;
  error?: string;
};

type RealtimeStatusSource = {
  getSnapshot: () => { state: RealtimeChannelState };
  subscribe: (listener: () => void) => () => void;
};

export class SyncStatusStore {
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeCoordinator: () => void;
  private readonly unsubscribeRealtime: () => void;
  private snapshot: SyncStatusSnapshot;

  constructor(
    private readonly coordinator: SyncCoordinator,
    private readonly realtime?: RealtimeStatusSource,
  ) {
    this.snapshot = this.withRealtimeState(coordinator.getSnapshot());
    this.unsubscribeCoordinator = coordinator.subscribe(() => this.refresh());
    this.unsubscribeRealtime = realtime?.subscribe(() => this.refresh()) ?? (() => undefined);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SyncStatusSnapshot {
    return this.snapshot;
  }

  syncNow(reason: SyncReason, operation: SyncOperation = 'full'): Promise<void> {
    return this.coordinator.syncNow(reason, operation);
  }

  dispose(): void {
    this.unsubscribeCoordinator();
    this.unsubscribeRealtime();
    this.listeners.clear();
  }

  private refresh(): void {
    this.snapshot = this.withRealtimeState(this.coordinator.getSnapshot());
    this.notify();
  }

  private withRealtimeState(snapshot: SyncStatusSnapshot): SyncStatusSnapshot {
    return {
      ...snapshot,
      realtimeState: this.realtime?.getSnapshot().state ?? 'disconnected',
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
