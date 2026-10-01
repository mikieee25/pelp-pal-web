export type RealtimeEvent = { id?: string; [key: string]: unknown };

export class RealtimeEventRouter {
  private readonly seen = new Set<string>();

  constructor(private readonly scheduleSync: (reason: 'realtime') => void) {}

  route(event: RealtimeEvent): void {
    const id = event.id;
    if (id && this.seen.has(id)) return;
    if (id) {
      this.seen.add(id);
      if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value as string);
    }
    this.scheduleSync('realtime');
  }
}
