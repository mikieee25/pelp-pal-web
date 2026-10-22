"use client";

import {
  useCallback,
  useState,
  useSyncExternalStore,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { AnimatedDisclosure } from "@/components/motion/animated-disclosure";
import { getBrowserRepository } from "@/lib/db/browser";
import type { SyncRow } from "@/lib/db/records";
import {
  repairMissingEvidence,
  type EvidenceRepairResult,
} from "@/lib/supabase/evidence-repair";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { syncCatalog } from "@/features/catalog/catalog-sync";
import type { SyncOperation } from "@/lib/sync/coordinator";
import type { SyncStatusSnapshot } from "./sync-status-store";
import type { SyncStatusStore } from "./sync-status-store";
import { useSyncRuntimeState } from "./sync-runtime-boundary";
import { TransferRecoveryPanel } from "./transfer-recovery-panel";
import {
  AccessibleModal,
  EmptyState,
  InlineNotice,
  KeyValueList,
  PageHeader,
  PageShell,
  Section,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { OfflinePreparation } from './offline-preparation';
import { startSyncRuntime } from "@/lib/sync/runtime";
import type {
  EvidenceDownloadEstimate,
  EvidenceDownloadResult,
} from "@/lib/db/repository";
import {
  formatRelativeSyncTime,
  getSyncErrorPresentation,
  getSyncHeadline,
} from "./sync-presentation";

const emptySnapshot: SyncStatusSnapshot = {
  status: "offline",
  realtimeState: "disconnected",
  pendingCount: 0,
  conflictCount: 0,
  failedCount: 0,
  evidencePendingCount: 0,
  evidenceFailedCount: 0,
};

type CatalogFeedback = { severity: "success" | "error"; message: string };

type SyncStoreLike = Pick<SyncStatusStore, "subscribe" | "getSnapshot"> & {
  syncNow: (
    reason: "manual" | "retry",
    operation?: SyncOperation
  ) => Promise<void>;
};

export function SyncView({ statusStore }: { statusStore?: SyncStoreLike }) {
  const runtimeState = useSyncRuntimeState();
  const runtimeStore = runtimeState.statusStore;
  const activeStore = statusStore ?? runtimeStore;
  const subscribe = useCallback(
    (listener: () => void) =>
      activeStore?.subscribe(listener) ?? noopSubscribe(),
    [activeStore]
  );
  const getSnapshot = useCallback(
    () => activeStore?.getSnapshot() ?? emptySnapshot,
    [activeStore]
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getEmptySnapshot
  );
  const [catalogSyncing, setCatalogSyncing] = useState(false);
  const [catalogLastSyncedAt, setCatalogLastSyncedAt] = useState<string>();
  const [catalogFeedback, setCatalogFeedback] = useState<CatalogFeedback>();
  const repository = useMemo(() => getBrowserRepository(), []);
  const [openConflicts, setOpenConflicts] = useState<SyncRow[]>([]);
  const [repairProgress, setRepairProgress] = useState<{
    completed: number;
    total: number;
  }>();
  const [repairing, setRepairing] = useState(false);
  const [repairResults, setRepairResults] = useState<EvidenceRepairResult[]>(
    []
  );
  const [downloadEstimate, setDownloadEstimate] =
    useState<EvidenceDownloadEstimate>();
  const [downloadPhotosOpen, setDownloadPhotosOpen] = useState(false);
  const [downloadingPhotos, setDownloadingPhotos] = useState(false);
  const [photoDownloadProgress, setPhotoDownloadProgress] = useState({
    completed: 0,
    total: 0,
  });
  const [photoDownloadResults, setPhotoDownloadResults] = useState<
    EvidenceDownloadResult[]
  >([]);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [discardConflictId, setDiscardConflictId] = useState<string>();
  const [conflictActionError, setConflictActionError] = useState<string>();
  const photoDownloadAbort = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    if (snapshot.conflictCount === 0 || !repository.listOpenConflicts) return;
    let active = true;
    void repository
      .listOpenConflicts()
      .then((conflicts) => {
        if (active) setOpenConflicts(conflicts);
      })
      .catch(() => {
        if (active) setOpenConflicts([]);
      });
    return () => {
      active = false;
    };
  }, [repository, snapshot.conflictCount]);
  const visibleConflicts = snapshot.conflictCount > 0 ? openConflicts : [];
  const resolveDeletion = async (
    conflictId: string,
    choice: "keep" | "discard"
  ) => {
    setConflictActionError(undefined);
    try {
      await repository.resolveRemoteDeletionConflict(conflictId, choice);
      setOpenConflicts((items) =>
        items.filter((item) => item.id !== conflictId)
      );
      if (choice === "discard") setDiscardConflictId(undefined);
      await activeStore?.syncNow("manual");
    } catch (error) {
      setConflictActionError(
        error instanceof Error
          ? error.message
          : "Could not resolve this conflict."
      );
    }
  };
  const headline = getSyncHeadline(snapshot);
  const errorPresentation = getSyncErrorPresentation(snapshot, [
    runtimeState.error,
    catalogFeedback?.severity === "error" ? catalogFeedback.message : undefined,
  ]);
  const photoWaitCount =
    (snapshot.evidencePendingCount ?? 0) + (snapshot.evidenceFailedCount ?? 0);
  const retryCatalog =
    catalogFeedback?.severity === "error" &&
    errorPresentation?.details.includes(catalogFeedback.message);

  const sync = (reason: "manual" | "retry", operation: SyncOperation) => {
    void activeStore?.syncNow(reason, operation).catch(() => undefined);
  };

  const syncMasterlist = () => {
    setCatalogSyncing(true);
    setCatalogFeedback(undefined);
    void syncCatalog()
      .then((result) => {
        setCatalogLastSyncedAt(new Date().toISOString());
        const catalogName =
          result.catalogRole === "guestlist" ? "Guest catalog" : "Masterlist";
        if (result.status === "updated")
          setCatalogFeedback({
            severity: "success",
            message: `${catalogName} updated to version ${result.version} (${result.rowCount.toLocaleString()} products).`,
          });
        else if (result.status === "unchanged")
          setCatalogFeedback({
            severity: "success",
            message: `${catalogName} is already current at version ${result.version} (${result.rowCount.toLocaleString()} products).`,
          });
        else
          setCatalogFeedback({
            severity: "error",
            message:
              "Catalog sync is available after signing in with an active personnel account.",
          });
      })
      .catch((error) => {
        setCatalogFeedback({
          severity: "error",
          message:
            error instanceof Error
              ? error.message
              : "The masterlist could not be synchronized.",
        });
      })
      .finally(() => setCatalogSyncing(false));
  };

  const repairPhotos = async () => {
    const scope = repository.getAccountScope();
    if (!scope?.organizationId) return;
    setRepairResults([]);
    setRepairing(true);
    try {
      const localPhotos = await repository.listScopedEvidenceBlobsForRepair();
      setRepairProgress({ completed: 0, total: localPhotos.length });
      const results = await repairMissingEvidence(
        getSupabaseBrowserClient(),
        scope.organizationId,
        localPhotos,
        (completed, total, result) => {
          setRepairProgress({ completed, total });
          setRepairResults((current) => [...current, result]);
        }
      );
      setRepairResults(results);
      await Promise.all(
        results
          .filter((result) => result.sha256 && result.status !== "failed")
          .map((result) =>
            repository.markEvidenceUploaded(
              result.evidenceId,
              result.remotePath,
              result.sha256!
            )
          )
      );
      await runtimeStore?.refreshStatus();
    } catch (error) {
      setRepairResults([
        {
          evidenceId: "repair",
          remotePath: "",
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
    } finally {
      setRepairing(false);
    }
  };

  const preparePhotoDownload = async () => {
    try {
      await startSyncRuntime();
      setPhotoDownloadResults([]);
      setDownloadEstimate(await repository.getEvidenceDownloadEstimate());
      setDownloadPhotosOpen(true);
    } catch {
      setPhotoDownloadResults([
        {
          evidenceId: "photos",
          status: "failed",
          message: "Sign in and retry the photo download.",
        },
      ]);
    }
  };

  const downloadPhotos = async () => {
    const controller = new AbortController();
    photoDownloadAbort.current = controller;
    setDownloadingPhotos(true);
    setPhotoDownloadProgress({
      completed: 0,
      total: downloadEstimate?.photoCount ?? 0,
    });
    try {
      const results = await repository.downloadRemoteEvidence(undefined, {
        signal: controller.signal,
        onProgress: (completed, total) =>
          setPhotoDownloadProgress({ completed, total }),
      });
      setPhotoDownloadResults(results);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setPhotoDownloadResults([
          {
            evidenceId: "photos",
            status: "failed",
            message:
              error instanceof Error ? error.message : "Photo download failed.",
          },
        ]);
      }
    } finally {
      photoDownloadAbort.current = undefined;
      setDownloadingPhotos(false);
    }
  };

  const retry = () => {
    if (retryCatalog) syncMasterlist();
    else sync("retry", "full");
  };
  const reviewConflicts = () => setConflictsOpen(true);

  return (
    <PageShell>
      <div className="space-y-5">
        <PageHeader
          title="Sync"
          subtitle="Keep completed inspections available to the consolidated report."
        />
        <OfflinePreparation syncNow={(reason, operation) => {
          if (!activeStore) return Promise.reject(new Error('Sign in with an active account to sync this device.'));
          return activeStore.syncNow(reason, operation);
        }} />
        <Surface
          data-testid="sync-status-card"
          className="space-y-4 border-l-4 border-primary p-4 sm:p-6"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary"
            >
              <RefreshCw className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2
                data-testid="sync-headline"
                className="text-lg font-semibold text-ink"
              >
                {headline.title}
              </h2>
              {snapshot.lastSyncedAt ? (
                <time
                  title={formatTime(snapshot.lastSyncedAt)}
                  className="text-sm text-muted"
                >
                  Last synced {formatRelativeSyncTime(snapshot.lastSyncedAt)}
                </time>
              ) : (
                <p className="text-sm text-muted">Not synced yet</p>
              )}
            </div>
          </div>
          {headline.progress && (
            <div>
              <p className="mb-2 text-sm text-muted" aria-live="polite">
                {snapshot.operation
                  ? `${operationLabel(snapshot.operation)} in progress`
                  : "Preparing synchronization"}
              </p>
              <progress className="h-1.5 w-full accent-primary" />
            </div>
          )}
          <button
            type="button"
            onClick={() => sync("manual", "full")}
            disabled={!activeStore || snapshot.status === "syncing"}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-primary px-4 font-semibold text-white disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Sync now
          </button>
          {errorPresentation && (
            <InlineNotice
              severity={
                errorPresentation.kind === "conflict"
                  ? "warning"
                  : errorPresentation.message.startsWith("You're offline")
                    ? "info"
                    : "error"
              }
              action={
                <button
                  type="button"
                  onClick={
                    errorPresentation.kind === "conflict"
                      ? reviewConflicts
                      : retry
                  }
                  className="min-h-10 rounded px-3 font-semibold"
                >
                  {errorPresentation.kind === "conflict"
                    ? "Review conflicts"
                    : "Retry"}
                </button>
              }
            >
              <div className="space-y-2">
                <p>{errorPresentation.message}</p>
                {errorPresentation.details.length > 0 && (
                  <AnimatedDisclosure
                    id="sync-technical-details"
                    ariaLabel="Technical details"
                    className="rounded-control border border-border px-3"
                    summaryClassName="flex min-h-11 w-full cursor-pointer items-center justify-between text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-focus"
                    panelClassName="overflow-hidden pb-3"
                    summary={<>Technical details<ChevronDown aria-hidden="true" className="size-4" /></>}
                  >
                    <ul className="mt-2 list-inside list-disc break-words text-xs">
                      {errorPresentation.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  </AnimatedDisclosure>
                )}
              </div>
            </InlineNotice>
          )}
          {snapshot.conflictCount > 0 && (
            <div className="flex flex-col gap-2 rounded-control bg-warning-soft p-3 sm:flex-row sm:items-center sm:justify-between">
              <strong className="text-sm text-warning">
                Needs review ({snapshot.conflictCount})
              </strong>
              <button
                type="button"
                onClick={reviewConflicts}
                className="min-h-11 w-full rounded-control border border-border-strong px-4 font-semibold text-primary sm:w-auto"
              >
                Review
              </button>
            </div>
          )}
          {photoWaitCount > 0 && (
            <div
              data-testid="evidence-sync-state"
              className="flex flex-col gap-2 rounded-control bg-warning-soft p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <StatusBadge
                  variant="waiting"
                  label={`Photos waiting (${photoWaitCount})`}
                />
                {snapshot.evidenceLastError && (
                  <p className="text-sm text-muted">
                    {snapshot.evidenceLastError}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAdvancedExpanded(true)}
                className="min-h-11 w-full rounded-control border border-border-strong px-4 font-semibold text-primary sm:w-auto"
              >
                Photo tools
              </button>
            </div>
          )}
        </Surface>

        <AnimatedDisclosure
          id="sync-details-content"
          testId="sync-details-accordion"
          ariaLabel="Details"
          className="rounded-xl border border-border bg-white"
          summaryClassName="flex min-h-14 w-full cursor-pointer list-none items-center justify-between px-4 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-focus"
          panelClassName="overflow-hidden border-t border-border px-4 pb-3"
          summary={<>Details<ChevronDown aria-hidden="true" className="size-4" /></>}
        >
          <div>
            <KeyValueList
              items={[
                {
                  label: "Pending",
                  value: `${snapshot.pendingCount}${(snapshot.retryingCount ?? 0) ? ` (${snapshot.retryingCount} retrying)` : ""}`,
                },
                { label: "Conflicts", value: snapshot.conflictCount },
                {
                  label: "On this device",
                  value: snapshot.localInspectionCount ?? "—",
                },
                {
                  label: "On the server",
                  value: snapshot.remoteInspectionCount ?? "—",
                },
                {
                  label: "Catalog version",
                  value:
                    snapshot.catalogVersion === undefined
                      ? "—"
                      : `v${snapshot.catalogVersion}${catalogLastSyncedAt ? ` · synced ${formatTime(catalogLastSyncedAt)}` : ""}`,
                },
                {
                  label: "Last upload",
                  value: snapshot.lastUploadAt
                    ? formatTime(snapshot.lastUploadAt)
                    : "—",
                },
                {
                  label: "Last download",
                  value: snapshot.lastDownloadAt
                    ? formatTime(snapshot.lastDownloadAt)
                    : "—",
                },
                {
                  label: "Organization",
                  value:
                    snapshot.organizationName ??
                    (snapshot.organizationId
                      ? snapshot.organizationId.slice(-8)
                      : "—"),
                  mono: !snapshot.organizationName,
                },
              ]}
            />
            {snapshot.diagnosticsError && (
              <p className="mt-2 text-xs text-muted">
                {snapshot.diagnosticsError}
              </p>
            )}
          </div>
        </AnimatedDisclosure>

        <AnimatedDisclosure
          id="sync-advanced-content"
          open={advancedExpanded}
          onOpenChange={setAdvancedExpanded}
          testId="sync-advanced-accordion"
          ariaLabel="Advanced"
          className="rounded-xl border border-border bg-white"
          summaryClassName="flex min-h-14 w-full cursor-pointer list-none items-center justify-between px-4 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-focus"
          panelClassName="overflow-hidden"
          summary={<>Advanced<ChevronDown aria-hidden="true" className="size-4" /></>}
        >
          <div className="space-y-4 border-t border-border p-4">
            <Section title="Sync actions">
              <div
                data-testid="sync-actions-grid"
                className="grid grid-cols-1 gap-4 md:grid-cols-2"
              >
                <SyncAction
                  title="Force upload inspections"
                  detail="Immediately push pending and retryable inspections to the shared mirror."
                  action={
                    <ActionButton
                      onClick={() => sync("manual", "upload")}
                      disabled={!activeStore || snapshot.status === "syncing"}
                    >
                      Force upload inspections
                    </ActionButton>
                  }
                />
                <SyncAction
                  title="Force download inspections"
                  detail="Immediately pull available inspections and updates from the shared mirror."
                  action={
                    <ActionButton
                      onClick={() => sync("manual", "download")}
                      disabled={!activeStore || snapshot.status === "syncing"}
                    >
                      Force download inspections
                    </ActionButton>
                  }
                />
                <SyncAction
                  title="Sync catalog"
                  detail="Download the latest product catalog for this account."
                  action={
                    <ActionButton
                      onClick={syncMasterlist}
                      disabled={!activeStore || catalogSyncing}
                    >
                      {catalogSyncing ? "Syncing catalog…" : "Sync catalog"}
                    </ActionButton>
                  }
                />
                <SyncAction
                  title="Re-upload missing photos"
                  detail="Check your local photos and upload any files missing."
                  action={
                    <ActionButton
                      onClick={() => void repairPhotos()}
                      disabled={
                        !activeStore || !snapshot.organizationId || repairing
                      }
                    >
                      {repairing
                        ? "Checking photos…"
                        : "Re-upload missing photos"}
                    </ActionButton>
                  }
                />
                <SyncAction
                  title="Download photos for offline use"
                  detail={
                    downloadEstimate
                      ? `${downloadEstimate.photoCount} photos · about ${formatBytes(downloadEstimate.bytes)}`
                      : "Review the size estimate before downloading photos to this browser."
                  }
                  action={
                    <ActionButton
                      onClick={() => void preparePhotoDownload()}
                      disabled={!snapshot.organizationId || downloadingPhotos}
                    >
                      Download photos for offline use
                    </ActionButton>
                  }
                />
              </div>
            </Section>
            {catalogFeedback?.severity === "success" && (
              <InlineNotice severity="success">
                {catalogFeedback.message}
              </InlineNotice>
            )}
            {repairing && repairProgress && (
              <p className="text-sm text-muted" aria-live="polite">
                {repairProgress.completed} of {repairProgress.total} photos
                checked
              </p>
            )}
            {repairResults.length > 0 && (
              <div aria-live="polite" data-testid="photo-repair-results">
                <h3 className="font-semibold">Photo repair results</h3>
                {repairResults.map((result) => (
                  <p
                    key={result.evidenceId}
                    className={`text-sm ${result.status === "failed" ? "text-danger" : "text-muted"}`}
                  >
                    {result.evidenceId}:{" "}
                    {result.status === "already_present"
                      ? "already uploaded"
                      : result.status}
                    {result.message ? ` — ${result.message}` : ""}
                  </p>
                ))}
              </div>
            )}
            {(snapshot.failedCount ?? 0) > 0 && (
              <ActionButton
                onClick={() => {
                  void (repository.retryFailedOutbox?.() ?? Promise.resolve())
                    .then(() => sync("retry", "upload"))
                    .catch(() => undefined);
                }}
                disabled={!activeStore || snapshot.status === "syncing"}
              >
                Retry failed uploads
              </ActionButton>
            )}
            {!runtimeState.starting && (
              <TransferRecoveryPanel
                repository={repository}
                statusStore={runtimeStore}
              />
            )}
          </div>
        </AnimatedDisclosure>
      </div>
      {conflictsOpen && (
        <Modal
          title="Review sync conflicts"
          onClose={() => setConflictsOpen(false)}
        >
          <div className="space-y-2">
            {conflictActionError && (
              <InlineNotice severity="error">
                {conflictActionError}
              </InlineNotice>
            )}
            {visibleConflicts.map((conflict) => {
              const inspectionId = textField(conflict, [
                "inspection_id",
                "inspectionId",
              ]);
              const controlNumber = textField(conflict, [
                "product_control_number",
                "controlNumber",
                "control_number",
              ]);
              if (conflict.source === "remote-deletion")
                return (
                  <Surface key={conflict.id} className="space-y-3 p-3">
                    <p className="text-sm">
                      {controlNumber || "Inspection"} was deleted on another
                      device. Keep the local work and upload it again, or
                      discard this local copy.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <ActionButton
                        onClick={() =>
                          void resolveDeletion(conflict.id, "keep")
                        }
                      >
                        Keep on this device
                      </ActionButton>
                      <ActionButton
                        danger
                        onClick={() => setDiscardConflictId(conflict.id)}
                      >
                        Discard local copy
                      </ActionButton>
                    </div>
                  </Surface>
                );
              return inspectionId ? (
                <a
                  key={conflict.id}
                  href={`/inspect/${encodeURIComponent(inspectionId)}`}
                  className="block min-h-11 rounded-control border border-border-strong px-4 py-3 font-semibold"
                >
                  Review {controlNumber || "inspection"}
                </a>
              ) : null;
            })}
            {visibleConflicts.length === 0 && (
              <EmptyState
                icon={<RefreshCw />}
                message="Conflict details are not available yet. Retry sync in a moment."
              />
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <ActionButton onClick={() => setConflictsOpen(false)}>
              Close
            </ActionButton>
          </div>
        </Modal>
      )}
      {discardConflictId && (
        <Modal
          title="Discard local inspection?"
          onClose={() => setDiscardConflictId(undefined)}
        >
          <p className="text-sm text-muted">
            This removes the inspection and its unsent edits and photos from
            this browser.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <ActionButton onClick={() => setDiscardConflictId(undefined)}>
              Cancel
            </ActionButton>
            <ActionButton
              danger
              onClick={() => void resolveDeletion(discardConflictId, "discard")}
            >
              Discard
            </ActionButton>
          </div>
        </Modal>
      )}
      {downloadPhotosOpen && (
        <Modal
          title="Download photos for offline use"
          onClose={() => {
            if (!downloadingPhotos) setDownloadPhotosOpen(false);
          }}
        >
          <div className="space-y-3">
            {!downloadingPhotos && photoDownloadResults.length === 0 && (
              <p className="text-sm">
                This will download {downloadEstimate?.photoCount ?? 0} photos
                (about {formatBytes(downloadEstimate?.bytes ?? 0)}). Photos
                already on this browser are skipped.
              </p>
            )}
            {downloadingPhotos && (
              <>
                <p className="text-sm" aria-live="polite">
                  Downloading photos: {photoDownloadProgress.completed} of{" "}
                  {photoDownloadProgress.total}
                </p>
                <progress
                  className="h-2 w-full accent-primary"
                  max={photoDownloadProgress.total || 1}
                  value={
                    photoDownloadProgress.total
                      ? photoDownloadProgress.completed
                      : undefined
                  }
                />
              </>
            )}
            {!downloadingPhotos && photoDownloadResults.length > 0 && (
              <>
                <p className="text-sm">
                  {
                    photoDownloadResults.filter(
                      (item) => item.status === "downloaded"
                    ).length
                  }{" "}
                  downloaded ·{" "}
                  {
                    photoDownloadResults.filter(
                      (item) => item.status === "failed"
                    ).length
                  }{" "}
                  failed ·{" "}
                  {
                    photoDownloadResults.filter(
                      (item) => item.status === "unavailable"
                    ).length
                  }{" "}
                  unavailable ·{" "}
                  {
                    photoDownloadResults.filter(
                      (item) => item.status === "offline"
                    ).length
                  }{" "}
                  offline
                </p>
                {photoDownloadResults
                  .filter(
                    (item) =>
                      item.status === "failed" ||
                      item.status === "unavailable" ||
                      item.status === "offline"
                  )
                  .map((item) => (
                    <p
                      key={item.evidenceId}
                      className={`text-sm ${item.status === "failed" ? "text-danger" : "text-muted"}`}
                    >
                      {item.evidenceId}: {item.message ?? item.status}
                    </p>
                  ))}
              </>
            )}
          </div>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {downloadingPhotos ? (
              <ActionButton onClick={() => photoDownloadAbort.current?.abort()}>
                Cancel download
              </ActionButton>
            ) : (
              <ActionButton onClick={() => setDownloadPhotosOpen(false)}>
                Close
              </ActionButton>
            )}
            {!downloadingPhotos && photoDownloadResults.length === 0 && (
              <ActionButton
                primary
                onClick={() => void downloadPhotos()}
                disabled={!downloadEstimate?.photoCount}
              >
                Download photos
              </ActionButton>
            )}
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SyncAction({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="font-semibold text-ink">{title}</h3>
      <p className="text-sm text-muted">{detail}</p>
      {action}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  primary = false,
  danger = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  const color = primary
    ? "bg-primary text-white"
    : danger
      ? "border border-danger text-danger"
      : "border border-border-strong text-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 w-full rounded-control px-4 font-semibold disabled:opacity-50 ${color}`}
    >
      {children}
    </button>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return <AccessibleModal ariaLabel={title} onClose={onClose} className="max-h-[90dvh] max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>
        {children}
  </AccessibleModal>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function noopSubscribe(): () => void {
  return () => undefined;
}
function getEmptySnapshot(): SyncStatusSnapshot {
  return emptySnapshot;
}

function textField(row: SyncRow, keys: string[]): string {
  const value = keys
    .map((key) => row[key])
    .find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? value.trim() : "";
}

function operationLabel(operation: SyncOperation): string {
  if (operation === "upload") return "Inspection upload";
  if (operation === "download") return "Inspection download";
  return "Full synchronization";
}
