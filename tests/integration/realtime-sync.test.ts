import { describe, expect, it, vi } from 'vitest';
import { RealtimeEventRouter } from '@/lib/realtime/event-router';
import { subscribeToSyncTables } from '@/lib/realtime/subscriptions';

describe('realtime sync integration', () => {
  it('schedules another pull when the same row receives a newer cursor', () => {
    const callbacks = new Map<string, (payload: unknown) => void>();
    const channel = {
      on: vi.fn((_event: string, filter: { table: string }, callback: (payload: unknown) => void) => {
        callbacks.set(filter.table, callback);
        return channel;
      }),
      subscribe: vi.fn(),
    };
    const client = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    };
    const reasons: string[] = [];
    const router = new RealtimeEventRouter((reason) => reasons.push(reason));
    const stop = subscribeToSyncTables(
      client as never,
      (event) => router.route(event),
      () => undefined,
    );
    const onRevision = callbacks.get('inspection_revisions');

    onRevision?.({ new: { id: 'revision-1', change_cursor: 10 }, old: {} });
    onRevision?.({ new: { id: 'revision-1', change_cursor: 11 }, old: {} });

    expect(reasons).toEqual(['realtime', 'realtime']);
    stop();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });
});
