export type JsonRecord = Record<string, unknown>;

export type DeviceRecord = {
  id: 'current';
  installationId: string;
  authUserId?: string;
  organizationId?: string;
  assignedUsername?: string;
  assignedRole?: 'admin' | 'epred' | 'guest';
  catalogScope?: 'masterlist' | 'guestlist';
  enrolled: boolean;
  revokedAt?: string;
  updatedAt: string;
};

export type StoreDetails = {
  storeId?: string;
  name: string;
  location: string;
  address?: string;
  contactName?: string;
  contactPosition?: string;
  contactNumber?: string;
  email?: string;
};

export type StoreRecord = StoreDetails & {
  id: 'current';
  storeId: string;
  updatedAt: string;
};

export type ActivityOutcome = 'compliant' | 'non_compliant' | 'unavailable';

export type ActivityRecord = {
  id: string;
  inspectionId?: string;
  storeName?: string;
  location?: string;
  productType?: string;
  controlNumber?: string;
  brand?: string;
  model?: string;
  outcome: ActivityOutcome;
  evidenceCount?: number;
  remarks?: string;
  username?: string;
  eventType?: string;
  createdAt: string;
};

export type ActivityFilter = {
  outcome?: ActivityOutcome | 'all';
  productType?: string;
  storeName?: string;
  limit?: number;
};

export type CursorState = {
  id: 'global';
  revision: number;
  activity: number;
  conflict: number;
  deletion: number;
};

export type SyncRow = JsonRecord & { id: string; change_cursor: number };

export type PullPage = {
  revisions: SyncRow[];
  activities: SyncRow[];
  conflicts: SyncRow[];
  deletions: SyncRow[];
};

export type AccountRecord = JsonRecord & { id: string; organizationId: string; username: string };
export type CatalogRecord = JsonRecord & { id: string; catalogScope: 'masterlist' | 'guestlist' };
export type CatalogRole = 'masterlist' | 'guestlist';
export type CatalogManifestState = {
  id: `catalog-manifest:${CatalogRole}`;
  catalogRole: CatalogRole;
  version: number;
  integrityHash: string;
  rowCount: number;
  schemaVersion: number;
  storagePath: string;
  updatedAt: string;
};
export type InspectionRecord = JsonRecord & { id: string };
export type EvidenceRecord = {
  id: string;
  inspectionId: string;
  displayOrder: number;
  capturedAt: string;
  fileName: string;
  mimeType: string;
  size: number;
};
export type LocalEvidenceRecord = EvidenceRecord & { blob: Blob };
export type OutboxRecord = JsonRecord & {
  id: string;
  aggregateId: string;
  status: 'pending' | 'uploading' | 'pushing' | 'retry' | 'conflict' | 'failed' | 'synced';
  nextAttemptAt: string;
  attempts?: number;
};

export type ReportDraft = {
  id: string;
  storeKey: string;
  inspectionDate: string;
  regionProvince: string;
  monitoringTeam: string;
  distributorType: 'physical' | 'online' | '';
  storeName: string;
  address: string;
  email: string;
  contactNumber: string;
  storeRepresentative: string;
  findings: string;
  recommendations: string;
  teamLeader: string;
  acknowledgedBy: string;
  teamLeaderDesignation: string;
  representativeDesignation: string;
  updatedAt: string;
};
