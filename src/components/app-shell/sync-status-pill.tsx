'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Chip, CircularProgress, Tooltip } from '@mui/material';
import { CloudDoneRounded, CloudOffRounded, ErrorOutlineRounded, SyncRounded, WarningAmberRounded } from '@mui/icons-material';
import type { SyncStatusSnapshot } from '@/features/sync/sync-status-store';
import { useSyncRuntimeStatusStore } from '@/features/sync/sync-runtime-boundary';

const emptySnapshot: SyncStatusSnapshot = { status: 'live', pendingCount: 0, conflictCount: 0, failedCount: 0 };
const noopSubscribe = () => () => undefined;
const getEmptySnapshot = () => emptySnapshot;

export function SyncStatusPill() {
  const store = useSyncRuntimeStatusStore();
  const subscribe = useCallback((listener: () => void) => store?.subscribe(listener) ?? noopSubscribe(), [store]);
  const getSnapshot = useCallback(() => store?.getSnapshot() ?? getEmptySnapshot(), [store]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getEmptySnapshot);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!store) return null;

  const display = getStatusDisplay(snapshot, online);
  const secondary = snapshot.realtimeState !== 'connected' && snapshot.pollingActive ? 'Polling fallback is active.' : undefined;
  const tooltip = [formatLastSynced(snapshot.lastSyncedAt), secondary].filter(Boolean).join(' · ') || 'Synchronization status';

  return (
    <Tooltip title={tooltip} arrow>
      <Chip
        component={Link}
        href="/sync"
        clickable
        icon={display.icon}
        label={<>
          <span data-testid="sync-status-pill-full-label" className="sync-status-pill-full-label">{display.label}</span>
          <span data-testid="sync-status-pill-compact-label" className="sync-status-pill-compact-label">{display.compactLabel}</span>
        </>}
        color={display.color}
        variant="outlined"
        aria-label={display.label}
        aria-live="polite"
        data-testid="sync-status-pill"
        sx={{
          maxWidth: '100%',
          '& .sync-status-pill-compact-label': { display: 'none' },
          '@media (max-width: 600px)': {
            '& .sync-status-pill-full-label': { display: 'none' },
            '& .sync-status-pill-compact-label': { display: 'inline' },
          },
        }}
      />
    </Tooltip>
  );
}

function getStatusDisplay(snapshot: SyncStatusSnapshot, online: boolean) {
  if (snapshot.status === 'syncing') return { label: 'Syncing…', compactLabel: '…', color: 'primary' as const, icon: <CircularProgress size={16} color="inherit" /> };
  const attentionCount = (snapshot.failedCount ?? 0) + snapshot.conflictCount;
  if (attentionCount > 0) return { label: `${attentionCount} need attention`, compactLabel: String(attentionCount), color: 'error' as const, icon: <ErrorOutlineRounded fontSize="small" /> };
  if ((snapshot.pendingCount ?? 0) > 0 || (snapshot.retryingCount ?? 0) > 0) {
    const pendingCount = snapshot.pendingCount ?? 0;
    return { label: `${pendingCount} waiting`, compactLabel: String(pendingCount), color: 'warning' as const, icon: <WarningAmberRounded fontSize="small" /> };
  }
  if (!online) return { label: 'Offline', compactLabel: '—', color: 'default' as const, icon: <CloudOffRounded fontSize="small" /> };
  return { label: 'Up to date', compactLabel: '✓', color: 'success' as const, icon: snapshot.realtimeState === 'connected' ? <CloudDoneRounded fontSize="small" /> : <SyncRounded fontSize="small" /> };
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
