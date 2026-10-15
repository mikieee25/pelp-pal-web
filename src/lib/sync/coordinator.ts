import type { LocalRepository } from '@/lib/db/repository';
import type { CatalogRole, CursorState, EvidenceUploadTask, OutboxRecord, PullPage } from '@/lib/db/records';
import type { SyncOperationResult, SyncStatusSnapshot } from '@/features/sync/sync-status-store';
import { EvidenceLocalInvalidError, SyncConflictError } from '@/lib/supabase/remote-source';
import { SYNC_PULL_PAGE_LIMIT } from './constants';

export type SyncStatus = 'live' | 'syncing' | 'pending' | 'reconnecting' | 'offline' | 'error';

export type SyncReason = 'startup' | 'resume' | 'online' | 'realtime' | 'manual' | 'retry';

export type SyncOperation = 'full' | 'upload' | 'download';

export interface SyncRemote {
  pullSyncChanges(cursors: Omit<CursorState, 'id'>): Promise<PullPage>;
  pushOutbox(item: OutboxRecord): Promise<void | EvidenceUploadTask[]>;
  uploadEvidence?(task: EvidenceUploadTask, blob: Blob): Promise<string>;
  getAvailableInspectionCount?(): Promise<number>;
}

export class SyncCoordinator {
  private snapshot: SyncStatusSnapshot = {
    status: 'offline',
    pendingCount: 0,
    conflictCount: 0,
    failedCount: 0,
    evidencePendingCount: 0,
    evidenceFailedCount: 0,
  };
  private inFlight?: Promise<void>;
  private queuedOperation?: SyncOperation;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly repository: LocalRepository,
    private readonly remote: SyncRemote,
    private readonly catalogRole: CatalogRole = 'masterlist',
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

  async refreshStatus(): Promise<void> {
    await this.refreshCounts();
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
    let failedCount = 0;
    try {
      await this.repository.migrateAcknowledgedEvidenceOutbox?.();
      await this.repository.recoverStaleOutbox();
      let pushedAny = false;
      if (operation !== 'upload') {
        downloadedCount += await this.pullUntilCurrent();
        this.setSnapshot({ lastDownloadAt: new Date().toISOString() });
      }
      if (operation !== 'download') {
        if (reason === 'manual' || reason === 'retry') {
          await this.repository.retryFailedOutbox();
          await this.repository.retryFailedEvidenceUploads?.();
        }
        let firstPushError: unknown;
        const rebuiltAggregates = new Set<string>();
        const dueItems = await this.repository.getDueOutbox();
        for (let itemIndex = 0; itemIndex < dueItems.length; itemIndex += 1) {
          const item = dueItems[itemIndex];
          const currentItem = await this.repository.getOutbox(item.id);
          if (!currentItem || (currentItem.status !== 'pending' && currentItem.status !== 'retry')) continue;
          await this.repository.updateOutbox(item.id, { status: 'pushing', updatedAt: new Date().toISOString() });
          try {
            const evidenceTasks = await this.remote.pushOutbox(item);
            pushedAny = true;
            uploadedCount += 1;
            await this.repository.updateOutbox(item.id, { status: 'synced', updatedAt: new Date().toISOString() });
            if (item.kind === 'inspection' && evidenceTasks?.length) {
              try {
                await this.repository.registerAcknowledgedEvidence?.(evidenceTasks);
              } catch {
                // The revision is already acknowledged; startup reconciliation can rebuild photo jobs.
              }
            }
          } catch (error) {
            if (error instanceof SyncConflictError && error.serverHead === 0 && !rebuiltAggregates.has(item.aggregateId)) {
              rebuiltAggregates.add(item.aggregateId);
              await this.repository.updateOutbox(item.id, {
                status: 'retry',
                nextAttemptAt: new Date().toISOString(),
                lastError: {
                  code: error.code,
                  message: error.message,
                  serverHead: error.serverHead,
                  serverHeadId: error.serverHeadId,
                },
              });
              const rebuilt = await this.repository.rebuildInspectionOutboxChain(item.aggregateId);
              if (rebuilt) {
                dueItems.splice(itemIndex + 1, 0, rebuilt);
                continue;
              }
            }
            if (error instanceof SyncConflictError) {
              await this.repository.updateOutbox(item.id, {
                status: 'conflict',
                lastError: {
                  code: error.code,
                  message: error.message,
                  serverHead: error.serverHead,
                  serverHeadId: error.serverHeadId,
                },
              });
              conflictedCount += 1;
              firstPushError ??= error;
              continue;
            }
            if (error instanceof EvidenceLocalInvalidError) {
              await this.repository.updateOutbox(item.id, {
                status: 'failed',
                lastError: { code: error.code, message: error.message },
              });
              failedCount += 1;
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
      await this.uploadDueEvidence();
      await this.refreshCounts();
      const completedAt = new Date().toISOString();
      const result = createOperationResult(operation, completedAt, {
        uploadedCount,
        downloadedCount,
        retryingCount,
        conflictedCount,
        failedCount,
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
          failedCount: Math.max(1, failedCount),
          error: errorMessage(error),
        }),
      });
      throw error;
    }
  }

  private async uploadDueEvidence(): Promise<void> {
    if (!this.remote.uploadEvidence || !this.repository.getDueEvidenceUploads
      || !this.repository.getEvidenceBlob || !this.repository.updateEvidenceUpload
      || !this.repository.markEvidenceUploaded) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const due = await this.repository.getDueEvidenceUploads();
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < due.length) {
        const taskRecord = due[nextIndex++];
        try {
          const local = await this.repository.getEvidenceBlob(taskRecord.evidenceId);
          if (!local) throw new Error('The local photo is missing from this browser. Use Re-upload missing photos after restoring it.');
          const blob = local.blob;
          const task: EvidenceUploadTask = {
            evidenceId: taskRecord.evidenceId,
            inspectionId: taskRecord.inspectionId,
            remotePath: taskRecord.remotePath,
            sha256: taskRecord.sha256 ?? local.sha256 ?? '',
            needsUpload: true,
          };
          const sha256 = await this.remote.uploadEvidence!(task, blob);
          await this.repository.markEvidenceUploaded(taskRecord.evidenceId, taskRecord.remotePath, sha256);
        } catch (error) {
          const attempts = taskRecord.attempts + 1;
          await this.repository.updateEvidenceUpload(taskRecord.id, {
            status: 'failed',
            attempts,
            nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
            lastError: errorMessage(error),
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, due.length) }, () => worker()));
  }

  private async refreshCounts(): Promise<void> {
    const [counts, localInspectionCount] = await Promise.all([
      this.repository.getSyncStatusCounts(),
      this.repository.getCompletedInspectionCount(),
    ]);
    const manifest = await this.repository.getCatalogManifestState(this.catalogRole);
    const scope = this.repository.getAccountScope?.();
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
      accountId: scope?.accountId,
      organizationId: scope?.organizationId,
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
