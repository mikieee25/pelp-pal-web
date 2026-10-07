export function syncDebug(message: string, details?: unknown): void {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_SYNC_DEBUG !== 'true') return;
  if (details === undefined) {
    console.debug(`[sync] ${message}`);
  } else {
    console.debug(`[sync] ${message}`, details);
  }
}
