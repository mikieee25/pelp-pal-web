"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import {
  ComplianceRateBadge,
  MobileReportCard,
} from "@/components/report/mobile-report-card";
import {
  InlineNotice,
  AccessibleModal,
  PageHeader,
  PageShell,
  Section,
  Surface,
} from "@/components/ui";
import { getBrowserRepository } from "@/lib/db/browser";
import { useRepositoryRevision } from "@/lib/db/use-repository-revision";
import type { EvidenceDownloadEstimate, EvidenceDownloadResult } from "@/lib/db/repository";
import type { ActivityRecord, InspectionRecord, StoreRecord } from "@/lib/db/records";
import {
  buildSummaryCsv,
  type SummaryCsvData,
} from "@/features/summary/summary-export";
import { buildReportDiagnostics } from "@/features/report/report-diagnostics";
import { productTypeKey, reportTypesFor } from "@/features/report/report-model";
import { enrichInspectionsWithActivity } from "@/lib/db/inspection-enrichment";
import { readInspectionField } from "@/lib/db/inspection-fields";
import { normalizeInspectionAnswers } from "@/lib/inspection-outcome";
import { downloadBlob } from "@/lib/transfer/browser-download";
import { normalizeStoreName } from "@/lib/store-name";
import { useSyncRuntimeState } from "@/features/sync/sync-runtime-boundary";
import { useCurrentStore } from "@/features/store/use-current-store";
import { startSyncRuntime } from "@/lib/sync/runtime";

type Product = {
  key: string;
  storeName: string;
  controlNumber: string;
  model: string;
  productType: string;
  typeKey: string;
  records: InspectionRecord[];
  nonCompliant: boolean;
  hasLabel: boolean;
  hasCoe: boolean;
  companyName: string;
  retailPrice: string;
};

type ReportRow = {
  typeKey: string;
  label: string;
  models: number;
  visits: number;
  compliant: number;
  notApplicable: number;
  labeled: number;
  exempted: number;
  nonCompliant: number;
  compliance: number | null;
};

const NC_PAGE_SIZE = 10;

type BreakdownRow = {
  typeKey: string;
  label: string;
  notRegistered: number;
  noDocument: number;
  placement: number;
  visualQuality: number;
  productDetails: number;
};

export function SummaryView() {
  const repository = useMemo(() => getBrowserRepository(), []);
  const repositoryRevision = useRepositoryRevision(repository);
  const { store: currentStore, status: currentStoreStatus } =
    useCurrentStore(repository);
  const syncRuntime = useSyncRuntimeState();
  const [syncSnapshot, setSyncSnapshot] = useState(() =>
    syncRuntime.statusStore?.getSnapshot(),
  );
  const [isRefreshingTeam, setIsRefreshingTeam] = useState(false);
  const [syncRefreshError, setSyncRefreshError] = useState<string>();
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [photoEstimate, setPhotoEstimate] = useState<EvidenceDownloadEstimate>();
  const [photoEstimateError, setPhotoEstimateError] = useState<string>();
  const [photoInspectionIds, setPhotoInspectionIds] = useState<string[]>([]);
  const [photoStoreFilter, setPhotoStoreFilter] = useState<string>();
  const [photoDownloading, setPhotoDownloading] = useState(false);
  const [photoDownloadFinished, setPhotoDownloadFinished] = useState(false);
  const [photoProgress, setPhotoProgress] = useState({ completed: 0, total: 0 });
  const [photoResults, setPhotoResults] = useState<EvidenceDownloadResult[]>([]);
  const [photoDownloadError, setPhotoDownloadError] = useState<string>();
  const photoDownloadAbort = useRef<AbortController | undefined>(undefined);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const storeFilter = currentStore
    ? `${normalizeProductIdentity(currentStore.storeId)}|${normalizeStoreName(currentStore.name)}|${normalizeProductIdentity(currentStore.location)}`
    : "__no_active_store__";
  const [ncPage, setNcPage] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [catalogVersion, setCatalogVersion] = useState<number>();
  const [pendingSync, setPendingSync] = useState(0);

  useEffect(() => {
    const store = syncRuntime.statusStore;
    if (!store) {
      setSyncSnapshot(undefined);
      return;
    }
    const refresh = () => setSyncSnapshot(store.getSnapshot());
    refresh();
    return store.subscribe(refresh);
  }, [syncRuntime.statusStore]);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    void repository
      .listCompletedInspections()
      .then(async (rows) => {
        const [catalogs, manifest, syncCounts, activityRows] = await Promise.all([
          repository.getCatalogByIds?.(
            rows.map(
              (row) =>
                readInspectionField(row, [
                  "catalogId",
                  "catalog_id",
                  "productId",
                  "product_id",
                ]) || row.id,
            ),
          ) ?? Promise.resolve([]),
          repository.getCatalogManifestState?.("masterlist"),
          repository.getSyncStatusCounts?.(),
          repository.listActivity?.({ limit: 999999 }) ?? Promise.resolve([]),
        ]);
        const catalogById = new Map(
          catalogs.map((catalog) => [catalog.id, catalog]),
        );
        const enrichedRows = enrichInspectionsWithActivity(rows, activityRows);
        const catalogEnrichedRows = enrichedRows.map((row) => {
          const catalogId = readInspectionField(row, [
            "catalogId",
            "catalog_id",
            "productId",
            "product_id",
          ]);
          const catalog = catalogId ? catalogById.get(catalogId) : undefined;
          return catalog && !row.dynamic_fields
            ? { ...row, dynamic_fields: catalog.dynamic_fields }
            : row;
        });
        if (active) {
          setInspections(catalogEnrichedRows);
          setActivities(activityRows);
          setCatalogVersion(manifest?.version);
          setPendingSync(syncCounts?.pendingCount ?? 0);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, repository, repositoryRevision]);

  useEffect(() => setNcPage(0), [storeFilter]);
  useEffect(() => () => photoDownloadAbort.current?.abort(), []);

  const filteredInspections = useMemo(
    () =>
      inspections.filter(
        (record) =>
          isForCurrentStore(record, currentStore),
      ),
    [currentStore, inspections],
  );
  const recoveredInspections = useMemo(() => {
    if (!currentStore) return [];
    const knownIds = new Set(inspections.map((inspection) => inspection.id));
    const latestSnapshots = new Map<string, InspectionRecord>();
    activities
      .filter(
        (activity) =>
          activity.inspectionId &&
          !knownIds.has(activity.inspectionId) &&
          isActivityForCurrentStore(activity, currentStore) &&
          isCompletedEvent(activity.eventType),
      )
      .forEach((activity) => {
        const snapshot = toCompleteInspectionSnapshot(activity);
        if (!snapshot) return;
        const existing = latestSnapshots.get(snapshot.id);
        if (!existing || compareLatestVisitFirst(snapshot, existing) < 0)
          latestSnapshots.set(snapshot.id, snapshot);
      });
    return Array.from(latestSnapshots.values());
  }, [activities, currentStore, inspections]);
  const reportInspections = useMemo(
    () => [...filteredInspections, ...recoveredInspections],
    [filteredInspections, recoveredInspections],
  );
  const products = useMemo(() => {
    const normalized = reportInspections
      .map(toProductRecord)
      .filter((record) => isForCurrentStore(record, currentStore));
    return consolidateProducts(normalized);
  }, [currentStore, reportInspections]);
  const activityVisitIds = useMemo(() => {
    if (!currentStore) return new Set<string>();
    return new Set<string>(
      activities
        .filter((activity) => isActivityForCurrentStore(activity, currentStore))
        .map((activity) => activity.inspectionId ?? `activity:${activity.id}`),
    );
  }, [activities, currentStore]);
  const inspectionVisitIds = useMemo(
    () => new Set(reportInspections.map((inspection) => inspection.id)),
    [reportInspections],
  );
  const unmatchedVisitIds = useMemo(
    () =>
      Array.from(
        new Set([...activityVisitIds, ...inspectionVisitIds]),
      )
        .filter(
          (id) =>
            activityVisitIds.has(id) !== inspectionVisitIds.has(id),
        )
        .sort(),
    [activityVisitIds, inspectionVisitIds],
  );
  const activityVisitCount = activityVisitIds.size;
  const inspectionVisitCount = inspectionVisitIds.size;
  const hasVisitCountMismatch =
    status === "ready" &&
    currentStoreStatus === "ready" &&
    unmatchedVisitIds.length > 0;
  const diagnostics = useMemo(
    () =>
      buildReportDiagnostics(reportInspections, {
        catalogVersion,
        pendingSync,
      }),
    [catalogVersion, pendingSync, reportInspections],
  );

  const complianceRows = useMemo(
    () => createComplianceRows(products),
    [products],
  );
  const breakdownRows = useMemo(
    () => createBreakdownRows(products),
    [products],
  );
  const ncProducts = useMemo(
    () => products.filter((product) => product.nonCompliant),
    [products],
  );
  const ncPageCount = Math.max(1, Math.ceil(ncProducts.length / NC_PAGE_SIZE));
  useEffect(
    () => setNcPage((page) => Math.min(page, ncPageCount - 1)),
    [ncPageCount],
  );
  const visibleNcProducts = ncProducts.slice(
    ncPage * NC_PAGE_SIZE,
    (ncPage + 1) * NC_PAGE_SIZE,
  );
  const total = sum(complianceRows, (row) => row.models);
  const totalVisits = sum(complianceRows, (row) => row.visits);
  const totalNonCompliant = sum(complianceRows, (row) => row.nonCompliant);
  const totalCompliant = sum(complianceRows, (row) => row.compliant);
  const totalNotApplicable = sum(
    complianceRows,
    (row) => row.notApplicable,
  );
  const totalLabeled = sum(complianceRows, (row) => row.labeled);
  const totalExempted = sum(complianceRows, (row) => row.exempted);
  const nonCompliantRows = useMemo(
    () =>
      ncProducts.map((product, index) => {
        const latest = product.records[0];
        const description = latest
          ? findingDescription([latest])
          : "Non-compliant finding";
        return {
          no: index + 1,
          ecpType: product.productType || "Not available",
          brandName: textValue(latest?.brand) || "Not available",
          modelCode: product.model || "Not available",
          description,
          status: "NC",
          company: product.companyName || "Not available",
          retailPrice: product.retailPrice || "Not available",
          companyEmail: textValue(latest?.companyEmail) || "Not available",
          pcrEmail: textValue(latest?.pcrEmail) || "Not available",
          warning: warningFor(description),
        };
      }),
    [ncProducts],
  );
  const exportData = useMemo<SummaryCsvData>(
    () => ({
      storeLabel: currentStore?.name ?? "No active store",
      generatedAt: new Date().toISOString(),
      teamSyncedAt: syncSnapshot?.lastDownloadAt,
      statusRule: "Latest completed inspection visit per product",
      catalogVersion,
      pendingSync,
      complianceRows,
      breakdownRows,
      emvRows: complianceRows.map((row) => ({
        ...row,
        compliant: row.compliant,
      })),
      totals: {
        models: total,
        visits: totalVisits,
        labeled: totalLabeled,
        exempted: totalExempted,
        nonCompliant: totalNonCompliant,
        compliant: totalCompliant,
        notApplicable: totalNotApplicable,
        compliance: percentage(
          totalCompliant + totalNonCompliant,
          totalNonCompliant,
        ),
      },
      nonCompliantRows,
    }),
    [
      breakdownRows,
      catalogVersion,
      complianceRows,
      currentStore?.name,
      nonCompliantRows,
      pendingSync,
      syncSnapshot?.lastDownloadAt,
      total,
      totalVisits,
      totalCompliant,
      totalNotApplicable,
      totalExempted,
      totalLabeled,
      totalNonCompliant,
    ],
  );

  const isTeamReportReady = Boolean(
    status === "ready" &&
      currentStoreStatus === "ready" &&
      currentStore &&
      !isRefreshingTeam &&
      pendingSync === 0 &&
      syncSnapshot?.status === "live" &&
      syncSnapshot.lastDownloadAt &&
      syncSnapshot.pendingCount === 0 &&
      syncSnapshot.conflictCount === 0 &&
      (syncSnapshot.failedCount ?? 0) === 0 &&
      !syncSnapshot.storeSyncError,
  );
  const downloadedPhotoCount = photoResults.filter(
    (item) => item.status === "downloaded",
  ).length;
  const cachedPhotoCount = photoResults.filter(
    (item) => item.status === "cached",
  ).length;
  const failedPhotoCount = photoResults.filter(
    (item) =>
      item.status === "failed" ||
      item.status === "unavailable" ||
      item.status === "offline",
  ).length;

  const prepareStorePhotos = async () => {
    if (!isTeamReportReady || !currentStore) return;
    const ids = Array.from(new Set(filteredInspections.map((record) => record.id)));
    setPhotoInspectionIds(ids);
    setPhotoStoreFilter(storeFilter);
    setPhotoEstimate(undefined);
    setPhotoEstimateError(undefined);
    setPhotoResults([]);
    setPhotoDownloadFinished(false);
    setPhotoDownloadError(undefined);
    setPhotoDialogOpen(true);
    try {
      await startSyncRuntime();
      setPhotoEstimate(await repository.getEvidenceDownloadEstimate(ids));
    } catch (error) {
      setPhotoEstimateError(
        error instanceof Error ? error.message : "Could not estimate store photos.",
      );
    }
  };

  const downloadStorePhotos = async () => {
    if (!photoEstimate || photoStoreFilter !== storeFilter || !isTeamReportReady)
      return;
    const controller = new AbortController();
    photoDownloadAbort.current = controller;
    setPhotoDownloading(true);
    setPhotoDownloadError(undefined);
    setPhotoProgress({ completed: 0, total: photoEstimate.photoCount });
    try {
      await startSyncRuntime();
      setPhotoResults(
        await repository.downloadRemoteEvidence(photoInspectionIds, {
          signal: controller.signal,
          onProgress: (completed, total) => setPhotoProgress({ completed, total }),
        }),
      );
      setPhotoDownloadFinished(true);
    } catch (error) {
      setPhotoDownloadError(
        error instanceof DOMException && error.name === "AbortError"
          ? "Download canceled. Retry to download the remaining photos."
          : error instanceof Error
            ? error.message
            : "Photo download failed.",
      );
    } finally {
      photoDownloadAbort.current = undefined;
      setPhotoDownloading(false);
    }
  };

  const syncAndRefreshReport = async () => {
    const syncStore = syncRuntime.statusStore;
    if (!syncStore) {
      setSyncRefreshError(
        syncRuntime.error ?? "Synchronization is not available for this account.",
      );
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSyncRefreshError(
        "Connect to the internet before preparing the team report.",
      );
      return;
    }

    setIsRefreshingTeam(true);
    setSyncRefreshError(undefined);
    try {
      await syncStore.syncNow("manual", "full");
      const snapshot = syncStore.getSnapshot();
      if (
        snapshot.status !== "live" ||
        !snapshot.lastDownloadAt ||
        snapshot.pendingCount > 0 ||
        snapshot.conflictCount > 0 ||
        (snapshot.failedCount ?? 0) > 0 ||
        snapshot.storeSyncError
      ) {
        throw new Error(
          "Team sync did not finish cleanly. Resolve pending changes or conflicts, then retry.",
        );
      }
      setStatus("loading");
      setLoadAttempt((attempt) => attempt + 1);
    } catch (error) {
      setSyncRefreshError(
        error instanceof Error
          ? error.message
          : "Team sync failed. Retry before exporting the report.",
      );
    } finally {
      setIsRefreshingTeam(false);
    }
  };

  const downloadCsv = () => {
    if (!isTeamReportReady || hasVisitCountMismatch) return;
    const blob = new Blob([buildSummaryCsv(exportData)], {
      type: "text/csv;charset=utf-8",
    });
    downloadBlob(
      blob,
      `pelp-pal-summary-${fileSlug(exportData.storeLabel)}.csv`,
    );
  };

  return (
    <PageShell maxWidth="6xl">
      <PageHeader
        title="Summary"
        subtitle={
          <>
            <span>
              Team report from completed inspections synced to this account.
              The latest visit sets each product&apos;s current status.
            </span>
            <span className="block text-xs text-muted">
              {catalogVersion !== undefined
                ? `Catalog v${catalogVersion}`
                : "Catalog version unavailable"}{" "}
              · {pendingSync} pending sync
            </span>
          </>
        }
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              type="button"
              onClick={syncAndRefreshReport}
              disabled={isRefreshingTeam || syncSnapshot?.status === "offline"}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-control border border-border-strong px-4 font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              {isRefreshingTeam ? "Syncing team data…" : "Sync team data"}
            </button>
            <button
              type="button"
              onClick={() => void prepareStorePhotos()}
              disabled={!isTeamReportReady}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-border-strong px-4 font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              <Download aria-hidden="true" className="size-4" />
              Download all photos
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={!isTeamReportReady || hasVisitCountMismatch}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-border-strong px-4 font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              <Download aria-hidden="true" className="size-4" />
              {status === "loading" ? "Preparing report…" : "Download CSV"}
            </button>
          </div>
        }
      />
      <Surface
        data-testid="summary-filter-bar"
        className="sticky top-0 z-10 mb-6 space-y-3 p-4 sm:flex sm:items-center sm:justify-between sm:space-y-0"
      >
        <div>
          <h2 className="font-semibold text-ink">Report filters</h2>
          <p className="text-sm text-muted">
            This summary is scoped to the active store.
          </p>
        </div>
        <p className="text-sm font-semibold text-ink" aria-live="polite">
          {currentStoreStatus === "loading"
            ? "Loading active store…"
            : currentStoreStatus === "error"
              ? "Could not load active store"
              : currentStore?.name ?? "No active store selected"}
        </p>
      </Surface>
      {status === "loading" && (
        <Surface role="status" aria-live="polite" className="mb-6 p-4">
          Preparing the report from synced team inspections…
        </Surface>
      )}
      {currentStoreStatus === "ready" && !currentStore && (
        <InlineNotice severity="info" className="mb-6">
          Select an active store to view its summary.
        </InlineNotice>
      )}
      {currentStoreStatus === "error" && (
        <InlineNotice severity="error" className="mb-6">
          The summary is hidden because the active store could not be loaded.
          Reload the page and try again.
        </InlineNotice>
      )}
      {status === "error" && (
        <InlineNotice
          severity="error"
          className="mb-6"
          action={
            <button
              type="button"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              className="min-h-11 rounded-control border border-border-strong px-4 font-semibold text-primary"
            >
              Retry
            </button>
          }
        >
          The report could not be loaded. No totals are shown, and CSV export is
          disabled until the inspection data loads successfully.
        </InlineNotice>
      )}
      {status === "ready" && isTeamReportReady && inspections.length === 0 && (
        <InlineNotice severity="info" className="mb-6">
          No completed team inspections were found for this account after sync.
        </InlineNotice>
      )}
      {status === "ready" && !isTeamReportReady && (
        <InlineNotice
          severity={syncRefreshError ? "error" : "warning"}
          className="mb-6"
        >
          {syncRefreshError ??
            (isRefreshingTeam
              ? "Team data is syncing. The report will be available when sync and refresh finish."
              : syncSnapshot?.storeSyncError
                ? `Store data could not be synced: ${syncSnapshot.storeSyncError}`
              : pendingSync > 0
                ? "This device has pending changes. Sync them before using this as the team report."
                : "Sync team data before opening or exporting the official report.")}
        </InlineNotice>
      )}
      {status === "ready" && isTeamReportReady && syncSnapshot?.lastDownloadAt && (
        <InlineNotice severity="success" className="mb-6">
          Team data synced at {formatReportDate(syncSnapshot.lastDownloadAt)}.
        </InlineNotice>
      )}
      {hasVisitCountMismatch && currentStore && (
        <InlineNotice severity="error" className="mb-6">
          <p>
            Report totals do not reconcile for {currentStore.name}: Activity lists {activityVisitCount} completed visits, but Summary has {inspectionVisitCount} inspection records. The official tables and CSV stay unavailable until every visit has a matching inspection record.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer font-semibold">
              Show {unmatchedVisitIds.length} unmatched visit IDs
            </summary>
            <ul className="mt-2 space-y-1 font-mono text-xs">
              {unmatchedVisitIds.slice(0, 20).map((id) => (
                <li key={id}>{id}</li>
              ))}
              {unmatchedVisitIds.length > 20 && (
                <li>And {unmatchedVisitIds.length - 20} more.</li>
              )}
            </ul>
          </details>
        </InlineNotice>
      )}
      {status === "ready" && isTeamReportReady && recoveredInspections.length > 0 && (
        <InlineNotice severity="warning" className="mb-6">
          {recoveredInspections.length} completed visit{recoveredInspections.length === 1 ? " is" : "s are"} included from verified activity snapshots because the matching inspection record or revisions are missing. Totals and CSV include these visits; the underlying sync records still need repair.
        </InlineNotice>
      )}
      {status === "ready" && isTeamReportReady && !hasVisitCountMismatch && (
        <ReportDiagnosticsCard
          diagnostics={diagnostics}
          latestNonCompliantCount={totalNonCompliant}
        />
      )}
      {status === "ready" && isTeamReportReady && !hasVisitCountMismatch && <nav
        aria-label="Summary sections"
        className="mb-6 flex gap-2 overflow-x-auto rounded-control border border-border bg-white p-2"
      >
        {[
          ["summary-compliance", "Compliance"],
          ["summary-breakdown", "NC breakdown"],
          ["summary-emv", "EMV results"],
          ["summary-nc-results", "NC results"],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="min-h-10 whitespace-nowrap rounded-control px-3 py-2 text-sm font-semibold text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-focus"
          >
            {label}
          </a>
        ))}
      </nav>}
      {status === "ready" && isTeamReportReady && !hasVisitCountMismatch && <div className="space-y-8">
        <ReportSection
          id="summary-compliance"
          title="Compliance Summary"
          subtitle="Model totals are unique by store, product type, and control number (or model code when no control number exists). Visit counts include every completed inspection. Status uses the latest completed visit."
        >
          <div className="hidden md:block">
            <ComplianceTable
              rows={complianceRows}
              total={{
                models: total,
                visits: totalVisits,
                compliant: totalCompliant,
                notApplicable: totalNotApplicable,
                labeled: totalLabeled,
                exempted: totalExempted,
                nonCompliant: totalNonCompliant,
                compliance: percentage(
                  totalCompliant + totalNonCompliant,
                  totalNonCompliant,
                ),
              }}
            />
          </div>
          <div className="space-y-3 md:hidden">
            {complianceRows.map((row) => (
              <MobileReportCard
                key={row.typeKey}
                testId="summary-mobile-compliance-card"
                title={row.label}
                compliance={formatPercentage(row.compliance)}
                metrics={[
                  { label: "Product models", value: row.models },
                  { label: "Inspection visits", value: row.visits },
                  { label: "Compliant", value: row.compliant },
                  { label: "Not applicable", value: row.notApplicable },
                  { label: "Energy labeled", value: row.labeled },
                  { label: "COE exempted", value: row.exempted },
                  { label: "Non-compliant", value: row.nonCompliant },
                ]}
              />
            ))}
          </div>
        </ReportSection>
        <ReportSection
          id="summary-breakdown"
          title="Non-Compliance Breakdown Summary"
          subtitle="A product can be counted in more than one finding category when it has multiple NC findings."
        >
          <div className="hidden md:block">
            <BreakdownTable rows={breakdownRows} />
          </div>
          <div className="space-y-3 md:hidden">
            {breakdownRows.map((row) => (
              <MobileReportCard
                key={row.typeKey}
                testId="summary-mobile-breakdown-card"
                title={row.label}
                metrics={[
                  { label: "Not registered", value: row.notRegistered },
                  { label: "No EL/COE", value: row.noDocument },
                  { label: "Placement", value: row.placement },
                  { label: "Visual quality", value: row.visualQuality },
                  { label: "Product details", value: row.productDetails },
                ]}
              />
            ))}
          </div>
        </ReportSection>
        <ReportSection
          id="summary-emv"
          title="Summary of EMV Results"
          subtitle="Copy-friendly totals for the finished store report."
        >
          <div className="hidden md:block">
            <EmvTable
              rows={complianceRows}
              total={{
                compliant: totalCompliant,
                nonCompliant: totalNonCompliant,
                notApplicable: totalNotApplicable,
                labeled: totalLabeled,
                exempted: totalExempted,
                models: total,
                visits: totalVisits,
                compliance: percentage(
                  totalCompliant + totalNonCompliant,
                  totalNonCompliant,
                ),
              }}
            />
          </div>
          <div className="space-y-3 md:hidden">
            {complianceRows.map((row) => (
              <MobileReportCard
                key={row.typeKey}
                testId="summary-mobile-emv-card"
                title={row.label}
                compliance={formatPercentage(
                  row.models > 0
                    ? percentage(
                        row.compliant + row.nonCompliant,
                        row.nonCompliant,
                      )
                    : null,
                )}
                metrics={[
                  { label: "Compliant", value: row.compliant },
                  { label: "Non-compliant", value: row.nonCompliant },
                  { label: "Not applicable", value: row.notApplicable },
                  { label: "Labeled", value: row.labeled },
                  { label: "Exempted", value: row.exempted },
                  { label: "Model count", value: row.models },
                  { label: "Inspection visits", value: row.visits },
                ]}
              />
            ))}
          </div>
        </ReportSection>
        <ReportSection
          id="summary-nc-results"
          title="Non-Compliance Results"
          subtitle="Products are listed when their latest completed visit is non-compliant."
        >
          <div className="hidden md:block">
            <NcTable products={visibleNcProducts} startIndex={ncPage * NC_PAGE_SIZE} />
          </div>
          <div className="space-y-3 md:hidden">
            {ncProducts.length === 0 ? (
              <Surface data-testid="summary-mobile-nc-empty" className="p-4">
                <p className="text-sm text-muted">
                  No non-compliant products for this store filter.
                </p>
              </Surface>
            ) : (
              visibleNcProducts.map((product, index) => (
                <MobileNonComplianceCard
                  key={product.key}
                  product={product}
                  index={ncPage * NC_PAGE_SIZE + index}
                />
              ))
            )}
          </div>
          {ncPageCount > 1 && (
            <nav
              aria-label="Non-compliance result pages"
              className="flex items-center justify-between gap-3 border-t border-border pt-3"
            >
              <button
                type="button"
                onClick={() => setNcPage((page) => Math.max(0, page - 1))}
                disabled={ncPage === 0}
                className="min-h-11 rounded-control border border-border-strong px-4 font-semibold text-primary disabled:opacity-50"
              >
                Previous
              </button>
              <span aria-live="polite" className="text-sm text-muted">
                Showing {ncPage * NC_PAGE_SIZE + 1}–
                {Math.min((ncPage + 1) * NC_PAGE_SIZE, ncProducts.length)} of{" "}
                {ncProducts.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setNcPage((page) => Math.min(ncPageCount - 1, page + 1))
                }
                disabled={ncPage >= ncPageCount - 1}
                className="min-h-11 rounded-control bg-primary px-4 font-semibold text-white disabled:opacity-50"
              >
                Next
              </button>
            </nav>
          )}
        </ReportSection>
      </div>}
      {photoDialogOpen && (
        <AccessibleModal
          labelledBy="store-photos-title"
          onClose={() => {
            if (!photoDownloading) setPhotoDialogOpen(false);
          }}
          className="max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-xl"
        >
          <h2 id="store-photos-title" className="text-lg font-semibold text-ink">
            Download photos for {currentStore?.name ?? "this store"}
          </h2>
          <p className="text-sm text-muted">
            Photos will be saved inside PELP Pal on this device for viewing after
            the team data is synced. They will not be added to the phone&apos;s
            Gallery.
          </p>
          {!photoDownloading && photoResults.length === 0 && (
            <p className="text-sm text-muted" aria-live="polite">
              {photoEstimateError
                ? `Photo estimate unavailable: ${photoEstimateError}`
                : photoEstimate
                  ? photoEstimate.photoCount
                    ? `${photoEstimate.photoCount} photos · about ${formatPhotoBytes(photoEstimate.bytes)} to download. Photos already on this device are skipped.`
                    : "No additional photos need downloading. There are no remote photos for this store, or they are already available on this device."
                  : "Checking photos for this store…"}
            </p>
          )}
          {photoDownloading && (
            <div className="space-y-2">
              <p className="text-sm text-muted" aria-live="polite">
                Downloading photos: {photoProgress.completed} of {photoProgress.total}
              </p>
              <progress
                className="h-2 w-full accent-primary"
                max={photoProgress.total || 1}
                value={photoProgress.total ? photoProgress.completed : undefined}
              />
            </div>
          )}
          {!photoDownloading && photoDownloadFinished && (
            <p className="text-sm text-muted" aria-live="polite">
              {downloadedPhotoCount} downloaded · {cachedPhotoCount} already
              available · {failedPhotoCount} could not be downloaded.
            </p>
          )}
          {photoDownloadError && (
            <InlineNotice severity="error">{photoDownloadError}</InlineNotice>
          )}
          {!photoDownloading && photoResults.some((item) => item.status === "failed" || item.status === "unavailable" || item.status === "offline") && (
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {photoResults
                .filter((item) => item.status === "failed" || item.status === "unavailable" || item.status === "offline")
                .map((item) => (
                  <p key={item.evidenceId} className="text-sm text-muted">
                    {item.evidenceId}: {item.message ?? item.status}
                  </p>
                ))}
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {photoDownloading ? (
              <button
                type="button"
                onClick={() => photoDownloadAbort.current?.abort()}
                className="min-h-11 rounded-control border border-border-strong px-4 font-semibold"
              >
                Cancel download
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPhotoDialogOpen(false)}
                className="min-h-11 rounded-control border border-border-strong px-4 font-semibold"
              >
                Close
              </button>
            )}
          {!photoDownloading && !photoDownloadFinished && (
              <button
                type="button"
                onClick={() => void downloadStorePhotos()}
                disabled={!photoEstimate?.photoCount || photoStoreFilter !== storeFilter || !isTeamReportReady}
                className="min-h-11 rounded-control bg-primary px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Download photos
              </button>
            )}
          </div>
        </AccessibleModal>
      )}
    </PageShell>
  );
}

function formatPhotoBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ReportDiagnosticsCard({
  diagnostics,
  latestNonCompliantCount,
}: {
  diagnostics: ReturnType<typeof buildReportDiagnostics>;
  latestNonCompliantCount: number;
}) {
  const warnings = [
    diagnostics.missingModelCount &&
      `${diagnostics.missingModelCount} product model${diagnostics.missingModelCount === 1 ? "" : "s"} missing a model code`,
    diagnostics.missingCompanyCount &&
      `${diagnostics.missingCompanyCount} product${diagnostics.missingCompanyCount === 1 ? "" : "s"} missing Company`,
    diagnostics.missingRetailPriceCount &&
      `${diagnostics.missingRetailPriceCount} product${diagnostics.missingRetailPriceCount === 1 ? "" : "s"} missing Retail Price`,
    diagnostics.missingCompanyEmailCount &&
      `${diagnostics.missingCompanyEmailCount} product${diagnostics.missingCompanyEmailCount === 1 ? "" : "s"} missing Company Email`,
    diagnostics.missingPcrEmailCount &&
      `${diagnostics.missingPcrEmailCount} product${diagnostics.missingPcrEmailCount === 1 ? "" : "s"} missing PCR Email`,
    diagnostics.pendingSync > 0 &&
      `Sync is pending on this device; report values may differ across devices`,
  ].filter((value): value is string => Boolean(value));
  return (
    <Surface className="mb-6 space-y-2 p-4">
      <h2 className="font-semibold text-ink">Report diagnostics</h2>
      <p className="text-sm text-muted">
        {diagnostics.inspectionCount.toLocaleString()} completed inspections →{" "}
        {diagnostics.productCount.toLocaleString()} consolidated product models
        · {latestNonCompliantCount.toLocaleString()} product models currently NC
      </p>
      <p className="text-xs text-muted">
        Product counts are deduplicated by store and control number. Visit counts
        include each completed inspection. Status and findings use the latest
        completed visit; N/A models are excluded from the compliance rate.
      </p>
      <p className="text-xs text-muted">
        Generated {new Date(diagnostics.generatedAt).toLocaleString()} ·{" "}
        {diagnostics.catalogVersion === undefined
          ? "Catalog version unavailable"
          : `Catalog v${diagnostics.catalogVersion}`}{" "}
        · {diagnostics.pendingSync} pending sync
      </p>
        {warnings.length > 0 ? (
        <InlineNotice severity="warning">
          Export review: {warnings.join(" · ")}.
        </InlineNotice>
      ) : (
        <InlineNotice severity="success">
          All tracked export fields are populated.
        </InlineNotice>
      )}
    </Surface>
  );
}

function MobileNonComplianceCard({
  product,
  index,
}: {
  product: Product;
  index: number;
}) {
  const latest = product.records[0];
  return (
    <MobileReportCard
      testId="summary-mobile-nc-card"
      title={`${index + 1}. ${product.model || "Not available"}`}
      status={
        <span className="rounded-lg bg-danger-soft px-2 py-1 text-xs font-semibold text-danger">
          NC
        </span>
      }
      metrics={[
        { label: "ECP type", value: product.productType || "Not available" },
        { label: "Brand", value: textValue(latest?.brand) || "Not available" },
        {
          label: "Latest finding",
          value: latest
            ? findingDescription([latest])
            : "Non-compliant finding",
        },
        { label: "Company", value: product.companyName || "Not available" },
      ]}
    />
  );
}

function ReportSection({
  id,
  title,
  subtitle,
  children,
}: {
  id?: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <Section title={title}>
        <div className="space-y-3">
          <p className="text-sm text-muted">{subtitle}</p>
          {children}
        </div>
      </Section>
    </div>
  );
}

function ComplianceTable({
  rows,
  total,
}: {
  rows: ReportRow[];
  total: Omit<ReportRow, "typeKey" | "label">;
}) {
  return (
    <DataTable
      ariaLabel="Compliance summary table"
      headers={[
        "Types of ECPs (A)",
        "Number of Product Models (B)",
        "Completed Inspection Visits",
        "Compliant Product Models",
        "Not Applicable Product Models",
        "Product Models with Energy Label (C)",
        "Product Models with Certificate of Exemption (D)",
        "Non-Compliant Product Models",
        "Compliance Percentage (%)",
      ]}
      rows={[
        ...rows.map((row) => [
          row.label,
          row.models,
          row.visits,
          row.compliant,
          row.notApplicable,
          row.labeled,
          row.exempted,
          row.nonCompliant,
          <ComplianceRateBadge
            key={row.typeKey}
            value={formatPercentage(row.compliance)}
          />,
        ]),
        [
          "Total:",
          total.models,
          total.visits,
          total.compliant,
          total.notApplicable,
          total.labeled,
          total.exempted,
          total.nonCompliant,
          <ComplianceRateBadge
            key="total"
            value={formatPercentage(total.compliance)}
          />,
        ],
      ]}
    />
  );
}

function BreakdownTable({ rows }: { rows: BreakdownRow[] }) {
  const total = {
    notRegistered: sum(rows, (row) => row.notRegistered),
    noDocument: sum(rows, (row) => row.noDocument),
    placement: sum(rows, (row) => row.placement),
    visualQuality: sum(rows, (row) => row.visualQuality),
    productDetails: sum(rows, (row) => row.productDetails),
  };
  return (
    <DataTable
      ariaLabel="Non-compliance breakdown table"
      headers={[
        "Types of ECPs",
        "Not Registered",
        "Registered but no EL/COE",
        "Placement",
        "Visual Quality",
        "Product Details",
      ]}
      rows={[
        ...rows.map((row) => [
          row.label,
          row.notRegistered,
          row.noDocument,
          row.placement,
          row.visualQuality,
          row.productDetails,
        ]),
        [
          "Total:",
          total.notRegistered,
          total.noDocument,
          total.placement,
          total.visualQuality,
          total.productDetails,
        ],
      ]}
    />
  );
}

function EmvTable({
  rows,
  total,
}: {
  rows: ReportRow[];
  total: {
    compliant: number;
    nonCompliant: number;
    notApplicable: number;
    visits: number;
    labeled: number;
    exempted: number;
    models: number;
    compliance: number | null;
  };
}) {
  return (
    <DataTable
      ariaLabel="EMV results summary table"
      headers={[
        "Types of ECPs",
        "Compliant Models",
        "Non-Compliant Models",
        "Not Applicable Models",
        "Inspection Visits",
        "Labeled Models",
        "Exempted Models",
        "Model Count",
      ]}
      rows={[
        ...rows.map((row) => [
          row.label,
          row.compliant,
          row.nonCompliant,
          row.notApplicable,
          row.visits,
          row.labeled,
          row.exempted,
          row.models,
        ]),
        [
          "Total",
          total.compliant,
          total.nonCompliant,
          total.notApplicable,
          total.visits,
          total.labeled,
          total.exempted,
          total.models,
        ],
        [
          "Compliance Rate",
          formatPercentage(total.compliance),
          "",
          "",
          "",
          "",
          "",
          "",
        ],
      ]}
    />
  );
}

function NcTable({
  products,
  startIndex,
}: {
  products: Product[];
  startIndex: number;
}) {
  const rows =
    products.length === 0
      ? [["No non-compliant products for this store filter."]]
      : products.map((product, index) => {
          const latest = product.records[0];
          const description = latest
            ? findingDescription([latest])
            : "Non-compliant finding";
          return [
            startIndex + index + 1,
            product.productType || "Not available",
            textValue(latest.brand) || "Not available",
            product.model || "Not available",
            description,
            "NC",
            product.companyName || "Not available",
            textValue(latest.companyEmail) || "Not available",
            textValue(latest.pcrEmail) || "Not available",
            warningFor(description),
          ];
        });
  return (
    <DataTable
      ariaLabel="Non-compliance results table"
      testId="summary-nc-table"
      headers={[
        "No.",
        "ECP Type",
        "Brand Name",
        "Model Code",
        "Description of Non-Compliance",
        "Status",
        "Company",
        "Company Email",
        "PCR Email",
        "Warning",
      ]}
      rows={rows}
    />
  );
}

function DataTable({
  ariaLabel,
  headers,
  rows,
  testId,
}: {
  ariaLabel: string;
  headers: string[];
  rows: React.ReactNode[][];
  testId?: string;
}) {
  const hasNumberFirstColumn = testId === "summary-nc-table";
  return (
    <div
      data-testid="table-scroll-cue"
      data-scroll-cue="true"
      className="relative overflow-x-auto pb-3"
    >
      <table
        data-testid={testId}
        data-sticky-first-column={
          testId === "summary-nc-table" ? "true" : undefined
        }
        aria-label={ariaLabel}
        className="min-w-[820px] border-collapse text-left text-sm"
      >
        <thead className="bg-surface-alt">
          <tr>
            {headers.map((header, index) => (
              <th
                key={header}
                scope="col"
                className={`px-2 py-2 font-semibold text-ink ${index === 0 ? `sticky left-0 z-20 border-r-2 border-border-strong bg-surface-alt ${hasNumberFirstColumn ? "w-12" : "min-w-[180px] whitespace-nowrap"}` : ""}`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border last:border-0">
              {headers.map((_, index) => (
                <td
                  key={index}
                  className={`max-w-[260px] whitespace-normal break-words px-2 py-2 align-top text-ink ${index === 0 ? `sticky left-0 z-10 border-r-2 border-border-strong bg-white font-semibold ${hasNumberFirstColumn ? "" : "min-w-[180px] whitespace-nowrap"}` : ""} ${typeof row[index] === "number" ? "tabular-nums text-right" : ""}`}
                >
                  {row[index] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function toProductRecord(record: InspectionRecord): InspectionRecord {
  return { ...record, ...normalizeInspectionAnswers(record) };
}

function isForCurrentStore(
  record: InspectionRecord,
  store?: StoreRecord,
): boolean {
  if (!store) return false;
  const recordName = normalizeProductIdentity(recordStoreName(record));
  const recordStoreLocation = normalizeProductIdentity(recordLocation(record));
  const storeLocation = normalizeProductIdentity(store.location);
  return (
    recordName === normalizeProductIdentity(store.name) &&
    (!recordStoreLocation || !storeLocation ||
      recordStoreLocation === storeLocation)
  );
}

function isActivityForCurrentStore(
  activity: ActivityRecord,
  store: StoreRecord,
): boolean {
  const activityName = normalizeProductIdentity(activity.storeName ?? "");
  const activityLocation = normalizeProductIdentity(activity.location ?? "");
  const storeName = normalizeProductIdentity(store.name);
  const storeLocation = normalizeProductIdentity(store.location);
  return (
    activityName === storeName &&
    (!activityLocation || !storeLocation || activityLocation === storeLocation)
  );
}

function isCompletedEvent(eventType?: string): boolean {
  return Boolean(
    eventType &&
      /complete|finish|submit|final/i.test(eventType) &&
      !/start|draft/i.test(eventType),
  );
}

function toCompleteInspectionSnapshot(
  activity: ActivityRecord,
): InspectionRecord | undefined {
  const snapshot = activity.snapshot;
  const id = activity.inspectionId;
  if (!snapshot || !id) return undefined;
  const answers = normalizeInspectionAnswers(snapshot);
  const storeName = activity.storeName || textValue(snapshot.storeName);
  const location = activity.location || textValue(snapshot.location);
  const productType = activity.productType || textValue(snapshot.productType);
  const controlNumber = activity.controlNumber || textValue(snapshot.controlNumber);
  const model = activity.model || textValue(snapshot.modelCode) || textValue(snapshot.model);
  if (
    !storeName ||
    !productType ||
    (!controlNumber && !model) ||
    answers.outcome === "unavailable" ||
    !answers.labeling ||
    !answers.placement ||
    !answers.visualQuality ||
    !answers.productDetails
  ) {
    return undefined;
  }
  return {
    ...snapshot,
    id,
    status: "completed",
    storeName,
    location,
    productType,
    controlNumber,
    model,
    createdAt: activity.createdAt,
    completedAt: activity.createdAt,
    updatedAt: activity.createdAt,
    ...answers,
  };
}

function consolidateProducts(records: InspectionRecord[]): Product[] {
  const grouped = new Map<string, InspectionRecord[]>();
  records.forEach((record) => {
    const control = readInspectionField(record, [
      "controlNumber",
      "control_number",
      "productControlNumber",
      "product_control_number",
    ]);
    const model = readInspectionField(record, [
      "model",
      "modelNumber",
      "model_number",
      "modelNumberCode",
      "model_number_code",
    ]);
    const productType = readInspectionField(record, [
      "productType",
      "product_type",
      "ecpType",
      "ecp_type",
      "type",
    ]);
    const productIdentity = control
      ? `control:${normalizeProductIdentity(control)}`
      : model
        ? `model:${normalizeProductIdentity(model)}`
        : `inspection:${record.id}`;
    const key = `${productTypeKey(productType)}|${productIdentity}`;
    const current = grouped.get(key) ?? [];
    current.push(record);
    grouped.set(key, current);
  });

  return Array.from(grouped.entries())
    .map(([key, groupedRecords]) => {
      const ordered = [...groupedRecords].sort(compareLatestVisitFirst);
      const latest = ordered[0];
      const latestAnswers = normalizeInspectionAnswers(latest);
      return {
        key,
        storeName: recordStoreName(latest) || "Store not recorded",
        controlNumber: readInspectionField(latest, [
          "controlNumber",
          "control_number",
          "productControlNumber",
          "product_control_number",
        ]),
        model: readInspectionField(latest, [
          "model",
          "modelNumber",
          "model_number",
          "modelNumberCode",
          "model_number_code",
        ]),
        productType: readInspectionField(latest, [
          "productType",
          "product_type",
          "ecpType",
          "ecp_type",
          "type",
        ]),
        typeKey: productTypeKey(
          readInspectionField(latest, [
            "productType",
            "product_type",
            "ecpType",
            "ecp_type",
            "type",
          ]),
        ),
        records: ordered,
        nonCompliant: latestAnswers.outcome === "non_compliant",
        hasLabel: latestAnswers.labeling === "with_label",
        hasCoe: latestAnswers.labeling === "with_coe",
        companyName:
          catalogFieldText(latest, [
            "companyName",
            "company_name",
            "company",
            "Company Name",
            "Company",
          ]) || textValue(latest.companyName),
        retailPrice: catalogFieldText(latest, [
          "retailPrice",
          "retail_price",
          "Retail Price",
          "Latest Average Price",
          "latestAveragePrice",
        ]),
      };
    })
    .sort(
      (left, right) =>
        Number(right.nonCompliant) - Number(left.nonCompliant) ||
        right.key.localeCompare(left.key),
    );
}

function createComplianceRows(products: Product[]): ReportRow[] {
  const types = reportTypesFor(products.map((product) => product.typeKey));
  return types.map((type) => {
    const matching = products.filter((product) =>
      type.typeKey === "other"
        ? !types.some(
            (known) =>
              known.typeKey !== "other" && known.typeKey === product.typeKey,
          )
        : product.typeKey === type.typeKey,
    );
    const models = matching.length;
    const compliant = matching.filter(
      (product) => normalizeInspectionAnswers(product.records[0] ?? {}).outcome === "compliant",
    ).length;
    const nonCompliant = matching.filter(
      (product) => product.nonCompliant,
    ).length;
    const notApplicable = Math.max(0, models - compliant - nonCompliant);
    return {
      typeKey: type.typeKey,
      label: type.label,
      models,
      visits: matching.reduce(
        (count, product) =>
          count + new Set(product.records.map((record) => record.id)).size,
        0,
      ),
      compliant,
      notApplicable,
      labeled: matching.filter((product) => product.hasLabel).length,
      exempted: matching.filter((product) => product.hasCoe).length,
      nonCompliant,
      compliance: percentage(compliant + nonCompliant, nonCompliant),
    };
  });
}

function createBreakdownRows(products: Product[]): BreakdownRow[] {
  const types = reportTypesFor(products.map((product) => product.typeKey));
  return types.map((type) => {
    const matching = products.filter(
      (product) =>
        product.nonCompliant &&
        (type.typeKey === "other"
          ? !types.some(
              (known) =>
                known.typeKey !== "other" && known.typeKey === product.typeKey,
            )
          : product.typeKey === type.typeKey),
    );
    return {
      typeKey: type.typeKey,
      label: type.label,
      notRegistered: matching.filter(
        (product) =>
          normalizeInspectionAnswers(product.records[0] ?? {}).labeling ===
          "not_registered",
      ).length,
      noDocument: matching.filter(
        (product) =>
          normalizeInspectionAnswers(product.records[0] ?? {}).labeling ===
          "registered_only",
      ).length,
      placement: matching.filter(
        (product) =>
          normalizeInspectionAnswers(product.records[0] ?? {}).placement ===
          "failing",
      ).length,
      visualQuality: matching.filter(
        (product) =>
          normalizeInspectionAnswers(product.records[0] ?? {}).visualQuality ===
          "failing",
      ).length,
      productDetails: matching.filter(
        (product) =>
          normalizeInspectionAnswers(product.records[0] ?? {}).productDetails ===
          "failing",
      ).length,
    };
  });
}

function findingDescription(records: InspectionRecord[]): string {
  const findings = new Set<string>();
  records.forEach((record) => {
    if (textValue(record.labeling) === "not_registered")
      findings.add("Not Registered");
    if (textValue(record.labeling) === "registered_only")
      findings.add("Registered but no EL/COE");
    if (textValue(record.placement) === "failing") findings.add("Placement");
    if (textValue(record.visualQuality) === "failing")
      findings.add("Visual Quality");
    if (textValue(record.productDetails) === "failing")
      findings.add("Product Details");
    if (textValue(record.remarks)) findings.add(textValue(record.remarks));
  });
  return Array.from(findings).join("; ") || "Non-compliant finding";
}

function warningFor(description: string): string {
  if (description.includes("Not Registered")) return "Check/scan QR code";
  if (description.includes("EL/COE"))
    return "Please check if the model is within the scope";
  return "Review non-compliant finding";
}

function isNonCompliant(record: InspectionRecord): boolean {
  return normalizeInspectionAnswers(record).outcome === "non_compliant";
}

function textValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function normalizeProductIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-PH");
}

function recordStoreName(record: InspectionRecord): string {
  return textValue(record.storeName) || textValue(record.store_name);
}

function recordLocation(record: InspectionRecord): string {
  return (
    textValue(record.location) ||
    textValue(record.storeLocation) ||
    textValue(record.store_location)
  );
}

function catalogFieldText(
  record: InspectionRecord | undefined,
  keys: string[],
): string {
  if (!record) return "";
  return readInspectionField(record, keys);
}

function timestamp(record: InspectionRecord): string {
  return (
    textValue(record.completedAt) ||
    textValue(record.completed_at) ||
    textValue(record.server_created_at) ||
    textValue(record.createdAt) ||
    textValue(record.created_at) ||
    textValue(record.updatedAt) ||
    textValue(record.updated_at)
  );
}

function compareLatestVisitFirst(
  left: InspectionRecord,
  right: InspectionRecord,
): number {
  const leftTime = Date.parse(timestamp(left));
  const rightTime = Date.parse(timestamp(right));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return rightTime - leftTime;
  }
  return timestamp(right).localeCompare(timestamp(left));
}

function percentage(models: number, nonCompliant: number): number | null {
  return models > 0 ? ((models - nonCompliant) / models) * 100 : null;
}

function formatPercentage(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(0)}%`;
}

function formatReportDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "time unavailable"
    : new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Manila",
      }).format(date);
}

function sum<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}

function fileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "all-stores"
  );
}
