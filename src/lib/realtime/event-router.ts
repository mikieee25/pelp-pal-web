import { syncDebug } from './debug';

export type RealtimeEvent = { id?: string; [key: string]: unknown };

export class RealtimeEventRouter {
  private readonly seen = new Set<string>();

  constructor(private readonly scheduleSync: (reason: 'realtime') => void) {}

  route(event: RealtimeEvent): void {
    const id = event.id;
    const cursor = typeof event.change_cursor === 'number' ? event.change_cursor : undefined;
    const key = id && cursor !== undefined ? `${id}:${cursor}` : undefined;
    if (key && this.seen.has(key)) {
      syncDebug('dropped duplicate realtime event', { id, change_cursor: cursor });
      return;
    }
    if (key) {
      this.seen.add(key);
      if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value as string);
    }
    this.scheduleSync('realtime');
  }
}
