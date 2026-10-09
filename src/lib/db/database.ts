import Dexie, { type Table } from 'dexie';
import type {
  AccountRecord,
  CatalogRecord,
  CursorState,
  DeviceRecord,
  EvidenceRecord,
  LocalEvidenceRecord,
  InspectionRecord,
  JsonRecord,
  OutboxRecord,
  StoreRecord,
  SyncRow,
  ReportDraft,
} from './records';

export class PELPPalDatabase extends Dexie {
  device!: Table<DeviceRecord, string>;
  accounts!: Table<AccountRecord, string>;
  catalog!: Table<CatalogRecord, string>;
  activity!: Table<SyncRow, string>;
  inspections!: Table<InspectionRecord, string>;
  inspectionRevisions!: Table<SyncRow, string>;
  inspectionDrafts!: Table<InspectionRecord, string>;
  evidence!: Table<EvidenceRecord, string>;
  evidenceBlobs!: Table<LocalEvidenceRecord, string>;
  conflicts!: Table<SyncRow, string>;
  tombstones!: Table<SyncRow, string>;
  outbox!: Table<OutboxRecord, string>;
  syncState!: Table<JsonRecord & { id: string }, string>;
  syncCursors!: Table<CursorState, string>;
  stores!: Table<StoreRecord, string>;
  accountResetReceipts!: Table<JsonRecord & { id: string }, string>;
  reportDrafts!: Table<ReportDraft, string>;

  constructor(name = 'pelp-pal-web') {
    super(name);
    this.version(1).stores({
      device: 'id, installationId, authUserId',
      accounts: 'id, organizationId, username, [organizationId+username]',
      catalog: 'id, catalogScope',
      activity: 'id, change_cursor, inspection_id',
      inspections: 'id, organizationId, ownerUsername, updatedAt',
      inspectionRevisions: 'id, inspection_id, change_cursor',
      inspectionDrafts: 'id, updatedAt',
      evidence: 'id, inspectionId, displayOrder',
      evidenceBlobs: 'id, evidenceId',
      conflicts: 'id, inspection_id, change_cursor, status',
      tombstones: 'id, change_cursor, inspection_id',
      outbox: 'id, aggregateId, status, nextAttemptAt',
      syncState: 'id',
      syncCursors: 'id',
      accountResetReceipts: 'id',
    });
    this.version(2).stores({
      stores: 'id, storeId, location, name, updatedAt',
    });
    this.version(3).stores({
      reportDrafts: 'id, storeKey, updatedAt',
    });
    this.version(4).stores({
      activity: 'id, change_cursor, inspection_id, server_created_at, [server_created_at+id]',
    });
  }
}
