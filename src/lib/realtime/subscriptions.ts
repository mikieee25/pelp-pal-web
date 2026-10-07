import type { SupabaseClient } from '@supabase/supabase-js';
import type { RealtimeEvent } from './event-router';
import { syncDebug } from './debug';

export const realtimeTables = [
  'devices',
  'organization_accounts',
  'account_reset_commands',
  'catalog_manifests',
  'inspections',
  'inspection_revisions',
  'activity_events',
  'inspection_conflicts',
  'inspection_evidence',
  'inspection_deletion_tombstones',
] as const;

type RealtimePayload = {
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
  commit_timestamp?: string;
};

export function realtimeEventFromPayload(payload: RealtimePayload): RealtimeEvent {
  const next = payload.new ?? {};
  const record = Object.keys(next).length > 0 ? next : (payload.old ?? {});
  const id = typeof record.id === 'string'
    ? record.id
    : typeof record.inspection_id === 'string'
      ? record.inspection_id
      : undefined;
  const changeCursor = typeof record.change_cursor === 'number' ? record.change_cursor : undefined;
  const commitTimestamp = typeof payload.commit_timestamp === 'string' ? payload.commit_timestamp : undefined;
  return {
    ...(id ? { id } : {}),
    ...(changeCursor !== undefined ? { change_cursor: changeCursor } : {}),
    ...(commitTimestamp ? { commit_timestamp: commitTimestamp } : {}),
  };
}

export function subscribeToSyncTables(
  client: SupabaseClient,
  onEvent: (event: RealtimeEvent) => void,
  onStatus: (status: string, error?: unknown) => void,
) {
  let channel = client.channel('pelp-pal-sync');
  for (const table of realtimeTables) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      onEvent(realtimeEventFromPayload(payload as RealtimePayload));
    });
  }
  channel.subscribe((status, error) => {
    syncDebug('realtime channel status changed', { status, error });
    onStatus(status, error);
  });
  return () => {
    void client.removeChannel(channel);
  };
}
