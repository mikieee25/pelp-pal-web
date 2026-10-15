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
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import SyncRounded from "@mui/icons-material/SyncRounded";
import { getBrowserRepository } from "@/lib/db/browser";
import type { SyncRow } from "@/lib/db/records";
import { repairMissingEvidence, type EvidenceRepairResult } from "@/lib/supabase/evidence-repair";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { syncCatalog } from "@/features/catalog/catalog-sync";
import type { SyncOperation } from "@/lib/sync/coordinator";
import type {
  SyncStatusSnapshot,
} from "./sync-status-store";
import type { SyncStatusStore } from "./sync-status-store";
import { useSyncRuntimeState } from "./sync-runtime-boundary";
import { TransferRecoveryPanel } from "./transfer-recovery-panel";
import { PageContainer, PageHeader } from "@/components/layout/page-layout";
import { startSyncRuntime } from "@/lib/sync/runtime";
import type { EvidenceDownloadEstimate, EvidenceDownloadResult } from "@/lib/db/repository";
import { formatRelativeSyncTime, getSyncErrorPresentation, getSyncHeadline } from "./sync-presentation";

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
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
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
  const headline = getSyncHeadline(snapshot);
  const errorPresentation = getSyncErrorPresentation(snapshot, [
    runtimeState.error,
    catalogFeedback?.severity === "error" ? catalogFeedback.message : undefined,
  ]);
  const photoWaitCount = (snapshot.evidencePendingCount ?? 0) + (snapshot.evidenceFailedCount ?? 0);
  const retryCatalog = catalogFeedback?.severity === "error" && errorPresentation?.details.includes(catalogFeedback.message);

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

  const retry = () => {
    if (retryCatalog) syncMasterlist();
    else sync("retry", "full");
  };
  const reviewConflicts = () => setConflictsOpen(true);

  return (
    <PageContainer maxWidth="md">
      <Stack spacing={{ xs: 2, md: 2.5 }}>
        <PageHeader eyebrow="Synchronization" title="Sync" subtitle="Keep completed inspections available to the consolidated report." />
        <Paper data-testid="sync-status-card" sx={{ p: { xs: 2, sm: 3 }, borderColor: `${headline.tone}.light` }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box aria-hidden sx={{ display: 'grid', placeItems: 'center', width: 44, height: 44, flex: '0 0 auto', borderRadius: '50%', bgcolor: `${headline.tone}.light`, color: `${headline.tone}.main` }}>
                <SyncRounded />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="h6" color={`${headline.tone}.main`} data-testid="sync-headline">{headline.title}</Typography>
                {snapshot.lastSyncedAt ? (
                  <Tooltip title={formatTime(snapshot.lastSyncedAt)}>
                    <Typography variant="body2" color="text.secondary">Last synced {formatRelativeSyncTime(snapshot.lastSyncedAt)}</Typography>
                  </Tooltip>
                ) : <Typography variant="body2" color="text.secondary">Not synced yet</Typography>}
              </Box>
            </Stack>
            {headline.progress && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }} aria-live="polite">
                  {snapshot.operation ? `${operationLabel(snapshot.operation)} in progress` : 'Preparing synchronization'}
                </Typography>
                <LinearProgress />
              </Box>
            )}
            <Button variant="contained" fullWidth onClick={() => sync('manual', 'full')} disabled={!activeStore || snapshot.status === 'syncing'} startIcon={<SyncRounded />} sx={{ minHeight: 44 }}>
              Sync now
            </Button>
            {errorPresentation && (
              <Alert
                severity={errorPresentation.kind === 'conflict' ? 'warning' : errorPresentation.message.startsWith("You're offline") ? 'info' : 'error'}
                role="alert"
                action={<Button color="inherit" size="small" onClick={errorPresentation.kind === 'conflict' ? reviewConflicts : retry}>{errorPresentation.kind === 'conflict' ? 'Review conflicts' : 'Retry'}</Button>}
              >
                <Stack spacing={0.75}>
                  <Typography variant="body2">{errorPresentation.message}</Typography>
                  {errorPresentation.details.length > 0 && (
                    <Box component="details">
                      <Typography component="summary" variant="body2" sx={{ cursor: 'pointer', fontWeight: 600 }}>Technical details</Typography>
                      <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                        {errorPresentation.details.map((detail) => <Typography key={detail} variant="caption" sx={{ overflowWrap: 'anywhere' }}>{detail}</Typography>)}
                      </Stack>
                    </Box>
                  )}
                </Stack>
              </Alert>
            )}
            {snapshot.conflictCount > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
                  <Typography variant="body2" fontWeight={700}>Needs review ({snapshot.conflictCount})</Typography>
                  <Button variant="outlined" fullWidth onClick={reviewConflicts} sx={{ minHeight: 44, maxWidth: { sm: 160 } }}>Review</Button>
                </Stack>
              </Paper>
            )}
            {photoWaitCount > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="evidence-sync-state">
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
                  <Box>
                    <Typography variant="body2" fontWeight={700}>Photos waiting ({photoWaitCount})</Typography>
                    {snapshot.evidenceLastError && <Typography variant="body2" color="text.secondary">{snapshot.evidenceLastError}</Typography>}
                  </Box>
                  <Button variant="outlined" fullWidth onClick={() => setAdvancedExpanded(true)} sx={{ minHeight: 44, maxWidth: { sm: 180 } }}>Photo tools</Button>
                </Stack>
              </Paper>
            )}
          </Stack>
        </Paper>

        <Accordion disableGutters data-testid="sync-details-accordion" sx={{ '&:before': { display: 'none' }, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <AccordionSummary expandIcon={<ExpandMoreRounded />}><Typography variant="subtitle1" fontWeight={700}>Details</Typography></AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Stack divider={<Divider flexItem />}>
              <StatusDetail label="Pending" value={`${snapshot.pendingCount}${(snapshot.retryingCount ?? 0) ? ` (${snapshot.retryingCount} retrying)` : ''}`} />
              <StatusDetail label="Conflicts" value={snapshot.conflictCount} />
              <StatusDetail label="On this device" value={snapshot.localInspectionCount ?? '—'} />
              <StatusDetail label="On the server" value={snapshot.remoteInspectionCount ?? '—'} />
              <StatusDetail label="Catalog version" value={snapshot.catalogVersion === undefined ? '—' : `v${snapshot.catalogVersion}${catalogLastSyncedAt ? ` · synced ${formatTime(catalogLastSyncedAt)}` : ''}`} />
              <StatusDetail label="Last upload" value={snapshot.lastUploadAt ? formatTime(snapshot.lastUploadAt) : '—'} />
              <StatusDetail label="Last download" value={snapshot.lastDownloadAt ? formatTime(snapshot.lastDownloadAt) : '—'} />
              <StatusDetail label="Organization" value={snapshot.organizationName ?? (snapshot.organizationId ? snapshot.organizationId.slice(-8) : '—')} />
            </Stack>
            {snapshot.diagnosticsError && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{snapshot.diagnosticsError}</Typography>}
          </AccordionDetails>
        </Accordion>

        <Accordion expanded={advancedExpanded} onChange={(_event, expanded) => setAdvancedExpanded(expanded)} disableGutters data-testid="sync-advanced-accordion" sx={{ '&:before': { display: 'none' }, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <AccordionSummary expandIcon={<ExpandMoreRounded />}><Typography variant="subtitle1" fontWeight={700}>Advanced</Typography></AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <Box data-testid="sync-actions-grid" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
                <SyncAction title="Force upload inspections" detail="Immediately push pending and retryable inspections to the shared mirror." action={<Button variant="outlined" fullWidth onClick={() => sync('manual', 'upload')} disabled={!activeStore || snapshot.status === 'syncing'} sx={{ minHeight: 44, whiteSpace: 'normal' }}>Force upload inspections</Button>} />
                <SyncAction title="Force download inspections" detail="Immediately pull available inspections and updates from the shared mirror." action={<Button variant="outlined" fullWidth onClick={() => sync('manual', 'download')} disabled={!activeStore || snapshot.status === 'syncing'} sx={{ minHeight: 44, whiteSpace: 'normal' }}>Force download inspections</Button>} />
                <SyncAction title="Sync catalog" detail="Download the latest product catalog for this account." action={<Button variant="outlined" fullWidth onClick={syncMasterlist} disabled={!activeStore || catalogSyncing} sx={{ minHeight: 44, whiteSpace: 'normal' }}>{catalogSyncing ? 'Syncing catalog…' : 'Sync catalog'}</Button>} />
                <SyncAction title="Re-upload missing photos" detail="Check your local photos and upload any files missing from the server." action={<Button variant="outlined" fullWidth onClick={() => void repairPhotos()} disabled={!activeStore || !snapshot.organizationId || repairing} sx={{ minHeight: 44, whiteSpace: 'normal' }}>{repairing ? 'Checking photos…' : 'Re-upload missing photos'}</Button>} />
                <SyncAction title="Download photos for offline use" detail={downloadEstimate ? `${downloadEstimate.photoCount} photos · about ${formatBytes(downloadEstimate.bytes)}` : 'Review the size estimate before downloading photos to this browser.'} action={<Button variant="outlined" fullWidth onClick={() => void preparePhotoDownload()} disabled={!snapshot.organizationId || downloadingPhotos} sx={{ minHeight: 44, whiteSpace: 'normal' }}>Download photos for offline use</Button>} />
              </Box>
              {catalogFeedback?.severity === 'success' && <Alert severity="success">{catalogFeedback.message}</Alert>}
              {repairing && repairProgress && <Typography variant="body2" color="text.secondary" aria-live="polite">{repairProgress.completed} of {repairProgress.total} photos checked</Typography>}
              {repairResults.length > 0 && <Box aria-live="polite" data-testid="photo-repair-results"><Typography variant="subtitle2">Photo repair results</Typography>{repairResults.map((result) => <Typography key={result.evidenceId} variant="body2" color={result.status === 'failed' ? 'error.main' : 'text.secondary'}>{result.evidenceId}: {result.status === 'already_present' ? 'already uploaded' : result.status}{result.message ? ` — ${result.message}` : ''}</Typography>)}</Box>}
              {(snapshot.failedCount ?? 0) > 0 && <Button variant="outlined" fullWidth onClick={() => { void (repository.retryFailedOutbox?.() ?? Promise.resolve()).then(() => sync('retry', 'upload')).catch(() => undefined); }} disabled={!activeStore || snapshot.status === 'syncing'} sx={{ minHeight: 44 }}>Retry failed uploads</Button>}
              <TransferRecoveryPanel repository={repository} statusStore={runtimeStore} />
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Stack>
      <Dialog open={conflictsOpen} onClose={() => setConflictsOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Review sync conflicts</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ pt: 1 }}>
            {visibleConflicts.map((conflict) => {
              const inspectionId = textField(conflict, ['inspection_id', 'inspectionId']);
              const controlNumber = textField(conflict, ['product_control_number', 'controlNumber', 'control_number']);
              return inspectionId ? <Button key={conflict.id} component="a" href={`/inspect/${encodeURIComponent(inspectionId)}`} variant="outlined" fullWidth sx={{ justifyContent: 'flex-start' }}>Review {controlNumber || 'inspection'}</Button> : null;
            })}
            {visibleConflicts.length === 0 && <Typography variant="body2" color="text.secondary">Conflict details are not available yet. Retry sync in a moment.</Typography>}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setConflictsOpen(false)}>Close</Button></DialogActions>
      </Dialog>
      <Dialog open={downloadPhotosOpen} onClose={() => { if (!downloadingPhotos) setDownloadPhotosOpen(false); }} fullWidth maxWidth="sm">
        <DialogTitle>Download photos for offline use</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {!downloadingPhotos && photoDownloadResults.length === 0 && <Typography variant="body2">This will download {downloadEstimate?.photoCount ?? 0} photos (about {formatBytes(downloadEstimate?.bytes ?? 0)}). Photos already on this browser are skipped.</Typography>}
            {downloadingPhotos && <><Typography variant="body2" aria-live="polite">Downloading photos: {photoDownloadProgress.completed} of {photoDownloadProgress.total}</Typography><LinearProgress variant={photoDownloadProgress.total ? 'determinate' : 'indeterminate'} value={photoDownloadProgress.total ? photoDownloadProgress.completed / photoDownloadProgress.total * 100 : undefined} /></>}
            {!downloadingPhotos && photoDownloadResults.length > 0 && <><Typography variant="body2">{photoDownloadResults.filter((item) => item.status === 'downloaded').length} downloaded · {photoDownloadResults.filter((item) => item.status === 'failed').length} failed · {photoDownloadResults.filter((item) => item.status === 'unavailable').length} unavailable · {photoDownloadResults.filter((item) => item.status === 'offline').length} offline</Typography>{photoDownloadResults.filter((item) => item.status === 'failed' || item.status === 'unavailable' || item.status === 'offline').map((item) => <Typography key={item.evidenceId} variant="body2" color={item.status === 'failed' ? 'error.main' : 'text.secondary'}>{item.evidenceId}: {item.message ?? item.status}</Typography>)}</>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, alignItems: 'stretch', '& > :not(style)': { width: { xs: '100%', sm: 'auto' } } }}>
          {downloadingPhotos ? <Button fullWidth onClick={() => photoDownloadAbort.current?.abort()}>Cancel download</Button> : <Button fullWidth onClick={() => setDownloadPhotosOpen(false)}>Close</Button>}
          {!downloadingPhotos && photoDownloadResults.length === 0 && <Button fullWidth variant="contained" onClick={() => void downloadPhotos()} disabled={!downloadEstimate?.photoCount}>Download photos</Button>}
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

function StatusDetail({ label, value }: { label: string; value: string | number }) {
  return (
    <Stack direction="row" spacing={2} justifyContent="space-between" sx={{ py: 1 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={600} textAlign="right" sx={{ overflowWrap: 'anywhere' }}>{value}</Typography>
    </Stack>
  );
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
