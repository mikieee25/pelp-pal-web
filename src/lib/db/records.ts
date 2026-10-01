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
export type InspectionRecord = JsonRecord & { id: string };
export type OutboxRecord = JsonRecord & {
  id: string;
  aggregateId: string;
  status: 'pending' | 'uploading' | 'pushing' | 'retry' | 'conflict' | 'failed' | 'synced';
  nextAttemptAt: string;
  attempts?: number;
};
