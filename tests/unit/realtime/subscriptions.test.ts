import { describe, expect, it } from 'vitest';
import { realtimeEventFromPayload } from '@/lib/realtime/subscriptions';

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
