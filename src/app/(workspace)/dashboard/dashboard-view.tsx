'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Box, Button, Grid, Stack, Typography } from '@mui/material';
import { ErrorOutlineRounded, QrCodeScannerRounded, SearchRounded } from '@mui/icons-material';
import { EmptyState, InlineNotice, ListRow, PageHeader, PageShell, Section, Stat, StatusBadge, Surface } from '@/components/ui';
import { CurrentStorePanel } from '@/features/store/current-store-panel';
import type { ActivityRecord } from '@/lib/db/records';
import { getBrowserRepository } from '@/lib/db/browser';
import { designTokens } from '@/theme/tokens';

type Counts = {
  completedInspections: number;
  drafts: number;
  pendingSync: number;
};

type SyncCounts = {
  failedCount: number;
  conflictCount: number;
  evidencePendingCount: number;
};

const emptySyncCounts: SyncCounts = { failedCount: 0, conflictCount: 0, evidencePendingCount: 0 };

export function DashboardView() {
  const [counts, setCounts] = useState<Counts>();
  const [syncCounts, setSyncCounts] = useState<SyncCounts>(emptySyncCounts);
  const [recent, setRecent] = useState<ActivityRecord[]>([]);
  const [failed, setFailed] = useState<ActivityRecord[]>([]);
  const [conflicts, setConflicts] = useState<ActivityRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    const repository = getBrowserRepository();
    void Promise.all([
      repository.getDashboardCounts(),
      repository.listActivity({ limit: 5 }),
      repository.listActivity({ syncStatus: 'failed', limit: 5 }),
      repository.listActivity({ syncStatus: 'conflict', limit: 5 }),
      repository.getSyncStatusCounts(),
    ]).then(([nextCounts, nextRecent, nextFailed, nextConflicts, nextSyncCounts]) => {
      if (!active) return;
      setCounts(nextCounts);
      setRecent(nextRecent);
      setFailed(nextFailed);
      setConflicts(nextConflicts);
      setSyncCounts(nextSyncCounts);
      setLoaded(true);
    }).catch(() => {
      if (!active) return;
      setLoadError(true);
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  const hasAttention = loaded && (
    syncCounts.failedCount > 0 || syncCounts.conflictCount > 0 || syncCounts.evidencePendingCount > 0
  );

  return (
    <PageShell>
      <Stack spacing={{ xs: 5, md: 6 }}>
        <PageHeader title="Dashboard" subtitle="Start an inspection or continue recent work." />

        <Surface sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={3}>
            <Box>
              <Typography component="h2" variant="h2">Start work</Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>Scan a label or find a product in the authorized catalog.</Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ width: '100%' }}>
              <Button component={Link} href="/lookup?scan=1" variant="contained" startIcon={<QrCodeScannerRounded />} fullWidth>
                Scan label
              </Button>
              <Button component={Link} href="/lookup" variant="outlined" startIcon={<SearchRounded />} fullWidth>
                Search catalog
              </Button>
            </Stack>
          </Stack>
        </Surface>

        <CurrentStorePanel returnTo="/dashboard" />

        {loadError && <InlineNotice severity="error">Local dashboard information could not be loaded. Refresh to try again.</InlineNotice>}

        {hasAttention && (
          <Section title="Needs attention">
            <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
              {failed.map((activity) => (
                <Link key={`failed-${activity.id}`} href={activity.inspectionId ? `/inspect/${activity.inspectionId}` : '/sync'} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <ListRow
                    primary={controlNumber(activity) || 'Inspection upload failed'}
                    secondary={activitySummary(activity) || activity.syncError || 'Review this upload in Activity.'}
                    trailing={<StatusBadge variant="attention" label="Upload failed" />}
                    chevron
                  />
                </Link>
              ))}
              {syncCounts.failedCount > failed.length && (
                <Link href="/sync" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <ListRow primary={`${syncCounts.failedCount - failed.length} more uploads need attention`} secondary="Review failed uploads in Sync." trailing={<StatusBadge variant="attention" label="Failed" />} chevron />
                </Link>
              )}
              {conflicts.map((activity) => (
                <Link key={`conflict-${activity.id}`} href="/sync" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <ListRow
                    primary={controlNumber(activity) || 'Inspection conflict'}
                    secondary={activitySummary(activity) || 'Review the conflicting changes.'}
                    trailing={<StatusBadge variant="attention" label="Needs review" />}
                    chevron
                  />
                </Link>
              ))}
              {syncCounts.conflictCount > conflicts.length && (
                <Link href="/sync" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <ListRow primary={`${syncCounts.conflictCount - conflicts.length} more conflicts need review`} secondary="Review conflicting changes in Sync." trailing={<StatusBadge variant="attention" label="Needs review" />} chevron />
                </Link>
              )}
              {syncCounts.evidencePendingCount > 0 && (
                <Link href="/sync" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <ListRow
                    leading={<ErrorOutlineRounded color="warning" aria-hidden />}
                    primary={`Photos waiting to upload (${syncCounts.evidencePendingCount})`}
                    secondary="Review photo upload status in Sync."
                    trailing={<StatusBadge variant="waiting" />}
                    chevron
                  />
                </Link>
              )}
            </Stack>
          </Section>
        )}

        <Section title="Work at a glance">
          <Surface sx={{ p: { xs: 3, sm: 4 } }}>
            <Grid container spacing={3}>
              <Grid size={{ xs: 4 }}><Stat value={counts?.completedInspections ?? '—'} label="Completed" /></Grid>
              <Grid size={{ xs: 4 }}><Stat value={counts?.drafts ?? '—'} label="Drafts" /></Grid>
              <Grid size={{ xs: 4 }}><Stat value={counts ? counts.pendingSync + syncCounts.evidencePendingCount : '—'} label="Waiting to upload" /></Grid>
            </Grid>
          </Surface>
        </Section>

        <Section title="Recent inspections">
          {recent.length > 0 ? (
            <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
              {recent.slice(0, 5).map((activity) => (
                <Link key={activity.id} href={activity.inspectionId ? `/inspect/${activity.inspectionId}` : '/activity'} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <ListRow
                    primary={<Box component="span" sx={{ fontFamily: designTokens.typography.monoFontFamily, fontSize: `${designTokens.typography.monoSize}px`, fontWeight: 600 }}>{controlNumber(activity) || 'Inspection'}</Box>}
                    secondary={activitySummary(activity)}
                    trailing={<Typography variant="body2" color="text.secondary">{activity.productType || 'Product details'}</Typography>}
                    chevron
                  />
                </Link>
              ))}
            </Stack>
          ) : (
            <EmptyState icon={<SearchRounded fontSize="large" />} message="Completed inspections will appear here." />
          )}
        </Section>
      </Stack>
    </PageShell>
  );
}

function controlNumber(activity: ActivityRecord): string {
  return activity.controlNumber?.trim() ?? '';
}

function activitySummary(activity: ActivityRecord): string {
  return [activity.brand, activity.model, activity.storeName].filter((part) => part?.trim()).join(' · ');
}
