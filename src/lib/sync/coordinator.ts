import type { LocalRepository } from '@/lib/db/repository';
import type { CursorState, OutboxRecord, PullPage } from '@/lib/db/records';
import type { SyncOperationResult, SyncStatusSnapshot } from '@/features/sync/sync-status-store';
import { SyncConflictError } from '@/lib/supabase/remote-source';
import { SYNC_PULL_PAGE_LIMIT } from './constants';

export type SyncStatus = 'live' | 'syncing' | 'pending' | 'reconnecting' | 'offline' | 'error';

export type SyncReason = 'startup' | 'resume' | 'online' | 'realtime' | 'manual' | 'retry';

export type SyncOperation = 'full' | 'upload' | 'download';

export interface SyncRemote {
  pullSyncChanges(cursors: Omit<CursorState, 'id'>): Promise<PullPage>;
  pushOutbox(item: OutboxRecord): Promise<void>;
  getAvailableInspectionCount?(): Promise<number>;
}

export class SyncCoordinator {
  private snapshot: SyncStatusSnapshot = {
    status: 'offline',
    pendingCount: 0,
    conflictCount: 0,
    failedCount: 0,
  };
  private inFlight?: Promise<void>;
  private queuedOperation?: SyncOperation;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly repository: LocalRepository,
    private readonly remote: SyncRemote,
  ) {}

  getStatus(): SyncStatus {
    return this.snapshot.status;
  }

  getSnapshot(): SyncStatusSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  syncNow(reason: SyncReason, operation: SyncOperation = 'full'): Promise<void> {
    if (this.inFlight) {
      this.queuedOperation = strongerOperation(this.queuedOperation, operation);
      const current = this.inFlight;
      return current.then(
        () => this.runQueuedOperation(),
        () => this.runQueuedOperation(),
      );
    }
    this.inFlight = this.run(reason, operation).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private runQueuedOperation(): Promise<void> {
    const queued = this.queuedOperation;
    this.queuedOperation = undefined;
    return queued ? this.syncNow('realtime', queued) : Promise.resolve();
  }

  private async run(reason: SyncReason, operation: SyncOperation): Promise<void> {
    this.setSnapshot({
      status: 'syncing',
      operation,
      operationStartedAt: new Date().toISOString(),
      lastError: undefined,
      lastOperationResult: undefined,
    });
    let uploadedCount = 0;
    let downloadedCount = 0;
    let retryingCount = 0;
    let conflictedCount = 0;
    try {
      await this.repository.recoverStaleOutbox();
      let pushedAny = false;
      if (operation !== 'upload') {
        downloadedCount += await this.pullUntilCurrent();
        this.setSnapshot({ lastDownloadAt: new Date().toISOString() });
      }
      if (operation !== 'download') {
        if (reason === 'manual' || reason === 'retry') {
          await this.repository.retryFailedOutbox();
        }
        let firstPushError: unknown;
        for (const item of await this.repository.getDueOutbox()) {
          await this.repository.updateOutbox(item.id, { status: 'pushing', updatedAt: new Date().toISOString() });
          try {
            await this.remote.pushOutbox(item);
            pushedAny = true;
            uploadedCount += 1;
            await this.repository.updateOutbox(item.id, { status: 'synced', updatedAt: new Date().toISOString() });
            if (item.kind === 'inspection') {
              try {
                const payload = item.payload && typeof item.payload === 'object' ? item.payload as Record<string, unknown> : {};
                const revisions = Array.isArray(payload.revisions) ? payload.revisions : [];
                const revisionId = revisions.at(-1) && typeof revisions.at(-1) === 'object'
                  ? (revisions.at(-1) as Record<string, unknown>).id
                  : undefined;
                await this.repository.markInspectionEvidenceSynced?.(item.aggregateId, typeof revisionId === 'string' ? revisionId : undefined);
              } catch {
                // The remote revision is already acknowledged; a local status marker can be repaired on the next edit.
              }
            }
          } catch (error) {
            if (error instanceof SyncConflictError) {
              await this.repository.updateOutbox(item.id, {
                status: 'conflict',
                lastError: { code: error.code, message: error.message },
              });
              conflictedCount += 1;
              firstPushError ??= error;
              continue;
            }
            const attempts = (typeof item.attempts === 'number' ? item.attempts : 0) + 1;
            await this.repository.updateOutbox(item.id, {
              status: 'retry',
              attempts,
              nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
              lastError: { code: 'REMOTE_PUSH_FAILED', message: errorMessage(error) },
            });
            retryingCount += 1;
            firstPushError ??= error;
          }
        }
        if (firstPushError) {
          throw firstPushError;
        }
      }
      if (operation === 'full' && pushedAny) {
        downloadedCount += await this.pullUntilCurrent();
        this.setSnapshot({ lastDownloadAt: new Date().toISOString() });
      }
      await this.refreshCounts();
      const completedAt = new Date().toISOString();
      const result = createOperationResult(operation, completedAt, {
        uploadedCount,
        downloadedCount,
        retryingCount,
        conflictedCount,
        failedCount: 0,
      });
      this.setSnapshot({
        status: this.snapshot.pendingCount > 0 ? 'pending' : 'live',
        lastSyncedAt: completedAt,
        lastUploadAt: operation !== 'download' ? completedAt : this.snapshot.lastUploadAt,
        lastDownloadAt: operation !== 'upload' ? (this.snapshot.lastDownloadAt ?? completedAt) : this.snapshot.lastDownloadAt,
        operation: undefined,
        operationStartedAt: undefined,
        lastError: undefined,
        lastOperationResult: result,
      });
    } catch (error) {
      try {
        await this.refreshCounts();
      } catch {
        // Preserve the original remote error when a local status refresh also fails.
      }
      this.setSnapshot({
        status: 'error',
        operation: undefined,
        operationStartedAt: undefined,
        lastError: errorMessage(error),
        lastOperationResult: createOperationResult(operation, new Date().toISOString(), {
          uploadedCount,
          downloadedCount,
          retryingCount,
          conflictedCount,
          failedCount: 1,
          error: errorMessage(error),
        }),
      });
      throw error;
    }
  }

  private async refreshCounts(): Promise<void> {
    const [counts, device, localInspectionCount] = await Promise.all([
      this.repository.getSyncStatusCounts(),
      this.repository.getDevice(),
      this.repository.getCompletedInspectionCount(),
    ]);
    const manifest = await this.repository.getCatalogManifestState(device?.catalogScope ?? 'masterlist');
    let remoteInspectionCount: number | undefined;
    let diagnosticsError: string | undefined;
    if (this.remote.getAvailableInspectionCount) {
      try {
        remoteInspectionCount = await this.remote.getAvailableInspectionCount();
      } catch {
        diagnosticsError = 'Remote inspection count is unavailable.';
      }
    }
    this.setSnapshot({
      ...counts,
      catalogVersion: manifest?.version,
      localInspectionCount,
      remoteInspectionCount,
      diagnosticsError,
    });
  }

  private setSnapshot(changes: Partial<SyncStatusSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    for (const listener of this.listeners) listener();
  }

  private async pullUntilCurrent(): Promise<number> {
    let downloadedCount = 0;
    while (true) {
      const current = await this.repository.getCursorState();
      const page = await this.remote.pullSyncChanges(current);
      if (!page.revisions.length && !page.activities.length && !page.conflicts.length && !page.deletions.length) {
        return downloadedCount;
      }
      if (!hasCursorProgress(page, current)) {
        throw new Error('Sync pull made no cursor progress. Retry the sync after checking the remote cursor state.');
      }
      await this.repository.applyPullPage(page);
      downloadedCount += page.revisions.length + page.activities.length + page.conflicts.length + page.deletions.length;
      if (!hasFullPullPage(page)) return downloadedCount;
    }
  }
}

function createOperationResult(
  operation: SyncOperation,
  completedAt: string,
  counts: Omit<SyncOperationResult, 'operation' | 'completedAt' | 'unchangedCount'>,
): SyncOperationResult {
  return {
    operation,
    completedAt,
    ...counts,
    unchangedCount: (operation === 'download' || (operation === 'full' && counts.uploadedCount === 0)) && counts.downloadedCount === 0 ? 1 : 0,
  };
}

function strongerOperation(current: SyncOperation | undefined, requested: SyncOperation): SyncOperation {
  if (current === 'full' || requested === 'full') return 'full';
  if (current && current !== requested) return 'full';
  return requested;
}

function hasCursorProgress(page: PullPage, current: Omit<CursorState, 'id'>): boolean {
  return page.revisions.some((row) => row.change_cursor > current.revision)
    || page.activities.some((row) => row.change_cursor > current.activity)
    || page.conflicts.some((row) => row.change_cursor > current.conflict)
    || page.deletions.some((row) => row.change_cursor > current.deletion);
}

function hasFullPullPage(page: PullPage): boolean {
  return page.revisions.length >= SYNC_PULL_PAGE_LIMIT
    || page.activities.length >= SYNC_PULL_PAGE_LIMIT
    || page.conflicts.length >= SYNC_PULL_PAGE_LIMIT
    || page.deletions.length >= SYNC_PULL_PAGE_LIMIT;
}

function retryDelayMs(attempts: number): number {
  const baseDelay = 1_000;
  const maximumDelay = 5 * 60 * 1_000;
  return Math.min(maximumDelay, baseDelay * 2 ** Math.min(attempts - 1, 9));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
