'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Badge, Box, Button, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, Fab, FormControl, InputLabel, Menu, MenuItem, Portal, Select, Skeleton, Snackbar, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, IconButton } from '@mui/material';
import { AddRounded, CloudDoneOutlined, DeleteOutlineRounded, EditRounded, ErrorOutlineRounded, ExpandMoreRounded, FilterListRounded, MoreVertRounded, QrCodeScannerRounded, SearchRounded, StoreRounded, SyncRounded } from '@mui/icons-material';
import { getBrowserRepository } from '@/lib/db/browser';
import { getSyncRuntime } from '@/lib/sync/runtime';
import { useRepositoryRevision } from '@/lib/db/use-repository-revision';
import type { ActivityFilter, ActivityFilterOptions, ActivityOutcome, ActivityPageCursor, ActivityRecord, ActivitySyncStatus } from '@/lib/db/records';
import { QrScannerDialog } from '@/features/lookup/qr-scanner-dialog';
import { extractLookupQuery } from '@/features/lookup/qr-value';
import { designTokens } from '@/theme/tokens';
import { useSyncRuntimeStatusStore } from '@/features/sync/sync-runtime-boundary';
import { ListRow, PageHeader, PageShell, StatusBadge, Surface } from '@/components/ui';

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

type ActivityFilterDraft = Pick<ActivityViewState['filters'], 'productType' | 'storeName' | 'inspector' | 'syncStatus' | 'evidence' | 'dateFrom' | 'dateTo'>;

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
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<ActivityFilterDraft>({ productType, storeName, inspector, syncStatus, evidence, dateFrom, dateTo });
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
  const activeFilterCount = [storeName, inspector, productType, syncStatus, evidence !== 'all' ? evidence : '', dateFrom, dateTo].filter(Boolean).length;
  const currentFilterValues: ActivityFilterDraft = { productType, storeName, inspector, syncStatus, evidence, dateFrom, dateTo };

  const openFilterSheet = () => {
    setFilterDraft(currentFilterValues);
    setIsFilterSheetOpen(true);
  };

  const closeFilterSheet = () => setIsFilterSheetOpen(false);

  const applyFilterDraft = () => {
    setProductType(filterDraft.productType);
    setStoreName(filterDraft.storeName);
    setInspector(filterDraft.inspector);
    setSyncStatus(filterDraft.syncStatus);
    setEvidence(filterDraft.evidence);
    setDateFrom(filterDraft.dateFrom);
    setDateTo(filterDraft.dateTo);
    setIsFilterSheetOpen(false);
  };

  const clearFilterDraft = () => {
    const cleared: ActivityFilterDraft = { productType: '', storeName: '', inspector: '', syncStatus: '', evidence: 'all', dateFrom: '', dateTo: '' };
    setFilterDraft(cleared);
    setProductType(cleared.productType);
    setStoreName(cleared.storeName);
    setInspector(cleared.inspector);
    setSyncStatus(cleared.syncStatus);
    setEvidence(cleared.evidence);
    setDateFrom(cleared.dateFrom);
    setDateTo(cleared.dateTo);
    setIsFilterSheetOpen(false);
  };

  const renderFilterFields = (values: ActivityFilterDraft, onChange: (key: keyof ActivityFilterDraft, value: string) => void, prefix: string) => <>
    <FormControl size="small" sx={{ minWidth: { sm: 220 }, flex: { sm: '1 1 220px' } }}>
      <InputLabel id={`${prefix}-store-filter-label`} shrink>Store</InputLabel>
      <Select displayEmpty labelId={`${prefix}-store-filter-label`} label="Store" value={values.storeName} onChange={(event) => onChange('storeName', event.target.value)}>
        <MenuItem value="">All stores</MenuItem>
        {storeNames.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
      </Select>
    </FormControl>
    <FormControl size="small" sx={{ minWidth: { sm: 220 }, flex: { sm: '1 1 220px' } }}>
      <InputLabel id={`${prefix}-inspector-filter-label`} shrink>Inspector</InputLabel>
      <Select displayEmpty labelId={`${prefix}-inspector-filter-label`} label="Inspector" value={values.inspector} onChange={(event) => onChange('inspector', event.target.value)}>
        <MenuItem value="">All inspectors</MenuItem>
        {inspectors.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
      </Select>
    </FormControl>
    <FormControl size="small" sx={{ minWidth: { sm: 220 }, flex: { sm: '1 1 220px' } }}>
      <InputLabel id={`${prefix}-product-filter-label`} shrink>Product type</InputLabel>
      <Select displayEmpty labelId={`${prefix}-product-filter-label`} label="Product type" value={values.productType} onChange={(event) => onChange('productType', event.target.value)}>
        <MenuItem value="">All types</MenuItem>
        {productTypes.map((type) => <MenuItem key={type} value={type}>{type}</MenuItem>)}
      </Select>
    </FormControl>
    <FormControl size="small" sx={{ minWidth: { sm: 220 }, flex: { sm: '1 1 220px' } }}>
      <InputLabel id={`${prefix}-sync-filter-label`} shrink>Sync status</InputLabel>
      <Select displayEmpty labelId={`${prefix}-sync-filter-label`} label="Sync status" value={values.syncStatus} onChange={(event) => onChange('syncStatus', event.target.value)}>
        <MenuItem value="">All statuses</MenuItem>
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
      <InputLabel id={`${prefix}-evidence-filter-label`} shrink>Evidence</InputLabel>
      <Select displayEmpty labelId={`${prefix}-evidence-filter-label`} label="Evidence" value={values.evidence} onChange={(event) => onChange('evidence', event.target.value)}>
        <MenuItem value="all">Any evidence</MenuItem>
        <MenuItem value="with">With evidence</MenuItem>
        <MenuItem value="without">No evidence</MenuItem>
      </Select>
    </FormControl>
    <TextField size="small" type="date" label="From" value={values.dateFrom} onChange={(event) => onChange('dateFrom', event.target.value)} InputLabelProps={{ shrink: true }} sx={{ minWidth: { sm: 170 }, flex: { sm: '1 1 170px' } }} />
    <TextField size="small" type="date" label="To" value={values.dateTo} onChange={(event) => onChange('dateTo', event.target.value)} InputLabelProps={{ shrink: true }} sx={{ minWidth: { sm: 170 }, flex: { sm: '1 1 170px' } }} />
  </>;

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
    <PageShell>
      <PageHeader title="Activity" subtitle={<><span>Completed inspections from this device and your synced account.</span><Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>Swipe an inspection left, or use its actions menu, to delete it. Deleted inspections can be undone before sync.</Typography></>} />

      <Stack spacing={2.5}>
        {deleteError && <Alert severity="error" onClose={() => setDeleteError(undefined)}>{deleteError}</Alert>}
        <Surface sx={{ p: { xs: 2, sm: 2.5 } }}>
          <Stack spacing={2}>
            <Stack data-testid="activity-outcome-filter-bar" direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ position: 'sticky', top: { xs: 0, md: 0 }, zIndex: 3, bgcolor: 'background.paper', py: 1 }}>
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
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap sx={{ display: { xs: 'none', sm: 'flex' } }}>
              {renderFilterFields(currentFilterValues, (key, value) => {
                if (key === 'productType') setProductType(value);
                if (key === 'storeName') setStoreName(value);
                if (key === 'inspector') setInspector(value);
                if (key === 'syncStatus') setSyncStatus(value as ActivitySyncStatus | '');
                if (key === 'evidence') setEvidence(value as 'all' | 'with' | 'without');
                if (key === 'dateFrom') setDateFrom(value);
                if (key === 'dateTo') setDateTo(value);
              }, 'desktop-activity')}
            </Stack>
            <Stack spacing={1} sx={{ display: { xs: 'flex', sm: 'none' } }}>
              <Badge data-testid="activity-filter-count" data-count={activeFilterCount} badgeContent={activeFilterCount} color="primary" showZero={false} sx={{ alignSelf: 'flex-start' }}>
                <Button aria-label="Open filters" variant="outlined" startIcon={<FilterListRounded />} onClick={openFilterSheet}>Filters</Button>
              </Badge>
              <Stack data-testid="activity-filter-chips" direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {storeName && <Chip data-testid="activity-filter-chip-store" label={`Store: ${storeName}`} onDelete={() => setStoreName('')} />}
                {inspector && <Chip data-testid="activity-filter-chip-inspector" label={`Inspector: ${inspector}`} onDelete={() => setInspector('')} />}
                {productType && <Chip data-testid="activity-filter-chip-product" label={`Type: ${productType}`} onDelete={() => setProductType('')} />}
                {syncStatus && <Chip data-testid="activity-filter-chip-status" label={`Status: ${syncStatus}`} onDelete={() => setSyncStatus('')} />}
                {evidence !== 'all' && <Chip data-testid="activity-filter-chip-evidence" label={evidence === 'with' ? 'With evidence' : 'No evidence'} onDelete={() => setEvidence('all')} />}
                {dateFrom && <Chip data-testid="activity-filter-chip-from" label={`From: ${dateFrom}`} onDelete={() => setDateFrom('')} />}
                {dateTo && <Chip data-testid="activity-filter-chip-to" label={`To: ${dateTo}`} onDelete={() => setDateTo('')} />}
              </Stack>
            </Stack>
          </Stack>
        </Surface>

        <Drawer anchor="bottom" open={isFilterSheetOpen} onClose={closeFilterSheet}>
          <Box data-testid="activity-filter-sheet" sx={{ p: 2, pb: 'calc(16px + env(safe-area-inset-bottom))' }}>
            <Stack spacing={2}>
              <Typography component="h2" variant="h6">Filters</Typography>
              <Stack spacing={1.5}>
                {renderFilterFields(filterDraft, (key, value) => setFilterDraft((current) => ({ ...current, [key]: value })), 'mobile-activity')}
              </Stack>
              <Stack direction="row" justifyContent="space-between" spacing={1}>
                <Button onClick={clearFilterDraft}>Clear</Button>
                <Button variant="contained" onClick={applyFilterDraft}>Apply filters</Button>
              </Stack>
            </Stack>
          </Box>
        </Drawer>

        {status === 'loading' ? <Stack spacing={1.5} aria-label="Loading activity"><Skeleton variant="rounded" height={150} /><Skeleton variant="rounded" height={150} /></Stack>
          : status === 'error' ? <Alert severity="error">Activity could not be loaded. Refresh to try again.</Alert>
            : activities.length === 0 ? <Alert severity="info">No completed inspections yet.</Alert>
              : <>
                <Stack data-testid="activity-list" component="ol" spacing={2} sx={{ listStyle: 'none', m: 0, p: 0, pr: { xs: 0, md: 10 }, pb: { xs: `calc(56px + 24px + ${designTokens.layout.mobileNavigationHeight}px + env(safe-area-inset-bottom))`, md: 0 } }}>{visibleStoreGroups.map((group) => <StoreActivityGroup key={group.key} group={group} isExpanded={expandedStoreKeys.has(group.key)} onExpandedChange={(expanded) => setExpandedStoreKeys((current) => { const next = new Set(current); if (expanded) { next.add(group.key); if (next.size > 500) { const oldest = next.values().next().value; if (oldest) next.delete(oldest); } } else next.delete(group.key); return next; })} onDelete={setDeleteTarget} revealedActivityId={revealedActivityId} onReveal={setRevealedActivityId} retryingInspectionIds={retryingInspectionIds} syncing={syncSnapshot?.status === 'syncing'} onRetry={async (inspectionId) => {
                  const store = runtimeStatusStore ?? getSyncRuntime()?.statusStore;
                  if (!store || retryingInspectionIds.has(inspectionId)) return;
                  setRetryingInspectionIds((current) => new Set(current).add(inspectionId));
                  try { await store.syncNow('manual', 'upload'); } catch { /* The card retains the failure detail. */ }
                  finally { setRetryingInspectionIds((current) => { const next = new Set(current); next.delete(inspectionId); return next; }); }
                }} />)}</Stack>
                {(storeGroups.length > visibleStoreGroups.length || hasMoreActivity) && <Button onClick={() => void loadMoreStores()} disabled={isLoadingMoreActivity} sx={{ alignSelf: 'center', mt: 2 }}>{isLoadingMoreActivity ? 'Loading more activity…' : 'Load more stores'}</Button>}
              </>}
      </Stack>
    </PageShell>
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
  return <Box component="li" sx={{ listStyle: 'none', minWidth: 0 }}>
    <Box data-testid="activity-store-header" sx={{ position: 'sticky', top: { xs: 0, md: 0 }, zIndex: 2, bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider' }}>
      <ListRow
        leading={<StoreRounded color="primary" />}
        primary={<Box component="span" role="heading" aria-level={3} sx={{ fontWeight: 600 }}>{group.storeName}</Box>}
        secondary={<>{group.location || 'Location not recorded'} · {group.activities.length} {group.activities.length === 1 ? 'inspection' : 'inspections'}{group.notSyncedCount > 0 && <> · <Box component="span" role="status" aria-label={`${group.notSyncedCount} inspections not synced`}>{group.notSyncedCount} not synced</Box></>}</>}
        trailing={<IconButton size="small" color="primary" aria-label={expanded ? `Collapse ${groupLabel}` : `Expand ${groupLabel}`} aria-expanded={expanded} onClick={() => onExpandedChange(!expanded)}><ExpandMoreRounded sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 180ms ease-out' }} /></IconButton>}
      />
    </Box>
    <Collapse in={expanded} unmountOnExit>
      <Stack component="ol" spacing={0} sx={{ listStyle: 'none', m: 0, p: 0, pl: { xs: 1, sm: 3 } }}>
        {group.products.map((product) => <ProductActivityGroupCard key={product.key} product={product} onDelete={onDelete} revealedActivityId={revealedActivityId} onReveal={onReveal} retryingInspectionIds={retryingInspectionIds} syncing={syncing} onRetry={onRetry} />)}
      </Stack>
    </Collapse>
  </Box>;
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
  return <Box component="li" sx={{ listStyle: 'none', minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ py: 1 }}>
        <Typography component="h4" variant="body2" fontWeight={700}>{productLabel} · {product.activities.length} {product.activities.length === 1 ? 'inspection' : 'inspections'}{product.productType ? ` · ${product.productType}` : ''}</Typography>
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
        <Stack component="ol" spacing={0} sx={{ listStyle: 'none', m: 0, p: 0 }}>
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
  </Box>;
}

function ActivityCard({ activity, inspectionNumber, showProductLabel, onDelete, isRevealed, onReveal, retryingInspectionIds, syncing, onRetry }: { activity: ActivityRecord; inspectionNumber: number; showProductLabel: boolean; onDelete: (activity: ActivityRecord) => void; isRevealed: boolean; onReveal: (activityId?: string) => void; retryingInspectionIds: Set<string>; syncing: boolean; onRetry: (inspectionId: string) => Promise<void> }) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const pressTimer = useRef<number | null>(null);
  const outcomeLabel = activity.outcome === 'compliant' ? 'Compliant' : activity.outcome === 'non_compliant' ? 'Non-compliant' : 'Outcome unavailable';
  const actionLabel = activity.controlNumber || `Inspection ${inspectionNumber}`;
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
  const modelSummary = [activity.brand, activity.model].filter((value) => value?.trim()).join(' · ') || activity.productType || 'Product details unavailable';
  const secondary = [
    modelSummary,
    activity.username ? `Inspected by ${activity.username}` : undefined,
    activity.evidenceCount !== undefined ? `${activity.evidenceCount} evidence item${activity.evidenceCount === 1 ? '' : 's'}` : undefined,
    activity.syncError ? `Sync detail: ${activity.syncError}` : undefined,
  ].filter(Boolean).join('\n');
  return <Box
    role="listitem"
    data-inspection-card
    sx={{ position: 'relative', overflow: 'hidden', listStyle: 'none' }}
    onContextMenu={(event) => { event.preventDefault(); revealActions(); }}
    onTouchStart={handleTouchStart}
    onTouchMove={handleTouchMove}
    onTouchEnd={handleTouchEnd}
    onTouchCancel={handleTouchEnd}
  >
    <Box sx={{ position: 'absolute', top: 1, right: 1, bottom: 1, width: 110, display: 'flex', justifyContent: 'flex-end', alignItems: 'stretch', bgcolor: 'error.main', borderTopRightRadius: 2, borderBottomRightRadius: 2, overflow: 'hidden' }}>
      <Button color="inherit" onClick={() => onDelete(activity)} startIcon={<DeleteOutlineRounded />} tabIndex={isRevealed ? 0 : -1} sx={{ minWidth: 112, color: 'error.contrastText', borderRadius: 0, fontWeight: 700 }} aria-label={`Delete inspection ${actionLabel}`}>Delete</Button>
    </Box>
    <Surface sx={{ position: 'relative', bgcolor: 'background.paper', transform: `translateX(${displaySwipeOffset}px)`, transition: 'transform 180ms ease-out', borderRadius: 0, borderLeft: 0, borderRight: 0 }}>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, pr: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {activity.inspectionId ? <Link href={`/inspect/${encodeURIComponent(activity.inspectionId)}?view=1`} style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
            <ListRow
              primary={<Box component="span" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13, fontWeight: 600 }}>{showProductLabel ? actionLabel : `Inspection ${inspectionNumber}`}</Box>}
              secondary={<Box component="span" sx={{ display: 'block', whiteSpace: 'pre-line' }}>{secondary}</Box>}
              trailing={<Stack direction="row" spacing={1} alignItems="center">
                <StatusBadge variant={activity.outcome === 'compliant' ? 'compliant' : activity.outcome === 'non_compliant' ? 'nonCompliant' : 'neutral'} label={outcomeLabel} />
                {syncChip && <Tooltip title={`Sync status: ${syncChip.label}${activity.syncError ? ` · ${activity.syncError}` : ''}`}>
                  <Box data-testid={`sync-chip-${activity.syncStatus}`} role="status" aria-label={`Sync status: ${syncChip.label}`} tabIndex={0} sx={{ color: syncChip.color === 'success' ? 'success.main' : syncChip.color === 'warning' ? 'warning.dark' : syncChip.color === 'error' ? 'error.main' : 'text.secondary', display: 'inline-flex', alignItems: 'center' }}>
                    {syncChip.color === 'success' ? <CloudDoneOutlined fontSize="small" aria-hidden /> : syncChip.color === 'error' ? <ErrorOutlineRounded fontSize="small" aria-hidden /> : <SyncRounded fontSize="small" aria-hidden />}
                    <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, p: 0, m: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>{syncChip.label}</Box>
                  </Box>
                </Tooltip>}
              </Stack>}
            />
          </Link> : <ListRow primary={actionLabel} secondary={secondary} trailing={<StatusBadge variant={activity.outcome === 'compliant' ? 'compliant' : activity.outcome === 'non_compliant' ? 'nonCompliant' : 'neutral'} label={outcomeLabel} />} />}
        </Box>
        {needsRetry && activity.inspectionId && <Button size="small" variant="text" color="primary" onClick={() => void onRetry(activity.inspectionId!)} disabled={isRetrying || syncing} sx={{ whiteSpace: 'nowrap' }}>{isRetrying || syncing ? 'Retrying…' : 'Retry'}</Button>}
        {activity.inspectionId && <IconButton size="small" color="primary" aria-label={`Inspection actions for ${actionLabel}`} onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()} onClick={(event) => setMenuAnchor(event.currentTarget)}><MoreVertRounded /></IconButton>}
      </Stack>
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)} disableScrollLock>
        {activity.inspectionId && <MenuItem component={Link} href={`/inspect/${encodeURIComponent(activity.inspectionId)}`} onClick={() => setMenuAnchor(null)}><EditRounded fontSize="small" sx={{ mr: 1 }} />Edit inspection</MenuItem>}
        <MenuItem onClick={() => { setMenuAnchor(null); onDelete(activity); }}><DeleteOutlineRounded fontSize="small" sx={{ mr: 1 }} />Delete inspection</MenuItem>
      </Menu>
    </Surface>
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
