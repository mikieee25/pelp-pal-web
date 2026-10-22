'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Share2, Upload, X } from 'lucide-react';
import type { LocalRepository, TransferStoreOption } from '@/lib/db/repository';
import {
  parseTransferFile,
  previewTransferBundle,
  serializeTransferBundle,
  type TransferBundle,
  type TransferImportPlan,
} from '@/lib/transfer/transfer-codec';
import { downloadTransferFile, shareTransferFile } from '@/lib/transfer/transfer-file';
import type { SyncStatusStore } from './sync-status-store';
import { InlineNotice, Surface } from '@/components/ui';
import { AccessibleModal } from '@/components/ui/accessible-overlay';
import { AnimatedDisclosure } from '@/components/motion/animated-disclosure';

const actionClass = 'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[10px] border border-border-strong bg-white px-3 py-2 text-center text-sm font-semibold text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50';
const primaryActionClass = 'inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-primary px-3 py-2 text-center text-sm font-semibold text-white hover:bg-primary-hover focus-within:outline-2 focus-within:outline-focus';

type TransferRepository = Pick<LocalRepository, 'exportTransferBundle' | 'previewTransferMerge' | 'mergeTransferBundle'> & {
  listTransferStores?: () => Promise<TransferStoreOption[]>;
  subscribeAccountScope?: (listener: () => void) => () => void;
};
type TransferStatusStore = Pick<SyncStatusStore, 'syncNow'>;

type Feedback = { severity: 'success' | 'error' | 'info'; message: string };
const ALL_STORES_VALUE = '__all_stores__';

export function TransferRecoveryPanel({
  repository,
  statusStore,
}: {
  repository: TransferRepository;
  statusStore?: TransferStatusStore;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stores, setStores] = useState<TransferStoreOption[]>();
  const [selectedStoreKeys, setSelectedStoreKeys] = useState<string[]>([]);
  const [storeOptionsError, setStoreOptionsError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [pendingImport, setPendingImport] = useState<{ file: File; bundle: TransferBundle; plan: TransferImportPlan }>();

  useEffect(() => {
    if (!repository.listTransferStores) return undefined;
    let active = true;
    let requestId = 0;
    const loadStores = () => {
      const currentRequest = ++requestId;
      setStores(undefined);
      setStoreOptionsError(undefined);
      void repository.listTransferStores?.()
        .then((options) => {
          if (active && currentRequest === requestId) setStores(options);
        })
        .catch((error: unknown) => {
          if (active && currentRequest === requestId) setStoreOptionsError(errorMessage(error));
        });
    };
    const unsubscribe = repository.subscribeAccountScope?.(loadStores);
    loadStores();
    return () => { active = false; unsubscribe?.(); };
  }, [repository]);

  const exportRecovery = async (share: boolean) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      const bundle = await repository.exportTransferBundle('pending', selectedStoreKeys.length > 0 ? selectedStoreKeys : undefined);
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

  const exportInspectionCsv = async () => {
    setBusy(true);
    setFeedback(undefined);
    try {
      const bundle = await repository.exportTransferBundle('records', selectedStoreKeys.length > 0 ? selectedStoreKeys : undefined);
      downloadCsvFile(bundle.records.inspections);
      setFeedback({ severity: 'success', message: `${bundle.records.inspections.length} local inspection records exported to CSV. Use recovery JSON to transfer data into another PELP Pal device.` });
    } catch (error) {
      setFeedback({ severity: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const availableStores = stores ?? [];
  const storesLoading = Boolean(repository.listTransferStores) && stores === undefined && !storeOptionsError;
  const exportDisabled = busy || storesLoading || Boolean(storeOptionsError);
  const selectedStoreLabel = selectedStoreKeys.length === 0
    ? 'All stores'
    : `${selectedStoreKeys.length} store${selectedStoreKeys.length === 1 ? '' : 's'} selected`;

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
    <Surface className="p-4 sm:p-6">
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-ink">Recovery transfer</h3>
          <p className="text-sm text-muted">
            Use recovery JSON to move pending work between browsers when automatic sync is unavailable. Export all selected local inspections to CSV for spreadsheet review and manual consolidation.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => void exportRecovery(false)} disabled={exportDisabled} className={actionClass}>
            <Download aria-hidden className="size-4" />
            Export recovery JSON
          </button>
          <button type="button" onClick={() => void exportInspectionCsv()} disabled={exportDisabled} className={actionClass}>
            <Download aria-hidden className="size-4" />
            Export inspection CSV
          </button>
          <button type="button" onClick={() => void exportRecovery(true)} disabled={exportDisabled} className={actionClass}>
            <Share2 aria-hidden className="size-4" />
            Share recovery JSON
          </button>
          <label className={`${primaryActionClass} ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload aria-hidden className="size-4" />
            Import and merge JSON
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept=".json,application/json"
              aria-label="Import and merge JSON"
              onChange={(event) => void inspectImport(event.target.files?.[0])}
            />
          </label>
        </div>
        <div className="space-y-2">
          <p className="text-sm text-muted">Choose which store details and pending inspections to include in the recovery file. All stores are selected by default.</p>
          <AnimatedDisclosure id="recovery-store-picker" ariaLabel="Stores to export" disabled={exportDisabled} className="rounded-lg border border-border-strong bg-white p-3" summaryClassName={`flex min-h-11 w-full items-center text-left text-base text-ink focus-visible:outline-2 focus-visible:outline-focus ${exportDisabled ? 'opacity-50' : ''}`} summary={<><span className="font-medium">Stores to export</span><span className="ml-2 text-sm text-muted">{selectedStoreLabel}</span></>} panelClassName="mt-3 max-h-[55vh] min-h-0 space-y-1 overflow-y-auto overscroll-contain border-t border-border pt-2">
            <div data-testid="recovery-store-options">
              <label className="flex min-h-11 items-center gap-3 rounded px-2 hover:bg-surface-alt"><input type="checkbox" checked={selectedStoreKeys.length === 0} disabled={exportDisabled} onChange={() => setSelectedStoreKeys([])} /><span className="text-sm font-medium">All stores <span className="font-normal text-muted">({availableStores.length} available)</span></span></label>
              {availableStores.map((store) => <label key={store.key} className="flex min-h-11 items-center gap-3 rounded px-2 hover:bg-surface-alt"><input type="checkbox" checked={selectedStoreKeys.includes(store.key)} disabled={exportDisabled} onChange={(event) => setSelectedStoreKeys((current) => event.target.checked ? [...current, store.key] : current.filter((key) => key !== store.key))} /><span className="text-sm">{store.name}<span className="block text-xs text-muted">{`${store.location ? `${store.location} · ` : ''}${store.inspectionCount} inspections`}</span></span></label>)}
            </div>
          </AnimatedDisclosure>
        </div>
        {storeOptionsError && <p className="text-sm text-danger" role="status" aria-live="polite">{storeOptionsError}</p>}
        <p className="text-sm text-muted">Store details are included even when a store has no pending inspections. Recovery JSON includes pending work and available evidence photos. CSV includes all local inspections for the selected stores.</p>
        {feedback && (feedback.severity === 'error'
          ? <p className="text-sm text-danger" role="status" aria-live="polite">{feedback.message}</p>
          : <InlineNotice severity={feedback.severity}>{feedback.message}</InlineNotice>)}
      </div>
      {pendingImport && <AccessibleModal onClose={() => setPendingImport(undefined)} labelledBy="transfer-import-title" className="max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between"><h3 id="transfer-import-title" className="text-lg font-semibold text-ink">Review import</h3><button type="button" onClick={() => setPendingImport(undefined)} aria-label="Close" className="rounded-lg p-2 text-muted hover:bg-surface-alt"><X aria-hidden className="size-5" /></button></div>
        <div>
          {pendingImport && (
            <div className="space-y-3 pt-3">
              <p className="text-sm font-medium text-ink">{pendingImport.file.name}</p><p className="break-all text-sm text-muted">Organization: {pendingImport.plan.organizationId}</p>
              <div className="flex flex-wrap gap-2">{[`${pendingImport.plan.inspectionCount} inspections`, `${pendingImport.plan.revisionCount} revisions`, `${pendingImport.plan.activityCount} activities`, `${pendingImport.plan.evidenceCount} evidence items`, `${pendingImport.plan.outboxCount} queued uploads`].map((label) => <span key={label} className="rounded-lg bg-surface-alt px-2 py-1 text-xs text-muted">{label}</span>)}</div>
              <InlineNotice severity="info">Nothing changes until you confirm. Imported work will enter this browser&apos;s normal upload queue.</InlineNotice>
            </div>
          )}
        </div>
        <div className="mt-5 flex flex-col justify-end gap-2 sm:flex-row"><button type="button" onClick={() => setPendingImport(undefined)} disabled={busy} className={actionClass}>Cancel</button><button type="button" onClick={() => void mergeImport()} disabled={busy} className={`${actionClass} border-primary bg-primary text-white hover:bg-primary-hover`}>Merge imported data</button></div>
      </AccessibleModal>}
    </Surface>
  );
}

function downloadAndReport(file: File): { status: 'downloaded' } {
  downloadTransferFile(file);
  return { status: 'downloaded' };
}

function downloadCsvFile(records: Record<string, unknown>[]): void {
  const rows = records.map(flattenRecord);
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).sort((left, right) => left.localeCompare(right));
  if (columns.length === 0) columns.push('id');
  const csv = [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'pelp-inspections.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function flattenRecord(record: Record<string, unknown>): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};
  const visit = (value: unknown, prefix: string) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value).forEach(([key, child]) => {
        if (key !== 'accountScopeKey' && key !== 'account_scope_key') visit(child, prefix ? `${prefix}.${key}` : key);
      });
    } else {
      flattened[prefix] = Array.isArray(value) ? JSON.stringify(value) : value;
    }
  };
  visit(record, '');
  return flattened;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safeText = typeof value === 'string' && /^[\s]*[=+@\-]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The recovery operation could not be completed.';
}
