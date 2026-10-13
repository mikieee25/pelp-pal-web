import { describe, expect, it } from 'vitest';
import { realtimeEventFromPayload, realtimeTables } from '@/lib/realtime/subscriptions';

it('subscribes only to the currently published sync tables', () => {
  expect(realtimeTables).toEqual([
    'account_reset_commands',
    'activity_events',
    'catalog_manifests',
    'inspection_conflicts',
    'inspection_deletion_tombstones',
    'inspection_evidence',
    'inspection_revisions',
    'inspections',
    'organization_accounts',
  ]);
});

describe('realtimeEventFromPayload', () => {
  it('forwards the row cursor so later updates to the same row are not deduplicated', () => {
    expect(realtimeEventFromPayload({
      new: { id: 'inspection-1', change_cursor: 11 },
      old: {},
      commit_timestamp: '2026-10-08T00:00:00.000Z',
    })).toEqual({ id: 'inspection-1', change_cursor: 11, commit_timestamp: '2026-10-08T00:00:00.000Z' });
  });

  it('forwards the commit timestamp for tables without a change cursor', () => {
    expect(realtimeEventFromPayload({
      new: { id: 'inspection-1' },
      old: {},
      commit_timestamp: '2026-10-08T00:00:01.000Z',
    })).toEqual({ id: 'inspection-1', commit_timestamp: '2026-10-08T00:00:01.000Z' });
  });

  it('uses the inspection id as the stable identity for deletion tombstones', () => {
    expect(realtimeEventFromPayload({
      new: {},
      old: { inspection_id: 'inspection-1', change_cursor: 12 },
    })).toEqual({ id: 'inspection-1', change_cursor: 12 });
  });
});
