import type { LocalRepository } from '@/lib/db/repository';
import type { CursorState, OutboxRecord, PullPage } from '@/lib/db/records';

export type SyncStatus = 'live' | 'syncing' | 'pending' | 'reconnecting' | 'offline' | 'error';

export type SyncReason = 'startup' | 'resume' | 'online' | 'realtime' | 'manual' | 'retry';

export interface SyncRemote {
  pullSyncChanges(cursors: Omit<CursorState, 'id'>): Promise<PullPage>;
  pushOutbox(item: OutboxRecord): Promise<void>;
}

export class SyncCoordinator {
  private status: SyncStatus = 'offline';
  private inFlight?: Promise<void>;

  constructor(
    private readonly repository: LocalRepository,
    private readonly remote: SyncRemote,
  ) {}

  getStatus(): SyncStatus {
    return this.status;
  }

  syncNow(_reason: SyncReason): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    this.status = 'syncing';
    try {
      await this.pullUntilCurrent();
      for (const item of await this.repository.getDueOutbox()) {
        await this.repository.updateOutbox(item.id, { status: 'pushing' });
        try {
          await this.remote.pushOutbox(item);
          await this.repository.updateOutbox(item.id, { status: 'synced' });
        } catch (error) {
          const attempts = (typeof item.attempts === 'number' ? item.attempts : 0) + 1;
          await this.repository.updateOutbox(item.id, {
            status: 'retry',
            attempts,
            nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
            lastError: { code: 'REMOTE_PUSH_FAILED', message: errorMessage(error) },
          });
          throw error;
        }
      }
      await this.pullUntilCurrent();
      this.status = (await this.repository.getDueOutbox()).length > 0 ? 'pending' : 'live';
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }

  private async pullUntilCurrent(): Promise<void> {
    while (true) {
      const page = await this.remote.pullSyncChanges(await this.repository.getCursorState());
      if (!page.revisions.length && !page.activities.length && !page.conflicts.length && !page.deletions.length) {
        return;
      }
      await this.repository.applyPullPage(page);
    }
  }
}

function retryDelayMs(attempts: number): number {
  const baseDelay = 1_000;
  const maximumDelay = 5 * 60 * 1_000;
  return Math.min(maximumDelay, baseDelay * 2 ** Math.min(attempts - 1, 9));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
