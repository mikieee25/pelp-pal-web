import type { Table } from 'dexie';
import { PELPPalDatabase } from './database';
import type { CatalogRecord, CursorState, DeviceRecord, OutboxRecord, PullPage, SyncRow } from './records';

const initialCursorState: CursorState = {
  id: 'global',
  revision: 0,
  activity: 0,
  conflict: 0,
  deletion: 0,
};

export class LocalRepository {
  constructor(private readonly database: PELPPalDatabase) {}

  async getOrCreateInstallationId(): Promise<string> {
    return this.database.transaction('rw', this.database.device, async () => {
      const current = await this.database.device.get('current');
      if (current) return current.installationId;
      const installationId = crypto.randomUUID();
      const record: DeviceRecord = {
        id: 'current',
        installationId,
        enrolled: false,
        updatedAt: new Date().toISOString(),
      };
      await this.database.device.put(record);
      return installationId;
    });
  }

  async markDeviceEnrolled(details: {
    authUserId: string;
    organizationId: string;
    assignedUsername: string;
    assignedRole: 'admin' | 'epred' | 'guest';
    catalogScope: 'masterlist' | 'guestlist';
  }): Promise<void> {
    const installationId = await this.getOrCreateInstallationId();
    await this.database.device.put({
      id: 'current',
      installationId,
      authUserId: details.authUserId,
      organizationId: details.organizationId,
      assignedUsername: details.assignedUsername,
      assignedRole: details.assignedRole,
      catalogScope: details.catalogScope,
      enrolled: true,
      updatedAt: new Date().toISOString(),
    });
  }

  async getCursorState(): Promise<Omit<CursorState, 'id'>> {
    const state = await this.database.syncCursors.get('global');
    const value = state ?? initialCursorState;
    return {
      revision: value.revision,
      activity: value.activity,
      conflict: value.conflict,
      deletion: value.deletion,
    };
  }

  async applyPullPage(page: PullPage): Promise<void> {
    await this.database.transaction(
      'rw',
      [
        this.database.inspectionRevisions,
        this.database.activity,
        this.database.conflicts,
        this.database.tombstones,
        this.database.syncCursors,
      ],
      async () => {
        await this.database.inspectionRevisions.bulkPut(page.revisions);
        await this.database.activity.bulkPut(page.activities);
        await this.database.conflicts.bulkPut(page.conflicts);
        await this.database.tombstones.bulkPut(page.deletions);

        const current = (await this.database.syncCursors.get('global')) ?? initialCursorState;
        await this.database.syncCursors.put({
          id: 'global',
          revision: maxCursor(current.revision, page.revisions),
          activity: maxCursor(current.activity, page.activities),
          conflict: maxCursor(current.conflict, page.conflicts),
          deletion: maxCursor(current.deletion, page.deletions),
        });
      },
    );
  }

  async enqueueOutbox(item: OutboxRecord): Promise<void> {
    await this.database.outbox.put(item);
  }

  async getOutbox(id: string): Promise<OutboxRecord | undefined> {
    return this.database.outbox.get(id);
  }

  async getAccountByUsername(username: string) {
    const normalized = username.trim().toLowerCase();
    return this.database.accounts.filter((account) => account.username.toLowerCase() === normalized).first();
  }

  async saveInspectionDraft(id: string, draft: Record<string, unknown>): Promise<void> {
    await this.database.inspectionDrafts.put({
      id,
      ...draft,
      updatedAt: new Date().toISOString(),
    });
  }

  async getInspectionDraft(id: string) {
    return this.database.inspectionDrafts.get(id);
  }

  async getDashboardCounts() {
    const [completedInspections, drafts, pendingSync, openConflicts] = await Promise.all([
      this.database.inspections.count(),
      this.database.inspectionDrafts.count(),
      this.database.outbox.where('status').anyOf('pending', 'uploading', 'pushing', 'retry').count(),
      this.database.conflicts.count(),
    ]);
    return { completedInspections, drafts, pendingSync, openConflicts };
  }

  async searchCatalog(query: string, limit = 50): Promise<CatalogRecord[]> {
    const normalizedQuery = query.trim().toLowerCase();
    const device = await this.database.device.get('current');
    const catalogScope = device?.catalogScope;
    const rows = await this.database.catalog
      .filter((row) => !catalogScope || row.catalogScope === catalogScope)
      .toArray();
    if (!normalizedQuery) return rows.slice(0, limit);

    return rows
      .filter((row) => Object.values(row).some((value) => typeof value === 'string' && value.toLowerCase().includes(normalizedQuery)))
      .slice(0, limit);
  }

  async getDueOutbox(now = new Date()): Promise<OutboxRecord[]> {
    const rows = await this.database.outbox.where('status').anyOf('pending', 'retry').toArray();
    return rows.filter((row) => row.nextAttemptAt <= now.toISOString());
  }

  async updateOutbox(id: string, changes: Partial<OutboxRecord>): Promise<void> {
    await this.database.outbox.update(id, changes);
  }

  async count(table: 'inspectionRevisions' | 'activity'): Promise<number> {
    const selected: Table<SyncRow, string> = this.database[table];
    return selected.count();
  }
}

function maxCursor(current: number, rows: SyncRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.change_cursor), current);
}
