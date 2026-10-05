import type { Table } from 'dexie';
import { PELPPalDatabase } from './database';
import type {
  ActivityFilter,
  ActivityOutcome,
  ActivityRecord,
  CatalogManifestState,
  CatalogRecord,
  CatalogRole,
  CursorState,
  DeviceRecord,
  EvidenceRecord,
  LocalEvidenceRecord,
  InspectionRecord,
  OutboxRecord,
  PullPage,
  ReportDraft,
  StoreDetails,
  StoreRecord,
  SyncRow,
} from './records';

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

  async getDevice(): Promise<DeviceRecord | undefined> {
    return this.database.device.get('current');
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
    const current = await this.database.syncCursors.get('global') ?? initialCursorState;
    validatePullPage(page, current);
    await this.database.transaction(
      'rw',
      [
        this.database.inspections,
        this.database.inspectionRevisions,
        this.database.activity,
        this.database.conflicts,
        this.database.tombstones,
        this.database.syncCursors,
      ],
      async () => {
        await this.database.inspectionRevisions.bulkPut(page.revisions);
        for (const revision of page.revisions) {
          await this.reconcileRevision(revision);
        }
        await this.database.activity.bulkPut(page.activities);
        await this.database.conflicts.bulkPut(page.conflicts);
        await this.database.tombstones.bulkPut(page.deletions);
        for (const deletion of page.deletions) {
          const inspectionId = text(deletion, ['inspection_id', 'inspectionId']);
          if (inspectionId) await this.database.inspections.delete(inspectionId);
        }

        const cursorState = (await this.database.syncCursors.get('global')) ?? initialCursorState;
        await this.database.syncCursors.put({
          id: 'global',
          revision: maxCursor(cursorState.revision, page.revisions),
          activity: maxCursor(cursorState.activity, page.activities),
          conflict: maxCursor(cursorState.conflict, page.conflicts),
          deletion: maxCursor(cursorState.deletion, page.deletions),
        });
      },
    );
  }

  private async reconcileRevision(revision: SyncRow): Promise<void> {
    const inspectionId = text(revision, ['inspection_id', 'inspectionId']);
    const payload = isRecord(revision.payload) ? revision.payload : undefined;
    const revisionNumber = numberValue(revision, ['revision']);
    if (!inspectionId || !payload || revisionNumber === undefined) return;

    const current = await this.database.inspections.get(inspectionId);
    const currentRevision = current ? numberValue(current, ['currentRevision', 'revision']) : undefined;
    if (currentRevision !== undefined && currentRevision > revisionNumber) return;

    const updatedAt = text(payload, ['updatedAt', 'updated_at', 'completedAt', 'completed_at'])
      ?? text(revision, ['server_created_at', 'client_created_at'])
      ?? current?.updatedAt
      ?? new Date(0).toISOString();
    const status = text(payload, ['status']) ?? (current ? text(current, ['status']) : undefined) ?? 'completed';
    await this.database.inspections.put({
      ...(current ?? {}),
      ...payload,
      id: inspectionId,
      status,
      currentRevision: revisionNumber,
      currentRevisionId: revision.id,
      updatedAt,
    });
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

  async getInspection(id: string): Promise<InspectionRecord | undefined> {
    return this.database.inspections.get(id);
  }

  async saveEvidenceImage(
    inspectionId: string,
    blob: Blob,
    details: Pick<EvidenceRecord, 'fileName' | 'capturedAt'>,
  ): Promise<EvidenceRecord> {
    const id = crypto.randomUUID();
    const existing = await this.database.evidence.where('inspectionId').equals(inspectionId).toArray();
    const evidence: EvidenceRecord = {
      id,
      inspectionId,
      displayOrder: existing.reduce((max, item) => Math.max(max, item.displayOrder), -1) + 1,
      capturedAt: details.capturedAt,
      fileName: details.fileName,
      mimeType: blob.type || 'application/octet-stream',
      size: blob.size,
    };
    const localEvidence: LocalEvidenceRecord = { ...evidence, blob };

    await this.database.transaction('rw', [this.database.evidence, this.database.evidenceBlobs], async () => {
      await this.database.evidence.put(evidence);
      await this.database.evidenceBlobs.put(localEvidence);
    });
    return evidence;
  }

  async listEvidenceImages(inspectionId: string): Promise<LocalEvidenceRecord[]> {
    const evidence = await this.database.evidence.where('inspectionId').equals(inspectionId).sortBy('displayOrder');
    const rows = await Promise.all(evidence.map(async (item) => this.database.evidenceBlobs.get(item.id)));
    if (rows.some((item) => !item)) {
      throw new Error(`Evidence blob is missing for inspection ${inspectionId}.`);
    }
    return rows as LocalEvidenceRecord[];
  }

  async deleteEvidenceImage(id: string): Promise<void> {
    await this.database.transaction('rw', [this.database.evidence, this.database.evidenceBlobs], async () => {
      await this.database.evidence.delete(id);
      await this.database.evidenceBlobs.delete(id);
    });
  }

  async completeInspection(id: string, inspection: Record<string, unknown>): Promise<void> {
    const completedAt = new Date().toISOString();
    const completed: InspectionRecord = {
      id,
      ...inspection,
      status: 'completed',
      completedAt,
      updatedAt: completedAt,
    };
    const activity: SyncRow = {
      id: `local-inspection-completed:${id}`,
      change_cursor: 0,
      inspection_id: id,
      event_type: 'inspection_completed',
      created_at: completedAt,
      ...inspection,
    };

    const previousRevisions = await this.database.inspectionRevisions
      .where('inspection_id')
      .equals(id)
      .toArray();
    const previousRevision = previousRevisions
      .map((row) => numberValue(row, ['revision']))
      .filter((revision): revision is number => revision !== undefined)
      .sort((left, right) => right - left)[0];
    const revisionNumber = (previousRevision ?? 0) + 1;
    const parentRevision = previousRevisions.find((row) => numberValue(row, ['revision']) === (previousRevision ?? 0));
    const revisionId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const revision: SyncRow = {
      id: revisionId,
      inspection_id: id,
      revision: revisionNumber,
      base_revision: previousRevision ?? 0,
      parent_client_revision_id: parentRevision?.id,
      payload: completed,
      edited_by_username: text(inspection, ['username']) ?? 'unknown',
      client_created_at: completedAt,
      change_cursor: 0,
    };
    const event: SyncRow = {
      id: eventId,
      inspection_id: id,
      inspection_revision_id: revisionId,
      event_type: 'inspection_completed',
      payload: activity,
      client_created_at: completedAt,
      change_cursor: 0,
    };
    const outbox: OutboxRecord = {
      id: `inspection-outbox:${id}:${revisionId}`,
      aggregateId: id,
      kind: 'inspection',
      payload: {
        inspection_id: id,
        revisions: [revision],
        events: [event],
      },
      status: 'pending',
      nextAttemptAt: completedAt,
      attempts: 0,
    };

    await this.database.transaction('rw', [
      this.database.inspections,
      this.database.inspectionDrafts,
      this.database.activity,
      this.database.inspectionRevisions,
      this.database.outbox,
    ], async () => {
      await this.database.inspections.put(completed);
      await this.database.activity.put(activity);
      await this.database.inspectionRevisions.put(revision);
      await this.database.outbox.put(outbox);
      await this.database.inspectionDrafts.delete(id);
    });
  }

  async listInspectionDrafts(limit = 10): Promise<InspectionRecord[]> {
    const drafts = await this.database.inspectionDrafts.orderBy('updatedAt').reverse().toArray();
    return drafts.slice(0, limit);
  }

  async listCompletedInspections(limit = 500): Promise<InspectionRecord[]> {
    const inspections = (await this.database.inspections.toArray())
      .filter((inspection) => inspection.status === 'completed')
      .sort((left, right) => inspectionTimestamp(right).localeCompare(inspectionTimestamp(left)));
    return inspections.slice(0, limit);
  }

  async getCatalogById(id: string): Promise<CatalogRecord | undefined> {
    return this.database.catalog.get(id);
  }

  async getCurrentStore(): Promise<StoreRecord | undefined> {
    return this.database.stores.get('current');
  }

  async saveReportDraft(draft: ReportDraft): Promise<void> {
    await this.database.reportDrafts.put({ ...draft, updatedAt: new Date().toISOString() });
  }

  async getReportDraft(storeKey: string): Promise<ReportDraft | undefined> {
    return this.database.reportDrafts.where('storeKey').equals(storeKey).first();
  }

  async saveCurrentStore(details: StoreDetails & Partial<Pick<StoreRecord, 'id' | 'updatedAt'>>): Promise<StoreRecord> {
    const current = await this.database.stores.get('current');
    const store: StoreRecord = {
      id: 'current',
      storeId: details.storeId || current?.storeId || createStoreId(details.location),
      name: details.name.trim(),
      location: details.location.trim(),
      address: optionalText(details.address),
      contactName: optionalText(details.contactName),
      contactPosition: optionalText(details.contactPosition),
      contactNumber: optionalText(details.contactNumber),
      email: optionalText(details.email),
      updatedAt: new Date().toISOString(),
    };
    await this.database.stores.put(store);
    return store;
  }

  async finishCurrentStore(): Promise<void> {
    await this.database.stores.delete('current');
  }

  async listActivity(filter: ActivityFilter = {}): Promise<ActivityRecord[]> {
    const rows = await this.database.activity.toArray();
    const activities = rows
      .map(mapActivity)
      .filter((activity) => isCompletedActivity(activity))
      .filter((activity) => filter.outcome === undefined || filter.outcome === 'all' || activity.outcome === filter.outcome)
      .filter((activity) => !filter.productType || activity.productType === filter.productType)
      .filter((activity) => !filter.storeName || activity.storeName === filter.storeName)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return activities.slice(0, filter.limit ?? 50);
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

  async getSyncStatusCounts(): Promise<{ pendingCount: number; conflictCount: number }> {
    const [pendingCount, conflictCount] = await Promise.all([
      this.database.outbox.where('status').anyOf('pending', 'uploading', 'pushing', 'retry').count(),
      this.database.conflicts.count(),
    ]);
    return { pendingCount, conflictCount };
  }

  async searchCatalog(query: string, limit = 50, ecpType?: string): Promise<CatalogRecord[]> {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedEcpType = ecpType?.trim().toLowerCase();
    const device = await this.database.device.get('current');
    const catalogScope = device?.catalogScope;
    const rows = await this.database.catalog
      .filter((row) => !catalogScope || row.catalogScope === catalogScope)
      .toArray();
    const scopedRows = normalizedEcpType
      ? rows.filter((row) => getCatalogEcpType(row)?.toLowerCase() === normalizedEcpType)
      : rows;
    if (!normalizedQuery) return scopedRows.slice(0, limit);

    return scopedRows
      .filter((row) => Object.values(row).some((value) => typeof value === 'string' && value.toLowerCase().includes(normalizedQuery)))
      .slice(0, limit);
  }

  async getCatalogEcpTypes(): Promise<string[]> {
    const device = await this.database.device.get('current');
    const catalogScope = device?.catalogScope;
    const rows = await this.database.catalog
      .filter((row) => !catalogScope || row.catalogScope === catalogScope)
      .toArray();
    return Array.from(new Set(rows.map(getCatalogEcpType).filter((value): value is string => Boolean(value))))
      .sort((left, right) => left.localeCompare(right));
  }

  async getCatalogManifestState(catalogRole: CatalogRole): Promise<CatalogManifestState | undefined> {
    const state = await this.database.syncState.get(`catalog-manifest:${catalogRole}`);
    return state as CatalogManifestState | undefined;
  }

  async replaceCatalog(
    catalogRole: CatalogRole,
    rows: CatalogRecord[],
    manifest: Omit<CatalogManifestState, 'id' | 'catalogRole' | 'updatedAt'>,
  ): Promise<void> {
    const state: CatalogManifestState = {
      id: `catalog-manifest:${catalogRole}`,
      catalogRole,
      ...manifest,
      updatedAt: new Date().toISOString(),
    };

    await this.database.transaction('rw', [this.database.catalog, this.database.syncState], async () => {
      await this.database.catalog.where('catalogScope').equals(catalogRole).delete();
      await this.database.catalog.bulkPut(rows);
      await this.database.syncState.put(state);
    });
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

function inspectionTimestamp(inspection: InspectionRecord): string {
  const value = inspection.completedAt ?? inspection.updatedAt;
  return typeof value === 'string' ? value : '';
}

const CATALOG_ECP_TYPE_KEYS = ['ecp_type', 'ecpType', 'product_type', 'productType', 'type'];

function getCatalogEcpType(row: CatalogRecord): string | undefined {
  const value = CATALOG_ECP_TYPE_KEYS
    .map((key) => row[key])
    .find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value.trim() : undefined;
}

function maxCursor(current: number, rows: SyncRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.change_cursor), current);
}

function validatePullPage(page: PullPage, current: CursorState): void {
  const streams: Array<[string, SyncRow[], number]> = [
    ['revisions', page.revisions, current.revision],
    ['activities', page.activities, current.activity],
    ['conflicts', page.conflicts, current.conflict],
    ['deletions', page.deletions, current.deletion],
  ];
  for (const [name, rows, cursor] of streams) {
    for (const [index, row] of rows.entries()) {
      if (!row.id || !Number.isInteger(row.change_cursor) || row.change_cursor <= 0) {
        throw new Error(`${name}[${index}] must contain a positive integer change_cursor.`);
      }
    }
    if (rows.length > 0 && Math.max(...rows.map((row) => row.change_cursor)) < cursor) {
      throw new Error(`${name} cursor moved backwards.`);
    }
  }
}

const ACTIVITY_FIELDS = ['payload', 'data', 'event'] as const;

function mapActivity(row: SyncRow): ActivityRecord {
  const payload = ACTIVITY_FIELDS
    .map((key) => row[key])
    .find((value): value is Record<string, unknown> => isRecord(value)) ?? {};
  const value = { ...payload, ...row };
  const eventType = text(value, ['event_type', 'eventType', 'type']);
  const outcome = normalizeOutcome(value, payload);
  return {
    id: row.id,
    inspectionId: text(value, ['inspection_id', 'inspectionId']),
    storeName: text(value, ['store_name', 'storeName']),
    location: text(value, ['location', 'store_location', 'storeLocation']),
    productType: text(value, ['product_type', 'productType', 'ecp_type', 'ecpType']),
    controlNumber: text(value, ['control_number', 'controlNumber', 'product_control_number']),
    brand: text(value, ['brand']),
    model: text(value, ['model', 'model_number', 'modelNumber']),
    outcome,
    evidenceCount: numberValue(value, ['evidence_count', 'evidenceCount']),
    remarks: text(value, ['remarks', 'notes']),
    username: text(value, ['username', 'performed_by_display_identity', 'performedByDisplayIdentity']),
    eventType,
    createdAt: text(value, ['server_created_at', 'serverCreatedAt', 'client_created_at', 'clientCreatedAt', 'created_at', 'createdAt'])
      ?? new Date(0).toISOString(),
  };
}

function isCompletedActivity(activity: ActivityRecord): boolean {
  if (!activity.eventType) return true;
  return /complete|finish|submit|final/i.test(activity.eventType)
    && !/start|draft/i.test(activity.eventType);
}

function normalizeOutcome(value: Record<string, unknown>, payload: Record<string, unknown>): ActivityOutcome {
  const raw = [value.outcome, value.compliance, value.compliance_status, payload.outcome]
    .find((candidate) => typeof candidate === 'string') as string | undefined;
  const normalized = raw?.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  if (normalized === 'compliant' || normalized === 'pass' || normalized === 'passing') return 'compliant';
  if (normalized === 'non_compliant' || normalized === 'noncompliant' || normalized === 'fail' || normalized === 'failing') return 'non_compliant';
  return 'unavailable';
}

function text(value: Record<string, unknown>, keys: string[]): string | undefined {
  const candidate = keys.map((key) => value[key]).find((item) => typeof item === 'string' && item.trim());
  return typeof candidate === 'string' ? candidate.trim() : undefined;
}

function numberValue(value: Record<string, unknown>, keys: string[]): number | undefined {
  const candidate = keys.map((key) => value[key]).find((item) => typeof item === 'number');
  return typeof candidate === 'number' ? candidate : undefined;
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function createStoreId(location: string): string {
  const prefix = location.trim().toUpperCase().slice(0, 3) || 'STR';
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${prefix}-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
