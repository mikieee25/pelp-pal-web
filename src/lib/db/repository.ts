import { liveQuery, type Table } from 'dexie';
import { PELPPalDatabase } from './database';
import type {
  ActivityFilter,
  ActivityFilterOptions,
  ActivityPage,
  ActivityPageCursor,
  ActivityPageFilter,
  ActivitySyncStatus,
  ActivityRecord,
  AccountScope,
  CatalogManifestState,
  CatalogRecord,
  CatalogRole,
  CursorState,
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
import { deriveInspectionOutcome } from '@/lib/inspection-outcome';
import {
  decodeEvidenceBlob,
  encodeEvidenceBlob,
  previewTransferBundle,
  type TransferBundle,
  type TransferExportMode,
  type TransferImportPlan,
  type TransferMergeResult,
} from '@/lib/transfer/transfer-codec';

const initialCursorState: CursorState = {
  id: 'global',
  revision: 0,
  activity: 0,
  conflict: 0,
  deletion: 0,
};

export type TransferStoreOption = {
  key: string;
  name: string;
  location?: string;
  inspectionCount: number;
};

export class LocalRepository {
  private accountScope?: AccountScope;
  private catalogRole?: CatalogRole;

  constructor(private readonly database: PELPPalDatabase) {}

  subscribeChanges(listener: () => void): () => void {
    const subscription = liveQuery(() => Promise.all([
      this.database.inspections.count(), this.database.activity.count(),
      this.database.outbox.count(), this.database.catalog.count(),
      this.database.syncState.count(),
    ])).subscribe({ next: listener, error: (error) => console.error('Local data subscription failed', error) });
    return () => subscription.unsubscribe();
  }

  setAccountScope(scope: AccountScope): void {
    this.accountScope = scope;
  }

  getAccountScope(): AccountScope | undefined {
    return this.accountScope;
  }

  setCatalogRole(catalogRole: CatalogRole): void {
    this.catalogRole = catalogRole;
  }

  async getCursorState(scope?: AccountScope): Promise<Omit<CursorState, 'id'>> {
    const activeScope = scope ?? this.accountScope;
    const state = await this.database.syncCursors.get(cursorStateId(activeScope));
    const value = state ?? initialCursorState;
    return {
      revision: value.revision,
      activity: value.activity,
      conflict: value.conflict,
      deletion: value.deletion,
    };
  }

  async applyPullPage(page: PullPage, scope?: AccountScope): Promise<void> {
    const activeScope = scope ?? this.accountScope;
    const cursorId = cursorStateId(activeScope);
    const current = await this.database.syncCursors.get(cursorId) ?? { ...initialCursorState, id: cursorId };
    validatePullPage(page, current);
    const scopedPage = activeScope ? {
      revisions: page.revisions.map((row) => ({ ...row, accountScopeKey: activeScope.key })),
      activities: page.activities.map((row) => ({ ...row, accountScopeKey: activeScope.key })),
      conflicts: page.conflicts.map((row) => ({ ...row, accountScopeKey: activeScope.key })),
      deletions: page.deletions.map((row) => ({ ...row, accountScopeKey: activeScope.key })),
    } : page;
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
        await this.database.inspectionRevisions.bulkPut(scopedPage.revisions);
        for (const revision of scopedPage.revisions) {
          await this.reconcileRevision(revision);
        }
        await this.database.activity.bulkPut(scopedPage.activities);
        await this.database.conflicts.bulkPut(scopedPage.conflicts);
        await this.database.tombstones.bulkPut(scopedPage.deletions);
        for (const deletion of scopedPage.deletions) {
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

        const cursorState = (await this.database.syncCursors.get(cursorId)) ?? { ...initialCursorState, id: cursorId };
        await this.database.syncCursors.put({
          id: cursorId,
          accountScopeKey: activeScope?.key,
          revision: maxCursor(cursorState.revision, scopedPage.revisions),
          activity: maxCursor(cursorState.activity, scopedPage.activities),
          conflict: maxCursor(cursorState.conflict, scopedPage.conflicts),
          deletion: maxCursor(cursorState.deletion, scopedPage.deletions),
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
      accountScopeKey: revision.accountScopeKey,
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

  async listInspections(scope: AccountScope, limit?: number): Promise<InspectionRecord[]> {
    const inspections = (await this.database.inspections.toArray())
      .filter((inspection) => inspection.accountScopeKey === scope.key && inspection.status === 'completed')
      .sort((left, right) => inspectionTimestamp(right).localeCompare(inspectionTimestamp(left)));
    return limit === undefined ? inspections : inspections.slice(0, limit);
  }

  async getPendingOutbox(scope: AccountScope, now = new Date()): Promise<OutboxRecord[]> {
    const nowValue = now.toISOString();
    return (await this.database.outbox.where('status').anyOf('pending', 'retry').toArray())
      .filter((row) => row.accountScopeKey === scope.key && row.nextAttemptAt <= nowValue);
  }

  async listTransferStores(): Promise<TransferStoreOption[]> {
    const scope = this.requireAccountScope();
    const groups = new Map<string, TransferStoreOption>();
    const inspections = await this.database.inspections.toArray();
    for (const inspection of inspections) {
      if (inspection.accountScopeKey !== scope.key) continue;
      const name = text(inspection, ['storeName', 'store_name']) ?? 'Store not recorded';
      const location = text(inspection, ['location', 'storeLocation', 'store_location']);
      const key = transferStoreKey(name, location);
      const current = groups.get(key);
      if (current) {
        current.inspectionCount += 1;
      } else {
        groups.set(key, { key, name, location, inspectionCount: 1 });
      }
    }
    return Array.from(groups.values()).sort((left, right) => left.name.localeCompare(right.name) || (left.location ?? '').localeCompare(right.location ?? ''));
  }

  async exportTransferBundle(mode: TransferExportMode = 'pending', storeKeys?: string[]): Promise<TransferBundle> {
    const scope = this.requireAccountScope();
    const allInspections = (await this.database.inspections.toArray()).filter((row) => row.accountScopeKey === scope.key);
    const allRevisions = (await this.database.inspectionRevisions.toArray()).filter((row) => row.accountScopeKey === scope.key);
    const allActivities = (await this.database.activity.toArray()).filter((row) => row.accountScopeKey === scope.key);
    const allEvidence = (await this.database.evidence.toArray()).filter((row) => row.accountScopeKey === scope.key);
    const allOutbox = (await this.database.outbox.toArray()).filter((row) => row.accountScopeKey === scope.key);
    const selectedStores = storeKeys ? new Set(storeKeys) : undefined;
    const storeMatches = (row: InspectionRecord): boolean => {
      if (!selectedStores) return true;
      const name = text(row, ['storeName', 'store_name']) ?? 'Store not recorded';
      const location = text(row, ['location', 'storeLocation', 'store_location']);
      return selectedStores.has(transferStoreKey(name, location));
    };
    const storeInspectionIds = selectedStores
      ? new Set(allInspections.filter(storeMatches).map((row) => row.id))
      : undefined;
    const scopedOutbox = storeInspectionIds
      ? allOutbox.filter((row) => storeInspectionIds.has(row.aggregateId))
      : allOutbox;
    const selectedOutbox = mode === 'pending'
      ? scopedOutbox.filter((row) => row.status === 'pending' || row.status === 'retry')
      : scopedOutbox;
    const selectedInspectionIds = mode === 'pending'
      ? new Set(selectedOutbox.map((row) => row.aggregateId))
      : undefined;
    const inspections = allInspections.filter((row) => {
      if (selectedInspectionIds && !selectedInspectionIds.has(row.id)) return false;
      return storeMatches(row);
    });
    const inspectionIds = new Set(inspections.map((row) => row.id));
    const revisions = allRevisions.filter((row) => {
      const inspectionId = text(row, ['inspection_id', 'inspectionId']);
      return inspectionId ? inspectionIds.has(inspectionId) : false;
    });
    const activities = allActivities.filter((row) => {
      const inspectionId = text(row, ['inspection_id', 'inspectionId']);
      return inspectionId ? inspectionIds.has(inspectionId) : false;
    });
    const evidence = allEvidence.filter((row) => inspectionIds.has(row.inspectionId));
    const evidenceBlobs = mode === 'records' ? [] : await Promise.all(evidence.map(async (item) => {
      const local = await this.database.evidenceBlobs.get(item.id);
      if (!local) throw new Error(`Evidence blob is missing for inspection ${item.inspectionId}.`);
      return encodeEvidenceBlob(new Uint8Array(await local.blob.arrayBuffer()), {
        id: item.id,
        evidenceId: item.id,
        fileName: item.fileName,
        mimeType: item.mimeType,
      });
    }));

    return {
      format: 'pelp-pal-transfer',
      schemaVersion: 1,
      exportMode: mode,
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
      organizationId: scope.organizationId,
      sourceAccountId: scope.accountId,
      records: {
        inspections: inspections.map((row) => sanitizeTransferValue(row)),
        revisions: revisions.map((row) => sanitizeTransferValue(row)),
        activities: activities.map((row) => sanitizeTransferValue(row)),
        evidence: evidence.map((row) => sanitizeTransferValue(row)),
        evidenceBlobs,
        outbox: selectedOutbox
          .filter((row) => mode !== 'pending' || row.status === 'pending' || row.status === 'retry')
          .map((row) => sanitizeTransferValue(row)),
      },
    };
  }

  async previewTransferMerge(bundle: TransferBundle): Promise<TransferImportPlan> {
    const scope = this.requireAccountScope();
    if (bundle.organizationId !== scope.organizationId) throw new Error('This recovery file belongs to another organization.');
    return this.planTransferMerge(bundle);
  }

  async mergeTransferBundle(bundle: TransferBundle): Promise<TransferMergeResult> {
    const scope = this.requireAccountScope();
    if (bundle.organizationId !== scope.organizationId) throw new Error('This recovery file belongs to another organization.');
    const plan = await this.planTransferMerge(bundle);
    const now = new Date().toISOString();
    const evidenceById = new Map<string, Blob>();
    for (const encoded of bundle.records.evidenceBlobs) {
      const bytes = await decodeEvidenceBlob(encoded);
      evidenceById.set(encoded.evidenceId, new Blob([bytes.buffer as ArrayBuffer], { type: encoded.mimeType }));
    }
    const localOutbox = await this.database.outbox.toArray();
    const localInspections = await this.database.inspections.toArray();
    const decisions = new Map(bundle.records.inspections.map((inspection) => [
      inspection.id,
      transferDecision(inspection, localInspections.find((row) => row.id === inspection.id), bundle.records.revisions),
    ]));
    const importInspectionIds = new Set(bundle.records.inspections
      .filter((row) => decisions.get(row.id) === 'import').map((row) => row.id));

    await this.database.transaction('rw', [
      this.database.inspections,
      this.database.inspectionRevisions,
      this.database.activity,
      this.database.evidence,
      this.database.evidenceBlobs,
      this.database.outbox,
      this.database.conflicts,
    ], async () => {
      for (const inspection of bundle.records.inspections) {
        if (decisions.get(inspection.id) !== 'import') continue;
        await this.database.inspections.put({
          ...inspection,
          organizationId: scope.organizationId,
          accountScopeKey: scope.key,
        } as unknown as InspectionRecord);
      }
      for (const revision of bundle.records.revisions) {
        const inspectionId = text(revision, ['inspection_id', 'inspectionId']);
        if (!inspectionId || !importInspectionIds.has(inspectionId)) continue;
        await this.database.inspectionRevisions.put({
          ...revision,
          change_cursor: 0,
          accountScopeKey: scope.key,
          payload: restoreEvidencePayload(revision.payload, evidenceById),
        } as unknown as SyncRow);
      }
      for (const activity of bundle.records.activities) {
        const inspectionId = text(activity, ['inspection_id', 'inspectionId']);
        if (!inspectionId || !importInspectionIds.has(inspectionId)) continue;
        await this.database.activity.put({ ...activity, change_cursor: 0, accountScopeKey: scope.key } as SyncRow);
      }
      for (const evidence of bundle.records.evidence) {
        if (!importInspectionIds.has(String(evidence.inspectionId ?? ''))) continue;
        await this.database.evidence.put({ ...evidence, accountScopeKey: scope.key } as EvidenceRecord);
        const evidenceId = typeof evidence.id === 'string' ? evidence.id : '';
        const blob = evidenceById.get(evidenceId);
        if (blob) await this.database.evidenceBlobs.put({ ...evidence, accountScopeKey: scope.key, blob } as LocalEvidenceRecord);
      }
      for (const row of bundle.records.outbox) {
        if (row.status !== 'pending' && row.status !== 'retry') continue;
        if (row.kind !== 'inspection_delete' && !importInspectionIds.has(row.aggregateId)) continue;
        if (row.kind === 'inspection_delete' && decisions.has(row.aggregateId) && decisions.get(row.aggregateId) !== 'import') continue;
        const existing = localOutbox.find((item) => item.id === row.id);
        if (existing) continue;
        const payload = restoreEvidencePayload(row.payload, evidenceById);
        await this.database.outbox.put({
          ...row,
          status: 'pending',
          nextAttemptAt: now,
          attempts: 0,
          accountScopeKey: scope.key,
          payload,
        } as unknown as OutboxRecord);
      }
      for (const inspection of bundle.records.inspections.filter((row) => decisions.get(row.id) === 'conflict')) {
        await this.database.conflicts.put({
          id: `transfer-conflict:${inspection.id}`,
          inspection_id: inspection.id,
          status: 'open',
          source: 'json-import',
          payload: inspection,
          change_cursor: 0,
          accountScopeKey: scope.key,
        });
      }
    });

    return { ...plan, completedAt: now };
  }

  private async planTransferMerge(bundle: TransferBundle): Promise<TransferImportPlan> {
    if (bundle.exportMode === 'records' && bundle.records.outbox.some((row) => containsEvidencePayload(row.payload))) {
      throw new Error('This records-only file cannot queue inspections that require evidence images. Export the full recovery file instead.');
    }
    const localInspections = await this.database.inspections.toArray();
    let importedCount = 0;
    let skippedCount = 0;
    let conflictCount = 0;
    for (const inspection of bundle.records.inspections) {
      const decision = transferDecision(
        inspection,
        localInspections.find((row) => row.id === inspection.id),
        bundle.records.revisions,
      );
      if (decision === 'import') importedCount += 1;
      else if (decision === 'skip') skippedCount += 1;
      else conflictCount += 1;
    }
    const existingEvidence = await this.database.evidence.toArray();
    const duplicateEvidenceCount = bundle.records.evidence.filter((item) => {
      const existing = existingEvidence.find((row) => row.id === item.id);
      return existing && existing.sha256 && existing.sha256 === item.sha256;
    }).length;
    return {
      ...previewTransferBundle(bundle),
      importedCount,
      skippedCount,
      conflictCount,
      duplicateEvidenceCount,
    };
  }

  async getUnscopedRecordCounts(): Promise<{ inspections: number; outbox: number }> {
    const [inspections, outbox] = await Promise.all([
      this.database.inspections.filter((row) => !row.accountScopeKey).count(),
      this.database.outbox.filter((row) => !row.accountScopeKey).count(),
    ]);
    return { inspections, outbox };
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
    const inspection = await this.database.inspections.get(id);
    return inspection && this.isInActiveScope(inspection) ? inspection : undefined;
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
      accountScopeKey: this.accountScope?.key,
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
    const accountScope = this.accountScope;
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
      organizationId: accountScope?.organizationId,
      accountScopeKey: accountScope?.key,
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
      ...inspection,
      id: `local-inspection-completed:${id}`,
      change_cursor: 0,
      inspection_id: id,
      event_type: 'inspection_completed',
      created_at: completedAt,
      updated_by: username,
      revision: previousRevisions.length + 1,
      accountScopeKey: accountScope?.key,
      origin: 'local',
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
      accountScopeKey: accountScope?.key,
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
      accountScopeKey: accountScope?.key,
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
      accountScopeKey: accountScope?.key,
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
      const existingOutbox = await this.database.outbox.where('aggregateId').equals(id).toArray();
      await mergeInspectionOutboxRows(this.database, id, existingOutbox, outbox);
      await this.database.inspectionDrafts.delete(id);
    });
  }

  async markInspectionEvidenceSynced(inspectionId: string, revisionId?: string): Promise<void> {
    const organizationId = this.accountScope?.organizationId;
    if (!organizationId) return;
    const evidence = await this.database.evidence.where('inspectionId').equals(inspectionId).toArray();
    await Promise.all(evidence.map((item) => this.database.evidence.update(item.id, {
      syncStatus: 'synced',
      remotePath: buildEvidencePath(organizationId, inspectionId, item.id, revisionId),
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
    const hasReachedServer = revisions.some((row) => row.change_cursor > 0)
      || outboxRows.some((row) => row.kind === 'inspection' && row.status === 'synced');
    const organizationId = this.accountScope?.organizationId;
    const storagePaths = organizationId
      ? evidence.map((item) => item.remotePath ?? buildEvidencePath(organizationId, id, item.id))
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
      if (hasReachedServer) {
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
      }
    });
  }

  async restoreDeletedInspection(id: string): Promise<void> {
    const backup = await this.database.syncState.get(deletedInspectionBackupKey(id));
    const deletedOutbox = await this.database.outbox
      .where('aggregateId')
      .equals(id)
      .filter((item) => item.kind === 'inspection_delete' && (item.status === 'pending' || item.status === 'retry'))
      .first();
    const backupOutboxRows = backup && Array.isArray(backup.outboxRows)
      ? backup.outboxRows.filter(isRecord) as unknown as OutboxRecord[]
      : [];
    const canRestoreNeverSynced = backupOutboxRows.some((item) => item.kind === 'inspection' && item.status !== 'synced');
    if (!backup || (!deletedOutbox && !canRestoreNeverSynced)) {
      throw new Error('This inspection can no longer be undone because its deletion is already synced.');
    }

    const inspection = isRecord(backup.inspection) ? backup.inspection as InspectionRecord : undefined;
    const draft = isRecord(backup.draft) ? backup.draft as InspectionRecord : undefined;
    const evidence = Array.isArray(backup.evidence) ? backup.evidence.filter(isRecord) as unknown as EvidenceRecord[] : [];
    const evidenceBlobs = Array.isArray(backup.evidenceBlobs) ? backup.evidenceBlobs.filter(isRecord) as unknown as LocalEvidenceRecord[] : [];
    const revisions = Array.isArray(backup.revisions) ? backup.revisions.filter(isRecord) as unknown as SyncRow[] : [];
    const activities = Array.isArray(backup.activities) ? backup.activities.filter(isRecord) as unknown as SyncRow[] : [];
    const outboxRows = backupOutboxRows;

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
      if (deletedOutbox) await this.database.outbox.delete(deletedOutbox.id);
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
      .filter((inspection) => inspection.status === 'completed' && this.isInActiveScope(inspection))
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

    const inspections = (await this.database.inspections.toArray()).filter((inspection) => this.isInActiveScope(inspection));
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
    const page = await this.listActivityPage(filter);
    return page.rows;
  }

  async listActivityFilterOptions(filter: ActivityFilter = {}): Promise<ActivityFilterOptions> {
    const [storeActivities, inspectorActivities, productTypeActivities] = await Promise.all([
      this.readActivity({ ...filter, storeName: undefined }),
      this.readActivity({ ...filter, inspector: undefined }),
      this.readActivity({ ...filter, productType: undefined }),
    ]);
    return {
      storeNames: sortedUnique(storeActivities.map((activity) => activity.storeName)),
      inspectors: sortedUnique(inspectorActivities.map((activity) => activity.username)),
      productTypes: sortedUnique(productTypeActivities.map((activity) => activity.productType)),
    };
  }

  async listActivityPage(filter: ActivityPageFilter = {}): Promise<ActivityPage> {
    const activities = await this.readActivity(filter);
    const limit = Math.max(1, filter.limit ?? 50);
    const start = filter.cursor ? findActivityCursorIndex(activities, filter.cursor) : 0;
    const rows = activities.slice(start, start + limit);
    const hasMore = start + rows.length < activities.length;
    const last = rows.at(-1);
    return {
      rows,
      hasMore,
      ...(hasMore && last ? { nextCursor: { createdAt: last.createdAt, id: last.id } } : {}),
    };
  }

  private async readActivity(filter: ActivityFilter = {}): Promise<ActivityRecord[]> {
    const [rows, outboxRows, inspectionRows] = await Promise.all([
      this.database.activity.filter((row) => this.isInActiveScope(row) || !row.accountScopeKey).toArray(),
      this.database.outbox.filter((row) => this.isInActiveScope(row)).toArray(),
      this.database.inspections.filter((row) => this.isInActiveScope(row)).toArray(),
    ]);
    const inspectionsById = new Map(inspectionRows.map((inspection) => [inspection.id, inspection]));
    const outboxByInspection = new Map<string, { status: OutboxRecord['status']; error?: string }>();
    for (const row of outboxRows) {
      const previous = outboxByInspection.get(row.aggregateId);
      if (!previous || outboxStatusPriority(row.status) > outboxStatusPriority(previous.status)) {
        outboxByInspection.set(row.aggregateId, { status: row.status, error: syncErrorMessage(row.lastError) });
      }
    }
    const activities = rows
      .filter((row) => this.isInActiveScope(row) || (
        !row.accountScopeKey && row.id.startsWith('local-inspection-completed:') &&
        inspectionsById.has(text(row, ['inspection_id', 'inspectionId']) ?? '')
      ))
      .map((row) => {
        const inspectionId = text(row, ['inspection_id', 'inspectionId']);
        return mapActivity(row, inspectionId ? inspectionsById.get(inspectionId) : undefined);
      })
      .map((activity) => {
        const sync = activity.inspectionId ? outboxByInspection.get(activity.inspectionId) : undefined;
        return {
          ...activity,
          syncStatus: (sync?.status ?? 'remote') as ActivitySyncStatus,
          ...(sync?.error ? { syncError: sync.error } : {}),
        };
      })
      .filter((activity) => isCompletedActivity(activity))
      .filter((activity) => filter.outcome === undefined || filter.outcome === 'all' || activity.outcome === filter.outcome)
      .filter((activity) => !filter.productType || activity.productType === filter.productType)
      .filter((activity) => !filter.storeName || activity.storeName === filter.storeName)
      .filter((activity) => !filter.inspector || activity.username === filter.inspector)
      .filter((activity) => !filter.syncStatus || filter.syncStatus === 'all' || activity.syncStatus === filter.syncStatus)
      .filter((activity) => !filter.evidence || filter.evidence === 'all' || (filter.evidence === 'with' ? (activity.evidenceCount ?? 0) > 0 : (activity.evidenceCount ?? 0) === 0))
      .filter((activity) => !filter.dateFrom || activity.createdAt.slice(0, 10) >= filter.dateFrom)
      .filter((activity) => !filter.dateTo || activity.createdAt.slice(0, 10) <= filter.dateTo)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    return activities;
  }

  async getDashboardCounts() {
    const [completedInspections, drafts, pendingSync, openConflicts, blockedOutbox] = await Promise.all([
      this.database.inspections.filter((inspection) => this.isInActiveScope(inspection)).count(),
      this.database.inspectionDrafts.count(),
      this.database.outbox.where('status').anyOf('pending', 'uploading', 'pushing', 'retry').filter((row) => this.isInActiveScope(row)).count(),
      this.database.conflicts.filter((conflict) => conflict.status === 'open' && this.isInActiveScope(conflict)).count(),
      this.database.outbox.where('status').equals('conflict').filter((row) => this.isInActiveScope(row)).count(),
    ]);
    return { completedInspections, drafts, pendingSync, openConflicts: openConflicts + blockedOutbox };
  }

  async getSyncStatusCounts(): Promise<{ pendingCount: number; retryingCount: number; conflictCount: number; failedCount: number }> {
    const [pendingCount, retryingCount, openConflicts, blockedOutbox, failedCount] = await Promise.all([
      this.database.outbox.where('status').anyOf('pending', 'uploading', 'pushing', 'retry').filter((row) => this.isInActiveScope(row)).count(),
      this.database.outbox.where('status').equals('retry').filter((row) => this.isInActiveScope(row)).count(),
      this.database.conflicts.filter((conflict) => conflict.status === 'open' && this.isInActiveScope(conflict)).count(),
      this.database.outbox.where('status').equals('conflict').filter((row) => this.isInActiveScope(row)).count(),
      this.database.outbox.where('status').equals('failed').filter((row) => this.isInActiveScope(row)).count(),
    ]);
    return { pendingCount, retryingCount, conflictCount: openConflicts + blockedOutbox, failedCount };
  }

  async listOpenConflicts(limit = 20): Promise<SyncRow[]> {
    const conflicts = (await this.database.conflicts.toArray())
      .filter((conflict) => conflict.status === 'open' && this.isInActiveScope(conflict))
      .sort((left, right) => right.change_cursor - left.change_cursor);
    return conflicts.slice(0, limit);
  }

  async searchCatalog(query: string, limit = 50, ecpType?: string): Promise<CatalogRecord[]> {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedEcpType = ecpType?.trim().toLowerCase();
    const catalogScope = this.catalogRole;
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
    const catalogScope = this.catalogRole;
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
    return rows.filter((row) => this.isInActiveScope(row) && row.nextAttemptAt <= now.toISOString());
  }

  async getCompletedInspectionCount(): Promise<number> {
    return this.database.inspections
      .filter((inspection) => inspection.status === 'completed' && this.isInActiveScope(inspection))
      .count();
  }

  async retryFailedOutbox(): Promise<number> {
    const rows = (await this.database.outbox.where('status').anyOf('failed', 'retry', 'conflict').toArray())
      .filter((row) => this.isInActiveScope(row) && (row.status !== 'conflict' || syncServerHead(row.lastError) === 0));
    const now = new Date().toISOString();
    await Promise.all(rows.map((row) => this.database.outbox.update(row.id, {
      status: 'retry',
      nextAttemptAt: now,
      lastError: undefined,
      updatedAt: now,
    })));
    return rows.length;
  }

  async rebuildInspectionOutboxChain(aggregateId: string): Promise<OutboxRecord | undefined> {
    return this.database.transaction('rw', this.database.outbox, async () => {
      const rows = (await this.database.outbox.where('aggregateId').equals(aggregateId).toArray())
        .filter((row) => this.isInActiveScope(row) && row.kind === 'inspection' && mergeableOutboxStatus(row.status));
      return mergeInspectionOutboxRows(this.database, aggregateId, rows);
    });
  }

  async recoverStaleOutbox(staleBefore = new Date(Date.now() - 15 * 60 * 1000)): Promise<void> {
    const cutoff = staleBefore.toISOString();
    const stale = await this.database.outbox
      .where('status')
      .anyOf('uploading', 'pushing')
      .filter((row) => this.isInActiveScope(row) && String(row.updatedAt ?? row.nextAttemptAt) <= cutoff)
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

  async count(table: 'inspectionRevisions' | 'activity', scope?: AccountScope): Promise<number> {
    const selected: Table<SyncRow, string> = this.database[table];
    return scope ? selected.filter((row) => row.accountScopeKey === scope.key).count() : selected.count();
  }

  private isInActiveScope(value: { accountScopeKey?: string }): boolean {
    return !this.accountScope || value.accountScopeKey === this.accountScope.key;
  }

  private requireAccountScope(): AccountScope {
    if (!this.accountScope) throw new Error('Sign in before exporting or importing recovery data.');
    return this.accountScope;
  }
}

function inspectionTimestamp(inspection: InspectionRecord): string {
  const value = inspection.completedAt ?? inspection.updatedAt;
  return typeof value === 'string' ? value : '';
}

function storeProfileKey(storeId: string): string {
  return `store:${storeId}`;
}

function transferStoreKey(name: string, location?: string): string {
  return `store:${normalizeIdentity(name)}\u0000${normalizeIdentity(location)}`;
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

function cursorStateId(scope?: AccountScope): string {
  return scope ? `global:${scope.key}` : 'global';
}

type TransferDecision = 'import' | 'skip' | 'conflict';

function transferDecision(
  imported: Record<string, unknown>,
  local: InspectionRecord | undefined,
  revisions: Record<string, unknown>[],
): TransferDecision {
  if (!local) return 'import';
  const importedRevision = revisions
    .filter((row) => text(row, ['inspection_id', 'inspectionId']) === imported.id)
    .map((row) => numberValue(row, ['revision']))
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => right - left)[0]
    ?? numberValue(imported, ['currentRevision', 'revision'])
    ?? 0;
  const localRevision = numberValue(local, ['currentRevision', 'revision']) ?? 0;
  if (stableTransferJson(imported) === stableTransferJson(local)) return 'skip';
  if (importedRevision > localRevision) return 'import';
  if (importedRevision < localRevision) return 'skip';
  return 'conflict';
}

function sanitizeTransferValue(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeTransferChild(value);
  if (!isRecord(sanitized)) throw new Error('Only JSON objects can be exported as transfer records.');
  return sanitized;
}

function sanitizeTransferChild(value: unknown): unknown {
  if (value instanceof Blob) return undefined;
  if (Array.isArray(value)) return value.map(sanitizeTransferChild).filter((child) => child !== undefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (key === 'blob' || key === 'accountScopeKey' || key === 'change_cursor' || key === 'changeCursor' || key === 'syncCursors' || key === 'sync_cursors') return [];
    const sanitized = sanitizeTransferChild(child);
    return sanitized === undefined ? [] : [[key, sanitized]];
  }));
}

function restoreEvidencePayload(value: unknown, evidenceById: Map<string, Blob>): unknown {
  if (Array.isArray(value)) return value.map((child) => restoreEvidencePayload(child, evidenceById));
  if (!value || typeof value !== 'object') return value;
  const restored = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, restoreEvidencePayload(child, evidenceById)]));
  if (Array.isArray(restored.evidence)) {
    restored.evidence = restored.evidence.map((item) => {
      if (!isRecord(item) || typeof item.id !== 'string') return item;
      const blob = evidenceById.get(item.id);
      return blob ? { ...item, blob } : item;
    });
  }
  return restored;
}

function containsEvidencePayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsEvidencePayload);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => key === 'evidence' && Array.isArray(child) && child.length > 0 || containsEvidencePayload(child));
}

function stableTransferJson(value: unknown): string {
  return JSON.stringify(normalizeTransferValue(value));
}

function normalizeTransferValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeTransferValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['accountScopeKey', 'organizationId', 'updatedAt', 'createdAt'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, normalizeTransferValue(child)]));
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

function mapActivity(row: SyncRow, inspection?: InspectionRecord): ActivityRecord {
  const payload = ACTIVITY_FIELDS
    .map((key) => row[key])
    .find((value): value is Record<string, unknown> => isRecord(value)) ?? {};
  const value = { ...inspection, ...payload, ...row };
  const eventType = text(value, ['event_type', 'eventType', 'type']);
  const outcome = inspection ? deriveInspectionOutcome(inspection) : deriveInspectionOutcome(value, payload);
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

function findActivityCursorIndex(activities: ActivityRecord[], cursor: ActivityPageCursor): number {
  const index = activities.findIndex((activity) =>
    activity.createdAt < cursor.createdAt || (activity.createdAt === cursor.createdAt && activity.id < cursor.id),
  );
  return index === -1 ? activities.length : index;
}

function text(value: Record<string, unknown>, keys: string[]): string | undefined {
  const candidate = keys.map((key) => value[key]).find((item) => typeof item === 'string' && item.trim());
  return typeof candidate === 'string' ? candidate.trim() : undefined;
}

function sortedUnique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((left, right) => left.localeCompare(right));
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

function mergeableOutboxStatus(status: OutboxRecord['status']): boolean {
  return status === 'pending' || status === 'retry' || status === 'failed' || status === 'conflict';
}

async function mergeInspectionOutboxRows(
  database: PELPPalDatabase,
  aggregateId: string,
  rows: OutboxRecord[],
  incoming?: OutboxRecord,
): Promise<OutboxRecord | undefined> {
  // Pushing rows belong to an in-flight request and must not be rewritten here.
  const candidates = rows
    .filter((row) => row.aggregateId === aggregateId && row.kind === 'inspection' && mergeableOutboxStatus(row.status));
  if (incoming && !candidates.some((row) => row.id === incoming.id)) candidates.push(incoming);
  if (candidates.length === 0) return undefined;

  const revisions = candidates.flatMap((row) => outboxArray(row, 'revisions'))
    .filter(isRecord)
    .sort(compareRevision)
    .filter((revision, index, all) => index === all.findIndex((candidate) => candidate.id === revision.id));
  const events = candidates.flatMap((row) => outboxArray(row, 'events'))
    .filter(isRecord)
    .filter((event, index, all) => index === all.findIndex((candidate) => candidate.id === event.id));
  const latest = candidates[candidates.length - 1];
  const latestRevision = revisions.at(-1);
  const merged: OutboxRecord = {
    ...latest,
    id: `inspection-outbox:${aggregateId}:${typeof latestRevision?.id === 'string' ? latestRevision.id : 'merged'}`,
    aggregateId,
    kind: 'inspection',
    payload: { inspection_id: aggregateId, revisions, events },
    status: 'pending',
    nextAttemptAt: new Date().toISOString(),
    attempts: Math.max(...candidates.map((row) => row.attempts ?? 0)),
    lastError: undefined,
    updatedAt: new Date().toISOString(),
  };
  await Promise.all(candidates.map((row) => database.outbox.delete(row.id)));
  await database.outbox.put(merged);
  return merged;
}

function outboxArray(row: OutboxRecord, key: 'revisions' | 'events'): unknown[] {
  const payload = isRecord(row.payload) ? row.payload[key] : undefined;
  return Array.isArray(payload) ? payload : [];
}

function compareRevision(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const revisionDifference = (numberValue(left, ['revision']) ?? 0) - (numberValue(right, ['revision']) ?? 0);
  if (revisionDifference !== 0) return revisionDifference;
  return String(left.id ?? '').localeCompare(String(right.id ?? ''));
}

function syncErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.message !== 'string') return undefined;
  const message = value.message.replace(/\s+/g, ' ').trim();
  return message ? message.slice(0, 240) : undefined;
}

function syncServerHead(value: unknown): number | undefined {
  if (!isRecord(value) || typeof value.serverHead !== 'number') return undefined;
  return value.serverHead;
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
