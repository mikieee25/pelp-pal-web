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
});
