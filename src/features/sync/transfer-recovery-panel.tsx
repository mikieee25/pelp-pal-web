'use client';

import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import IosShareRounded from '@mui/icons-material/IosShareRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import type { LocalRepository } from '@/lib/db/repository';
import {
  parseTransferFile,
  previewTransferBundle,
  serializeTransferBundle,
  type TransferBundle,
  type TransferExportMode,
  type TransferImportPlan,
} from '@/lib/transfer/transfer-codec';
import { downloadTransferFile, shareTransferFile } from '@/lib/transfer/transfer-file';
import type { SyncStatusStore } from './sync-status-store';

type TransferRepository = Pick<LocalRepository, 'exportTransferBundle' | 'previewTransferMerge' | 'mergeTransferBundle'>;
type TransferStatusStore = Pick<SyncStatusStore, 'syncNow'>;

type Feedback = { severity: 'success' | 'error' | 'info'; message: string };

export function TransferRecoveryPanel({
  repository,
  statusStore,
}: {
  repository: TransferRepository;
  statusStore?: TransferStatusStore;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<TransferExportMode>('pending');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [pendingImport, setPendingImport] = useState<{ file: File; bundle: TransferBundle; plan: TransferImportPlan }>();

  const exportRecovery = async (share: boolean) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      const bundle = await repository.exportTransferBundle(mode);
      const file = await serializeTransferBundle(bundle);
      const result = share ? await shareTransferFile(file) : downloadAndReport(file);
      setFeedback({
        severity: result.status === 'failed' ? 'error' : 'success',
        message: result.status === 'shared'
          ? 'Recovery JSON is ready in the share sheet.'
          : result.status === 'canceled'
            ? 'Sharing was canceled. The recovery file is still available to export again.'
            : result.status === 'downloaded'
              ? 'Recovery JSON was downloaded.'
              : result.message,
      });
    } catch (error) {
      setFeedback({ severity: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const inspectImport = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const bundle = await parseTransferFile(file);
      const filePreview = previewTransferBundle(bundle, file.size);
      const plan = await repository.previewTransferMerge(bundle);
      setPendingImport({ file, bundle, plan: { ...plan, ...filePreview } });
    } catch (error) {
      setFeedback({ severity: 'error', message: errorMessage(error) });
      setPendingImport(undefined);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const mergeImport = async () => {
    if (!pendingImport) return;
    setBusy(true);
    try {
      const result = await repository.mergeTransferBundle(pendingImport.bundle);
      setPendingImport(undefined);
      setFeedback({
        severity: result.conflictCount > 0 ? 'info' : 'success',
        message: `${result.importedCount} imported, ${result.skippedCount} skipped, ${result.conflictCount} conflict${result.conflictCount === 1 ? '' : 's'}. Imported work is queued for upload.`,
      });
      await statusStore?.syncNow('manual', 'upload');
    } catch (error) {
      setFeedback({ severity: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={1.5}>
        <Stack spacing={0.5}>
          <Typography variant="h6">Recovery transfer</Typography>
          <Typography variant="body2" color="text.secondary">
            Move pending inspection work between browsers when automatic sync is unavailable. The same JSON file works with iOS, Android, and desktop browsers.
          </Typography>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap flexWrap="wrap">
          <Button variant="outlined" startIcon={<DownloadRounded />} onClick={() => void exportRecovery(false)} disabled={busy} sx={recoveryActionButtonSx}>
            Export recovery JSON
          </Button>
          <Button variant="outlined" startIcon={<IosShareRounded />} onClick={() => void exportRecovery(true)} disabled={busy} sx={recoveryActionButtonSx}>
            Share recovery JSON
          </Button>
          <Button component="label" variant="contained" startIcon={<UploadFileRounded />} disabled={busy} sx={recoveryActionButtonSx}>
            Import and merge JSON
            <input
              ref={inputRef}
              hidden
              type="file"
              accept=".json,application/json"
              aria-label="Import and merge JSON"
              onChange={(event) => void inspectImport(event.target.files?.[0])}
            />
          </Button>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} useFlexGap flexWrap="wrap">
          <Typography variant="body2" color="text.secondary">Export scope:</Typography>
          <Button size="small" variant={mode === 'pending' ? 'contained' : 'text'} onClick={() => setMode('pending')} disabled={busy} sx={{ minHeight: 44 }}>Pending work</Button>
          <Button size="small" variant={mode === 'full' ? 'contained' : 'text'} onClick={() => setMode('full')} disabled={busy} sx={{ minHeight: 44 }}>Full local snapshot</Button>
          <Button size="small" variant={mode === 'records' ? 'contained' : 'text'} onClick={() => setMode('records')} disabled={busy} sx={{ minHeight: 44 }}>Records only</Button>
        </Stack>
        {mode === 'full' && <Alert severity="warning">A full snapshot can be large when it includes evidence images.</Alert>}
        {mode === 'records' && <Alert severity="info">Records-only recovery excludes evidence image bytes.</Alert>}
        {feedback && <Alert severity={feedback.severity}>{feedback.message}</Alert>}
      </Stack>
      <Dialog open={Boolean(pendingImport)} onClose={() => setPendingImport(undefined)} fullWidth maxWidth="sm">
        <DialogTitle>Review import</DialogTitle>
        <DialogContent>
          {pendingImport && (
            <Stack spacing={1.25} sx={{ pt: 1 }}>
              <Typography variant="body2">{pendingImport.file.name}</Typography>
              <Typography variant="body2" color="text.secondary">Organization: {pendingImport.plan.organizationId}</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={`${pendingImport.plan.inspectionCount} inspections`} />
                <Chip size="small" label={`${pendingImport.plan.revisionCount} revisions`} />
                <Chip size="small" label={`${pendingImport.plan.activityCount} activities`} />
                <Chip size="small" label={`${pendingImport.plan.evidenceCount} evidence items`} />
                <Chip size="small" label={`${pendingImport.plan.outboxCount} queued uploads`} />
              </Stack>
              <Alert severity="info">Nothing changes until you confirm. Imported work will enter this browser&apos;s normal upload queue.</Alert>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingImport(undefined)} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={() => void mergeImport()} disabled={busy}>Merge imported data</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

function downloadAndReport(file: File): { status: 'downloaded' } {
  downloadTransferFile(file);
  return { status: 'downloaded' };
}

const recoveryActionButtonSx = {
  flex: { sm: '1 1 0' },
  minHeight: 44,
  minWidth: { sm: 0 },
  textAlign: 'center',
  whiteSpace: 'normal',
} as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The recovery operation could not be completed.';
}
