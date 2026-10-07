import type { Table } from 'dexie';
import { PELPPalDatabase } from './database';
import type {
  ActivityFilter,
  ActivityOutcome,
  ActivitySyncStatus,
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
import { buildEvidencePath } from '@/lib/evidence/validation';

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
        this.database.inspectionDrafts,
        this.database.evidence,
        this.database.evidenceBlobs,
        this.database.outbox,
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
          if (!inspectionId) continue;
          await this.database.inspections.delete(inspectionId);
          await this.database.inspectionDrafts.delete(inspectionId);
          await this.database.inspectionRevisions.where('inspection_id').equals(inspectionId).delete();
          await this.database.activity.where('inspection_id').equals(inspectionId).delete();
          const evidence = await this.database.evidence.where('inspectionId').equals(inspectionId).toArray();
          await this.database.evidence.where('inspectionId').equals(inspectionId).delete();
          await Promise.all(evidence.map((item) => this.database.evidenceBlobs.delete(item.id)));
          const outboxRows = await this.database.outbox.where('aggregateId').equals(inspectionId).toArray();
          await Promise.all(outboxRows.map((item) => this.database.outbox.delete(item.id)));
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
      syncStatus: 'local',
    };
    const localEvidence: LocalEvidenceRecord = { ...evidence, blob };

    await this.database.transaction('rw', [this.database.evidence, this.database.evidenceBlobs], async () => {
      await this.database.evidence.put(evidence);
      await this.database.evidenceBlobs.put(localEvidence);
    });
    return evidence;
  }

  async replaceEvidenceImage(
    id: string,
    blob: Blob,
    details: Pick<EvidenceRecord, 'fileName' | 'capturedAt'>,
  ): Promise<EvidenceRecord> {
    const existing = await this.database.evidence.get(id);
    if (!existing) throw new Error('The evidence image was not found on this device.');
    const replacement: EvidenceRecord = {
      ...existing,
      fileName: details.fileName,
      capturedAt: details.capturedAt,
      mimeType: blob.type || 'application/octet-stream',
      size: blob.size,
      remotePath: undefined,
      sha256: undefined,
      syncStatus: 'local',
    };
    await this.database.transaction('rw', [this.database.evidence, this.database.evidenceBlobs], async () => {
      await this.database.evidence.put(replacement);
      await this.database.evidenceBlobs.put({ ...replacement, blob });
    });
    return replacement;
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
    const device = await this.getDevice();
    const previousInspection = await this.database.inspections.get(id);
    const username = text(inspection, ['username', 'updatedBy']) ?? 'unknown';
    const evidence = await this.database.evidence.where('inspectionId').equals(id).sortBy('displayOrder');
    const evidencePayload = await Promise.all(evidence.map(async (item) => {
      const local = await this.database.evidenceBlobs.get(item.id);
      if (!local) throw new Error(`Evidence blob is missing for inspection ${id}.`);
      return {
        id: item.id,
        product_control_number: text(inspection, ['controlNumber', 'control_number', 'product_control_number']) ?? '',
        original_file_name: item.fileName,
        export_file_name: item.fileName,
        mime_type: item.mimeType,
        size_bytes: item.size,
        captured_at: item.capturedAt,
        display_order: item.displayOrder,
        blob: local.blob,
      };
    }));
    const completed: InspectionRecord = {
      id,
      ...inspection,
      organizationId: device?.organizationId,
      status: 'completed',
      createdAt: textValue(previousInspection?.createdAt) || completedAt,
      createdBy: textValue(previousInspection?.createdBy) || username,
      updatedBy: username,
      completedAt,
      updatedAt: completedAt,
    };
    const previousRevisions = await this.database.inspectionRevisions
      .where('inspection_id')
      .equals(id)
      .toArray();
    const activity: SyncRow = {
      id: `local-inspection-completed:${id}`,
      change_cursor: 0,
      inspection_id: id,
      event_type: 'inspection_completed',
      created_at: completedAt,
      updated_by: username,
      revision: previousRevisions.length + 1,
      ...inspection,
    };

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
      payload: { ...completed, evidence: evidencePayload },
      edited_by_username: username,
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
      this.database.evidence,
    ], async () => {
      await this.database.inspections.put(completed);
      await Promise.all(evidence.map((item) => this.database.evidence.update(item.id, { syncStatus: 'pending' })));
      await this.database.activity.put(activity);
      await this.database.inspectionRevisions.put(revision);
      await this.database.outbox.put(outbox);
      await this.database.inspectionDrafts.delete(id);
    });
  }

  async markInspectionEvidenceSynced(inspectionId: string, revisionId?: string): Promise<void> {
    const device = await this.getDevice();
    if (!device?.organizationId) return;
    const evidence = await this.database.evidence.where('inspectionId').equals(inspectionId).toArray();
    await Promise.all(evidence.map((item) => this.database.evidence.update(item.id, {
      syncStatus: 'synced',
      remotePath: buildEvidencePath(device.organizationId!, inspectionId, item.id, revisionId),
    })));
  }

  async deleteInspection(id: string): Promise<void> {
    const inspection = await this.database.inspections.get(id);
    const draft = await this.database.inspectionDrafts.get(id);
    const controlNumber = text(inspection ?? {}, ['controlNumber', 'control_number', 'product_control_number']) ?? '';
    const evidence = await this.database.evidence.where('inspectionId').equals(id).toArray();
    const evidenceBlobs = await Promise.all(evidence.map(async (item) => this.database.evidenceBlobs.get(item.id)));
    const revisions = await this.database.inspectionRevisions.where('inspection_id').equals(id).toArray();
    const activities = await this.database.activity.where('inspection_id').equals(id).toArray();
    const outboxRows = await this.database.outbox.where('aggregateId').equals(id).toArray();
    const device = await this.getDevice();
    const storagePaths = device?.organizationId
      ? evidence.map((item) => item.remotePath ?? buildEvidencePath(device.organizationId!, id, item.id))
      : [];

    await this.database.transaction('rw', [
      this.database.inspections,
      this.database.inspectionDrafts,
      this.database.inspectionRevisions,
      this.database.activity,
      this.database.evidence,
      this.database.evidenceBlobs,
      this.database.outbox,
      this.database.syncState,
    ], async () => {
      await this.database.syncState.put({
        id: deletedInspectionBackupKey(id),
        inspection,
        draft,
        evidence,
        evidenceBlobs,
        revisions,
        activities,
        outboxRows,
        deletedAt: new Date().toISOString(),
      });
      await this.database.inspections.delete(id);
      await this.database.inspectionDrafts.delete(id);
      await this.database.inspectionRevisions.where('inspection_id').equals(id).delete();
      await this.database.activity.where('inspection_id').equals(id).delete();
      await this.database.activity.delete(`local-inspection-completed:${id}`);
      await this.database.evidence.where('inspectionId').equals(id).delete();
      await Promise.all(evidence.map((item) => this.database.evidenceBlobs.delete(item.id)));
      await Promise.all(outboxRows.map((item) => this.database.outbox.delete(item.id)));
      const deletedAt = new Date().toISOString();
      await this.database.outbox.put({
        id: `inspection-delete-outbox:${id}:${crypto.randomUUID()}`,
        aggregateId: id,
        kind: 'inspection_delete',
        payload: {
          inspection_id: id,
          product_control_number: controlNumber,
          storage_paths: storagePaths,
        },
        status: 'pending',
        nextAttemptAt: deletedAt,
        attempts: 0,
      });
    });
  }

  async restoreDeletedInspection(id: string): Promise<void> {
    const backup = await this.database.syncState.get(deletedInspectionBackupKey(id));
    const deletedOutbox = await this.database.outbox
      .where('aggregateId')
      .equals(id)
      .filter((item) => item.kind === 'inspection_delete' && (item.status === 'pending' || item.status === 'retry'))
      .first();
    if (!backup || !deletedOutbox) {
      throw new Error('This inspection can no longer be undone because its deletion is already synced.');
    }

    const inspection = isRecord(backup.inspection) ? backup.inspection as InspectionRecord : undefined;
    const draft = isRecord(backup.draft) ? backup.draft as InspectionRecord : undefined;
    const evidence = Array.isArray(backup.evidence) ? backup.evidence.filter(isRecord) as unknown as EvidenceRecord[] : [];
    const evidenceBlobs = Array.isArray(backup.evidenceBlobs) ? backup.evidenceBlobs.filter(isRecord) as unknown as LocalEvidenceRecord[] : [];
    const revisions = Array.isArray(backup.revisions) ? backup.revisions.filter(isRecord) as unknown as SyncRow[] : [];
    const activities = Array.isArray(backup.activities) ? backup.activities.filter(isRecord) as unknown as SyncRow[] : [];
    const outboxRows = Array.isArray(backup.outboxRows) ? backup.outboxRows.filter(isRecord) as unknown as OutboxRecord[] : [];

    await this.database.transaction('rw', [
      this.database.inspections,
      this.database.inspectionDrafts,
      this.database.inspectionRevisions,
      this.database.activity,
      this.database.evidence,
      this.database.evidenceBlobs,
      this.database.outbox,
      this.database.syncState,
    ], async () => {
      if (inspection) await this.database.inspections.put(inspection);
      if (draft) await this.database.inspectionDrafts.put(draft);
      if (revisions.length) await this.database.inspectionRevisions.bulkPut(revisions);
      if (activities.length) await this.database.activity.bulkPut(activities);
      if (evidence.length) await this.database.evidence.bulkPut(evidence);
      if (evidenceBlobs.length) await this.database.evidenceBlobs.bulkPut(evidenceBlobs);
      await this.database.outbox.delete(deletedOutbox.id);
      if (outboxRows.length) {
        await this.database.outbox.bulkPut(outboxRows.map((item) => ({
          ...item,
          status: 'pending' as const,
          nextAttemptAt: new Date().toISOString(),
        })));
      } else if (revisions.length || activities.length) {
        await this.database.outbox.put({
          id: `inspection-restore-outbox:${id}:${crypto.randomUUID()}`,
          aggregateId: id,
          kind: 'inspection',
          payload: { inspection_id: id, revisions, events: activities },
          status: 'pending',
          nextAttemptAt: new Date().toISOString(),
          attempts: 0,
        });
      }
      await this.database.syncState.delete(deletedInspectionBackupKey(id));
    });
  }

  async listInspectionDrafts(limit = 10): Promise<InspectionRecord[]> {
    const drafts = await this.database.inspectionDrafts.orderBy('updatedAt').reverse().toArray();
    return drafts.slice(0, limit);
  }

  async listCompletedInspections(limit?: number): Promise<InspectionRecord[]> {
    const inspections = (await this.database.inspections.toArray())
      .filter((inspection) => inspection.status === 'completed')
      .sort((left, right) => inspectionTimestamp(right).localeCompare(inspectionTimestamp(left)));
    return limit === undefined ? inspections : inspections.slice(0, limit);
  }

  async findDuplicateCompletedInspection(input: {
    inspectionId?: string;
    storeId?: string;
    controlNumber?: string;
    model?: string;
    username?: string;
  }): Promise<InspectionRecord | undefined> {
    const normalizedControlNumber = normalizeIdentity(input.controlNumber);
    const normalizedModel = normalizeIdentity(input.model);
    const normalizedUsername = normalizeIdentity(input.username);
    if (!input.storeId || !normalizedControlNumber || !normalizedUsername) return undefined;

    const inspections = await this.database.inspections.toArray();
    return inspections.find((inspection) => inspection.id !== input.inspectionId
      && inspection.status === 'completed'
      && normalizeIdentity(textValue(inspection.storeId)) === normalizeIdentity(input.storeId)
      && normalizeIdentity(textValue(inspection.controlNumber)) === normalizedControlNumber
      && (!normalizedModel || normalizeIdentity(textValue(inspection.model)) === normalizedModel)
      && normalizeIdentity(textValue(inspection.username)) === normalizedUsername);
  }

  async getCatalogById(id: string): Promise<CatalogRecord | undefined> {
    return this.database.catalog.get(id);
  }

  async getCatalogByIds(ids: string[]): Promise<CatalogRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.database.catalog.bulkGet(ids);
    return rows.filter((row): row is CatalogRecord => Boolean(row));
  }

  async getCurrentStore(): Promise<StoreRecord | undefined> {
    return this.database.stores.get('current');
  }

  async listSavedStores(): Promise<StoreRecord[]> {
    const current = await this.getCurrentStore();
    return this.database.stores
      .filter((store) => store.id !== 'current')
      .filter((store) => store.storeId !== current?.storeId)
      .sortBy('updatedAt');
  }

  async switchCurrentStore(storeId: string): Promise<StoreRecord> {
    const saved = await this.database.stores.get(storeProfileKey(storeId));
    if (!saved) throw new Error(`Saved store ${storeId} was not found on this device.`);
    const current: StoreRecord = { ...saved, id: 'current', updatedAt: new Date().toISOString() };
    await this.database.stores.put(current);
    return current;
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
    await this.database.stores.bulkPut([store, { ...store, id: storeProfileKey(store.storeId) }]);
    return store;
  }

  async finishCurrentStore(): Promise<void> {
    await this.database.stores.delete('current');
  }

  async deleteSavedStore(storeId: string): Promise<void> {
    await this.database.stores.delete(storeProfileKey(storeId));
    const current = await this.database.stores.get('current');
    if (current?.storeId === storeId) await this.database.stores.delete('current');
  }

  async listActivity(filter: ActivityFilter = {}): Promise<ActivityRecord[]> {
    const [rows, outboxRows] = await Promise.all([
      this.database.activity.toArray(),
      this.database.outbox.toArray(),
    ]);
    const outboxByInspection = new Map<string, OutboxRecord['status']>();
    for (const row of outboxRows) {
      const previous = outboxByInspection.get(row.aggregateId);
      if (!previous || outboxStatusPriority(row.status) > outboxStatusPriority(previous)) {
        outboxByInspection.set(row.aggregateId, row.status);
      }
    }
    const activities = rows
      .map(mapActivity)
      .map((activity) => ({ ...activity, syncStatus: (activity.inspectionId ? outboxByInspection.get(activity.inspectionId) ?? 'remote' : 'remote') as ActivitySyncStatus }))
      .filter((activity) => isCompletedActivity(activity))
      .filter((activity) => filter.outcome === undefined || filter.outcome === 'all' || activity.outcome === filter.outcome)
      .filter((activity) => !filter.productType || activity.productType === filter.productType)
      .filter((activity) => !filter.storeName || activity.storeName === filter.storeName)
      .filter((activity) => !filter.inspector || activity.username === filter.inspector)
      .filter((activity) => !filter.syncStatus || filter.syncStatus === 'all' || activity.syncStatus === filter.syncStatus)
      .filter((activity) => !filter.evidence || filter.evidence === 'all' || (filter.evidence === 'with' ? (activity.evidenceCount ?? 0) > 0 : (activity.evidenceCount ?? 0) === 0))
      .filter((activity) => !filter.dateFrom || activity.createdAt.slice(0, 10) >= filter.dateFrom)
      .filter((activity) => !filter.dateTo || activity.createdAt.slice(0, 10) <= filter.dateTo)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return activities.slice(0, filter.limit ?? 50);
  }

  async getDashboardCounts() {
    const [completedInspections, drafts, pendingSync, openConflicts, blockedOutbox] = await Promise.all([
      this.database.inspections.count(),
      this.database.inspectionDrafts.count(),
      this.database.outbox.where('status').anyOf('pending', 'uploading', 'pushing', 'retry').count(),
      this.database.conflicts.filter((conflict) => conflict.status === 'open').count(),
      this.database.outbox.where('status').equals('conflict').count(),
    ]);
    return { completedInspections, drafts, pendingSync, openConflicts: openConflicts + blockedOutbox };
  }

  async getSyncStatusCounts(): Promise<{ pendingCount: number; conflictCount: number; failedCount: number }> {
    const [pendingCount, openConflicts, blockedOutbox, failedCount] = await Promise.all([
      this.database.outbox.where('status').anyOf('pending', 'uploading', 'pushing', 'retry').count(),
      this.database.conflicts.filter((conflict) => conflict.status === 'open').count(),
      this.database.outbox.where('status').equals('conflict').count(),
      this.database.outbox.where('status').equals('failed').count(),
    ]);
    return { pendingCount, conflictCount: openConflicts + blockedOutbox, failedCount };
  }

  async listOpenConflicts(limit = 20): Promise<SyncRow[]> {
    const conflicts = (await this.database.conflicts.toArray())
      .filter((conflict) => conflict.status === 'open')
      .sort((left, right) => right.change_cursor - left.change_cursor);
    return conflicts.slice(0, limit);
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

  async retryFailedOutbox(): Promise<number> {
    const rows = await this.database.outbox.where('status').anyOf('failed', 'retry').toArray();
    const now = new Date().toISOString();
    await Promise.all(rows.map((row) => this.database.outbox.update(row.id, {
      status: 'retry',
      nextAttemptAt: now,
      lastError: undefined,
      updatedAt: now,
    })));
    return rows.length;
  }

  async recoverStaleOutbox(staleBefore = new Date(Date.now() - 15 * 60 * 1000)): Promise<void> {
    const cutoff = staleBefore.toISOString();
    const stale = await this.database.outbox
      .where('status')
      .anyOf('uploading', 'pushing')
      .filter((row) => String(row.updatedAt ?? row.nextAttemptAt) <= cutoff)
      .toArray();
    await Promise.all(stale.map((row) => this.database.outbox.update(row.id, {
      status: 'retry',
      nextAttemptAt: new Date().toISOString(),
      lastError: { code: 'RECOVERED_INTERRUPTED_SYNC', message: 'Recovered after an interrupted browser sync.' },
      updatedAt: new Date().toISOString(),
    })));
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

function storeProfileKey(storeId: string): string {
  return `store:${storeId}`;
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
    updatedBy: text(value, ['updated_by', 'updatedBy', 'edited_by_username', 'editedByUsername']),
    revision: numberValue(value, ['revision']),
    origin: text(value, ['origin']) === 'local' ? 'local' : 'remote',
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

function normalizeIdentity(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? '';
}

function outboxStatusPriority(status: OutboxRecord['status']): number {
  return ({ conflict: 6, failed: 5, retry: 4, pending: 3, pushing: 2, uploading: 1, synced: 0 } satisfies Record<OutboxRecord['status'], number>)[status];
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function createStoreId(location: string): string {
  const prefix = location.trim().toUpperCase().slice(0, 3) || 'STR';
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${prefix}-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function deletedInspectionBackupKey(id: string): string {
  return `deleted-inspection:${id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
