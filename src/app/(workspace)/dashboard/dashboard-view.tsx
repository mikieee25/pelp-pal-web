'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Grid,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AssignmentTurnedInRounded,
  CloudDoneRounded,
  ErrorOutlineRounded,
  PendingActionsRounded,
  RateReviewRounded,
  SyncRounded,
} from '@mui/icons-material';
import { getBrowserRepository } from '@/lib/db/browser';
import type { InspectionRecord } from '@/lib/db/records';
import { DeviceEnrollmentStatus } from '@/components/device/device-enrollment-status';
import { CurrentStorePanel } from '@/features/store/current-store-panel';
import { designTokens } from '@/theme/tokens';

type Counts = {
  completedInspections: number;
  drafts: number;
  pendingSync: number;
  openConflicts: number;
};

const metricDefinitions = [
  { key: 'completedInspections', label: 'Completed inspections', detail: 'Saved on this device', icon: <AssignmentTurnedInRounded />, color: 'success.main' },
  { key: 'drafts', label: 'Drafts on this device', detail: 'Work ready to continue', icon: <RateReviewRounded />, color: 'primary.main' },
  { key: 'pendingSync', label: 'Pending sync', detail: 'Waiting for a connection', icon: <PendingActionsRounded />, color: 'warning.main' },
  { key: 'openConflicts', label: 'Open conflicts', detail: 'Need your attention', icon: <ErrorOutlineRounded />, color: 'error.main' },
] as const;

export function DashboardView() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [drafts, setDrafts] = useState<InspectionRecord[]>([]);
  const [countsError, setCountsError] = useState(false);
  useEffect(() => {
    let active = true;
    const repository = getBrowserRepository();
    void Promise.all([repository.getDashboardCounts(), repository.listInspectionDrafts(10)])
      .then(([nextCounts, nextDrafts]) => {
        if (active) {
          setCounts(nextCounts);
          setDrafts(nextDrafts);
        }
      })
      .catch(() => {
        if (active) setCountsError(true);
      });
    return () => { active = false; };
  }, []);

  return (
    <Container maxWidth="lg" sx={{ px: { xs: 2, sm: 3, md: 4 }, py: { xs: 3, md: 5 } }}>
      <Stack spacing={0.75} sx={{ mb: { xs: 3, md: 4 } }}>
        <Typography variant="overline" color="primary.main" sx={{ fontWeight: 800, letterSpacing: '0.1em' }}>
          Field workspace
        </Typography>
        <Typography component="h1" variant="h4" sx={{ fontSize: { xs: '1.8rem', sm: '2.125rem' } }}>
          Good to see you back.
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 660 }}>
          Review local work, prepare inspections, and stay ready to sync when your connection returns.
        </Typography>
      </Stack>

      <Paper
        elevation={0}
        sx={(theme) => ({
          mb: { xs: 3, md: 4 },
          p: { xs: 2.5, sm: 3.5 },
          color: 'primary.contrastText',
          borderRadius: 3,
          background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 100%)`,
          overflow: 'hidden',
          position: 'relative',
          '&::after': {
            content: '""',
            position: 'absolute',
            width: { xs: 180, md: 280 },
            height: { xs: 180, md: 280 },
            right: { xs: -80, md: -60 },
            top: { xs: -90, md: -130 },
            borderRadius: '50%',
            bgcolor: alpha(theme.palette.primary.contrastText, 0.08),
          },
        })}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" sx={{ position: 'relative', zIndex: 1 }}>
          <Stack spacing={1}>
            <Chip
              icon={<CloudDoneRounded />}
              label="Local-first mode"
              size="small"
              sx={(theme) => ({ alignSelf: 'flex-start', color: 'inherit', bgcolor: alpha(theme.palette.primary.contrastText, 0.14), '& .MuiChip-icon': { color: 'inherit' } })}
            />
            <Typography variant="h5" fontWeight={700}>Ready for field work</Typography>
            <Typography sx={(theme) => ({ maxWidth: 600, color: alpha(theme.palette.primary.contrastText, 0.82) })}>
              Drafts, evidence, and inspection records remain available on this device while you work offline.
            </Typography>
          </Stack>
          <Button component={Link} href="/lookup" variant="contained" color="inherit" sx={{ flexShrink: 0, color: 'primary.dark', bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.default' } }}>
            Browse catalog
          </Button>
        </Stack>
      </Paper>

      <Box sx={{ mb: { xs: 3, md: 4 } }}>
        <CurrentStorePanel returnTo="/dashboard" />
      </Box>

      <Stack spacing={2} sx={{ mb: { xs: 3, md: 4 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
          <Box>
            <Typography component="h2" variant="h5">Work at a glance</Typography>
            <Typography variant="body2" color="text.secondary">A quick view of what is happening locally.</Typography>
          </Box>
          <Chip label="This device" size="small" variant="outlined" />
        </Stack>

        {countsError && <Alert severity="error">Local work could not be loaded. Refresh to try again.</Alert>}

        <Grid container spacing={{ xs: 1.5, sm: 2 }}>
          {metricDefinitions.map((metric) => (
            <Grid key={metric.key} size={{ xs: 12, sm: 6, lg: 3 }}>
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 2, sm: 2.5 },
                  height: '100%',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 2,
                  transition: (theme) => theme.transitions.create(['border-color', 'box-shadow'], { duration: designTokens.motion.duration.fast * 1000 }),
                  '&:hover': { borderColor: 'primary.light', boxShadow: 2 },
                }}
              >
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
                  <Stack spacing={1.5}>
                    <Typography variant="body2" color="text.secondary">{metric.label}</Typography>
                    {counts ? (
                      <Typography component="p" variant="h3" sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                        {counts[metric.key]}
                      </Typography>
                    ) : (
                      <Skeleton variant="text" width={58} height={44} />
                    )}
                    <Typography variant="caption" color="text.secondary">{metric.detail}</Typography>
                  </Stack>
                  <Box sx={{ display: 'grid', placeItems: 'center', width: 40, height: 40, flexShrink: 0, borderRadius: 2, bgcolor: 'action.hover', color: metric.color }}>
                    {metric.icon}
                  </Box>
                </Stack>
              </Paper>
            </Grid>
          ))}
        </Grid>
      </Stack>

      <Grid container spacing={{ xs: 2, md: 3 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper elevation={0} sx={{ p: { xs: 2.5, sm: 3 }, height: '100%', border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Stack spacing={2}>
              <Box>
                <Typography component="h2" variant="h6">Continue your work</Typography>
                <Typography variant="body2" color="text.secondary">Pick up where you left off on this device.</Typography>
              </Box>
              {counts?.drafts ? drafts.length > 0 ? (
                <Stack spacing={1}>
                  {drafts.map((draft) => <DraftItem key={draft.id} draft={draft} />)}
                  {counts.drafts > drafts.length && <Typography variant="caption" color="text.secondary">Showing the latest {drafts.length} of {counts.drafts} drafts.</Typography>}
                </Stack>
              ) : (
                <Alert severity="warning">Drafts are saved on this device, but their details could not be listed. Refresh and try again.</Alert>
              ) : (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Box>
                    <Typography variant="body2" fontWeight={700}>No local inspections yet</Typography>
                    <Typography variant="caption" color="text.secondary">Start by browsing the authorized catalog.</Typography>
                  </Box>
                  <Button component={Link} href="/lookup" size="small" variant="outlined">Browse catalog</Button>
                </Stack>
              )}
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper elevation={0} sx={{ p: { xs: 2.5, sm: 3 }, height: '100%', border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Stack spacing={2}>
              <Box>
                <Typography component="h2" variant="h6">Sync readiness</Typography>
                <Typography variant="body2" color="text.secondary">Device access and connection state.</Typography>
              </Box>
              <DeviceEnrollmentStatus surface={false} />
              <Button component={Link} href="/sync" variant="text" endIcon={<SyncRounded />} sx={{ alignSelf: 'flex-start', px: 0 }}>
                Open sync center
              </Button>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}

function DraftItem({ draft }: { draft: InspectionRecord }) {
  const storeName = textValue(draft.storeName) || 'Unnamed store';
  const controlNumber = textValue(draft.controlNumber);

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      alignItems={{ xs: 'stretch', sm: 'center' }}
      sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}
    >
      <RateReviewRounded color="primary" />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={700}>{storeName}</Typography>
        <Typography variant="caption" color="text.secondary">
          {controlNumber || 'Inspection draft'}
        </Typography>
      </Box>
      <Button component={Link} href={`/inspect/${draft.id}`} size="small" variant="outlined" sx={{ alignSelf: { xs: 'stretch', sm: 'center' } }}>
        Resume
      </Button>
    </Stack>
  );
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
