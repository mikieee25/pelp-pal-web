'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CircleAlert as ErrorOutlineRounded, CloudCheck as CloudDoneOutlined, Clock3 as WaitingRounded, ChevronDown as ExpandMoreRounded, Ellipsis as MoreVertRounded, Filter as FilterIcon, Info, ListFilter as FilterListRounded, Pencil as EditRounded, Plus as AddRounded, QrCode as QrCodeScannerRounded, Search as SearchRounded, Store as StoreRounded, Trash2 as DeleteOutlineRounded } from 'lucide-react';
import { getBrowserRepository } from '@/lib/db/browser';
import { getSyncRuntime } from '@/lib/sync/runtime';
import { useRepositoryRevision } from '@/lib/db/use-repository-revision';
import type { ActivityFilter, ActivityFilterOptions, ActivityOutcome, ActivityPageCursor, ActivityRecord, ActivitySyncStatus } from '@/lib/db/records';
import { QrScannerDialog } from '@/features/lookup/qr-scanner-dialog';
import { extractLookupQuery } from '@/features/lookup/qr-value';
import { designTokens } from '@/theme/tokens';
import { useSyncRuntimeStatusStore } from '@/features/sync/sync-runtime-boundary';
import { InlineNotice, ListRow, PageHeader, PageShell, StatusBadge, Surface } from '@/components/ui';
import { AnimatedDisclosure } from '@/components/motion/animated-disclosure';
import { AccessibleDrawer, AccessibleModal, AccessibleSelect } from '@/components/ui/accessible-overlay';

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
  const [isMoreFiltersOpen, setIsMoreFiltersOpen] = useState(false);
  const [isActivityHintOpen, setIsActivityHintOpen] = useState(false);
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
  const moreFilterCount = [syncStatus, evidence !== 'all' ? evidence : '', dateFrom, dateTo].filter(Boolean).length;
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

  const renderFilterFields = (values: ActivityFilterDraft, onChange: (key: keyof ActivityFilterDraft, value: string) => void, prefix: string, fields: Array<keyof ActivityFilterDraft> = ['storeName', 'inspector', 'productType', 'syncStatus', 'evidence', 'dateFrom', 'dateTo']) => <>
    {fields.includes('storeName') && <FilterSelect id={`${prefix}-store-filter-label`} label="Store" value={values.storeName} emptyLabel="All stores" options={storeNames} onChange={(value) => onChange('storeName', value)} />}
    {fields.includes('inspector') && <FilterSelect id={`${prefix}-inspector-filter-label`} label="Inspector" value={values.inspector} emptyLabel="All inspectors" options={inspectors} onChange={(value) => onChange('inspector', value)} />}
    {fields.includes('productType') && <FilterSelect id={`${prefix}-product-filter-label`} label="Product type" value={values.productType} emptyLabel="All types" options={productTypes} onChange={(value) => onChange('productType', value)} />}
    {fields.includes('syncStatus') && <FilterSelect id={`${prefix}-sync-filter-label`} label="Sync status" value={values.syncStatus} emptyLabel="All statuses" options={['pending|Waiting to upload', 'uploading|Waiting to upload', 'pushing|Uploading…', 'retry|Retrying', 'conflict|Needs attention', 'failed|Needs attention', 'synced|Synced', 'remote|From server']} onChange={(value) => onChange('syncStatus', value)} />}
    {fields.includes('evidence') && <FilterSelect id={`${prefix}-evidence-filter-label`} label="Evidence" value={values.evidence} options={['all|Any evidence', 'with|With evidence', 'without|No evidence']} onChange={(value) => onChange('evidence', value)} />}
    {fields.includes('dateFrom') && <DateFilter label="From" value={values.dateFrom} onChange={(value) => onChange('dateFrom', value)} />}
    {fields.includes('dateTo') && <DateFilter label="To" value={values.dateTo} onChange={(value) => onChange('dateTo', value)} />}
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
      <PageHeader title="Activity" subtitle="Completed inspections from this device and your synced account." />
      <div className="space-y-5">
        <div className="relative flex justify-end"><button type="button" aria-label="Activity help" aria-expanded={isActivityHintOpen} onClick={() => setIsActivityHintOpen((open) => !open)} className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus"><Info aria-hidden="true" className="size-5" /></button>{isActivityHintOpen && <div role="tooltip" className="absolute right-0 top-11 z-20 max-w-xs rounded-control border border-border bg-white p-3 text-sm text-muted shadow-lg">Swipe an inspection left, or use its actions menu, to delete it. Deleted inspections can be undone before sync.</div>}</div>
        {deleteError && <InlineNotice severity="error" action={<button type="button" onClick={() => setDeleteError(undefined)} aria-label="Dismiss error">×</button>}>{deleteError}</InlineNotice>}
        <Surface className="space-y-4 p-4">
          <div data-testid="activity-outcome-filter-bar" className="sticky top-0 z-10 flex flex-col gap-3 bg-white py-2 sm:flex-row sm:items-center sm:justify-between">
            <BoxHeading count={activities.length} hasMore={hasMoreActivity} />
            <div role="group" aria-label="Activity outcome filter" className="flex w-full rounded-control border border-border p-1 sm:w-auto">
              {([['all', 'All'], ['compliant', 'Compliant'], ['non_compliant', 'Non-compliant']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={outcome === value} onClick={() => setOutcome(value)} className={`min-h-10 flex-1 whitespace-nowrap rounded px-3 text-sm font-semibold sm:flex-none ${outcome === value ? 'bg-primary-soft text-primary' : 'text-muted'}`}>{label}</button>)}
            </div>
          </div>
          <div className="hidden flex-wrap items-end gap-3 md:flex">{renderFilterFields(currentFilterValues, (key, value) => { if (key === 'productType') setProductType(value); if (key === 'storeName') setStoreName(value); if (key === 'inspector') setInspector(value); }, 'desktop-activity', ['storeName', 'inspector', 'productType'])}<div className="relative"><button type="button" data-testid="activity-more-filters" aria-expanded={isMoreFiltersOpen} aria-controls="activity-more-filters-panel" onClick={() => setIsMoreFiltersOpen((open) => !open)} className="inline-flex min-h-12 items-center gap-2 rounded-control border border-border-strong px-3 font-semibold text-primary"><FilterIcon aria-hidden="true" className="size-4" />More filters{moreFilterCount > 0 && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs">{moreFilterCount}</span>}</button>{isMoreFiltersOpen && <div id="activity-more-filters-panel" role="region" aria-label="More activity filters" className="absolute right-0 top-full z-20 mt-2 grid min-w-[min(720px,90vw)] grid-cols-2 gap-3 rounded-xl border border-border bg-white p-4 shadow-lg">{renderFilterFields(currentFilterValues, (key, value) => { if (key === 'syncStatus') setSyncStatus(value as ActivitySyncStatus | ''); if (key === 'evidence') setEvidence(value as 'all' | 'with' | 'without'); if (key === 'dateFrom') setDateFrom(value); if (key === 'dateTo') setDateTo(value); }, 'desktop-more-activity', ['syncStatus', 'evidence', 'dateFrom', 'dateTo'])}</div>}</div></div>
          <div className="space-y-2 md:hidden"><button data-testid="activity-filter-count" data-count={activeFilterCount} aria-label="Open filters" type="button" onClick={openFilterSheet} className="min-h-11 rounded-control border border-border-strong px-4 font-semibold text-primary"><FilterListRounded className="mr-2 inline size-4" />Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</button>
            <div data-testid="activity-filter-chips" className="flex flex-wrap gap-2"><ActivityFilterChip value={storeName} label="Store" testId="activity-filter-chip-store" clear={() => setStoreName('')} /><ActivityFilterChip value={inspector} label="Inspector" testId="activity-filter-chip-inspector" clear={() => setInspector('')} /><ActivityFilterChip value={productType} label="Type" testId="activity-filter-chip-product" clear={() => setProductType('')} /><ActivityFilterChip value={syncStatus} label="Status" testId="activity-filter-chip-status" clear={() => setSyncStatus('')} /><ActivityFilterChip value={evidence !== 'all' ? (evidence === 'with' ? 'With evidence' : 'No evidence') : ''} label="" testId="activity-filter-chip-evidence" clear={() => setEvidence('all')} /><ActivityFilterChip value={dateFrom} label="From" testId="activity-filter-chip-from" clear={() => setDateFrom('')} /><ActivityFilterChip value={dateTo} label="To" testId="activity-filter-chip-to" clear={() => setDateTo('')} /></div>
          </div>
        </Surface>
        {isFilterSheetOpen && <AccessibleDrawer onClose={closeFilterSheet} ariaLabel="Filters" testId="activity-filter-sheet" className="max-h-[90dvh] space-y-4 overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(16px+env(safe-area-inset-bottom))]" backdropClassName="items-end"> <h2 className="text-lg font-semibold">Filters</h2><div className="grid gap-3 sm:grid-cols-2">{renderFilterFields(filterDraft, (key, value) => setFilterDraft((current) => ({ ...current, [key]: value })), 'mobile-activity')}</div><div className="flex justify-between gap-2"><button type="button" onClick={clearFilterDraft} className="min-h-11 px-4 font-semibold">Clear</button><button type="button" onClick={applyFilterDraft} className="min-h-11 rounded-control bg-primary px-4 font-semibold text-white">Apply filters</button></div></AccessibleDrawer>}
        {status === 'loading' ? <div role="status" aria-label="Loading activity" className="space-y-3"><div className="h-36 animate-pulse rounded-xl bg-surface-alt" /><div className="h-36 animate-pulse rounded-xl bg-surface-alt" /></div>
          : status === 'error' ? <InlineNotice severity="error">Activity could not be loaded. Refresh to try again.</InlineNotice>
            : activities.length === 0 ? <InlineNotice severity="info">No completed inspections yet.</InlineNotice>
              : <>
                <ol data-testid="activity-list" className="space-y-4 pb-[calc(56px+24px+var(--mobile-nav-height)+env(safe-area-inset-bottom))] md:pr-10">{visibleStoreGroups.map((group) => <StoreActivityGroup key={group.key} group={group} isExpanded={expandedStoreKeys.has(group.key)} onExpandedChange={(expanded) => setExpandedStoreKeys((current) => { const next = new Set(current); if (expanded) { next.add(group.key); if (next.size > 500) { const oldest = next.values().next().value; if (oldest) next.delete(oldest); } } else next.delete(group.key); return next; })} onDelete={setDeleteTarget} revealedActivityId={revealedActivityId} onReveal={setRevealedActivityId} retryingInspectionIds={retryingInspectionIds} syncing={syncSnapshot?.status === 'syncing'} onRetry={async (inspectionId) => {
                  const store = runtimeStatusStore ?? getSyncRuntime()?.statusStore;
                  if (!store || retryingInspectionIds.has(inspectionId)) return;
                  setRetryingInspectionIds((current) => new Set(current).add(inspectionId));
                  try { await store.syncNow('manual', 'upload'); } catch { /* The card retains the failure detail. */ }
                  finally { setRetryingInspectionIds((current) => { const next = new Set(current); next.delete(inspectionId); return next; }); }
                }} />)}</ol>
                {(storeGroups.length > visibleStoreGroups.length || hasMoreActivity) && <button type="button" onClick={() => void loadMoreStores()} disabled={isLoadingMoreActivity} className="mx-auto block min-h-11 px-4 font-semibold text-primary disabled:opacity-50">{isLoadingMoreActivity ? 'Loading more activity…' : 'Load more stores'}</button>}
              </>}
      </div>
    </PageShell>
    <button type="button" aria-label="Open quick actions" onClick={(event) => setQuickActionAnchor(quickActionAnchor ? null : event.currentTarget)} className="fixed bottom-[calc(var(--mobile-nav-height)+24px+env(safe-area-inset-bottom))] right-4 z-40 grid size-14 place-items-center rounded-full bg-primary text-white shadow-xl md:bottom-6 md:right-8"><AddRounded aria-hidden="true" /></button>
    {quickActionAnchor && <div role="menu" className="fixed bottom-[calc(var(--mobile-nav-height)+92px+env(safe-area-inset-bottom))] right-4 z-40 min-w-48 rounded-control border border-border bg-white p-1 shadow-xl md:bottom-24 md:right-8"><button type="button" role="menuitem" onClick={() => { setQuickActionAnchor(null); setIsScannerOpen(true); }} className="block min-h-11 w-full rounded px-3 text-left"><QrCodeScannerRounded className="mr-2 inline size-4" />Scan QR code</button><Link role="menuitem" href="/lookup" onClick={() => setQuickActionAnchor(null)} className="block min-h-11 rounded px-3 py-2"><SearchRounded className="mr-2 inline size-4" />Search catalog</Link></div>}
    <QrScannerDialog
        open={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onDetected={(payload) => {
          const query = extractLookupQuery(payload);
          setIsScannerOpen(false);
          router.push(query ? `/lookup?query=${encodeURIComponent(query)}` : '/lookup');
        }}
    />
    {deleteTarget && <AccessibleModal onClose={() => setDeleteTarget(undefined)} labelledBy="delete-inspection-title" className="max-w-md rounded-2xl bg-white p-5 shadow-xl"><h2 id="delete-inspection-title" className="text-lg font-semibold">Delete inspection?</h2><p className="mt-3 text-sm text-muted">This removes the local inspection and queues the deletion for the next sync. You can undo it while the deletion is still waiting on this device.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDeleteTarget(undefined)} disabled={isDeleting} className="min-h-11 px-4">Cancel</button><button type="button" onClick={() => void confirmDelete()} disabled={isDeleting} className="min-h-11 rounded-control bg-danger px-4 font-semibold text-white"><DeleteOutlineRounded className="mr-2 inline size-4" />Delete inspection</button></div></AccessibleModal>}
    {undoInspectionId && <div role="status" className="fixed bottom-[calc(var(--mobile-nav-height)+12px+env(safe-area-inset-bottom))] left-4 right-4 z-50 flex items-center justify-between rounded-control bg-ink px-4 py-3 text-white shadow-xl md:bottom-4 md:left-auto md:w-auto"><span>Inspection deleted locally.</span><button type="button" onClick={() => void undoDelete()} className="min-h-10 px-3 font-semibold">Undo</button><button type="button" aria-label="Dismiss" onClick={() => setUndoInspectionId(undefined)}>×</button></div>}
  </>;
}

function BoxHeading({ count, hasMore }: { count: number; hasMore?: boolean }) {
  return <div><h2 className="font-semibold text-ink">Inspection history</h2><p className="text-sm text-muted">{count}{hasMore ? '+' : ''} completed {count === 1 && !hasMore ? 'inspection' : 'inspections'}</p></div>;
}

function FilterSelect({ id, label, value, options, emptyLabel, onChange }: { id: string; label: string; value: string; options: string[]; emptyLabel?: string; onChange: (value: string) => void }) {
  const selectOptions = [...(emptyLabel ? [{ value: '', label: emptyLabel }] : []), ...options.map((item) => { const [optionValue, optionLabel] = item.includes('|') ? [item.slice(0, item.indexOf('|')), item.slice(item.indexOf('|') + 1)] : [item, item]; return { value: optionValue, label: optionLabel }; })];
  return <AccessibleSelect id={id} className="min-w-[min(100%,220px)] flex-1" label={label} value={value} onChange={onChange} options={selectOptions} />;
}

function DateFilter({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="flex min-w-[min(100%,170px)] flex-1 flex-col gap-1 text-xs text-muted">{label}<input aria-label={label} type="date" value={value} onChange={(event) => onChange(event.target.value)} className="h-12 rounded-control border border-border-strong bg-white px-3 text-base text-ink outline-none focus:ring-2 focus:ring-focus" /></label>;
}

function ActivityFilterChip({ value, label, testId, clear }: { value: string; label: string; testId: string; clear: () => void }) {
  if (!value) return null;
  return <span data-testid={testId} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs">{label ? `${label}: ` : ''}{value}<button type="button" aria-label={`Remove ${label || value} filter`} onClick={clear}>×</button></span>;
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
  return <li className="w-full min-w-0 list-none">
    <AnimatedDisclosure
      id={`activity-${encodeURIComponent(group.key)}-inspections`}
      headingLevel={2}
      testId="activity-store-header"
      open={expanded}
      onOpenChange={onExpandedChange}
      className="sticky top-0 z-[2] w-full border-b border-border bg-page"
      summaryClassName="w-full px-0 text-left focus-visible:outline-2 focus-visible:outline-focus md:-mr-10 md:w-[calc(100%+2.5rem)]"
      panelClassName="overflow-hidden"
      summary={<ListRow
        className="w-full"
        leading={<StoreRounded aria-hidden="true" className="size-5 text-primary" />}
        primary={<span role="heading" aria-level={3} className="font-semibold">{group.storeName}</span>}
        secondary={<>{group.location || 'Location not recorded'} · {group.activities.length} {group.activities.length === 1 ? 'inspection' : 'inspections'}{group.notSyncedCount > 0 && <> · <span role="status" aria-label={`${group.notSyncedCount} inspections not synced`}>{group.notSyncedCount} not synced</span></>}</>}
        trailing={<ExpandMoreRounded aria-hidden="true" className={`size-5 text-primary transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />}
      />}
    >
      <ol className="m-0 list-none space-y-3 pl-2 sm:pl-6">
        {group.products.map((product) => <ProductActivityGroupCard key={product.key} product={product} onDelete={onDelete} revealedActivityId={revealedActivityId} onReveal={onReveal} retryingInspectionIds={retryingInspectionIds} syncing={syncing} onRetry={onRetry} />)}
      </ol>
    </AnimatedDisclosure>
    </li>;
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
  return <li className="min-w-0 list-none border-b border-border">
    <AnimatedDisclosure
      id={`product-${encodeURIComponent(product.key)}-inspections`}
      ariaLabel={`${expanded ? 'Collapse' : 'Expand'} ${productLabel} inspections`}
      headingLevel={3}
      open={expanded}
      onOpenChange={(next) => setExpanded(next)}
      className="space-y-1"
      summaryClassName="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-focus"
      panelClassName="overflow-hidden"
      summary={<><h4 className="text-sm font-bold text-ink">{productLabel} · {product.activities.length} inspections{product.productType ? ` · ${product.productType}` : ''}</h4><ExpandMoreRounded aria-hidden="true" className={`size-5 shrink-0 text-primary transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} /></>}
    >
      <ol className="m-0 list-none space-y-2 p-0">
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
      </ol>
    </AnimatedDisclosure>
  </li>;
}

function ActivityCard({ activity, inspectionNumber, showProductLabel, onDelete, isRevealed, onReveal, retryingInspectionIds, syncing, onRetry }: { activity: ActivityRecord; inspectionNumber: number; showProductLabel: boolean; onDelete: (activity: ActivityRecord) => void; isRevealed: boolean; onReveal: (activityId?: string) => void; retryingInspectionIds: Set<string>; syncing: boolean; onRetry: (inspectionId: string) => Promise<void> }) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
    clearPressTimer();
    pressTimer.current = window.setTimeout(revealActions, 650);
  };
  const handleTouchMove = (event: React.TouchEvent<HTMLElement>) => {
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
  const syncIcon = activity.syncStatus === 'failed' || activity.syncStatus === 'conflict'
    ? { kind: 'attention', Icon: ErrorOutlineRounded }
    : activity.syncStatus === 'synced' || activity.syncStatus === 'remote'
      ? { kind: 'synced', Icon: CloudDoneOutlined }
      : activity.syncStatus ? { kind: 'waiting', Icon: WaitingRounded } : undefined;
  const SyncIcon = syncIcon?.Icon;
  return <li
    role="listitem" data-inspection-card className="relative list-none overflow-hidden"
    onContextMenu={(event) => { event.preventDefault(); revealActions(); }}
    onTouchStart={handleTouchStart}
    onTouchMove={handleTouchMove}
    onTouchEnd={handleTouchEnd}
    onTouchCancel={handleTouchEnd}
  >
    <div className="absolute inset-y-0 right-0 flex w-28 justify-end overflow-hidden rounded-r-xl bg-danger"><button type="button" onClick={() => onDelete(activity)} tabIndex={isRevealed ? 0 : -1} className="min-h-full min-w-28 font-bold text-white" aria-label={`Delete inspection ${actionLabel}`}><DeleteOutlineRounded aria-hidden="true" className="mr-1 inline size-4" />Delete</button></div>
    <Surface className="relative rounded-xl border bg-white transition-transform motion-reduce:transition-none" style={{ transform: `translateX(${displaySwipeOffset}px)` }}>
      <div className="relative min-w-0 px-3 py-2 pr-14">
        {activity.inspectionId ? <Link href={`/inspect/${encodeURIComponent(activity.inspectionId)}?view=1`} className="block min-w-0 text-ink no-underline">
          <div data-testid="activity-control-line" className="truncate whitespace-nowrap font-mono text-[13px] font-semibold">{showProductLabel ? actionLabel : `Inspection ${inspectionNumber}`}</div>
          <div data-testid="activity-product-line" title={modelSummary} className="truncate text-sm text-muted">{modelSummary}</div>
          <div data-testid="activity-status-line" className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <StatusBadge variant={activity.outcome === 'compliant' ? 'compliant' : activity.outcome === 'non_compliant' ? 'nonCompliant' : 'neutral'} label={outcomeLabel} />
            {activity.username && <span className="truncate">Inspected by {activity.username}</span>}
            {SyncIcon && syncChip && <span data-testid={`sync-chip-${activity.syncStatus}`} data-sync-icon={syncIcon?.kind} role="status" aria-label={`Sync status: ${syncChip.label}`} tabIndex={0} title={`${syncChip.label}${activity.syncError ? ` · ${activity.syncError}` : ''}`} className={syncIcon.kind === 'synced' ? 'text-success' : syncIcon.kind === 'waiting' ? 'text-warning' : 'text-danger'}><SyncIcon aria-hidden="true" className="size-4" /><span className="sr-only">{syncChip.label}</span></span>}
            {activity.evidenceCount !== undefined && <span className="sr-only">{activity.evidenceCount} evidence item{activity.evidenceCount === 1 ? '' : 's'}</span>}
          </div>
        </Link> : <div className="block min-w-0 text-ink">
          <div data-testid="activity-control-line" className="truncate whitespace-nowrap font-mono text-[13px] font-semibold">{actionLabel}</div>
          <div data-testid="activity-product-line" title={modelSummary} className="truncate text-sm text-muted">{modelSummary}</div>
          <div data-testid="activity-status-line" className="flex min-w-0 items-center gap-2 text-xs text-muted"><StatusBadge variant={activity.outcome === 'compliant' ? 'compliant' : activity.outcome === 'non_compliant' ? 'nonCompliant' : 'neutral'} label={outcomeLabel} />{activity.username && <span className="truncate">Inspected by {activity.username}</span>}</div>
        </div>}
        {activity.inspectionId && <button type="button" aria-label={`Inspection actions for ${actionLabel}`} onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()} onClick={() => setMenuOpen((open) => !open)} className="absolute right-1 top-0 grid size-11 shrink-0 place-items-center rounded-full text-primary"><MoreVertRounded /></button>}
        {menuOpen && <div role="menu" aria-label={`Inspection actions for ${actionLabel}`} className="absolute right-2 top-11 z-20 min-w-48 rounded-control border border-border bg-white p-1 shadow-xl">{needsRetry && activity.inspectionId && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void onRetry(activity.inspectionId!); }} disabled={isRetrying || syncing} className="block min-h-11 w-full rounded px-3 py-2 text-left text-sm disabled:opacity-50">{isRetrying || syncing ? 'Retrying…' : 'Retry'}</button>}{activity.inspectionId && <Link role="menuitem" href={`/inspect/${encodeURIComponent(activity.inspectionId)}`} onClick={() => setMenuOpen(false)} className="block min-h-11 rounded px-3 py-2 text-sm"><EditRounded className="mr-2 inline size-4" />Edit inspection</Link>}<button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDelete(activity); }} className="block min-h-11 w-full rounded px-3 py-2 text-left text-sm text-danger"><DeleteOutlineRounded className="mr-2 inline size-4" />Delete inspection</button></div>}
      </div>
    </Surface>
  </li>;
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
