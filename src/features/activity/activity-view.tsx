'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Box, Button, Chip, Container, Fab, FormControl, InputLabel, Menu, MenuItem, Paper, Select, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { AddRounded, EditRounded, QrCodeScannerRounded, SearchRounded, StoreRounded } from '@mui/icons-material';
import { CurrentStorePanel } from '@/features/store/current-store-panel';
import { getBrowserRepository } from '@/lib/db/browser';
import type { ActivityOutcome, ActivityRecord } from '@/lib/db/records';
import { fadeUp } from '@/lib/animation/gsap';
import { QrScannerDialog } from '@/features/lookup/qr-scanner-dialog';
import { extractLookupQuery } from '@/features/lookup/qr-value';
import { designTokens } from '@/theme/tokens';

export function ActivityView() {
  const repository = useMemo(() => getBrowserRepository(), []);
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [catalogProductTypes, setCatalogProductTypes] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<ActivityOutcome | 'all'>('all');
  const [productType, setProductType] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [quickActionAnchor, setQuickActionAnchor] = useState<HTMLElement | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  useLayoutEffect(() => fadeUp(contentRef.current), []);

  useEffect(() => {
    let active = true;
    void repository.listActivity({ outcome, productType: productType || undefined })
      .then((rows) => {
        if (active) {
          setActivities(rows);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (active) {
          setActivities([]);
          setStatus('error');
        }
      });
    return () => { active = false; };
  }, [outcome, productType, repository]);

  useEffect(() => {
    let active = true;
    void repository.getCatalogEcpTypes()
      .then((types) => {
        if (active) setCatalogProductTypes(types);
      })
      .catch(() => {
        if (active) setCatalogProductTypes([]);
      });
    return () => { active = false; };
  }, [repository]);

  const productTypes = Array.from(new Set([
    ...catalogProductTypes,
    ...activities.map((activity) => activity.productType).filter((value): value is string => Boolean(value)),
  ])).sort();
  const storeGroups = groupActivities(activities);

  return <>
    <Container ref={contentRef} maxWidth="lg" sx={{ px: { xs: 2, sm: 3, md: 4 }, py: { xs: 3, md: 5 } }}>
      <Stack spacing={0.75} sx={{ mb: { xs: 3, md: 4 } }}>
        <Typography variant="overline" color="primary.main" sx={{ fontWeight: 800, letterSpacing: '0.1em' }}>Local record</Typography>
        <Typography component="h1" variant="h4" sx={{ fontSize: { xs: '1.8rem', sm: '2.125rem' } }}>Activity</Typography>
        <Typography color="text.secondary">Completed inspections saved on this device.</Typography>
      </Stack>

      <Stack spacing={2.5}>
        <CurrentStorePanel />
        <Paper elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 2 }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <BoxHeading count={activities.length} />
              <ToggleButtonGroup
                exclusive
                fullWidth
                value={outcome}
                onChange={(_, value: ActivityOutcome | 'all' | null) => value && setOutcome(value)}
                size="small"
                aria-label="Activity outcome filter"
                sx={{
                  width: { xs: '100%', sm: 'auto' },
                  '& .MuiToggleButton-root': {
                    flex: { xs: 1, sm: 'initial' },
                    whiteSpace: 'nowrap',
                    px: { xs: 1, sm: 1.5 },
                  },
                }}
              >
                <ToggleButton value="all">All</ToggleButton>
                <ToggleButton value="compliant">Compliant</ToggleButton>
                <ToggleButton value="non_compliant">Non-compliant</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <FormControl size="small" sx={{ maxWidth: { xs: '100%', sm: 280 } }}>
              <InputLabel id="activity-product-filter-label">Product type</InputLabel>
              <Select labelId="activity-product-filter-label" label="Product type" value={productType} onChange={(event) => setProductType(event.target.value)}>
                <MenuItem value="">All product types</MenuItem>
                {productTypes.map((type) => <MenuItem key={type} value={type}>{type}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
        </Paper>

        {status === 'loading' ? <Stack spacing={1.5} aria-label="Loading activity"><Skeleton variant="rounded" height={150} /><Skeleton variant="rounded" height={150} /></Stack>
          : status === 'error' ? <Alert severity="error">Activity could not be loaded. Refresh to try again.</Alert>
            : activities.length === 0 ? <Alert severity="info">No completed inspections yet.</Alert>
              : <Stack component="ol" spacing={2} sx={{ listStyle: 'none', m: 0, p: 0 }}>{storeGroups.map((group) => <StoreActivityGroup key={group.key} group={group} />)}</Stack>}
      </Stack>
    </Container>
    <Fab
        color="primary"
        aria-label="Open quick actions"
        onClick={(event) => setQuickActionAnchor(event.currentTarget)}
        sx={{
          position: 'fixed',
          right: { xs: 'calc(16px + env(safe-area-inset-right))', sm: 'calc(24px + env(safe-area-inset-right))', md: 'calc(32px + env(safe-area-inset-right))' },
          bottom: { xs: `calc(${designTokens.layout.mobileNavigationHeight}px + 24px + env(safe-area-inset-bottom))`, md: '24px' },
          zIndex: 1100,
        }}
      >
        <AddRounded />
      </Fab>
    <Menu
        anchorEl={quickActionAnchor}
        open={Boolean(quickActionAnchor)}
        onClose={() => setQuickActionAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <MenuItem onClick={() => { setQuickActionAnchor(null); setIsScannerOpen(true); }}>
          <QrCodeScannerRounded fontSize="small" sx={{ mr: 1 }} />
          Scan QR code
        </MenuItem>
        <MenuItem component={Link} href="/lookup" onClick={() => setQuickActionAnchor(null)}>
          <SearchRounded fontSize="small" sx={{ mr: 1 }} />
          Search catalog
        </MenuItem>
      </Menu>
    <QrScannerDialog
        open={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onDetected={(payload) => {
          const query = extractLookupQuery(payload);
          setIsScannerOpen(false);
          router.push(query ? `/lookup?query=${encodeURIComponent(query)}` : '/lookup');
        }}
    />
  </>;
}

function BoxHeading({ count }: { count: number }) {
  return <Stack spacing={0.25}><Typography component="h2" variant="h6">Inspection history</Typography><Typography variant="body2" color="text.secondary">{count} completed {count === 1 ? 'inspection' : 'inspections'}</Typography></Stack>;
}

type ActivityGroup = {
  key: string;
  storeName: string;
  location?: string;
  activities: ActivityRecord[];
};

function groupActivities(activities: ActivityRecord[]): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>();
  for (const activity of activities) {
    const storeName = activity.storeName || 'Store not recorded';
    const key = `${storeName}\u0000${activity.location ?? ''}`;
    const group = groups.get(key);
    if (group) {
      group.activities.push(activity);
    } else {
      groups.set(key, { key, storeName, location: activity.location, activities: [activity] });
    }
  }
  return Array.from(groups.values());
}

function StoreActivityGroup({ group }: { group: ActivityGroup }) {
  return <Paper component="li" elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 2 }}>
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <StoreRounded color="primary" />
        <BoxHeadingStore group={group} />
      </Stack>
      <Stack component="ol" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {group.activities.map((activity, index) => <ActivityCard key={activity.id} activity={activity} inspectionNumber={index + 1} />)}
      </Stack>
    </Stack>
  </Paper>;
}

function BoxHeadingStore({ group }: { group: ActivityGroup }) {
  return <Stack spacing={0.25}>
    <Typography component="h3" variant="h6">{group.storeName}</Typography>
    <Typography variant="body2" color="text.secondary">{group.location || 'Location not recorded'} · {group.activities.length} {group.activities.length === 1 ? 'inspection' : 'inspections'}</Typography>
  </Stack>;
}

function ActivityCard({ activity, inspectionNumber }: { activity: ActivityRecord; inspectionNumber: number }) {
  const outcomeLabel = activity.outcome === 'compliant' ? 'Compliant' : activity.outcome === 'non_compliant' ? 'Non-compliant' : 'Outcome unavailable';
  return <Paper component="li" elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.default' }}>
    <Stack spacing={1}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
        <Stack spacing={0.25} sx={{ minWidth: 0 }}>
          <Typography component="h4" variant="subtitle1" fontWeight={700}>{activity.controlNumber || `Inspection ${inspectionNumber}`}</Typography>
          <Typography variant="body2" color="text.secondary">{[activity.location, activity.productType].filter(Boolean).join(' · ') || 'Inspection record'}</Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ alignSelf: { xs: 'flex-end', sm: 'auto' }, flexShrink: 0 }}>
          <Chip label={outcomeLabel} color={activity.outcome === 'compliant' ? 'success' : activity.outcome === 'non_compliant' ? 'error' : 'default'} size="small" />
          {activity.inspectionId && <Button component={Link} href={`/inspect/${encodeURIComponent(activity.inspectionId)}`} size="small" variant="outlined" startIcon={<EditRounded />} sx={{ whiteSpace: 'nowrap' }}>Edit inspection</Button>}
        </Stack>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Inspected by <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{activity.username || 'Unknown user'}</Box>
        {activity.evidenceCount !== undefined ? ` · ${activity.evidenceCount} evidence item${activity.evidenceCount === 1 ? '' : 's'}` : ''}
      </Typography>
    </Stack>
  </Paper>;
}
