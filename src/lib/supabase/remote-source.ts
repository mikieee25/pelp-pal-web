import type { SupabaseClient } from '@supabase/supabase-js';
import type { CursorState, OutboxRecord, PullPage, SyncRow } from '@/lib/db/records';
import type { SyncRemote } from '@/lib/sync/coordinator';

export class SupabaseSyncRemote implements SyncRemote {
  constructor(private readonly client: SupabaseClient) {}

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
    return parsePullPage(legacyResponse.data);
  }

  async pushOutbox(item: OutboxRecord): Promise<void> {
    const payload = asRecord(item.payload);
    if (item.kind === 'inspection') {
      const inspectionId = stringValue(payload.inspection_id, 'inspection_id');
      const revisions = arrayValue(payload.revisions, 'revisions');
      const events = arrayValue(payload.events, 'events');
      const { error } = await this.client.rpc('push_inspection_revisions', {
        p_inspection_id: inspectionId,
        p_revisions: revisions,
        p_events: events,
      });
      if (error) throw new Error(`push_inspection_revisions failed: ${error.message}`);
      return;
    }
    if (item.kind === 'activity') {
      const { error } = await this.client.rpc('push_activity_events', { p_events: arrayValue(payload.events, 'events') });
      if (error) throw new Error(`push_activity_events failed: ${error.message}`);
      return;
    }
    throw new Error(`Unsupported outbox kind: ${item.kind}`);
  }
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
    if (
      typeof parsed.id !== 'string'
      || !parsed.id
      || typeof parsed.change_cursor !== 'number'
      || !Number.isInteger(parsed.change_cursor)
      || parsed.change_cursor <= 0
    ) {
      throw new Error(`${name}[${index}] must contain id and a positive integer change_cursor.`);
    }
    return parsed as SyncRow;
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
