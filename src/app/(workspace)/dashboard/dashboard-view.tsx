"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  CloudUpload,
  FileClock,
  Search,
} from "lucide-react";
import {
  EmptyState,
  InlineNotice,
  ListRow,
  PageHeader,
  PageShell,
  Section,
  Stat,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { CurrentStorePanel } from "@/features/store/current-store-panel";
import type { ActivityRecord, InspectionRecord } from "@/lib/db/records";
import { getBrowserRepository } from "@/lib/db/browser";
import { useRepositoryRevision } from "@/lib/db/use-repository-revision";
import { navigateToInspectionOffline } from "@/lib/offline/inspection-route";

type Counts = {
  completedInspections: number;
  drafts: number;
  pendingSync: number;
};

type SyncCounts = {
  failedCount: number;
  conflictCount: number;
  evidencePendingCount: number;
  evidenceFailedCount: number;
};

const emptySyncCounts: SyncCounts = {
  failedCount: 0,
  conflictCount: 0,
  evidencePendingCount: 0,
  evidenceFailedCount: 0,
};

export function DashboardView() {
  const repository = useMemo(() => getBrowserRepository(), []);
  const repositoryRevision = useRepositoryRevision(repository);
  const [counts, setCounts] = useState<Counts>();
  const [syncCounts, setSyncCounts] = useState<SyncCounts>(emptySyncCounts);
  const [recent, setRecent] = useState<ActivityRecord[]>([]);
  const [drafts, setDrafts] = useState<InspectionRecord[]>([]);
  const [showAllDrafts, setShowAllDrafts] = useState(false);
  const [failed, setFailed] = useState<ActivityRecord[]>([]);
  const [conflicts, setConflicts] = useState<ActivityRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.getDashboardCounts(),
      repository.listInspectionDrafts(),
      repository.listActivity({ limit: 5 }),
      repository.listActivity({ syncStatus: "failed", limit: 5 }),
      repository.listActivity({ syncStatus: "conflict", limit: 5 }),
      repository.getSyncStatusCounts(),
    ])
      .then(
        ([
          nextCounts,
          nextDrafts,
          nextRecent,
          nextFailed,
          nextConflicts,
          nextSyncCounts,
        ]) => {
          if (!active) return;
          setCounts(nextCounts);
          setDrafts(nextDrafts);
          setRecent(nextRecent);
          setFailed(nextFailed);
          setConflicts(nextConflicts);
          setSyncCounts(nextSyncCounts);
          setLoaded(true);
          setLoadError(false);
        },
      )
      .catch(() => {
        if (!active) return;
        setLoadError(true);
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [repository, repositoryRevision]);

  const hasAttention =
    loaded &&
    (syncCounts.failedCount > 0 ||
      syncCounts.conflictCount > 0 ||
      (syncCounts.evidencePendingCount ?? 0) > 0 ||
      (syncCounts.evidenceFailedCount ?? 0) > 0);
  const photoWaitingCount =
    (syncCounts.evidencePendingCount ?? 0) +
    (syncCounts.evidenceFailedCount ?? 0);

  return (
    <PageShell>
      <div className="space-y-8">
        <PageHeader
          title="Dashboard"
          subtitle="Start an inspection or continue recent work."
        />

        <Surface className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary-soft via-white to-white p-5 sm:p-7">
          <div className="pointer-events-none absolute -right-8 -top-8 hidden size-48 rounded-full bg-primary/5 sm:block" />
          <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="max-w-xl border-l-4 border-primary pl-4">
              <p className="text-sm font-semibold uppercase tracking-wide text-primary">
                Ready for field work?
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                Start an inspection
              </h2>
              <p className="mt-2 text-sm text-muted">
                Scan an energy label or search the authorized product catalog.
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:min-w-96">
              <Link
                href="/lookup?scan=1"
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control bg-primary px-5 font-semibold text-white shadow-sm hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <Camera aria-hidden="true" className="size-4" />
                Scan label
              </Link>
              <Link
                href="/lookup"
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control border border-border-strong bg-white px-5 font-semibold text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <Search aria-hidden="true" className="size-4" />
                Search catalog
              </Link>
            </div>
          </div>
        </Surface>

        <CurrentStorePanel returnTo="/dashboard" compactMobile />

        {loadError && (
          <InlineNotice severity="error">
            Local dashboard information could not be loaded. Refresh to try
            again.
          </InlineNotice>
        )}

        {hasAttention && (
          <Section title="Needs attention">
            <div className="divide-y divide-border">
              {failed.map((activity) => (
                <Link
                  key={`failed-${activity.id}`}
                  href={
                    activity.inspectionId
                      ? `/inspect/${activity.inspectionId}`
                      : "/sync"
                  }
                  onClick={(event) => {
                    if (activity.inspectionId && !navigator.onLine) {
                      event.preventDefault();
                      navigateToInspectionOffline(activity.inspectionId);
                    }
                  }}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <ListRow
                    primary={
                      controlNumber(activity) || "Inspection upload failed"
                    }
                    secondary={
                      activitySummary(activity) ||
                      activity.syncError ||
                      "Review this upload in Activity."
                    }
                    trailing={
                      <StatusBadge variant="attention" label="Upload failed" />
                    }
                    chevron
                  />
                </Link>
              ))}
              {syncCounts.failedCount > failed.length && (
                <Link
                  href="/sync"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <ListRow
                    primary={`${syncCounts.failedCount - failed.length} more uploads need attention`}
                    secondary="Review failed uploads in Sync."
                    trailing={
                      <StatusBadge variant="attention" label="Failed" />
                    }
                    chevron
                  />
                </Link>
              )}
              {conflicts.map((activity) => (
                <Link
                  key={`conflict-${activity.id}`}
                  href="/sync"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <ListRow
                    primary={controlNumber(activity) || "Inspection conflict"}
                    secondary={
                      activitySummary(activity) ||
                      "Review the conflicting changes."
                    }
                    trailing={
                      <StatusBadge variant="attention" label="Needs review" />
                    }
                    chevron
                  />
                </Link>
              ))}
              {syncCounts.conflictCount > conflicts.length && (
                <Link
                  href="/sync"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <ListRow
                    primary={`${syncCounts.conflictCount - conflicts.length} more conflicts need review`}
                    secondary="Review conflicting changes in Sync."
                    trailing={
                      <StatusBadge variant="attention" label="Needs review" />
                    }
                    chevron
                  />
                </Link>
              )}
              {photoWaitingCount > 0 && (
                <Link
                  href="/sync"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <ListRow
                    leading={
                      <AlertCircle
                        aria-hidden="true"
                        className="text-warning"
                      />
                    }
                    primary={`Photos waiting to upload (${photoWaitingCount})`}
                    secondary="Review photo upload status in Sync."
                    trailing={<StatusBadge variant="waiting" />}
                    chevron
                  />
                </Link>
              )}
            </div>
          </Section>
        )}

        <Section title="Work at a glance">
          <div
            data-testid="dashboard-stat-grid"
            className="grid gap-3 sm:grid-cols-3"
          >
            <DashboardStat
              icon={<ClipboardCheck aria-hidden="true" className="size-5" />}
              tone="primary"
              value={counts?.completedInspections ?? "—"}
              label="Completed inspections"
            />
            <DashboardStat
              icon={<FileClock aria-hidden="true" className="size-5" />}
              tone="warning"
              value={counts?.drafts ?? "—"}
              label="Saved drafts"
            />
            <DashboardStat
              icon={<CloudUpload aria-hidden="true" className="size-5" />}
              tone={
                counts && counts.pendingSync + photoWaitingCount > 0
                  ? "warning"
                  : "success"
              }
              value={counts ? counts.pendingSync + photoWaitingCount : "—"}
              label="Waiting to upload"
            />
          </div>
        </Section>

        {loaded && drafts.length > 0 && (
          <Section
            title="Continue drafts"
            actions={
              drafts.length > 5 ? (
                <button
                  type="button"
                  aria-expanded={showAllDrafts}
                  onClick={() => setShowAllDrafts((value) => !value)}
                  className="min-h-11 rounded-control px-3 text-sm font-semibold text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {showAllDrafts ? "Show fewer" : `View all ${drafts.length}`}
                </button>
              ) : null
            }
          >
            <p className="mb-3 text-sm text-muted">
              Saved on this device. Select a draft to continue where you left off.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {(showAllDrafts ? drafts : drafts.slice(0, 5)).map((draft) => (
                <Link
                  key={draft.id}
                  href={`/inspect/${encodeURIComponent(draft.id)}`}
                  onClick={(event) => {
                    if (!navigator.onLine) {
                      event.preventDefault();
                      navigateToInspectionOffline(draft.id);
                    }
                  }}
                  className="group flex min-h-24 items-center gap-3 rounded-xl border border-warning/30 bg-warning-soft/40 p-4 text-ink transition-colors hover:border-warning hover:bg-warning-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-control bg-white text-warning">
                    <FileClock aria-hidden="true" className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {draftTitle(draft)}
                    </span>
                    <span className="mt-1 block truncate text-sm text-muted">
                      {draftSummary(draft)}
                    </span>
                    <span className="mt-1 block text-xs text-muted">
                      Saved {formatDashboardDate(String(draft.updatedAt ?? ""))}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              ))}
            </div>
          </Section>
        )}

        <Section title="Recent inspections">
          {!loaded ? (
            <Surface
              role="status"
              aria-live="polite"
              className="p-4 text-sm text-muted"
            >
              Loading recent inspections…
            </Surface>
          ) : recent.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {recent.slice(0, 5).map((activity) => (
                <Link
                  key={activity.id}
                  href={
                    activity.inspectionId
                      ? `/inspect/${activity.inspectionId}`
                      : "/activity"
                  }
                  onClick={(event) => {
                    if (activity.inspectionId && !navigator.onLine) {
                      event.preventDefault();
                      navigateToInspectionOffline(activity.inspectionId);
                    }
                  }}
                  className="group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <Surface className="flex h-full items-start gap-3 p-4 transition-colors group-hover:border-primary/40 group-hover:bg-primary-soft/30">
                    <span
                      className={`mt-0.5 grid size-10 shrink-0 place-items-center rounded-control ${activity.outcome === "compliant" ? "bg-success-soft text-success" : activity.outcome === "non_compliant" ? "bg-danger-soft text-danger" : "bg-surface-alt text-muted"}`}
                    >
                      {activity.outcome === "compliant" ? (
                        <CheckCircle2 aria-hidden="true" className="size-5" />
                      ) : activity.outcome === "non_compliant" ? (
                        <AlertCircle aria-hidden="true" className="size-5" />
                      ) : (
                        <Clock3 aria-hidden="true" className="size-5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-ink">
                          {controlNumber(activity) || "Inspection"}
                        </span>
                        <StatusBadge
                          variant={
                            activity.outcome === "compliant"
                              ? "compliant"
                              : activity.outcome === "non_compliant"
                                ? "nonCompliant"
                                : "neutral"
                          }
                          label={
                            activity.outcome === "compliant"
                              ? "Compliant"
                              : activity.outcome === "non_compliant"
                                ? "Non-compliant"
                                : "N/A"
                          }
                        />
                      </span>
                      <span className="mt-2 block truncate text-sm font-medium text-ink">
                        {activitySummary(activity) || "Product details unavailable"}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        {activity.productType && (
                          <span>{activity.productType}</span>
                        )}
                        {activity.productType && <span aria-hidden="true">·</span>}
                        <time dateTime={activity.createdAt}>
                          {formatDashboardDate(activity.createdAt)}
                        </time>
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="mt-2 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                    />
                  </Surface>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Search aria-hidden="true" className="size-8" />}
              message="Completed inspections will appear here."
            />
          )}
        </Section>
      </div>
    </PageShell>
  );
}

function DashboardStat({
  icon,
  tone,
  value,
  label,
}: {
  icon: ReactNode;
  tone: "primary" | "warning" | "success";
  value: ReactNode;
  label: string;
}) {
  const toneClass =
    tone === "primary"
      ? "bg-primary-soft text-primary"
      : tone === "warning"
        ? "bg-warning-soft text-warning"
        : "bg-success-soft text-success";
  return (
    <Surface className="flex min-h-24 items-center gap-4 p-4 sm:p-5">
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-control ${toneClass}`}
      >
        {icon}
      </span>
      <Stat value={value} label={label} />
    </Surface>
  );
}

function controlNumber(activity: ActivityRecord): string {
  return activity.controlNumber?.trim() ?? "";
}

function activitySummary(activity: ActivityRecord): string {
  return [activity.brand, activity.model, activity.storeName]
    .filter((part) => part?.trim())
    .join(" · ");
}

function draftTitle(draft: InspectionRecord): string {
  return (
    textField(draft, [
      "controlNumber",
      "control_number",
      "modelCode",
      "model_code",
    ]) ||
    "New inspection draft"
  );
}

function draftSummary(draft: InspectionRecord): string {
  return [
    textField(draft, [
      "productType",
      "product_type",
      "ecpType",
      "ecp_type",
    ]),
    textField(draft, ["storeName", "store_name"]),
  ]
    .filter(Boolean)
    .join(" · ") || "Product or store details not entered yet";
}

function textField(record: InspectionRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function formatDashboardDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "time unavailable"
    : new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Manila",
      }).format(date);
}
