'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Box, Button, Chip, Collapse, Container, Dialog, DialogActions, DialogContent, DialogTitle, Fab, FormControl, InputLabel, Menu, MenuItem, Paper, Portal, Select, Skeleton, Snackbar, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography, IconButton } from '@mui/material';
import { AddRounded, DeleteOutlineRounded, EditRounded, ExpandMoreRounded, MoreVertRounded, QrCodeScannerRounded, SearchRounded, StoreRounded, VisibilityOutlined } from '@mui/icons-material';
import { getBrowserRepository } from '@/lib/db/browser';
import { getSyncRuntime } from '@/lib/sync/runtime';
import { useRepositoryRevision } from '@/lib/db/use-repository-revision';
import type { ActivityFilter, ActivityFilterOptions, ActivityOutcome, ActivityPageCursor, ActivityRecord, ActivitySyncStatus } from '@/lib/db/records';
import { QrScannerDialog } from '@/features/lookup/qr-scanner-dialog';
import { extractLookupQuery } from '@/features/lookup/qr-value';
import { designTokens } from '@/theme/tokens';
import { useSyncRuntimeStatusStore } from '@/features/sync/sync-runtime-boundary';

const ACTIVITY_PAGE_SIZE = 100;
const ACTIVITY_STORE_PAGE_SIZE = 8;
const ACTIVITY_VIEW_STATE_KEY = 'pelp-pal:activity-view:v2';
const LEGACY_ACTIVITY_VIEW_STATE_KEY = 'pelp-pal:activity-view:v1';
const noopSyncSubscribe = () => () => undefined;

type ActivityViewState = {
  filters: {
    outcome: ActivityOutcome | 'all';
    productType: string;
    storeName: string;
    inspector: string;
    syncStatus: ActivitySyncStatus | '';
    evidence: 'all' | 'with' | 'without';
    dateFrom: string;
    dateTo: string;
  };
  expandedStoreKeys: string[];
};

function readActivityViewState(): ActivityViewState {
  const defaults: ActivityViewState = {
    filters: {
      outcome: 'all',
      productType: '',
      storeName: '',
      inspector: '',
      syncStatus: '',
      evidence: 'all',
      dateFrom: '',
      dateTo: '',
    },
    expandedStoreKeys: [],
  };
  if (typeof window === 'undefined') return defaults;

  try {
    const currentRaw = window.localStorage.getItem(ACTIVITY_VIEW_STATE_KEY);
    const legacyRaw = window.localStorage.getItem(LEGACY_ACTIVITY_VIEW_STATE_KEY);
    const parsed: unknown = JSON.parse(currentRaw ?? legacyRaw ?? 'null');
    if (!isRecord(parsed)) return defaults;
    const rawFilters = isRecord(parsed.filters) ? parsed.filters : {};
    const rawOutcome = rawFilters.outcome;
    const rawEvidence = rawFilters.evidence;
    const rawSyncStatus = rawFilters.syncStatus;
    const expandedStoreKeys = currentRaw && Array.isArray(parsed.expandedStoreKeys)
      ? parsed.expandedStoreKeys.filter((value): value is string => typeof value === 'string').slice(0, 500)
      : [];

    return {
      filters: {
        outcome: rawOutcome === 'compliant' || rawOutcome === 'non_compliant' ? rawOutcome : 'all',
        productType: stringValue(rawFilters.productType),
        storeName: stringValue(rawFilters.storeName),
        inspector: stringValue(rawFilters.inspector),
        syncStatus: isActivitySyncStatus(rawSyncStatus) ? rawSyncStatus : '',
        evidence: rawEvidence === 'with' || rawEvidence === 'without' ? rawEvidence : 'all',
        dateFrom: stringValue(rawFilters.dateFrom),
        dateTo: stringValue(rawFilters.dateTo),
      },
      expandedStoreKeys,
    };
  } catch {
    return defaults;
  } finally {
    try {
      window.localStorage.removeItem(LEGACY_ACTIVITY_VIEW_STATE_KEY);
    } catch {
      // Storage may be disabled or unavailable in private browsing.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function withSelectedOption(options: string[], selected: string): string[] {
  if (!selected || options.includes(selected)) return options;
  return [...options, selected].sort((left, right) => left.localeCompare(right));
}

function isActivitySyncStatus(value: unknown): value is ActivitySyncStatus {
  return value === 'pending' || value === 'uploading' || value === 'pushing' || value === 'retry' || value === 'conflict' || value === 'failed' || value === 'synced' || value === 'remote';
}

export function ActivityView() {
  const repository = useMemo(() => getBrowserRepository(), []);
  const repositoryRevision = useRepositoryRevision(repository);
  const router = useRouter();
  const [persistedViewState] = useState(readActivityViewState);
  const [allActivities, setAllActivities] = useState<ActivityRecord[]>([]);
  const [catalogProductTypes, setCatalogProductTypes] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<ActivityOutcome | 'all'>(() => persistedViewState.filters.outcome);
  const [productType, setProductType] = useState(() => persistedViewState.filters.productType);
  const [storeName, setStoreName] = useState(() => persistedViewState.filters.storeName);
  const [inspector, setInspector] = useState(() => persistedViewState.filters.inspector);
  const [syncStatus, setSyncStatus] = useState<ActivitySyncStatus | ''>(() => persistedViewState.filters.syncStatus);
  const [evidence, setEvidence] = useState<'all' | 'with' | 'without'>(() => persistedViewState.filters.evidence);
  const [dateFrom, setDateFrom] = useState(() => persistedViewState.filters.dateFrom);
  const [dateTo, setDateTo] = useState(() => persistedViewState.filters.dateTo);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [displayStoreLimit, setDisplayStoreLimit] = useState(ACTIVITY_STORE_PAGE_SIZE);
  const [activityCursor, setActivityCursor] = useState<ActivityPageCursor>();
  const [hasMoreActivity, setHasMoreActivity] = useState(false);
  const [isLoadingMoreActivity, setIsLoadingMoreActivity] = useState(false);
  const [expandedStoreKeys, setExpandedStoreKeys] = useState(() => new Set(persistedViewState.expandedStoreKeys));
  const [filterOptions, setFilterOptions] = useState<ActivityFilterOptions>({ storeNames: [], inspectors: [], productTypes: [] });
  const [quickActionAnchor, setQuickActionAnchor] = useState<HTMLElement | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ActivityRecord>();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [revealedActivityId, setRevealedActivityId] = useState<string>();
  const [undoInspectionId, setUndoInspectionId] = useState<string>();
  const runtimeStatusStore = useSyncRuntimeStatusStore();
  const subscribeSyncStatus = useCallback((listener: () => void) => runtimeStatusStore?.subscribe(listener) ?? noopSyncSubscribe(), [runtimeStatusStore]);
  const getSyncStatusSnapshot = useCallback(() => runtimeStatusStore?.getSnapshot(), [runtimeStatusStore]);
  const syncSnapshot = useSyncExternalStore(subscribeSyncStatus, getSyncStatusSnapshot, getSyncStatusSnapshot);
  const [retryingInspectionIds, setRetryingInspectionIds] = useState(() => new Set<string>());

  const activityFilter = useMemo<ActivityFilter>(() => ({
    outcome,
    productType: productType || undefined,
    storeName: storeName || undefined,
    inspector: inspector || undefined,
    syncStatus: syncStatus || undefined,
    evidence,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }), [dateFrom, dateTo, evidence, inspector, outcome, productType, storeName, syncStatus]);

  useEffect(() => {
    let active = true;
    const pageLoader = repository.listActivityPage;
    const load = async () => {
      if (typeof pageLoader !== 'function') {
        return {
          rows: await repository.listActivity({ ...activityFilter, limit: ACTIVITY_PAGE_SIZE }),
          cursor: undefined,
          hasMore: false,
        };
      }

      const rows: ActivityRecord[] = [];
      let cursor: ActivityPageCursor | undefined;
      let hasMore = false;
      do {
        const page = await pageLoader.call(repository, {
          ...activityFilter,
          limit: ACTIVITY_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        rows.push(...page.rows);
        cursor = page.nextCursor;
        hasMore = page.hasMore;
      } while (
        hasMore &&
        cursor &&
        groupActivities(filterActivities(deduplicateActivities(rows), activityFilter)).length < displayStoreLimit
      );

      return { rows, cursor, hasMore };
    };
    void load()
      .then((result) => {
        if (active) {
          if (Array.isArray(result)) {
            setAllActivities(result);
            setHasMoreActivity(false);
          } else {
            setAllActivities(result.rows);
            setActivityCursor(result.cursor);
            setHasMoreActivity(result.hasMore);
          }
          setStatus('ready');
        }
      })
      .catch(() => {
        if (active) {
          setAllActivities([]);
          setActivityCursor(undefined);
          setHasMoreActivity(false);
          setStatus('error');
        }
      });
    return () => { active = false; };
  }, [activityFilter, displayStoreLimit, repository, repositoryRevision]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVITY_VIEW_STATE_KEY, JSON.stringify({
        filters: { outcome, productType, storeName, inspector, syncStatus, evidence, dateFrom, dateTo },
        expandedStoreKeys: Array.from(expandedStoreKeys).slice(0, 500),
      } satisfies ActivityViewState));
    } catch {
      // Storage may be disabled or unavailable in private browsing.
    }
  }, [dateFrom, dateTo, evidence, expandedStoreKeys, inspector, outcome, productType, storeName, syncStatus]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const loader = repository.listActivityFilterOptions;
      if (typeof loader !== 'function') return;
      const options = await loader.call(repository, activityFilter);
      if (active) setFilterOptions(options);
    };
    void load().catch(() => {
      if (active) setFilterOptions({ storeNames: [], inspectors: [], productTypes: [] });
    });
    return () => { active = false; };
  }, [activityFilter, repository, repositoryRevision]);

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

  const activities = useMemo(() => filterActivities(deduplicateActivities(allActivities), activityFilter), [activityFilter, allActivities]);
  const productTypes = withSelectedOption(Array.from(new Set([
    ...catalogProductTypes,
    ...filterOptions.productTypes,
  ])).sort(), productType);
  const storeNames = withSelectedOption(filterOptions.storeNames, storeName);
  const inspectors = withSelectedOption(filterOptions.inspectors, inspector);
  const storeGroups = groupActivities(activities);
  const visibleStoreGroups = storeGroups.slice(0, displayStoreLimit);

  const confirmDelete = async () => {
    if (!deleteTarget?.inspectionId) return;
    setIsDeleting(true);
    setDeleteError(undefined);
    try {
      await repository.deleteInspection(deleteTarget.inspectionId);
      setAllActivities((current) => current.filter((activity) => activity.inspectionId !== deleteTarget.inspectionId));
      setRevealedActivityId(undefined);
      setUndoInspectionId(deleteTarget.inspectionId);
      setDeleteTarget(undefined);
    } catch {
      setDeleteError('The inspection could not be deleted from this device. Try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const undoDelete = async () => {
    if (!undoInspectionId) return;
    try {
      await repository.restoreDeletedInspection(undoInspectionId);
      const rows = await repository.listActivity({ limit: Math.max(ACTIVITY_PAGE_SIZE + 1, allActivities.length + ACTIVITY_PAGE_SIZE + 1) });
      setAllActivities(rows);
      setDisplayStoreLimit((current) => current + ACTIVITY_STORE_PAGE_SIZE);
      setUndoInspectionId(undefined);
    } catch {
      setDeleteError('This inspection could not be restored because its deletion may already be synced.');
      setUndoInspectionId(undefined);
    }
  };

  const loadMoreStores = async () => {
    if (hasMoreActivity && activityCursor && typeof repository.listActivityPage === 'function') {
      setIsLoadingMoreActivity(true);
      try {
        const page = await repository.listActivityPage({ ...activityFilter, limit: ACTIVITY_PAGE_SIZE, cursor: activityCursor });
        setAllActivities((current) => [...current, ...page.rows]);
        setActivityCursor(page.nextCursor);
        setHasMoreActivity(page.hasMore);
      } finally {
        setIsLoadingMoreActivity(false);
      }
    }
    setDisplayStoreLimit((current) => current + ACTIVITY_STORE_PAGE_SIZE);
  };

  return <>
    <Container maxWidth="lg" sx={{ px: { xs: 2, sm: 3, md: 4 }, py: { xs: 3, md: 5 } }}>
      <Stack spacing={0.75} sx={{ mb: { xs: 3, md: 4 } }}>
        <Typography variant="overline" color="primary.main" sx={{ fontWeight: 800, letterSpacing: '0.1em' }}>Inspection history</Typography>
        <Typography component="h1" variant="h4" sx={{ fontSize: { xs: '1.8rem', sm: '2.125rem' } }}>Activity</Typography>
        <Typography color="text.secondary">Completed inspections from this device and your synced account.</Typography>
        <Typography variant="caption" color="text.secondary">Swipe an inspection left, or use its actions menu, to delete it. Deleted inspections can be undone before sync.</Typography>
      </Stack>

      <Stack spacing={2.5}>
        {deleteError && <Alert severity="error" onClose={() => setDeleteError(undefined)}>{deleteError}</Alert>}
        <Paper elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 2 }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <BoxHeading count={activities.length} hasMore={hasMoreActivity} />
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
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
            <FormControl size="small" sx={{ minWidth: { sm: 220 }, flex: { sm: '1 1 220px' } }}>
              <InputLabel id="activity-store-filter-label">Store</InputLabel>
              <Select labelId="activity-store-filter-label" label="Store" value={storeName} onChange={(event) => setStoreName(event.target.value)}>
                <MenuItem value="">All stores</MenuItem>
                {storeNames.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: { sm: 220 }, flex: { sm: '1 1 220px' } }}>
              <InputLabel id="activity-inspector-filter-label">Inspector</InputLabel>
              <Select labelId="activity-inspector-filter-label" label="Inspector" value={inspector} onChange={(event) => setInspector(event.target.value)}>
                <MenuItem value="">All inspectors</MenuItem>
                {inspectors.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: { sm: 220 }, flex: { sm: '1 1 220px' } }}>
              <InputLabel id="activity-product-filter-label">Product type</InputLabel>
              <Select labelId="activity-product-filter-label" label="Product type" value={productType} onChange={(event) => setProductType(event.target.value)}>
                <MenuItem value="">All product types</MenuItem>
                {productTypes.map((type) => <MenuItem key={type} value={type}>{type}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: { sm: 220 }, flex: { sm: '1 1 220px' } }}>
              <InputLabel id="activity-sync-filter-label">Sync status</InputLabel>
              <Select labelId="activity-sync-filter-label" label="Sync status" value={syncStatus} onChange={(event) => setSyncStatus(event.target.value as ActivitySyncStatus | '')}>
                <MenuItem value="">All sync statuses</MenuItem>
                <MenuItem value="pending">Waiting to upload</MenuItem>
                <MenuItem value="uploading">Waiting to upload</MenuItem>
                <MenuItem value="pushing">Uploading…</MenuItem>
                <MenuItem value="retry">Retrying</MenuItem>
                <MenuItem value="conflict">Needs attention</MenuItem>
                <MenuItem value="failed">Needs attention</MenuItem>
                <MenuItem value="synced">Synced</MenuItem>
                <MenuItem value="remote">From server</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: { sm: 220 }, flex: { sm: '1 1 220px' } }}>
              <InputLabel id="activity-evidence-filter-label">Evidence</InputLabel>
              <Select labelId="activity-evidence-filter-label" label="Evidence" value={evidence} onChange={(event) => setEvidence(event.target.value as 'all' | 'with' | 'without')}>
                <MenuItem value="all">Any evidence</MenuItem>
                <MenuItem value="with">With evidence</MenuItem>
                <MenuItem value="without">No evidence</MenuItem>
              </Select>
            </FormControl>
            <TextField size="small" type="date" label="From" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} InputLabelProps={{ shrink: true }} sx={{ minWidth: { sm: 170 }, flex: { sm: '1 1 170px' } }} />
            <TextField size="small" type="date" label="To" value={dateTo} onChange={(event) => setDateTo(event.target.value)} InputLabelProps={{ shrink: true }} sx={{ minWidth: { sm: 170 }, flex: { sm: '1 1 170px' } }} />
            </Stack>
          </Stack>
        </Paper>

        {status === 'loading' ? <Stack spacing={1.5} aria-label="Loading activity"><Skeleton variant="rounded" height={150} /><Skeleton variant="rounded" height={150} /></Stack>
          : status === 'error' ? <Alert severity="error">Activity could not be loaded. Refresh to try again.</Alert>
            : activities.length === 0 ? <Alert severity="info">No completed inspections yet.</Alert>
              : <>
                <Stack data-testid="activity-list" component="ol" spacing={2} sx={{ listStyle: 'none', m: 0, p: 0, pb: { xs: `calc(56px + 24px + ${designTokens.layout.mobileNavigationHeight}px + env(safe-area-inset-bottom))`, md: 0 } }}>{visibleStoreGroups.map((group) => <StoreActivityGroup key={group.key} group={group} isExpanded={expandedStoreKeys.has(group.key)} onExpandedChange={(expanded) => setExpandedStoreKeys((current) => { const next = new Set(current); if (expanded) { next.add(group.key); if (next.size > 500) { const oldest = next.values().next().value; if (oldest) next.delete(oldest); } } else next.delete(group.key); return next; })} onDelete={setDeleteTarget} revealedActivityId={revealedActivityId} onReveal={setRevealedActivityId} retryingInspectionIds={retryingInspectionIds} syncing={syncSnapshot?.status === 'syncing'} onRetry={async (inspectionId) => {
                  const store = runtimeStatusStore ?? getSyncRuntime()?.statusStore;
                  if (!store || retryingInspectionIds.has(inspectionId)) return;
                  setRetryingInspectionIds((current) => new Set(current).add(inspectionId));
                  try { await store.syncNow('manual', 'upload'); } catch { /* The card retains the failure detail. */ }
                  finally { setRetryingInspectionIds((current) => { const next = new Set(current); next.delete(inspectionId); return next; }); }
                }} />)}</Stack>
                {(storeGroups.length > visibleStoreGroups.length || hasMoreActivity) && <Button onClick={() => void loadMoreStores()} disabled={isLoadingMoreActivity} sx={{ alignSelf: 'center', mt: 2 }}>{isLoadingMoreActivity ? 'Loading more activity…' : 'Load more stores'}</Button>}
              </>}
      </Stack>
    </Container>
    <Portal>
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
    </Portal>
    <Menu
        anchorEl={quickActionAnchor}
        open={Boolean(quickActionAnchor)}
        onClose={() => setQuickActionAnchor(null)}
        disableScrollLock
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
    <Dialog open={Boolean(deleteTarget)} onClose={() => !isDeleting && setDeleteTarget(undefined)} disableScrollLock aria-labelledby="delete-inspection-title">
      <DialogTitle id="delete-inspection-title">Delete inspection?</DialogTitle>
      <DialogContent>
        This removes the local inspection and queues the deletion for the next sync. You can undo it while the deletion is still waiting on this device.
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDeleteTarget(undefined)} disabled={isDeleting}>Cancel</Button>
        <Button color="error" onClick={() => void confirmDelete()} disabled={isDeleting} startIcon={<DeleteOutlineRounded />}>Delete inspection</Button>
      </DialogActions>
    </Dialog>
    <Snackbar
      open={Boolean(undoInspectionId)}
      autoHideDuration={10000}
      onClose={() => setUndoInspectionId(undefined)}
      message="Inspection deleted locally."
      action={<Button color="secondary" size="small" onClick={() => void undoDelete()}>Undo</Button>}
    />
  </>;
}

function BoxHeading({ count, hasMore }: { count: number; hasMore?: boolean }) {
  return <Stack spacing={0.25}><Typography component="h2" variant="h6">Inspection history</Typography><Typography variant="body2" color="text.secondary">{count}{hasMore ? '+' : ''} completed {count === 1 && !hasMore ? 'inspection' : 'inspections'}</Typography></Stack>;
}

function deduplicateActivities(activities: ActivityRecord[]): ActivityRecord[] {
  const latestByInspection = new Map<string, ActivityRecord>();
  for (const activity of activities) {
    const key = activity.inspectionId ?? `activity:${activity.id}`;
    const previous = latestByInspection.get(key);
    if (!previous || isNewerActivity(activity, previous)) latestByInspection.set(key, activity);
  }
  return Array.from(latestByInspection.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function isNewerActivity(candidate: ActivityRecord, current: ActivityRecord): boolean {
  if (candidate.revision !== undefined && current.revision !== undefined && candidate.revision !== current.revision) {
    return candidate.revision > current.revision;
  }
  return candidate.createdAt > current.createdAt;
}

function filterActivities(activities: ActivityRecord[], filter: ActivityFilter): ActivityRecord[] {
  return activities.filter((activity) =>
    (filter.outcome === undefined || filter.outcome === 'all' || activity.outcome === filter.outcome) &&
    (!filter.productType || activity.productType === filter.productType) &&
    (!filter.storeName || activity.storeName === filter.storeName) &&
    (!filter.inspector || activity.username === filter.inspector) &&
    (!filter.syncStatus || filter.syncStatus === 'all' || activity.syncStatus === filter.syncStatus) &&
    (!filter.evidence || filter.evidence === 'all' || (filter.evidence === 'with' ? (activity.evidenceCount ?? 0) > 0 : (activity.evidenceCount ?? 0) === 0)) &&
    (!filter.dateFrom || activity.createdAt.slice(0, 10) >= filter.dateFrom) &&
    (!filter.dateTo || activity.createdAt.slice(0, 10) <= filter.dateTo),
  );
}

type ActivityGroup = {
  key: string;
  storeName: string;
  location?: string;
  activities: ActivityRecord[];
  products: ProductActivityGroup[];
  inspectionCount: number;
  notSyncedCount: number;
  needsAttentionCount: number;
};

type ProductActivityGroup = {
  key: string;
  controlNumber?: string;
  productType?: string;
  activities: ActivityRecord[];
};

function groupActivities(activities: ActivityRecord[]): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>();
  for (const activity of activities) {
    const storeName = activity.storeName || 'Store not recorded';
    const location = activity.location?.trim() ?? '';
    const key = `${normalizeActivityIdentity(storeName)}\u0000${normalizeActivityIdentity(location)}`;
    const group = groups.get(key);
    if (group) {
      addActivityToProductGroup(group, activity);
    } else {
      const next: ActivityGroup = { key, storeName, location: activity.location, activities: [], products: [], inspectionCount: 0, notSyncedCount: 0, needsAttentionCount: 0 };
      addActivityToProductGroup(next, activity);
      groups.set(key, next);
    }
  }
  return Array.from(groups.values());
}

function addActivityToProductGroup(group: ActivityGroup, activity: ActivityRecord): void {
  group.activities.push(activity);
  if (activity.syncStatus !== 'synced' && activity.syncStatus !== 'remote') group.notSyncedCount += 1;
  if (activity.syncStatus === 'failed' || activity.syncStatus === 'conflict') group.needsAttentionCount += 1;
  const controlNumber = activity.controlNumber?.trim();
  const productKey = controlNumber
    ? `${group.key}\u0000${normalizeActivityIdentity(controlNumber, true)}`
    : `${group.key}\u0000inspection:${activity.inspectionId ?? activity.id}`;
  const product = group.products.find((candidate) => candidate.key === productKey);
  if (product) {
    product.activities.push(activity);
  } else {
    group.products.push({ key: productKey, controlNumber, productType: activity.productType, activities: [activity] });
  }
  group.inspectionCount += 1;
}

function normalizeActivityIdentity(value: string, compact = false): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return compact ? normalized.replace(/\s+/g, '') : normalized;
}

function StoreActivityGroup({ group, isExpanded, onExpandedChange, onDelete, revealedActivityId, onReveal, retryingInspectionIds, syncing, onRetry }: { group: ActivityGroup; isExpanded: boolean; onExpandedChange: (expanded: boolean) => void; onDelete: (activity: ActivityRecord) => void; revealedActivityId?: string; onReveal: (activityId?: string) => void; retryingInspectionIds: Set<string>; syncing: boolean; onRetry: (inspectionId: string) => Promise<void> }) {
  const expanded = isExpanded;
  const groupLabel = `${group.storeName} inspections`;
  return <Paper component="li" elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 2 }}>
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.25} alignItems="flex-start" justifyContent="space-between">
        <Stack direction="row" spacing={1.25} alignItems="flex-start" minWidth={0}>
          <StoreRounded color="primary" />
          <BoxHeadingStore group={group} />
        </Stack>
        <IconButton
          size="small"
          color="primary"
          aria-label={expanded ? `Collapse ${groupLabel}` : `Expand ${groupLabel}`}
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
          sx={{ flexShrink: 0 }}
        >
          <ExpandMoreRounded sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 180ms ease-out' }} />
        </IconButton>
      </Stack>
      <Collapse in={expanded} unmountOnExit>
        <Stack component="ol" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {group.products.map((product) => <ProductActivityGroupCard key={product.key} product={product} onDelete={onDelete} revealedActivityId={revealedActivityId} onReveal={onReveal} retryingInspectionIds={retryingInspectionIds} syncing={syncing} onRetry={onRetry} />)}
        </Stack>
      </Collapse>
    </Stack>
  </Paper>;
}

function BoxHeadingStore({ group }: { group: ActivityGroup }) {
  return <Stack spacing={0.25}>
    <Typography component="h3" variant="h6">{group.storeName}</Typography>
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
      <Typography variant="body2" color="text.secondary">{group.location || 'Location not recorded'} · {group.activities.length} {group.activities.length === 1 ? 'inspection' : 'inspections'}</Typography>
      {group.notSyncedCount > 0 && <Chip size="small" variant="outlined" color={group.needsAttentionCount > 0 ? 'error' : 'warning'} label={`${group.notSyncedCount} not synced`} aria-label={`${group.notSyncedCount} inspections not synced`} />}
    </Stack>
  </Stack>;
}

function ProductActivityGroupCard({ product, onDelete, revealedActivityId, onReveal, retryingInspectionIds, syncing, onRetry }: { product: ProductActivityGroup; onDelete: (activity: ActivityRecord) => void; revealedActivityId?: string; onReveal: (activityId?: string) => void; retryingInspectionIds: Set<string>; syncing: boolean; onRetry: (inspectionId: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(true);
  const productLabel = product.controlNumber || product.activities[0]?.productType || 'Product inspections';
  const hasRepeatedInspections = product.activities.length > 1;
  if (!hasRepeatedInspections) {
    const activity = product.activities[0];
    if (!activity) return null;
    return <ActivityCard
      activity={activity}
      inspectionNumber={1}
      showProductLabel
      onDelete={onDelete}
      isRevealed={revealedActivityId === activity.id}
      onReveal={onReveal}
      retryingInspectionIds={retryingInspectionIds}
      syncing={syncing}
      onRetry={onRetry}
    />;
  }
  return <Paper component="li" elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
        <Stack spacing={0.25} minWidth={0}>
          <Typography component="h4" variant="subtitle1" fontWeight={700}>{productLabel} · {product.activities.length} {product.activities.length === 1 ? 'inspection' : 'inspections'}</Typography>
          {product.productType && <Typography variant="body2" color="text.secondary">{product.productType}</Typography>}
        </Stack>
        {hasRepeatedInspections && <IconButton
          size="small"
          color="primary"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${productLabel} inspections`}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <ExpandMoreRounded sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 180ms ease-out' }} />
        </IconButton>}
      </Stack>
      <Collapse in={expanded} unmountOnExit>
        <Stack component="ol" spacing={1} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {product.activities.map((activity, index) => <ActivityCard
            key={activity.id}
            activity={activity}
            inspectionNumber={index + 1}
            showProductLabel={false}
            onDelete={onDelete}
            isRevealed={revealedActivityId === activity.id}
            onReveal={onReveal}
            retryingInspectionIds={retryingInspectionIds}
            syncing={syncing}
            onRetry={onRetry}
          />)}
        </Stack>
      </Collapse>
    </Stack>
  </Paper>;
}

function ActivityCard({ activity, inspectionNumber, showProductLabel, onDelete, isRevealed, onReveal, retryingInspectionIds, syncing, onRetry }: { activity: ActivityRecord; inspectionNumber: number; showProductLabel: boolean; onDelete: (activity: ActivityRecord) => void; isRevealed: boolean; onReveal: (activityId?: string) => void; retryingInspectionIds: Set<string>; syncing: boolean; onRetry: (inspectionId: string) => Promise<void> }) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const pressTimer = useRef<number | null>(null);
  const outcomeLabel = activity.outcome === 'compliant' ? 'Compliant' : activity.outcome === 'non_compliant' ? 'Non-compliant' : 'Outcome unavailable';
  const actionLabel = activity.controlNumber || `Inspection ${inspectionNumber}`;
  const cardLabel = showProductLabel ? actionLabel : `Inspection ${inspectionNumber}`;
  const syncChip = activity.syncStatus ? syncStatusChip(activity.syncStatus) : undefined;
  const needsRetry = Boolean(activity.inspectionId && (activity.syncStatus === 'retry' || activity.syncStatus === 'failed' || activity.syncStatus === 'conflict'));
  const isRetrying = activity.inspectionId ? retryingInspectionIds.has(activity.inspectionId) : false;
  const clearPressTimer = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const revealActions = () => {
    setSwipeOffset(-112);
    onReveal(activity.id);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(8);
  };
  const toggleActions = () => {
    if (isRevealed) {
      setSwipeOffset(0);
      onReveal();
      return;
    }
    revealActions();
  };
  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
    clearPressTimer();
    pressTimer.current = window.setTimeout(revealActions, 650);
  };
  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) clearPressTimer();
    if (deltaX < 0 && Math.abs(deltaX) > Math.abs(deltaY)) setSwipeOffset(Math.max(-112, deltaX));
  };
  const handleTouchEnd = () => {
    clearPressTimer();
    touchStart.current = null;
    if (swipeOffset <= -64) onReveal(activity.id);
    else onReveal();
    setSwipeOffset((current) => current <= -64 ? -112 : 0);
  };
  const displaySwipeOffset = isRevealed ? -112 : Math.max(-64, swipeOffset);
  return <Box
    data-inspection-card
    sx={{ position: 'relative', overflow: 'hidden', borderRadius: 2 }}
    onContextMenu={(event) => { event.preventDefault(); revealActions(); }}
    onTouchStart={handleTouchStart}
    onTouchMove={handleTouchMove}
    onTouchEnd={handleTouchEnd}
    onTouchCancel={handleTouchEnd}
  >
    <Box sx={{ position: 'absolute', top: 1, right: 1, bottom: 1, width: 110, display: 'flex', justifyContent: 'flex-end', alignItems: 'stretch', bgcolor: 'error.main', borderTopRightRadius: 2, borderBottomRightRadius: 2, overflow: 'hidden' }}>
      <Button color="inherit" onClick={() => onDelete(activity)} startIcon={<DeleteOutlineRounded />} tabIndex={isRevealed ? 0 : -1} sx={{ minWidth: 112, color: 'error.contrastText', borderRadius: 0, fontWeight: 700 }} aria-label={`Delete inspection ${actionLabel}`}>Delete</Button>
    </Box>
    <Paper component="li" elevation={0} sx={{ position: 'relative', p: { xs: 2, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.default', transform: `translateX(${displaySwipeOffset}px)`, transition: 'transform 180ms ease-out' }}>
      <Stack spacing={1}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
          <Stack spacing={0.25} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <Typography component={showProductLabel ? 'h4' : 'h5'} variant="subtitle1" fontWeight={700}>{cardLabel}</Typography>
            <Typography variant="body2" color="text.secondary">{[activity.location, activity.productType].filter(Boolean).join(' · ') || 'Inspection record'}</Typography>
            {activity.model && <Typography variant="body2" color="text.secondary">Model number/code: {activity.model}</Typography>}
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center" sx={{ alignSelf: { xs: 'stretch', sm: 'auto' }, justifyContent: { xs: 'flex-start', sm: 'flex-end' }, minWidth: 0, maxWidth: '100%', flexShrink: { xs: 1, sm: 0 } }}>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
              <Chip label={outcomeLabel} color={activity.outcome === 'compliant' ? 'success' : activity.outcome === 'non_compliant' ? 'error' : 'default'} size="small" />
              {syncChip && <Chip data-testid={`sync-chip-${activity.syncStatus}`} label={syncChip.label} color={syncChip.color} variant={syncChip.variant} size="small" aria-label={`Sync status: ${syncChip.label}`} />}
            </Stack>
            {activity.inspectionId && <Button component={Link} href={`/inspect/${encodeURIComponent(activity.inspectionId)}?view=1`} size="small" variant="outlined" startIcon={<VisibilityOutlined />} sx={{ whiteSpace: 'nowrap' }}>View</Button>}
            {activity.inspectionId && <Button component={Link} href={`/inspect/${encodeURIComponent(activity.inspectionId)}`} size="small" variant="outlined" startIcon={<EditRounded />} sx={{ whiteSpace: 'nowrap' }}>Edit inspection</Button>}
            {needsRetry && activity.inspectionId && <Button size="small" variant="text" color="primary" onClick={() => void onRetry(activity.inspectionId!)} disabled={isRetrying || syncing} sx={{ whiteSpace: 'nowrap' }}>{isRetrying || syncing ? 'Retrying…' : 'Retry'}</Button>}
            {activity.inspectionId && <IconButton size="small" color="primary" aria-label={`Inspection actions for ${actionLabel}`} onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()} onClick={toggleActions}><MoreVertRounded /></IconButton>}
          </Stack>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Inspected by <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{activity.username || 'Unknown user'}</Box>
          {activity.evidenceCount !== undefined ? ` · ${activity.evidenceCount} evidence item${activity.evidenceCount === 1 ? '' : 's'}` : ''}
        </Typography>
        {activity.syncError && <Typography variant="caption" color="error.main" sx={{ overflowWrap: 'anywhere' }}>Sync detail: {activity.syncError}</Typography>}
        {activity.updatedBy && activity.updatedBy !== activity.username && <Typography variant="caption" color="text.secondary">Updated by <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{activity.updatedBy}</Box>{activity.revision ? ` · Revision ${activity.revision}` : ''}</Typography>}
      </Stack>
    </Paper>
  </Box>;
}

type SyncChipConfig = {
  label: string;
  color: 'default' | 'success' | 'warning' | 'error';
  variant: 'filled' | 'outlined';
};

function syncStatusChip(status: ActivitySyncStatus): SyncChipConfig {
  if (status === 'synced') return { label: 'Synced', color: 'success', variant: 'outlined' };
  if (status === 'remote') return { label: 'From server', color: 'default', variant: 'outlined' };
  if (status === 'pushing') return { label: 'Uploading…', color: 'default', variant: 'outlined' };
  if (status === 'pending' || status === 'uploading') return { label: 'Waiting to upload', color: 'default', variant: 'outlined' };
  if (status === 'retry') return { label: 'Retrying', color: 'warning', variant: 'outlined' };
  if (status === 'failed' || status === 'conflict') return { label: 'Needs attention', color: 'error', variant: 'outlined' };
  return { label: status, color: 'default', variant: 'outlined' };
}
