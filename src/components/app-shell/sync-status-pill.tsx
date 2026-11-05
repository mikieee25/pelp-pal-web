'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { CloudCheck, CloudOff, CircleAlert, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import type { SyncStatusSnapshot } from '@/features/sync/sync-status-store';
import { useSyncRuntimeStatusStore } from '@/features/sync/sync-runtime-boundary';

const emptySnapshot: SyncStatusSnapshot = { status: 'live', pendingCount: 0, conflictCount: 0, failedCount: 0, evidencePendingCount: 0, evidenceFailedCount: 0 };
const noopSubscribe = () => () => undefined;
const getEmptySnapshot = () => emptySnapshot;

export function SyncStatusPill() {
  const store = useSyncRuntimeStatusStore();
  const subscribe = useCallback((listener: () => void) => store?.subscribe(listener) ?? noopSubscribe(), [store]);
  const getSnapshot = useCallback(() => store?.getSnapshot() ?? getEmptySnapshot(), [store]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getEmptySnapshot);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  if (!store) return null;
  const display = getStatusDisplay(snapshot, online);
  const secondary = snapshot.realtimeState !== 'connected' && snapshot.pollingActive ? 'Polling fallback is active.' : undefined;
  const tooltip = [formatLastSynced(snapshot.lastSyncedAt), secondary, snapshot.evidenceLastError].filter(Boolean).join(' · ') || 'Synchronization status';
  const Icon = display.icon;
  return <Link href="/sync" data-testid="sync-status-pill" aria-label={display.label} aria-live="polite" title={tooltip}
    onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)} onFocus={() => setShowTooltip(true)} onBlur={() => setShowTooltip(false)}
    className={`relative inline-flex min-h-9 max-w-full shrink items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${display.tone}`}>
    <Icon aria-hidden="true" className={`size-4 shrink-0 ${snapshot.status === 'syncing' ? 'animate-spin' : ''}`} />
    <span data-testid="sync-status-pill-full-label" className="truncate max-[600px]:hidden">{display.label}</span>
    <span data-testid="sync-status-pill-compact-label" className="hidden max-[600px]:inline">{display.compactLabel}</span>
    {showTooltip && <span role="tooltip" className="absolute right-0 top-full z-50 mt-2 w-max max-w-[min(90vw,320px)] rounded-lg bg-ink px-3 py-2 text-xs font-normal text-white shadow-lg">{tooltip}</span>}
  </Link>;
}

function getStatusDisplay(snapshot: SyncStatusSnapshot, online: boolean) {
  if (snapshot.status === 'syncing') return { label: 'Syncing…', compactLabel: '…', tone: 'border-primary text-primary bg-primary-soft', icon: LoaderCircle };
  const attentionCount = (snapshot.failedCount ?? 0) + snapshot.conflictCount;
  if (attentionCount > 0) return { label: `${attentionCount} need attention`, compactLabel: String(attentionCount), tone: 'border-danger text-danger bg-danger-soft', icon: CircleAlert };
  const waitingPhotos = (snapshot.evidencePendingCount ?? 0) + (snapshot.evidenceFailedCount ?? 0);
  if (waitingPhotos > 0) return { label: `${waitingPhotos} photos waiting`, compactLabel: String(waitingPhotos), tone: 'border-warning text-warning bg-warning-soft', icon: TriangleAlert };
  if ((snapshot.pendingCount ?? 0) > 0 || (snapshot.retryingCount ?? 0) > 0) {
    const pendingCount = snapshot.pendingCount ?? 0;
    return { label: `${pendingCount} waiting`, compactLabel: String(pendingCount), tone: 'border-warning text-warning bg-warning-soft', icon: TriangleAlert };
  }
  if (!online) return { label: 'Offline', compactLabel: '—', tone: 'border-border-strong text-muted bg-surface-alt', icon: CloudOff };
  return { label: 'Up to date', compactLabel: '✓', tone: 'border-success text-success bg-success-soft', icon: snapshot.realtimeState === 'connected' ? CloudCheck : RefreshCw };
}

function formatLastSynced(value?: string): string {
  if (!value) return 'Not synced yet';
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Last synced just now';
  if (minutes < 60) return `Last synced ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last synced ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Last synced ${days} day${days === 1 ? '' : 's'} ago`;
}
