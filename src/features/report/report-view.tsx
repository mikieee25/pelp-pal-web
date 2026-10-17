'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import { MobileReportCard } from '@/components/report/mobile-report-card';
import { ActionBar, InlineNotice, PageHeader, PageShell, Section, Surface } from '@/components/ui';
import { AnimatedDisclosure } from '@/components/motion/animated-disclosure';
import { AccessibleModal } from '@/components/ui/accessible-overlay';
import { AccessibleSelect } from '@/components/ui/accessible-overlay';
import { getBrowserRepository } from '@/lib/db/browser';
import type { InspectionRecord, ReportDraft } from '@/lib/db/records';
import { buildReportSummary, consolidateReportProducts, type BreakdownRow, type ComplianceRow, type ConsolidatedProduct } from './report-model';
import { createEmptyReportDraft } from './report-draft';
import { buildReportDiagnostics } from './report-diagnostics';
import { enrichInspectionsWithActivity } from '@/lib/db/inspection-enrichment';
import { startSyncRuntime } from '@/lib/sync/runtime';
import { prepareReportPhoto } from './report-images';
import type { ReportPhotoProduct } from './docx-template';

export function ReportView() {
  const repository = useMemo(() => getBrowserRepository(), []);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [selectedStore, setSelectedStore] = useState('all');
  const [draft, setDraft] = useState<ReportDraft>(() => createEmptyReportDraft('all'));
  const [loadedDraftKey, setLoadedDraftKey] = useState<string>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [exportError, setExportError] = useState<string>();
  const [includeEvidencePhotos, setIncludeEvidencePhotos] = useState(false);
  const [photoEstimate, setPhotoEstimate] = useState<{ photoCount: number; bytes: number; key: string }>();
  const [photoEstimateError, setPhotoEstimateError] = useState<string>();
  const [photoReportPhase, setPhotoReportPhase] = useState<'confirm' | 'downloading' | 'review' | 'generating'>();
  const [photoProgress, setPhotoProgress] = useState({ completed: 0, total: 0 });
  const [photoReport, setPhotoReport] = useState<ReportPhotoProduct[]>([]);
  const [photoReportBytes, setPhotoReportBytes] = useState(0);
  const [photoFailureCount, setPhotoFailureCount] = useState(0);
  const photoReportAbort = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void repository.listCompletedInspections()
      .then(async (rows) => {
        const activities = repository.listActivity?.({ limit: 100000 }) ?? Promise.resolve([]);
        const enrichedRows = enrichInspectionsWithActivity(rows, await activities);
        if (active) { setInspections(enrichedRows); setStatus('ready'); }
      })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [repository]);

  useEffect(() => {
    let active = true;
    void repository.getReportDraft(selectedStore)
      .then((saved) => { if (active) { setDraft(saved ?? createDraftFromStore(selectedStore, inspections)); setLoadedDraftKey(selectedStore); } })
      .catch(() => { if (active) { setDraft(createDraftFromStore(selectedStore, inspections)); setLoadedDraftKey(selectedStore); } });
    return () => { active = false; };
  }, [inspections, repository, selectedStore]);

  useEffect(() => {
    if (status !== 'ready' || loadedDraftKey !== selectedStore) return;
    const timer = window.setTimeout(() => {
      setSaveStatus('saving');
      void repository.saveReportDraft(draft)
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, loadedDraftKey, repository, selectedStore, status]);

  const stores = useMemo(() => uniqueStores(inspections), [inspections]);
  const products = useMemo(() => consolidateReportProducts(inspections, selectedStore === 'all' ? undefined : selectedStore), [inspections, selectedStore]);
  const summary = useMemo(() => buildReportSummary(products), [products]);
  const diagnostics = useMemo(() => buildReportDiagnostics(
    inspections.filter((inspection) => selectedStore === 'all' || inspectionStoreKey(inspection) === selectedStore),
  ), [inspections, selectedStore]);
  const nonCompliantInspectionIds = useMemo(() => Array.from(new Set(summary.nonCompliantProducts.flatMap((product) => product.records.map((record) => record.id)))), [summary.nonCompliantProducts]);

  useEffect(() => {
    if (!includeEvidencePhotos || status !== 'ready') return;
    let active = true;
    void startSyncRuntime().then(() => repository.getEvidenceDownloadEstimate(nonCompliantInspectionIds))
      .then((estimate) => { if (active) { setPhotoEstimate({ ...estimate, key: nonCompliantInspectionIds.join('|') }); setPhotoEstimateError(undefined); } })
      .catch((error) => { if (active) setPhotoEstimateError(error instanceof Error ? error.message : 'Photo estimate could not be loaded.'); });
    return () => { active = false; };
  }, [includeEvidencePhotos, nonCompliantInspectionIds, repository, status]);
  const photoEstimateCurrent = photoEstimate?.key === nonCompliantInspectionIds.join('|') ? photoEstimate : undefined;

  const updateDraft = (changes: Partial<ReportDraft>) => setDraft((current) => ({ ...current, ...changes, storeKey: selectedStore }));

  const download = async () => {
    setExportError(undefined);
    if (includeEvidencePhotos) { setPhotoReportPhase('confirm'); return; }
    try {
      const { downloadEmvReport } = await import('./docx-template');
      await downloadEmvReport({ draft, summary, nonCompliantProducts: summary.nonCompliantProducts });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'The Word report could not be generated. Your local draft is still safe.');
    }
  };

  const downloadAndPreparePhotos = async () => {
    const controller = new AbortController();
    photoReportAbort.current = controller;
    setPhotoProgress({ completed: 0, total: photoEstimate?.photoCount ?? 0 });
    setPhotoReportPhase('downloading');
    setPhotoFailureCount(0);
    try {
      await startSyncRuntime();
      const results = await repository.downloadRemoteEvidence(nonCompliantInspectionIds, {
        signal: controller.signal,
        onProgress: (completed, total) => setPhotoProgress({ completed, total }),
      });
      let failed = results.filter((item) => item.status === 'failed' || item.status === 'unavailable' || item.status === 'offline').length;
      let totalBytes = 0;
      const reportPhotos = await Promise.all(summary.nonCompliantProducts.map(async (product): Promise<ReportPhotoProduct> => {
        const photos: ReportPhotoProduct['photos'] = [];
        for (const record of product.records) {
          const evidence = await repository.listEvidenceImages(record.id);
          for (const item of evidence) {
            if (!item.blob) continue;
            try {
              const prepared = await prepareReportPhoto(item.blob);
              photos.push(prepared);
              totalBytes += prepared.blob.size;
            } catch { failed += 1; }
          }
        }
        return { controlNumber: product.controlNumber, brand: product.brand, model: product.model, photos };
      }));
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      setPhotoReport(reportPhotos.filter((product) => product.photos.length));
      setPhotoReportBytes(totalBytes);
      setPhotoFailureCount(failed);
      setPhotoReportPhase('review');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setExportError(error instanceof Error ? error.message : 'The photo appendix could not be prepared.');
      setPhotoReportPhase(undefined);
    } finally {
      photoReportAbort.current = undefined;
    }
  };

  const generatePhotoReport = async () => {
    setPhotoReportPhase('generating');
    setExportError(undefined);
    try {
      const { downloadEmvReport } = await import('./docx-template');
      await downloadEmvReport({ draft, summary, nonCompliantProducts: summary.nonCompliantProducts, photoAppendix: photoReport });
      setPhotoReportPhase(undefined);
    } catch (error) {
      setPhotoReportPhase('review');
      setExportError(error instanceof Error ? error.message : 'The Word report could not be generated.');
    }
  };

  return <PageShell>
    <div className="space-y-6">
      <PageHeader title="Report" subtitle="Populate the EMV report from completed inspections synchronized to this device." />
      <Section title="Report details">
        <div className="space-y-4"><p className="text-sm text-muted">Draft fields are saved locally for each finished store.</p>
          <AccessibleSelect id="report-finished-store" label="Finished store" value={selectedStore} onChange={setSelectedStore} options={[{ value: 'all', label: 'All finished stores' }, ...stores.map((store) => ({ value: store.key, label: store.name }))]} />
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink"><input type="checkbox" checked={includeEvidencePhotos} onChange={(event) => setIncludeEvidencePhotos(event.target.checked)} className="size-5 accent-primary" />Include evidence photos (non-compliant products only)</label>
          {includeEvidencePhotos && <p className={`text-sm ${photoEstimateError ? 'text-danger' : 'text-muted'}`}>{photoEstimateError ? `Photo estimate unavailable: ${photoEstimateError}` : photoEstimateCurrent ? `${photoEstimateCurrent.photoCount} photos not on this browser · about ${formatFileSize(photoEstimateCurrent.bytes)} to download` : 'Estimating photo download…'}</p>}
        </div>
      </Section>
      <Section title="Store and inspection"><div className="grid gap-4 md:grid-cols-2">
        <ReportField label="Inspection date" type="date" value={draft.inspectionDate} onChange={(value) => updateDraft({ inspectionDate: value })} />
        <ReportField label="Region / province" value={draft.regionProvince} onChange={(value) => updateDraft({ regionProvince: value })} />
        <ReportField label="DOE monitoring team" value={draft.monitoringTeam} onChange={(value) => updateDraft({ monitoringTeam: value })} />
        <ReportField label="Store name" value={draft.storeName} onChange={(value) => updateDraft({ storeName: value })} />
        <ReportField label="Address" value={draft.address} onChange={(value) => updateDraft({ address: value })} />
      </div></Section>
      <Section title="Store contacts"><div className="grid gap-4 md:grid-cols-2">
        <ReportField label="Email" type="email" value={draft.email} onChange={(value) => updateDraft({ email: value })} />
        <ReportField label="Contact number" value={draft.contactNumber} onChange={(value) => updateDraft({ contactNumber: value })} />
        <ReportField label="Store representative" value={draft.storeRepresentative} onChange={(value) => updateDraft({ storeRepresentative: value })} />
        <ReportField label="Team leader" value={draft.teamLeader} onChange={(value) => updateDraft({ teamLeader: value })} />
        <ReportField label="Acknowledged by" value={draft.acknowledgedBy} onChange={(value) => updateDraft({ acknowledgedBy: value })} />
      </div></Section>
      <Section title="Findings and recommendations"><div className="grid gap-4 md:grid-cols-2">
        <ReportField label="Findings / observations" multiline value={draft.findings} onChange={(value) => updateDraft({ findings: value })} />
        <ReportField label="Recommendations / resolution" multiline value={draft.recommendations} onChange={(value) => updateDraft({ recommendations: value })} />
      </div></Section>
      {(exportError || (includeEvidencePhotos && photoFailureCount > 0 && photoReportPhase === 'review') || (includeEvidencePhotos && photoReportPhase === 'review' && photoReportBytes > 25 * 1024 * 1024) || status === 'error') && <div className="space-y-3">
        {exportError && <InlineNotice severity="info">{exportError}</InlineNotice>}
        {includeEvidencePhotos && photoFailureCount > 0 && photoReportPhase === 'review' && <InlineNotice severity="warning">{photoFailureCount} photo(s) were unavailable and will be omitted from the appendix.</InlineNotice>}
        {includeEvidencePhotos && photoReportPhase === 'review' && photoReportBytes > 25 * 1024 * 1024 && <InlineNotice severity="warning">The photo appendix is estimated above 25 MB.</InlineNotice>}
        {status === 'error' && <InlineNotice severity="warning">Completed inspections could not be loaded. The fixed zero-filled report remains available.</InlineNotice>}
      </div>}
      <ActionBar>
        <span className="text-sm text-muted" aria-live="polite">{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved locally' : saveStatus === 'error' ? 'Save failed' : ''}</span>
        <button type="button" onClick={() => void download()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-primary px-4 font-semibold text-white sm:w-auto"><Download aria-hidden="true" className="size-4" />Download Word report</button>
      </ActionBar>
      <ReportDiagnosticsCard diagnostics={diagnostics} />
      <ReportTables summary={summary} />
    </div>
    {photoReportPhase && <AccessibleModal onClose={() => { if (photoReportPhase !== 'downloading' && photoReportPhase !== 'generating') setPhotoReportPhase(undefined); }} labelledBy="photo-dialog-title" className="max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-xl">
      <h2 id="photo-dialog-title" className="text-lg font-semibold text-ink">{photoReportPhase === 'review' ? 'Review photo appendix' : 'Prepare photo appendix'}</h2>
      <div className="space-y-3">
        {photoReportPhase === 'confirm' && <p className="text-sm text-muted">{photoEstimateError ? `Photo estimate unavailable: ${photoEstimateError}` : photoEstimateCurrent ? `Download up to ${photoEstimateCurrent.photoCount} photos (${formatFileSize(photoEstimateCurrent.bytes)}) for non-compliant products, then include available photos in the Word report.` : 'Estimating photo download…'}</p>}
        {photoReportPhase === 'downloading' && <><p className="text-sm text-muted" aria-live="polite">Downloading photos: {photoProgress.completed} of {photoProgress.total}</p><progress className="h-2 w-full accent-primary" max={photoProgress.total || 1} value={photoProgress.total ? photoProgress.completed : undefined} /></>}
        {photoReportPhase === 'review' && <><p className="text-sm text-muted">{photoReport.reduce((count, product) => count + product.photos.length, 0)} photos · estimated appendix size {formatFileSize(photoReportBytes)}.</p>{photoReportBytes > 25 * 1024 * 1024 && <InlineNotice severity="warning">This report exceeds the recommended 25 MB size. You can continue or cancel and reduce the number of included photos.</InlineNotice>}{photoFailureCount > 0 && <p className="text-sm text-muted">{photoFailureCount} unavailable photos will be skipped.</p>}</>}
        {photoReportPhase === 'generating' && <><p className="text-sm text-muted">Generating the Word document…</p><progress className="h-2 w-full accent-primary" /></>}
      </div>
      <div className="flex flex-col justify-end gap-2 sm:flex-row">
        {photoReportPhase === 'downloading' ? <button type="button" onClick={() => photoReportAbort.current?.abort()} className="min-h-11 rounded-control border border-border-strong px-4 font-semibold">Cancel</button> : photoReportPhase === 'generating' ? null : <button type="button" onClick={() => setPhotoReportPhase(undefined)} className="min-h-11 rounded-control border border-border-strong px-4 font-semibold">Cancel</button>}
        {photoReportPhase === 'confirm' && <button type="button" onClick={() => void downloadAndPreparePhotos()} disabled={!photoEstimateCurrent} className="min-h-11 rounded-control bg-primary px-4 font-semibold text-white disabled:opacity-50">Download photos</button>}
        {photoReportPhase === 'review' && <button type="button" onClick={() => void generatePhotoReport()} className="min-h-11 rounded-control bg-primary px-4 font-semibold text-white">Generate Word report</button>}
      </div>
    </AccessibleModal>}
  </PageShell>;
}

function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ReportDiagnosticsCard({ diagnostics }: { diagnostics: ReturnType<typeof buildReportDiagnostics> }) {
  const warnings = [
    diagnostics.missingModelCount && `${diagnostics.missingModelCount} missing model code`,
    diagnostics.missingCompanyCount && `${diagnostics.missingCompanyCount} missing Company`,
    diagnostics.missingRetailPriceCount && `${diagnostics.missingRetailPriceCount} missing Retail Price`,
    diagnostics.missingCompanyEmailCount && `${diagnostics.missingCompanyEmailCount} missing Company Email`,
    diagnostics.missingPcrEmailCount && `${diagnostics.missingPcrEmailCount} missing PCR Email`,
  ].filter((value): value is string => Boolean(value));
  return <Surface className="space-y-2 p-4">
      <h2 className="text-lg font-semibold text-ink">Export diagnostics</h2>
      <p className="text-sm text-muted">{diagnostics.inspectionCount} inspections · {diagnostics.productCount} consolidated models · {diagnostics.nonCompliantCount} NC inspection records</p>
      {warnings.length > 0 ? <InlineNotice severity="warning">Review before export: {warnings.join(' · ')}.</InlineNotice> : <InlineNotice severity="success">All tracked export fields are populated.</InlineNotice>}
  </Surface>;
}

function ReportTables({ summary }: { summary: ReturnType<typeof buildReportSummary> }) {
  return <>
    <AnimatedDisclosure id="report-preview-data-content" ariaLabel="Preview report data" className="rounded-xl border border-border bg-white" summaryClassName="flex min-h-14 w-full items-center justify-between px-4 text-left font-semibold text-ink focus-visible:outline-2 focus-visible:outline-focus" summary={<>Preview report data<ChevronDown aria-hidden="true" className="size-4" /></>} panelClassName="overflow-hidden border-t border-border p-4">
      <div className="space-y-6">
    <ReportSection title="Compliance Summary" subtitle="One row per consolidated product model and control number.">
      <div className="hidden md:block"><DataTable label="Compliance summary table" headers={['Types of ECPs', 'Models', 'With Energy Label', 'With COE', 'Non-Compliant', 'Compliance Percentage (%)']} rows={[...summary.complianceRows.map((row) => [row.label, row.models, row.labeled, row.exempted, row.nonCompliant, formatRate(row.compliance)]), ['Total:', summary.totals.models, summary.totals.labeled, summary.totals.exempted, summary.totals.nonCompliant, formatRate(summary.totals.compliance)]]} /></div>
      <div className="space-y-3 md:hidden">{summary.complianceRows.map((row) => <MobileReportCard key={row.typeKey} testId="report-mobile-compliance-card" title={row.label} compliance={formatRate(row.compliance)} metrics={[{ label: 'Models', value: row.models }, { label: 'Energy labeled', value: row.labeled }, { label: 'COE exempted', value: row.exempted }, { label: 'Non-compliant', value: row.nonCompliant }]} />)}</div>
    </ReportSection>
    <ReportSection title="Non-Compliance Breakdown Summary" subtitle="A consolidated product is counted once per finding category.">
      <div className="hidden md:block"><DataTable label="Non-compliance breakdown table" headers={['Types of ECPs', 'Not Registered', 'Registered but no EL/COE', 'Placement', 'Visual Quality', 'Product Details']} rows={summary.breakdownRows.map((row) => [row.label, row.notRegistered, row.noDocument, row.placement, row.visualQuality, row.productDetails])} /></div>
      <div className="space-y-3 md:hidden">{summary.breakdownRows.map((row) => <MobileReportCard key={row.typeKey} testId="report-mobile-breakdown-card" title={row.label} metrics={[{ label: 'Not registered', value: row.notRegistered }, { label: 'No EL/COE', value: row.noDocument }, { label: 'Placement', value: row.placement }, { label: 'Visual quality', value: row.visualQuality }, { label: 'Product details', value: row.productDetails }]} />)}</div>
    </ReportSection>
    <ReportSection title="Summary of EMV Results" subtitle="Copy-friendly totals for the finished-store report.">
      <div className="hidden md:block"><DataTable label="Summary of EMV results table" headers={['Types of ECPs', 'Compliant Models', 'Non-Compliant Models', 'Labeled Models', 'Exempted Models', 'Model Count']} rows={[...summary.emvRows.map((row) => [row.label, row.compliant, row.nonCompliant, row.labeled, row.exempted, row.models]), ['Total', summary.totals.compliant, summary.totals.nonCompliant, summary.totals.labeled, summary.totals.exempted, summary.totals.models], ['Compliance Rate', formatRate(summary.totals.compliance), '', '', '', '']]} /></div>
      <div className="space-y-3 md:hidden">{summary.emvRows.map((row) => <MobileReportCard key={row.typeKey} testId="report-mobile-emv-card" title={row.label} compliance={formatRate(row.models > 0 ? (row.compliant / row.models) * 100 : null)} metrics={[{ label: 'Compliant', value: row.compliant }, { label: 'Non-compliant', value: row.nonCompliant }, { label: 'Labeled', value: row.labeled }, { label: 'Exempted', value: row.exempted }, { label: 'Model count', value: row.models }]} />)}</div>
    </ReportSection>
      </div>
    </AnimatedDisclosure>
    <ReportSection title="Non-Compliance Results" subtitle="NC products appear first and remain consolidated by store and control number.">
      <div className="hidden md:block"><DataTable testId="report-nc-table" label="Non-compliance results table" headers={['No.', 'ECP Type', 'Brand Name', 'Model Code', 'Description of Non-Compliance', 'Status', 'Company', 'Company Email', 'PCR Email', 'Warning']} rows={summary.nonCompliantProducts.length === 0 ? [['No non-compliant products for this store filter.']] : summary.nonCompliantProducts.map((product, index) => [index + 1, product.productType || 'Not available', product.brand || 'Not available', product.model || 'Not available', product.findings.join('; ') || 'Non-compliant finding', 'NC', product.companyName || 'Not available', product.companyEmail || 'Not available', product.pcrEmail || 'Not available', product.findings.includes('Not Registered') ? 'Check/scan QR code' : 'Please check if the model is within the scope'])} /></div>
      <div className="space-y-3 md:hidden">{summary.nonCompliantProducts.length === 0 ? <Surface data-testid="report-mobile-nc-empty" className="p-4"><p className="text-sm text-muted">No non-compliant products for this store filter.</p></Surface> : summary.nonCompliantProducts.map((product, index) => <MobileNonComplianceCard key={product.key} product={product} index={index} />)}</div>
    </ReportSection>
  </>;
}

function DataTable({ label, headers, rows, testId }: { label: string; headers: string[]; rows: React.ReactNode[][]; testId?: string }) {
  return <div data-testid="table-scroll-cue" data-scroll-cue="true" className="relative overflow-x-auto pb-3 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-3 after:bg-gradient-to-l after:from-border/80 after:to-transparent">
    <table data-testid={testId} data-sticky-first-column={testId === 'report-nc-table' ? 'true' : undefined} aria-label={label} className="min-w-full border-collapse text-left text-sm"><thead className="bg-surface-alt"><tr>{headers.map((header, index) => <th key={header} scope="col" className={`px-2 py-2 font-semibold text-ink ${index === 0 ? 'sticky left-0 bg-surface-alt' : ''}`}>{header}</th>)}</tr></thead>
      <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-border last:border-0">{headers.map((_, columnIndex) => <td key={columnIndex} className={`max-w-[260px] whitespace-normal break-words px-2 py-2 align-top text-ink ${columnIndex === 0 ? 'sticky left-0 bg-white font-semibold' : ''} ${typeof row[columnIndex] === 'number' ? 'tabular-nums text-right' : ''}`}>{row[columnIndex] ?? ''}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function MobileNonComplianceCard({ product, index }: { product: ConsolidatedProduct; index: number }) {
  return <MobileReportCard testId="report-mobile-nc-card" title={`${index + 1}. ${product.model || 'Not available'}`} status={<span className="rounded-lg bg-danger-soft px-2 py-1 text-xs font-semibold text-danger">NC</span>} metrics={[{ label: 'ECP type', value: product.productType || 'Not available' }, { label: 'Brand', value: product.brand || 'Not available' }, { label: 'Description', value: product.findings.join('; ') || 'Non-compliant finding' }, { label: 'Company', value: product.companyName || 'Not available' }]} />;
}

function ReportSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <Section title={title}><div className="space-y-3"><p className="text-sm text-muted">{subtitle}</p>{children}</div></Section>;
}
function ReportField({ label, value, onChange, type = 'text', multiline = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; multiline?: boolean }) {
  const classes = 'mt-1.5 w-full rounded-control border border-border-strong bg-white px-3 py-3 text-base text-ink outline-none focus:ring-2 focus:ring-focus';
  return <label className="block text-sm font-medium text-ink">{label}{multiline
    ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} className={`${classes} min-h-28 resize-y`} />
    : <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className={`${classes} h-12`} />}</label>;
}
function formatRate(value: number | null): string { return value === null ? 'N/A' : `${value.toFixed(0)}%`; }
function uniqueStores(inspections: InspectionRecord[]): Array<{ key: string; name: string }> { const seen = new Map<string, string>(); inspections.forEach((inspection) => { const key = text(inspection, ['storeId', 'store_id']) || `${text(inspection, ['storeName', 'store_name'])}|${text(inspection, ['location'])}`; if (key && !seen.has(key)) seen.set(key, text(inspection, ['storeName', 'store_name']) || 'Unnamed store'); }); return Array.from(seen, ([key, name]) => ({ key, name })).sort((left, right) => left.name.localeCompare(right.name)); }
function createDraftFromStore(storeKey: string, inspections: InspectionRecord[]): ReportDraft { const draft = createEmptyReportDraft(storeKey); const store = inspections.find((inspection) => (text(inspection, ['storeId', 'store_id']) || `${text(inspection, ['storeName', 'store_name'])}|${text(inspection, ['location'])}`) === storeKey); return store ? { ...draft, storeName: text(store, ['storeName', 'store_name']), regionProvince: text(store, ['location', 'storeLocation', 'store_location']), updatedAt: new Date().toISOString() } : draft; }
function text(record: Record<string, unknown>, keys: string[]): string { const value = keys.map((key) => record[key]).find((candidate) => typeof candidate === 'string' && candidate.trim()); return typeof value === 'string' ? value.trim() : ''; }
function inspectionStoreKey(record: InspectionRecord): string { return text(record, ['storeId', 'store_id']) || `${text(record, ['storeName', 'store_name'])}|${text(record, ['location'])}`; }
