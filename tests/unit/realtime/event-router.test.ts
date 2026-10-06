import { describe, expect, it } from 'vitest';
import { RealtimeEventRouter } from '@/lib/realtime/event-router';

describe('RealtimeEventRouter', () => {
  it('deduplicates events by stable event id', () => {
    const reasons: string[] = [];
    const router = new RealtimeEventRouter((reason) => reasons.push(reason));

    router.route({ id: 'event-1' });
    router.route({ id: 'event-1' });
    router.route({ id: 'event-2' });

    expect(reasons).toEqual(['realtime', 'realtime']);
  });

  it('does not suppress later updates to the same row when its cursor changes', () => {
    const reasons: string[] = [];
    const router = new RealtimeEventRouter((reason) => reasons.push(reason));

    router.route({ id: 'inspection-1', change_cursor: 10 });
    router.route({ id: 'inspection-1', change_cursor: 10 });
    router.route({ id: 'inspection-1', change_cursor: 11 });

    expect(reasons).toEqual(['realtime', 'realtime']);
  });
});
