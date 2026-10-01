import type { SupabaseClient } from '@supabase/supabase-js';
import type { RealtimeEvent } from './event-router';

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

export function subscribeToSyncTables(
  client: SupabaseClient,
  onEvent: (event: RealtimeEvent) => void,
  onStatus: (status: string) => void,
) {
  let channel = client.channel('pelp-pal-sync');
  for (const table of realtimeTables) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      const record = (payload.new ?? payload.old) as Record<string, unknown>;
      onEvent({ id: typeof record.id === 'string' ? record.id : undefined, payload });
    });
  }
  channel.subscribe((status) => onStatus(status));
  return () => {
    void client.removeChannel(channel);
  };
}
