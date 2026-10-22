import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountScope, CursorState, EvidenceUploadTask, OrganizationStoreRecord, OutboxRecord, PullPage, StoreRecord, SyncRow } from '@/lib/db/records';
import type { SyncRemote } from '@/lib/sync/coordinator';
import { SYNC_PULL_PAGE_LIMIT } from '@/lib/sync/constants';
import { buildEvidencePath, EVIDENCE_MAX_BYTES, readEvidenceArrayBuffer, validateEvidenceBytes } from '@/lib/evidence/validation';

export class SyncConflictError extends Error {
  readonly code = 'SYNC_CONFLICT';
  readonly serverHead?: number;
  readonly serverHeadId?: string | null;

  constructor(message: string, serverHead?: number, serverHeadId?: string | null) {
    super(message);
    this.name = 'SyncConflictError';
    this.serverHead = serverHead;
    this.serverHeadId = serverHeadId;
  }
}

export class EvidenceLocalInvalidError extends Error {
  readonly code = 'EVIDENCE_LOCAL_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'EvidenceLocalInvalidError';
  }
}

export class EvidenceNotFoundError extends Error {
  constructor(readonly remotePath: string) {
    super(`Evidence object not found: ${remotePath}`);
    this.name = 'EvidenceNotFoundError';
  }
}

export class EvidenceDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceDownloadError';
  }
}

export class SupabaseSyncRemote implements SyncRemote {
  constructor(private readonly client: SupabaseClient) {}

  async downloadEvidence(remotePath: string, signal?: AbortSignal): Promise<Blob> {
    let data: Blob | null;
    let error: { name?: string; message: string; statusCode?: string | number; status?: string | number } | null;
    try {
      ({ data, error } = await this.client.storage.from('inspection-evidence').download(remotePath, {}, { signal }));
    } catch (cause) {
      if (signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) throw cause;
      throw new EvidenceDownloadError(`Evidence download failed for ${remotePath}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (error) {
      const detail = error;
      const status = String(detail.statusCode ?? detail.status ?? '');
      if (status === '404' || /not found/i.test(detail.message)) throw new EvidenceNotFoundError(remotePath);
      throw new EvidenceDownloadError(`Evidence download failed for ${remotePath}: ${detail.name} (status ${status || 'unknown'}): ${detail.message}`);
    }
    if (!data) throw new EvidenceDownloadError(`Evidence download returned no file for ${remotePath}.`);
    return data;
  }

  async getAvailableInspectionCount(signal?: AbortSignal): Promise<number> {
    const request = this.client
      .from('inspections')
      .select('id', { count: 'exact', head: true });
    const response = await (signal ? request.abortSignal(signal) : request);
    if (response.error) throw new Error(`Inspection count failed: ${response.error.message}`);
    if (typeof response.count !== 'number') throw new Error('Inspection count was not returned by the server.');
    return response.count;
  }

  async syncOrganizationStores(stores: StoreRecord[], scope: AccountScope, signal?: AbortSignal): Promise<OrganizationStoreRecord[]> {
    throwIfAborted(signal);
    let remote = await this.fetchOrganizationStores(scope, signal);
    for (const store of stores) {
      throwIfAborted(signal);
      const existing = remote.find((candidate) => candidate.id === store.remoteId
        || normalizeStoreIdentity(candidate.name) === normalizeStoreIdentity(store.name)
          && normalizeStoreIdentity(candidate.location) === normalizeStoreIdentity(store.location));
      if (!existing) {
        const insert = this.client.from('organization_stores').insert({
          organization_id: scope.organizationId,
          name: store.name,
          location: store.location,
          address: store.address ?? null,
          normalized_name: normalizeStoreIdentity(store.name),
          created_by_username: store.createdByUsername ?? scope.username ?? scope.accountId,
        }).select('id, organization_id, name, location, address, normalized_name, created_by_username, created_at, updated_at, is_active').single();
        const response = await withAbortSignal(insert, signal);
        if (response.error) throw new Error(`Organization store upload failed: ${response.error.message}`);
        remote.push(mapOrganizationStore(response.data));
      } else if (Date.parse(store.updatedAt) > Date.parse(existing.updatedAt)) {
        const update = this.client.from('organization_stores').update({
          name: store.name,
          location: store.location,
          address: store.address ?? null,
          normalized_name: normalizeStoreIdentity(store.name),
        }).eq('id', existing.id).eq('organization_id', scope.organizationId).select('id, organization_id, name, location, address, normalized_name, created_by_username, created_at, updated_at, is_active').single();
        const response = await withAbortSignal(update, signal);
        if (response.error) throw new Error(`Organization store update failed: ${response.error.message}`);
        const updated = mapOrganizationStore(response.data);
        remote = remote.map((candidate) => candidate.id === updated.id ? updated : candidate);
      }
    }
    return this.fetchOrganizationStores(scope, signal);
  }

  private async fetchOrganizationStores(scope: AccountScope, signal?: AbortSignal): Promise<OrganizationStoreRecord[]> {
    const query = this.client.from('organization_stores')
      .select('id, organization_id, name, location, address, normalized_name, created_by_username, created_at, updated_at, is_active')
      .eq('organization_id', scope.organizationId)
      .eq('is_active', true);
    const response = await withAbortSignal(query, signal);
    if (response.error) throw new Error(`Organization store download failed: ${response.error.message}`);
    return (response.data ?? []).map(mapOrganizationStore);
  }

  async pullSyncChanges(cursors: Omit<CursorState, 'id'>, signal?: AbortSignal): Promise<PullPage> {
    const request = {
      p_revision_cursor: cursors.revision,
      p_activity_cursor: cursors.activity,
      p_conflict_cursor: cursors.conflict,
      p_limit: SYNC_PULL_PAGE_LIMIT,
      p_deletion_cursor: cursors.deletion,
    };
    const pull = this.client.rpc('pull_sync_changes', request);
    const response = await (signal ? pull.abortSignal(signal) : pull);
    if (!response.error) return parsePullPage(response.data);

    throw new Error(`pull_sync_changes failed: ${response.error.message}`);
  }

  async pushOutbox(item: OutboxRecord, signal?: AbortSignal): Promise<EvidenceUploadTask[]> {
    throwIfAborted(signal);
    const payload = asRecord(item.payload);
    if (item.kind === 'inspection') {
      const inspectionId = stringValue(payload.inspection_id, 'inspection_id');
      const prepared = await prepareInspectionRevisions(arrayValue(payload.revisions, 'revisions'));
      throwIfAborted(signal);
      const events = arrayValue(payload.events, 'events');
      const push = this.client.rpc('push_inspection_revisions', {
        p_inspection_id: inspectionId,
        p_revisions: prepared.revisions,
        p_events: events,
      });
      const response = await (signal ? push.abortSignal(signal) : push);
      if (response.error) throw new Error(`push_inspection_revisions failed: ${response.error.message}`);
      if (asRecord(response.data).status === 'conflict') {
        const result = asRecord(response.data);
        const serverHead = numberValue(result.server_head ?? result.serverHead);
        const serverHeadId = stringValueOptional(result.server_head_id ?? result.serverHeadId);
        throw new SyncConflictError(`Inspection ${inspectionId} conflicts with a newer remote revision.`, serverHead, serverHeadId);
      }
      return prepared.uploads;
    }
    if (item.kind === 'activity') {
      const push = this.client.rpc('push_activity_events', { p_events: arrayValue(payload.events, 'events') });
      const { error } = await (signal ? push.abortSignal(signal) : push);
      if (error) throw new Error(`push_activity_events failed: ${error.message}`);
      return [];
    }
    if (item.kind === 'inspection_delete') {
      const remove = this.client.rpc('delete_inspection_sync', {
        p_inspection_id: stringValue(payload.inspection_id, 'inspection_id'),
        p_product_control_number: stringValue(payload.product_control_number, 'product_control_number'),
        p_storage_paths: arrayValue(payload.storage_paths ?? [], 'storage_paths').filter((path): path is string => typeof path === 'string'),
      });
      const { error } = await (signal ? remove.abortSignal(signal) : remove);
      if (error) throw new Error(`delete_inspection_sync failed: ${error.message}`);
      return [];
    }
    throw new Error(`Unsupported outbox kind: ${item.kind}`);
  }

  async uploadEvidence(task: EvidenceUploadTask, blob: Blob, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const arrayBuffer = await readEvidenceArrayBuffer(blob);
    throwIfAborted(signal);
    const bytes = new Uint8Array(arrayBuffer);
    let validation: Awaited<ReturnType<typeof validateEvidenceBytes>>;
    try {
      validation = await validateEvidenceBytes(bytes);
    } catch {
      if (bytes.length > EVIDENCE_MAX_BYTES) {
        throw new EvidenceLocalInvalidError(`Evidence file "${task.evidenceId}" exceeds 5 MB (${bytes.length.toLocaleString()} bytes, ${formatBytes(bytes.length)}).`);
      }
      throw new EvidenceLocalInvalidError(`Evidence file "${task.evidenceId}" is not a valid JPEG.`);
    }
    const jpegBlob = new Blob([arrayBuffer], { type: 'image/jpeg' });
    const { error } = await this.client.storage.from('inspection-evidence').upload(task.remotePath, jpegBlob, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    throwIfAborted(signal);
    if (error) {
      const detail = error as typeof error & { statusCode?: string | number; status?: string | number; name?: string };
      throw new Error(`Evidence upload failed for ${task.evidenceId}: ${detail.name ?? 'StorageError'} (status ${detail.statusCode ?? detail.status ?? 'unknown'}): ${detail.message}`);
    }
    return validation.sha256;
  }
}

function mapOrganizationStore(value: unknown): OrganizationStoreRecord {
  const row = asRecord(value);
  return {
    id: stringValue(row.id, 'organization_store.id'),
    organizationId: stringValue(row.organization_id, 'organization_store.organization_id'),
    name: stringValue(row.name, 'organization_store.name'),
    location: stringValue(row.location, 'organization_store.location'),
    address: stringValueOptional(row.address) ?? undefined,
    normalizedName: stringValue(row.normalized_name, 'organization_store.normalized_name'),
    createdByUsername: stringValue(row.created_by_username, 'organization_store.created_by_username'),
    createdAt: stringValue(row.created_at, 'organization_store.created_at'),
    updatedAt: stringValue(row.updated_at, 'organization_store.updated_at'),
    isActive: row.is_active !== false,
  };
}

function normalizeStoreIdentity(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
}

function withAbortSignal<T extends object>(request: T, signal?: AbortSignal): T {
  if (!signal) return request;
  const abortable = request as T & { abortSignal?: (value: AbortSignal) => T };
  return typeof abortable.abortSignal === 'function' ? abortable.abortSignal(signal) : request;
}

async function prepareInspectionRevisions(values: unknown[]): Promise<{ revisions: unknown[]; uploads: EvidenceUploadTask[] }> {
  const uploads = new Map<string, EvidenceUploadTask>();
  const revisions = await Promise.all(values.map(async (value) => {
    const revision = asRecord(value);
    const payload = asRecord(revision.payload);
    if (!Array.isArray(payload.evidence)) return value;

    const organizationId = stringValue(payload.organizationId ?? payload.organization_id, 'organization_id');
    const inspectionId = stringValue(revision.inspection_id, 'inspection_id');
    const evidence = await Promise.all(payload.evidence.map(async (value) => {
      const item = asRecord(value);
      const blob = item.blob;
      const fileName = stringValueOptional(item.original_file_name ?? item.fileName ?? item.export_file_name) ?? String(item.id ?? 'unnamed evidence');
      const evidenceId = stringValue(item.id, 'evidence_id');
      const remotePath = buildEvidencePath(organizationId, inspectionId, evidenceId);
      const uploadedSha256 = stringValueOptional(item.uploaded_sha256 ?? item.uploadedSha256);
      if (!(blob instanceof Blob)) {
        const sha256 = stringValueOptional(item.sha256);
        uploads.set(evidenceId, {
          evidenceId,
          inspectionId,
          remotePath,
          sha256: sha256 ?? '',
          needsUpload: uploadedSha256 !== sha256,
        });
        const { blob: _blob, ...metadata } = item;
        return {
          ...metadata,
          remote_path: remotePath,
          ...(sha256 ? { sha256 } : {}),
        };
      }
      const bytes = new Uint8Array(await readEvidenceArrayBuffer(blob));
      let validation: Awaited<ReturnType<typeof validateEvidenceBytes>> | undefined;
      try {
        validation = await validateEvidenceBytes(bytes);
      } catch {
        const sha256 = stringValueOptional(item.sha256) ?? '';
        uploads.set(evidenceId, { evidenceId, inspectionId, remotePath, sha256, needsUpload: uploadedSha256 !== sha256 });
        const { blob: _blob, ...metadata } = item;
        return {
          ...metadata,
          remote_path: remotePath,
          mime_type: stringValueOptional(item.mime_type ?? item.mimeType) ?? 'image/jpeg',
          size_bytes: numberValue(item.size_bytes ?? item.size) ?? blob.size,
          ...(sha256 ? { sha256 } : {}),
        };
      }
      uploads.set(evidenceId, {
        evidenceId,
        inspectionId,
        remotePath,
        sha256: validation.sha256,
        needsUpload: uploadedSha256 !== validation.sha256,
      });
      const { blob: _blob, ...metadata } = item;
      return {
        ...metadata,
        remote_path: remotePath,
        mime_type: validation.mimeType,
        size_bytes: validation.sizeBytes,
        sha256: validation.sha256,
      };
    }));

    return { ...revision, payload: { ...payload, evidence } };
  }));
  return { revisions, uploads: [...uploads.values()] };
}

export function parsePullPage(value: unknown): PullPage {
  const record = asRecord(value);
  return {
    revisions: rowsValue(record.revisions, 'revisions'),
    activities: rowsValue(record.activities, 'activities'),
    conflicts: rowsValue(record.conflicts, 'conflicts'),
    deletions: rowsValue(record.deletions ?? [], 'deletions'),
  };
}

function rowsValue(value: unknown, name: string): SyncRow[] {
  return arrayValue(value, name).map((row, index) => {
    const parsed = asRecord(row);
    const normalized = typeof parsed.id === 'string' && parsed.id
      ? parsed
      : typeof parsed.inspection_id === 'string' && parsed.inspection_id
        ? { ...parsed, id: parsed.inspection_id }
        : parsed;
    if (
      typeof normalized.id !== 'string'
      || !normalized.id
      || typeof normalized.change_cursor !== 'number'
      || !Number.isInteger(normalized.change_cursor)
      || normalized.change_cursor <= 0
    ) {
      throw new Error(`${name}[${index}] must contain id and a positive integer change_cursor.`);
    }
    return normalized as SyncRow;
  });
}

function arrayValue(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Sync response is missing ${name}.`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Outbox payload is missing ${name}.`);
  return value;
}

function stringValueOptional(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
