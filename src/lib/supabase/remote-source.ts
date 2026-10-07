import type { SupabaseClient } from '@supabase/supabase-js';
import type { CursorState, OutboxRecord, PullPage, SyncRow } from '@/lib/db/records';
import type { SyncRemote } from '@/lib/sync/coordinator';
import { buildEvidencePath, validateEvidenceBytes } from '@/lib/evidence/validation';

export class SyncConflictError extends Error {
  readonly code = 'SYNC_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'SyncConflictError';
  }
}

export class SupabaseSyncRemote implements SyncRemote {
  constructor(private readonly client: SupabaseClient) {}

  async getAvailableInspectionCount(): Promise<number> {
    const response = await this.client
      .from('inspections')
      .select('id', { count: 'exact', head: true });
    if (response.error) throw new Error(`Inspection count failed: ${response.error.message}`);
    if (typeof response.count !== 'number') throw new Error('Inspection count was not returned by the server.');
    return response.count;
  }

  async pullSyncChanges(cursors: Omit<CursorState, 'id'>): Promise<PullPage> {
    const request = {
      p_revision_cursor: cursors.revision,
      p_activity_cursor: cursors.activity,
      p_conflict_cursor: cursors.conflict,
      p_limit: 100,
      p_deletion_cursor: cursors.deletion,
    };
    const response = await this.client.rpc('pull_sync_changes', request);
    if (!response.error) return parsePullPage(response.data);

    // The first deployment of the new project still has the previous four-argument
    // RPC. Keep sync usable while that schema catches up, but only for the known
    // PostgREST schema-cache signature mismatch.
    if (!isLegacyPullSyncSignatureError(response.error)) {
      throw new Error(`pull_sync_changes failed: ${response.error.message}`);
    }

    const legacyResponse = await this.client.rpc('pull_sync_changes', {
      p_revision_cursor: cursors.revision,
      p_activity_cursor: cursors.activity,
      p_conflict_cursor: cursors.conflict,
      p_limit: 100,
    });
    if (legacyResponse.error) throw new Error(`pull_sync_changes failed: ${legacyResponse.error.message}`);
    const legacyPage = asRecord(legacyResponse.data);
    return parsePullPage({ ...legacyPage, deletions: legacyPage.deletions ?? [] });
  }

  async pushOutbox(item: OutboxRecord): Promise<void> {
    const payload = asRecord(item.payload);
    if (item.kind === 'inspection') {
      const inspectionId = stringValue(payload.inspection_id, 'inspection_id');
      const revisions = await prepareInspectionRevisions(this.client, arrayValue(payload.revisions, 'revisions'));
      const events = arrayValue(payload.events, 'events');
      const response = await this.client.rpc('push_inspection_revisions', {
        p_inspection_id: inspectionId,
        p_revisions: revisions,
        p_events: events,
      });
      if (response.error) throw new Error(`push_inspection_revisions failed: ${response.error.message}`);
      if (asRecord(response.data).status === 'conflict') {
        throw new SyncConflictError(`Inspection ${inspectionId} conflicts with a newer remote revision.`);
      }
      return;
    }
    if (item.kind === 'activity') {
      const { error } = await this.client.rpc('push_activity_events', { p_events: arrayValue(payload.events, 'events') });
      if (error) throw new Error(`push_activity_events failed: ${error.message}`);
      return;
    }
    if (item.kind === 'inspection_delete') {
      const { error } = await this.client.rpc('delete_inspection_sync', {
        p_inspection_id: stringValue(payload.inspection_id, 'inspection_id'),
        p_product_control_number: stringValue(payload.product_control_number, 'product_control_number'),
        p_storage_paths: arrayValue(payload.storage_paths ?? [], 'storage_paths').filter((path): path is string => typeof path === 'string'),
      });
      if (error) throw new Error(`delete_inspection_sync failed: ${error.message}`);
      return;
    }
    throw new Error(`Unsupported outbox kind: ${item.kind}`);
  }
}

async function prepareInspectionRevisions(client: SupabaseClient, values: unknown[]): Promise<unknown[]> {
  return Promise.all(values.map(async (value) => {
    const revision = asRecord(value);
    const payload = asRecord(revision.payload);
    if (!Array.isArray(payload.evidence)) return value;

    const organizationId = stringValue(payload.organizationId ?? payload.organization_id, 'organization_id');
    const inspectionId = stringValue(revision.inspection_id, 'inspection_id');
    const revisionId = stringValue(revision.id, 'revision_id');
    const evidence = await Promise.all(payload.evidence.map(async (value) => {
      const item = asRecord(value);
      const blob = item.blob;
      if (!(blob instanceof Blob)) throw new Error(`Evidence ${String(item.id ?? '')} is missing its local image.`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const validation = await validateEvidenceBytes(bytes);
      const evidenceId = stringValue(item.id, 'evidence_id');
      const remotePath = buildEvidencePath(organizationId, inspectionId, evidenceId, revisionId);
      const upload = await client.storage.from('inspection-evidence').upload(remotePath, blob, {
        contentType: validation.mimeType,
        upsert: true,
      });
      if (upload.error) throw new Error(`Evidence upload failed: ${upload.error.message}`);
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

function isLegacyPullSyncSignatureError(error: { code?: string; message?: string }): boolean {
  const message = error.message?.toLowerCase() ?? '';
  return error.code === 'PGRST202'
    && message.includes('pull_sync_changes')
    && message.includes('schema cache');
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
