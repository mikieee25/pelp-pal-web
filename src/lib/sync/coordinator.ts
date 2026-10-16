import type { LocalRepository } from '@/lib/db/repository';
import type { AccountScope, CatalogRole, CursorState, EvidenceUploadTask, OutboxRecord, PullPage } from '@/lib/db/records';
import type { SyncOperationResult, SyncStatusSnapshot } from '@/features/sync/sync-status-store';
import { EvidenceLocalInvalidError, SyncConflictError } from '@/lib/supabase/remote-source';
import { SYNC_PULL_PAGE_LIMIT } from './constants';

export type SyncStatus = 'live' | 'syncing' | 'pending' | 'reconnecting' | 'offline' | 'error';

export type SyncReason = 'startup' | 'resume' | 'online' | 'realtime' | 'manual' | 'retry';

export type SyncOperation = 'full' | 'upload' | 'download';

export interface SyncRemote {
  pullSyncChanges(cursors: Omit<CursorState, 'id'>, signal?: AbortSignal): Promise<PullPage>;
  pushOutbox(item: OutboxRecord, signal?: AbortSignal): Promise<void | EvidenceUploadTask[]>;
  uploadEvidence?(task: EvidenceUploadTask, blob: Blob, signal?: AbortSignal): Promise<string>;
  getAvailableInspectionCount?(signal?: AbortSignal): Promise<number>;
}

type SyncRun = { id: number; scope: AccountScope | null; scopeKey?: string; controller: AbortController; invalidated: boolean };

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
  private queuedForRunId?: number;
  private activeRun?: SyncRun;
  private nextRunId = 0;
  private readonly unsubscribeAccountScope?: () => void;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly repository: LocalRepository,
    private readonly remote: SyncRemote,
    private readonly catalogRole: CatalogRole = 'masterlist',
  ) {
    this.unsubscribeAccountScope = this.repository.subscribeAccountScope?.((scope) => {
      if (this.activeRun && this.activeRun.scopeKey !== scope?.key) this.cancelForAccountChange();
    });
  }

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
      const ownerRunId = this.activeRun?.id;
      this.queuedForRunId = ownerRunId;
      const current = this.inFlight;
      return current.then(
        () => this.runQueuedOperation(ownerRunId),
        () => this.runQueuedOperation(ownerRunId),
      );
    }
    const scope = this.repository.getAccountScope?.() ?? null;
    const run: SyncRun = {
      id: ++this.nextRunId,
      scope,
      scopeKey: scope?.key,
      controller: new AbortController(),
      invalidated: false,
    };
    this.activeRun = run;
    const current = this.run(reason, operation, run).finally(() => {
      if (this.activeRun === run) {
        this.activeRun = undefined;
        this.inFlight = undefined;
      }
    });
    this.inFlight = current;
    return current;
  }

  cancelForAccountChange(): void {
    this.queuedOperation = undefined;
    this.queuedForRunId = undefined;
    const run = this.activeRun;
    if (run) {
      run.invalidated = true;
      run.controller.abort();
      this.activeRun = undefined;
      this.inFlight = undefined;
    }
    this.setSnapshot({ status: 'offline', operation: undefined, operationStartedAt: undefined, lastError: undefined });
  }

  dispose(): void {
    this.cancelForAccountChange();
    this.unsubscribeAccountScope?.();
  }

  private runQueuedOperation(ownerRunId?: number): Promise<void> {
    if (this.queuedForRunId !== ownerRunId) return Promise.resolve();
    const queued = this.queuedOperation;
    this.queuedOperation = undefined;
    this.queuedForRunId = undefined;
    return queued ? this.syncNow('realtime', queued) : Promise.resolve();
  }

  private async run(reason: SyncReason, operation: SyncOperation, run: SyncRun): Promise<void> {
    if (!this.isCurrentRun(run)) return;
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
      await this.repository.migrateAcknowledgedEvidenceOutbox?.(run.scope);
      this.assertCurrentRun(run);
      await this.repository.recoverStaleOutbox(undefined, run.scope);
      this.assertCurrentRun(run);
      let pushedAny = false;
      if (operation !== 'upload') {
        downloadedCount += await this.pullUntilCurrent(run);
        this.assertCurrentRun(run);
        this.setSnapshot({ lastDownloadAt: new Date().toISOString() });
      }
      if (operation !== 'download') {
        if (reason === 'manual' || reason === 'retry') {
          await this.repository.retryFailedOutbox(run.scope);
          this.assertCurrentRun(run);
          await this.repository.retryFailedEvidenceUploads?.(run.scope);
          this.assertCurrentRun(run);
        }
        let firstPushError: unknown;
        const rebuiltAggregates = new Set<string>();
        const dueItems = await this.repository.getDueOutbox(new Date(), run.scope);
        this.assertCurrentRun(run);
        for (let itemIndex = 0; itemIndex < dueItems.length; itemIndex += 1) {
          this.assertCurrentRun(run);
          const item = dueItems[itemIndex];
          const currentItem = await this.repository.getOutbox(item.id, run.scope);
          this.assertCurrentRun(run);
          if (!currentItem || (currentItem.status !== 'pending' && currentItem.status !== 'retry')) continue;
          await this.repository.updateOutbox(item.id, { status: 'pushing', updatedAt: new Date().toISOString() }, run.scope);
          this.assertCurrentRun(run);
          try {
            const evidenceTasks = await this.remote.pushOutbox(item, run.controller.signal);
            this.assertCurrentRun(run);
            pushedAny = true;
            uploadedCount += 1;
            await this.repository.updateOutbox(item.id, { status: 'synced', updatedAt: new Date().toISOString() }, run.scope);
            this.assertCurrentRun(run);
            if (item.kind === 'inspection' && evidenceTasks?.length) {
              try {
                await this.repository.registerAcknowledgedEvidence?.(evidenceTasks, run.scope);
                this.assertCurrentRun(run);
              } catch {
                this.assertCurrentRun(run);
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
              }, run.scope);
              this.assertCurrentRun(run);
              const rebuilt = await this.repository.rebuildInspectionOutboxChain(item.aggregateId, run.scope);
              this.assertCurrentRun(run);
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
              }, run.scope);
              this.assertCurrentRun(run);
              conflictedCount += 1;
              firstPushError ??= error;
              continue;
            }
            if (error instanceof EvidenceLocalInvalidError) {
              await this.repository.updateOutbox(item.id, {
                status: 'failed',
                lastError: { code: error.code, message: error.message },
              }, run.scope);
              this.assertCurrentRun(run);
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
            }, run.scope);
            this.assertCurrentRun(run);
            retryingCount += 1;
            firstPushError ??= error;
          }
        }
        if (firstPushError) {
          throw firstPushError;
        }
      }
      if (operation === 'full' && pushedAny) {
        downloadedCount += await this.pullUntilCurrent(run);
        this.assertCurrentRun(run);
        this.setSnapshot({ lastDownloadAt: new Date().toISOString() });
      }
      await this.uploadDueEvidence(run);
      this.assertCurrentRun(run);
      await this.refreshCounts(run);
      this.assertCurrentRun(run);
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
      if (!this.isCurrentRun(run)) return;
      try {
        await this.refreshCounts(run);
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

  private async uploadDueEvidence(run: SyncRun): Promise<void> {
    if (!this.remote.uploadEvidence || !this.repository.getDueEvidenceUploads
      || !this.repository.getEvidenceBlob || !this.repository.updateEvidenceUpload
      || !this.repository.markEvidenceUploaded) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const due = await this.repository.getDueEvidenceUploads(new Date(), run.scope);
    this.assertCurrentRun(run);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < due.length) {
        this.assertCurrentRun(run);
        const taskRecord = due[nextIndex++];
        try {
          const local = await this.repository.getEvidenceBlob(taskRecord.evidenceId, run.scope);
          this.assertCurrentRun(run);
          if (!local) throw new Error('The local photo is missing from this browser. Use Re-upload missing photos after restoring it.');
          const blob = local.blob;
          const task: EvidenceUploadTask = {
            evidenceId: taskRecord.evidenceId,
            inspectionId: taskRecord.inspectionId,
            remotePath: taskRecord.remotePath,
            sha256: taskRecord.sha256 ?? local.sha256 ?? '',
            needsUpload: true,
          };
          const sha256 = await this.remote.uploadEvidence!(task, blob, run.controller.signal);
          this.assertCurrentRun(run);
          await this.repository.markEvidenceUploaded(taskRecord.evidenceId, taskRecord.remotePath, sha256, run.scope);
          this.assertCurrentRun(run);
        } catch (error) {
          this.assertCurrentRun(run);
          const attempts = taskRecord.attempts + 1;
          await this.repository.updateEvidenceUpload(taskRecord.id, {
            status: 'failed',
            attempts,
            nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
            lastError: errorMessage(error),
          }, run.scope);
          this.assertCurrentRun(run);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, due.length) }, () => worker()));
  }

  private async refreshCounts(run?: SyncRun): Promise<void> {
    const scope = run?.scope ?? this.repository.getAccountScope?.() ?? null;
    const scopeKey = scope?.key;
    const assertScope = () => {
      if (run) this.assertCurrentRun(run);
      else if (this.repository.getAccountScope && this.repository.getAccountScope()?.key !== scopeKey) {
        throw new Error('The signed-in account changed while refreshing sync status.');
      }
    };
    const [counts, localInspectionCount] = await Promise.all([
      this.repository.getSyncStatusCounts(),
      this.repository.getCompletedInspectionCount(),
    ]);
    assertScope();
    const manifest = await this.repository.getCatalogManifestState(this.catalogRole);
    assertScope();
    let remoteInspectionCount: number | undefined;
    let diagnosticsError: string | undefined;
    if (this.remote.getAvailableInspectionCount) {
      try {
        remoteInspectionCount = await this.remote.getAvailableInspectionCount(run?.controller.signal);
        assertScope();
      } catch {
        diagnosticsError = 'Remote inspection count is unavailable.';
      }
    }
    assertScope();
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

  private async pullUntilCurrent(run: SyncRun): Promise<number> {
    let downloadedCount = 0;
    while (true) {
      this.assertCurrentRun(run);
      const current = await this.repository.getCursorState(run.scope);
      this.assertCurrentRun(run);
      const page = await this.remote.pullSyncChanges(current, run.controller.signal);
      this.assertCurrentRun(run);
      if (!page.revisions.length && !page.activities.length && !page.conflicts.length && !page.deletions.length) {
        return downloadedCount;
      }
      if (!hasCursorProgress(page, current)) {
        throw new Error('Sync pull made no cursor progress. Retry the sync after checking the remote cursor state.');
      }
      await this.repository.applyPullPage(page, run.scope);
      this.assertCurrentRun(run);
      downloadedCount += page.revisions.length + page.activities.length + page.conflicts.length + page.deletions.length;
      if (!hasFullPullPage(page)) return downloadedCount;
    }
  }

  private isCurrentRun(run: SyncRun): boolean {
    if (this.activeRun !== run || run.invalidated || run.controller.signal.aborted) return false;
    if (!this.repository.getAccountScope) return true;
    return this.repository.getAccountScope()?.key === run.scopeKey;
  }

  private assertCurrentRun(run: SyncRun): void {
    if (this.isCurrentRun(run)) return;
    run.controller.abort();
    const error = new Error('Synchronization was cancelled because the signed-in account changed.');
    error.name = 'AbortError';
    throw error;
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
