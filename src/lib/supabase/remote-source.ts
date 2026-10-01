import type { SupabaseClient } from '@supabase/supabase-js';
import type { CursorState, OutboxRecord, PullPage, SyncRow } from '@/lib/db/records';
import type { SyncRemote } from '@/lib/sync/coordinator';

export class SupabaseSyncRemote implements SyncRemote {
  constructor(private readonly client: SupabaseClient) {}

  async pullSyncChanges(cursors: Omit<CursorState, 'id'>): Promise<PullPage> {
    const { data, error } = await this.client.rpc('pull_sync_changes', {
      p_revision_cursor: cursors.revision,
      p_activity_cursor: cursors.activity,
      p_conflict_cursor: cursors.conflict,
      p_limit: 100,
      p_deletion_cursor: cursors.deletion,
    });
    if (error) throw new Error(`pull_sync_changes failed: ${error.message}`);
    return parsePullPage(data);
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
    deletions: rowsValue(record.deletions, 'deletions'),
  };
}

function rowsValue(value: unknown, name: string): SyncRow[] {
  return arrayValue(value, name).map((row, index) => {
    const parsed = asRecord(row);
    if (typeof parsed.id !== 'string' || typeof parsed.change_cursor !== 'number') {
      throw new Error(`${name}[${index}] must contain id and numeric change_cursor.`);
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
