import type { SyncStatusSnapshot } from './sync-status-store';

export type SyncHeadline = {
  title: 'Everything is up to date' | `${number} waiting to upload` | 'Syncing…' | 'Needs attention';
  tone: 'success' | 'warning' | 'info' | 'error';
  progress: boolean;
};

export type SyncErrorPresentation = {
  message: string;
  details: string[];
  kind: 'retry' | 'conflict';
} | undefined;

export function getSyncHeadline(snapshot: SyncStatusSnapshot): SyncHeadline {
  if (snapshot.status === 'syncing') return { title: 'Syncing…', tone: 'info', progress: true };
  if ((snapshot.failedCount ?? 0) > 0 || snapshot.conflictCount > 0 || snapshot.status === 'error') {
    return { title: 'Needs attention', tone: 'error', progress: false };
  }
  const waiting = snapshot.pendingCount + (snapshot.retryingCount ?? 0)
    + (snapshot.evidencePendingCount ?? 0) + (snapshot.evidenceFailedCount ?? 0);
  if (waiting > 0) return { title: `${waiting} waiting to upload`, tone: 'warning', progress: false };
  return { title: 'Everything is up to date', tone: 'success', progress: false };
}

export function getSyncErrorPresentation(
  snapshot: SyncStatusSnapshot,
  additionalMessages: Array<string | undefined> = [],
): SyncErrorPresentation {
  const details = Array.from(new Set([
    snapshot.lastError,
    snapshot.lastOperationResult?.error,
    snapshot.diagnosticsError,
    ...additionalMessages,
  ].map((message) => message?.trim()).filter((message): message is string => Boolean(message))));
  const browserOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (snapshot.conflictCount > 0) {
    return { message: 'Some inspections conflict with newer versions. Review them before retrying.', details, kind: 'conflict' };
  }
  if (details.length === 0 && !(snapshot.status === 'offline' && browserOffline)
    && snapshot.status !== 'error' && !(snapshot.failedCount ?? 0)) return undefined;
  if (details.some((message) => /not found|cannot be found|can not be found/i.test(message))) {
    return {
      message: 'A photo couldn\'t be found on the server yet. It will be uploaded again from the device that took it.',
      details,
      kind: 'retry',
    };
  }
  if (browserOffline || details.some((message) => /offline|network is unavailable|network unavailable|failed to fetch/i.test(message))) {
    return { message: 'You\'re offline. Changes will upload when you\'re back online.', details, kind: 'retry' };
  }
  return { message: 'Sync couldn\'t finish. Try again.', details, kind: 'retry' };
}

export function formatRelativeSyncTime(value: string, now = new Date()): string {
  const time = new Date(value).valueOf();
  if (Number.isNaN(time)) return value;
  const seconds = Math.round((time - now.valueOf()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800],
    ['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1],
  ];
  const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? units[units.length - 1]!;
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
}
