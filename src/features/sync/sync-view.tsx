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
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import SyncRounded from "@mui/icons-material/SyncRounded";
import WifiOffRounded from "@mui/icons-material/WifiOffRounded";
import { getBrowserRepository } from "@/lib/db/browser";
import type { SyncRow } from "@/lib/db/records";
import { repairMissingEvidence, type EvidenceRepairResult } from "@/lib/supabase/evidence-repair";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { syncCatalog } from "@/features/catalog/catalog-sync";
import type { SyncOperation } from "@/lib/sync/coordinator";
import type {
  SyncOperationResult,
  SyncStatusSnapshot,
} from "./sync-status-store";
import type { SyncStatusStore } from "./sync-status-store";
import { useSyncRuntimeState } from "./sync-runtime-boundary";
import { TransferRecoveryPanel } from "./transfer-recovery-panel";
import { PageContainer, PageHeader } from "@/components/layout/page-layout";
import { startSyncRuntime } from "@/lib/sync/runtime";
import type { EvidenceDownloadEstimate, EvidenceDownloadResult } from "@/lib/db/repository";

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
  const [repairProgress, setRepairProgress] = useState<{ completed: number; total: number }>();
  const [repairing, setRepairing] = useState(false);
  const [repairResults, setRepairResults] = useState<EvidenceRepairResult[]>([]);
  const [downloadEstimate, setDownloadEstimate] = useState<EvidenceDownloadEstimate>();
  const [downloadPhotosOpen, setDownloadPhotosOpen] = useState(false);
  const [downloadingPhotos, setDownloadingPhotos] = useState(false);
  const [photoDownloadProgress, setPhotoDownloadProgress] = useState({ completed: 0, total: 0 });
  const [photoDownloadResults, setPhotoDownloadResults] = useState<EvidenceDownloadResult[]>([]);
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
  const realtimeStatus = getRealtimeStatus(snapshot);

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
        },
      );
      setRepairResults(results);
      await Promise.all(results.filter((result) => result.sha256 && result.status !== "failed")
        .map((result) => repository.markEvidenceUploaded(result.evidenceId, result.remotePath, result.sha256!)));
      await runtimeStore?.refreshStatus();
    } catch (error) {
      setRepairResults([{ evidenceId: "repair", remotePath: "", status: "failed", message: error instanceof Error ? error.message : String(error) }]);
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
      setPhotoDownloadResults([{ evidenceId: 'photos', status: 'failed', message: 'Sign in and retry the photo download.' }]);
    }
  };

  const downloadPhotos = async () => {
    const controller = new AbortController();
    photoDownloadAbort.current = controller;
    setDownloadingPhotos(true);
    setPhotoDownloadProgress({ completed: 0, total: downloadEstimate?.photoCount ?? 0 });
    try {
      const results = await repository.downloadRemoteEvidence(undefined, {
        signal: controller.signal,
        onProgress: (completed, total) => setPhotoDownloadProgress({ completed, total }),
      });
      setPhotoDownloadResults(results);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setPhotoDownloadResults([{ evidenceId: 'photos', status: 'failed', message: error instanceof Error ? error.message : 'Photo download failed.' }]);
      }
    } finally {
      photoDownloadAbort.current = undefined;
      setDownloadingPhotos(false);
    }
  };

  return (
    <PageContainer maxWidth="md">
      <Stack spacing={{ xs: 2.5, md: 3 }}>
        <PageHeader
          eyebrow="Synchronization"
          title="Sync"
          subtitle="Keep completed inspections available to the consolidated report."
        />
        {runtimeState.error && !statusStore && (
          <Alert severity="error" role="alert">
            {runtimeState.error}
          </Alert>
        )}
        <Paper
          data-testid="sync-actions-card"
          sx={{ p: { xs: 2, sm: 3 }, order: 1 }}
        >
          <Stack spacing={2}>
            <Box>
              <Typography variant="h6">Sync actions</Typography>
              <Typography variant="body2" color="text.secondary">
                Run each operation separately, or retry the complete sync after
                an error.
              </Typography>
            </Box>
            <Box
              data-testid="sync-actions-grid"
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(2, minmax(0, 1fr))",
                },
                gap: 2,
              }}
            >
              <SyncAction
                title="Upload inspections"
                detail="Immediately push pending and retryable inspections to the shared mirror."
                action={
                  <Button
                    variant="outlined"
                    fullWidth
                    onClick={() => sync("manual", "upload")}
                    disabled={!activeStore || snapshot.status === "syncing"}
                    sx={{ minHeight: 44, whiteSpace: "normal" }}
                  >
                    Upload inspections
                  </Button>
                }
              />
              <SyncAction
                title="Download inspections"
                detail="Immediately pull available inspections and updates from the shared mirror."
                action={
                  <Button
                    variant="outlined"
                    fullWidth
                    onClick={() => sync("manual", "download")}
                    disabled={!activeStore || snapshot.status === "syncing"}
                    sx={{ minHeight: 44, whiteSpace: "normal" }}
                  >
                    Download inspections
                  </Button>
                }
              />
              <SyncAction
                title="Sync everything"
                detail="Pull updates, push local inspections, then pull again."
                action={
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={() => sync("manual", "full")}
                    disabled={!activeStore || snapshot.status === "syncing"}
                    sx={{ minHeight: 44, whiteSpace: "normal" }}
                  >
                    Sync everything
                  </Button>
                }
              />
              <SyncAction
                title="Sync catalog"
                detail="Download the latest product catalog for this account."
                action={
                  <Button
                    variant="outlined"
                    fullWidth
                    onClick={syncMasterlist}
                    disabled={!activeStore || catalogSyncing}
                    sx={{ mt: 0.5, minHeight: 44, whiteSpace: "normal" }}
                  >
                    {catalogSyncing ? "Syncing catalog…" : "Sync catalog"}
                  </Button>
                }
              />
            </Box>
            {catalogFeedback && (
              <Alert severity={catalogFeedback.severity}>
                {catalogFeedback.message}
              </Alert>
            )}
          </Stack>
        </Paper>
        <Box sx={{ order: 2 }}>
          <TransferRecoveryPanel
            repository={repository}
            statusStore={runtimeStore}
          />
        </Box>
        <Paper
          data-testid="sync-status-card"
          sx={{ p: { xs: 2, sm: 3 }, order: 0 }}
        >
          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", sm: "center" }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box
                  aria-hidden
                  sx={{
                    display: "grid",
                    placeItems: "center",
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    bgcolor: "action.hover",
                    color:
                      snapshot.status === "offline"
                        ? "text.secondary"
                        : "primary.main",
                  }}
                >
                  {snapshot.status === "offline" ? (
                    <WifiOffRounded />
                  ) : (
                    <SyncRounded />
                  )}
                </Box>
                <Box>
                  <Typography variant="h6">Synchronization status</Typography>
                  <Typography variant="body2" color="text.secondary">
                    The coordinator pulls remote changes and sends completed
                    local inspections.
                  </Typography>
                </Box>
              </Stack>
              <Chip label={realtimeStatus.label} color={realtimeStatus.color} />
            </Stack>
            {snapshot.lastError && (
              <Alert severity="error" role="alert">
                {snapshot.lastError}
              </Alert>
            )}
            {snapshot.status === "syncing" && snapshot.operation && (
              <Alert severity="info">
                {operationLabel(snapshot.operation)} in progress…
              </Alert>
            )}
            {((snapshot.evidencePendingCount ?? 0) + (snapshot.evidenceFailedCount ?? 0)) > 0 && (
              <Alert severity="warning" data-testid="evidence-sync-state">
                <Typography variant="body2" fontWeight={700}>
                  {(snapshot.evidencePendingCount ?? 0) + (snapshot.evidenceFailedCount ?? 0)} photos waiting to upload
                </Typography>
                {snapshot.evidenceLastError && <Typography variant="body2">{snapshot.evidenceLastError}</Typography>}
              </Alert>
            )}
            {snapshot.lastOperationResult && snapshot.status !== "syncing" && (
              <Alert
                severity={
                  snapshot.lastOperationResult.error ? "error" : "success"
                }
              >
                {formatOperationResult(snapshot.lastOperationResult)}
              </Alert>
            )}
            {snapshot.conflictCount > 0 && (
              <Alert severity="warning">
                <Stack spacing={1}>
                  <Typography variant="body2" fontWeight={700}>
                    Sync conflicts need review
                  </Typography>
                  <Typography variant="body2">
                    A newer version exists on another device. Review the
                    affected inspection before retrying its upload.
                  </Typography>
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
                    return inspectionId ? (
                      <Button
                        key={conflict.id}
                        component="a"
                        href={`/inspect/${encodeURIComponent(inspectionId)}`}
                        size="small"
                        variant="outlined"
                        sx={{ alignSelf: "flex-start" }}
                      >
                        Review {controlNumber || "inspection"}
                      </Button>
                    ) : null;
                  })}
                </Stack>
              </Alert>
            )}
            {snapshot.status === "offline" && (
              <Alert severity="info">
                Local data remains available while this browser is offline or
                signed out. Sign in with an active personnel account to upload
                or download shared inspections.
              </Alert>
            )}
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              flexWrap="wrap"
              useFlexGap
            >
              <Chip
                label={`${snapshot.pendingCount} pending`}
                variant="outlined"
              />
              {(snapshot.retryingCount ?? 0) > 0 && (
                <Chip
                  label={`${snapshot.retryingCount} retrying`}
                  variant="outlined"
                  color="warning"
                />
              )}
              <Chip
                label={`${snapshot.conflictCount} ${snapshot.conflictCount === 1 ? "conflict" : "conflicts"}`}
                variant="outlined"
                color={snapshot.conflictCount > 0 ? "warning" : "default"}
              />
              {(snapshot.failedCount ?? 0) > 0 && (
                <Chip
                  label={`${snapshot.failedCount} failed`}
                  variant="outlined"
                  color="error"
                />
              )}
              <Button
                variant="outlined"
                onClick={() => void repairPhotos()}
                disabled={!activeStore || !snapshot.organizationId || repairing}
              >
                {repairing ? "Checking photos…" : "Re-upload missing photos"}
              </Button>
              <Button variant="outlined" onClick={() => void preparePhotoDownload()} disabled={!snapshot.organizationId || downloadingPhotos}>
                Download photos for offline use
              </Button>
              {snapshot.catalogVersion !== undefined && (
                <Chip
                  label={`Catalog v${snapshot.catalogVersion}`}
                  variant="outlined"
                />
              )}
              {snapshot.localInspectionCount !== undefined && (
                <Chip
                  label={`${snapshot.localInspectionCount} on this browser`}
                  variant="outlined"
                />
              )}
              {snapshot.remoteInspectionCount !== undefined && (
                <Chip
                  label={`${snapshot.remoteInspectionCount} available remotely`}
                  variant="outlined"
                />
              )}
              {snapshot.organizationId && (
                <Chip
                  label={`Organization ${snapshot.organizationId}`}
                  variant="outlined"
                />
              )}
              {snapshot.lastUploadAt && (
                <Chip
                  label={`Uploaded ${formatTime(snapshot.lastUploadAt)}`}
                  variant="outlined"
                />
              )}
              {snapshot.lastDownloadAt && (
                <Chip
                  label={`Downloaded ${formatTime(snapshot.lastDownloadAt)}`}
                  variant="outlined"
                />
              )}
              {catalogLastSyncedAt && (
                <Chip
                  label={`Catalog synced ${formatTime(catalogLastSyncedAt)}`}
                  variant="outlined"
                />
              )}
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ alignSelf: "center" }}
              >
                {snapshot.lastSyncedAt
                  ? `Last synced ${formatTime(snapshot.lastSyncedAt)}`
                  : "Not synced in this session"}
              </Typography>
            </Stack>
            {repairing && repairProgress && (
              <Typography variant="body2" color="text.secondary" aria-live="polite">
                {repairProgress.completed} of {repairProgress.total} photos checked
              </Typography>
            )}
            {repairResults.length > 0 && (
              <Box aria-live="polite" data-testid="photo-repair-results">
                <Typography variant="subtitle2">Photo repair results</Typography>
                {repairResults.map((result) => (
                  <Typography key={result.evidenceId} variant="body2" color={result.status === "failed" ? "error.main" : "text.secondary"}>
                    {result.evidenceId}: {result.status === "already_present" ? "already uploaded" : result.status}{result.message ? ` — ${result.message}` : ""}
                  </Typography>
                ))}
              </Box>
            )}
            {snapshot.diagnosticsError && (
              <Alert severity="warning">{snapshot.diagnosticsError}</Alert>
            )}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              {(snapshot.failedCount ?? 0) > 0 && (
                <Button
                  variant="outlined"
                  onClick={() => {
                    const retry = repository.retryFailedOutbox
                      ? repository.retryFailedOutbox()
                      : Promise.resolve();
                    void retry
                      .then(() => sync("retry", "upload"))
                      .catch(() => undefined);
                  }}
                  disabled={!activeStore || snapshot.status === "syncing"}
                >
                  Retry failed uploads
                </Button>
              )}
              {snapshot.status === "error" && (
                <Button
                  variant="outlined"
                  startIcon={<SyncRounded />}
                  onClick={() => sync("retry", "full")}
                  disabled={!activeStore}
                >
                  Retry full sync
                </Button>
              )}
            </Stack>
          </Stack>
        </Paper>
      </Stack>
      <Dialog open={downloadPhotosOpen} onClose={() => { if (!downloadingPhotos) setDownloadPhotosOpen(false); }} fullWidth maxWidth="sm">
        <DialogTitle>Download photos for offline use</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {!downloadingPhotos && photoDownloadResults.length === 0 && <Typography variant="body2">This will download {downloadEstimate?.photoCount ?? 0} photos (about {formatBytes(downloadEstimate?.bytes ?? 0)}). Photos already on this browser are skipped.</Typography>}
            {downloadingPhotos && <><Typography variant="body2" aria-live="polite">Downloading photos: {photoDownloadProgress.completed} of {photoDownloadProgress.total}</Typography><LinearProgress variant={photoDownloadProgress.total ? 'determinate' : 'indeterminate'} value={photoDownloadProgress.total ? photoDownloadProgress.completed / photoDownloadProgress.total * 100 : undefined} /></>}
            {!downloadingPhotos && photoDownloadResults.length > 0 && <><Typography variant="body2">{photoDownloadResults.filter((item) => item.status === 'downloaded').length} downloaded · {photoDownloadResults.filter((item) => item.status === 'failed').length} failed · {photoDownloadResults.filter((item) => item.status === 'unavailable').length} unavailable · {photoDownloadResults.filter((item) => item.status === 'offline').length} offline</Typography>{photoDownloadResults.filter((item) => item.status === 'failed' || item.status === 'unavailable' || item.status === 'offline').map((item) => <Typography key={item.evidenceId} variant="body2" color={item.status === 'failed' ? 'error.main' : 'text.secondary'}>{item.evidenceId}: {item.message ?? item.status}</Typography>)}</>}
          </Stack>
        </DialogContent>
        <DialogActions>
          {downloadingPhotos ? <Button onClick={() => photoDownloadAbort.current?.abort()}>Cancel download</Button> : <Button onClick={() => setDownloadPhotosOpen(false)}>Close</Button>}
          {!downloadingPhotos && photoDownloadResults.length === 0 && <Button variant="contained" onClick={() => void downloadPhotos()} disabled={!downloadEstimate?.photoCount}>Download photos</Button>}
        </DialogActions>
      </Dialog>
    </PageContainer>
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
    <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="subtitle2" fontWeight={700}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {detail}
      </Typography>
      {action}
    </Stack>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function getRealtimeStatus(snapshot: SyncStatusSnapshot): {
  label: "Live" | "Reconnecting" | "Polling" | "Offline";
  color: "default" | "success" | "warning";
} {
  if (snapshot.status === "offline")
    return { label: "Offline", color: "default" };
  if (snapshot.realtimeState === "connected")
    return { label: "Live", color: "success" };
  if (snapshot.realtimeState === "reconnecting")
    return { label: "Reconnecting", color: "warning" };
  return snapshot.pollingActive === false
    ? { label: "Reconnecting", color: "warning" }
    : { label: "Polling", color: "default" };
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

function formatOperationResult(result: SyncOperationResult): string {
  const details: string[] = [];
  if (result.uploadedCount > 0)
    details.push(`${result.uploadedCount} uploaded`);
  if (result.downloadedCount > 0)
    details.push(`${result.downloadedCount} downloaded`);
  if (result.unchangedCount > 0) details.push("no new inspections");
  if (result.retryingCount > 0)
    details.push(`${result.retryingCount} queued for retry`);
  if (result.conflictedCount > 0)
    details.push(
      `${result.conflictedCount} conflict${result.conflictedCount === 1 ? "" : "s"}`
    );
  if (result.failedCount > 0) details.push(`${result.failedCount} failed`);
  const suffix = details.length > 0 ? `: ${details.join(" · ")}` : ".";
  return `${operationLabel(result.operation)} completed${suffix}${result.error ? ` ${result.error}` : ""}`;
}
