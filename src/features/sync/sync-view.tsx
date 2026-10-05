'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Alert, Box, Button, Chip, Container, Paper, Stack, Typography } from '@mui/material';
import SyncRounded from '@mui/icons-material/SyncRounded';
import WifiOffRounded from '@mui/icons-material/WifiOffRounded';
import { DeviceEnrollmentStatus } from '@/components/device/device-enrollment-status';
import { getSyncRuntime } from '@/lib/sync/runtime';
import type { SyncStatusSnapshot } from './sync-status-store';
import type { SyncStatusStore } from './sync-status-store';

const emptySnapshot: SyncStatusSnapshot = { status: 'offline', pendingCount: 0, conflictCount: 0 };

const labels: Record<SyncStatusSnapshot['status'], string> = {
  live: 'Live', syncing: 'Syncing', pending: 'Pending', reconnecting: 'Reconnecting', offline: 'Offline', error: 'Error',
};

export function SyncView({ statusStore }: { statusStore?: SyncStatusStore | Pick<SyncStatusStore, 'subscribe' | 'getSnapshot' | 'syncNow'> }) {
  const activeStore = statusStore ?? getSyncRuntime()?.statusStore;
  const subscribe = useCallback(
    (listener: () => void) => activeStore?.subscribe(listener) ?? noopSubscribe(),
    [activeStore],
  );
  const getSnapshot = useCallback(
    () => activeStore?.getSnapshot() ?? emptySnapshot,
    [activeStore],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getEmptySnapshot,
  );

  const sync = (reason: 'manual' | 'retry') => {
    void activeStore?.syncNow(reason).catch(() => undefined);
  };

  return <Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}>
    <Stack spacing={{ xs: 2.5, md: 3 }}>
      <Box>
        <Typography component="h1" variant="h3">Sync</Typography>
        <Typography color="text.secondary">Keep completed inspections available to the consolidated report.</Typography>
      </Box>
      <DeviceEnrollmentStatus />
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box aria-hidden sx={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: '50%', bgcolor: 'action.hover', color: snapshot.status === 'offline' ? 'text.secondary' : 'primary.main' }}>
                {snapshot.status === 'offline' ? <WifiOffRounded /> : <SyncRounded />}
              </Box>
              <Box>
                <Typography variant="h6">Synchronization status</Typography>
                <Typography variant="body2" color="text.secondary">The coordinator pulls remote changes and sends completed local inspections.</Typography>
              </Box>
            </Stack>
            <Chip label={labels[snapshot.status]} color={snapshot.status === 'error' ? 'error' : snapshot.status === 'live' ? 'success' : 'default'} />
          </Stack>
          {snapshot.lastError && <Alert severity="error" role="alert">{snapshot.lastError}</Alert>}
          {snapshot.status === 'offline' && <Alert severity="info">Local data remains available while this browser is offline or not enrolled.</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={`${snapshot.pendingCount} pending`} variant="outlined" />
            <Chip label={`${snapshot.conflictCount} ${snapshot.conflictCount === 1 ? 'conflict' : 'conflicts'}`} variant="outlined" color={snapshot.conflictCount > 0 ? 'warning' : 'default'} />
            <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
              {snapshot.lastSyncedAt ? `Last synced ${formatTime(snapshot.lastSyncedAt)}` : 'Not synced in this session'}
            </Typography>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button variant="contained" startIcon={<SyncRounded />} onClick={() => sync('manual')} disabled={!activeStore || snapshot.status === 'syncing'}>Sync now</Button>
            {snapshot.status === 'error' && <Button variant="outlined" onClick={() => sync('retry')} disabled={!activeStore}>Retry sync</Button>}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  </Container>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function noopSubscribe(): () => void { return () => undefined; }
function getEmptySnapshot(): SyncStatusSnapshot { return emptySnapshot; }
