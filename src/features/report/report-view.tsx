'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  LinearProgress,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import { MobileReportCard } from '@/components/report/mobile-report-card';
import { PageContainer, PageHeader } from '@/components/layout/page-layout';
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

  return <PageContainer maxWidth="xl">
    <Stack spacing={{ xs: 2.5, md: 3 }}>
      <PageHeader eyebrow="EMV report" title="Report" subtitle="Populate the EMV report from completed inspections synchronized to this device." />
      <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Box><Typography variant="h6">Report details</Typography><Typography variant="body2" color="text.secondary">Draft fields are saved locally for each finished store.</Typography></Box>
            <Stack direction="row" spacing={1} alignItems="center"><Typography variant="body2" color="text.secondary">{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved locally' : saveStatus === 'error' ? 'Save failed' : ''}</Typography><Button startIcon={<DownloadRounded />} variant="contained" onClick={() => void download()}>Download Word report</Button></Stack>
          </Stack>
          <FormControl fullWidth size="small"><InputLabel id="report-store-label">Finished store</InputLabel><Select labelId="report-store-label" label="Finished store" value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}><MenuItem value="all">All finished stores</MenuItem>{stores.map((store) => <MenuItem key={store.key} value={store.key}>{store.name}</MenuItem>)}</Select></FormControl>
          <Box>
            <FormControlLabel control={<Switch checked={includeEvidencePhotos} onChange={(event) => setIncludeEvidencePhotos(event.target.checked)} />} label="Include evidence photos (non-compliant products only)" />
            {includeEvidencePhotos && <Typography variant="body2" color={photoEstimateError ? 'error.main' : 'text.secondary'}>{photoEstimateError ? `Photo estimate unavailable: ${photoEstimateError}` : photoEstimateCurrent ? `${photoEstimateCurrent.photoCount} photos not on this browser · about ${formatFileSize(photoEstimateCurrent.bytes)} to download` : 'Estimating photo download…'}</Typography>}
          </Box>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField fullWidth label="Inspection date" type="date" InputLabelProps={{ shrink: true }} value={draft.inspectionDate} onChange={(event) => updateDraft({ inspectionDate: event.target.value })} />
            <TextField fullWidth label="Region / province" value={draft.regionProvince} onChange={(event) => updateDraft({ regionProvince: event.target.value })} />
            <TextField fullWidth label="DOE monitoring team" value={draft.monitoringTeam} onChange={(event) => updateDraft({ monitoringTeam: event.target.value })} />
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField fullWidth label="Store name" value={draft.storeName} onChange={(event) => updateDraft({ storeName: event.target.value })} />
            <TextField fullWidth label="Address" value={draft.address} onChange={(event) => updateDraft({ address: event.target.value })} />
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField fullWidth label="Email" type="email" value={draft.email} onChange={(event) => updateDraft({ email: event.target.value })} />
            <TextField fullWidth label="Contact number" value={draft.contactNumber} onChange={(event) => updateDraft({ contactNumber: event.target.value })} />
            <TextField fullWidth label="Store representative" value={draft.storeRepresentative} onChange={(event) => updateDraft({ storeRepresentative: event.target.value })} />
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField fullWidth label="Findings / observations" multiline minRows={3} value={draft.findings} onChange={(event) => updateDraft({ findings: event.target.value })} />
            <TextField fullWidth label="Recommendations / resolution" multiline minRows={3} value={draft.recommendations} onChange={(event) => updateDraft({ recommendations: event.target.value })} />
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField fullWidth label="Team leader" value={draft.teamLeader} onChange={(event) => updateDraft({ teamLeader: event.target.value })} />
            <TextField fullWidth label="Acknowledged by" value={draft.acknowledgedBy} onChange={(event) => updateDraft({ acknowledgedBy: event.target.value })} />
          </Stack>
          {exportError && <Alert severity="info" onClose={() => setExportError(undefined)}>{exportError}</Alert>}
          {includeEvidencePhotos && photoFailureCount > 0 && photoReportPhase === 'review' && <Alert severity="warning">{photoFailureCount} photo(s) were unavailable and will be omitted from the appendix.</Alert>}
          {includeEvidencePhotos && photoReportPhase === 'review' && photoReportBytes > 25 * 1024 * 1024 && <Alert severity="warning">The photo appendix is estimated above 25 MB.</Alert>}
          {status === 'error' && <Alert severity="warning">Completed inspections could not be loaded. The fixed zero-filled report remains available.</Alert>}
        </Stack>
      </Paper>
      <ReportDiagnosticsCard diagnostics={diagnostics} />
      <ReportTables summary={summary} />
    </Stack>
    <Dialog open={Boolean(photoReportPhase)} onClose={() => { if (photoReportPhase !== 'downloading' && photoReportPhase !== 'generating') setPhotoReportPhase(undefined); }} fullWidth maxWidth="sm">
      <DialogTitle>{photoReportPhase === 'review' ? 'Review photo appendix' : 'Prepare photo appendix'}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          {photoReportPhase === 'confirm' && <Typography variant="body2">{photoEstimateError ? `Photo estimate unavailable: ${photoEstimateError}` : photoEstimateCurrent ? `Download up to ${photoEstimateCurrent.photoCount} photos (${formatFileSize(photoEstimateCurrent.bytes)}) for non-compliant products, then include available photos in the Word report.` : 'Estimating photo download…'}</Typography>}
          {photoReportPhase === 'downloading' && <><Typography variant="body2" aria-live="polite">Downloading photos: {photoProgress.completed} of {photoProgress.total}</Typography><LinearProgress variant={photoProgress.total ? 'determinate' : 'indeterminate'} value={photoProgress.total ? photoProgress.completed / photoProgress.total * 100 : undefined} /></>}
          {photoReportPhase === 'review' && <><Typography variant="body2">{photoReport.reduce((count, product) => count + product.photos.length, 0)} photos · estimated appendix size {formatFileSize(photoReportBytes)}.</Typography>{photoReportBytes > 25 * 1024 * 1024 && <Alert severity="warning">This report exceeds the recommended 25 MB size. You can continue or cancel and reduce the number of included photos.</Alert>}{photoFailureCount > 0 && <Typography variant="body2" color="text.secondary">{photoFailureCount} unavailable photos will be skipped.</Typography>}</>}
          {photoReportPhase === 'generating' && <><Typography variant="body2">Generating the Word document…</Typography><LinearProgress /></>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {photoReportPhase === 'downloading' ? <Button onClick={() => photoReportAbort.current?.abort()}>Cancel</Button> : photoReportPhase === 'generating' ? null : <Button onClick={() => setPhotoReportPhase(undefined)}>Cancel</Button>}
        {photoReportPhase === 'confirm' && <Button variant="contained" onClick={() => void downloadAndPreparePhotos()} disabled={!photoEstimateCurrent}>Download photos</Button>}
        {photoReportPhase === 'review' && <Button variant="contained" onClick={() => void generatePhotoReport()}>Generate Word report</Button>}
      </DialogActions>
    </Dialog>
  </PageContainer>;
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
  return <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
    <Stack spacing={1}>
      <Typography variant="h6">Export diagnostics</Typography>
      <Typography variant="body2" color="text.secondary">{diagnostics.inspectionCount} inspections · {diagnostics.productCount} consolidated models · {diagnostics.nonCompliantCount} NC inspection records</Typography>
      {warnings.length > 0 ? <Alert severity="warning">Review before export: {warnings.join(' · ')}.</Alert> : <Alert severity="success">All tracked export fields are populated.</Alert>}
    </Stack>
  </Paper>;
}

function ReportTables({ summary }: { summary: ReturnType<typeof buildReportSummary> }) {
  return <>
    <Accordion disableGutters defaultExpanded={false} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, '&::before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreRounded />} aria-controls="report-preview-data-content" id="report-preview-data-header">
        <Typography component="h2" variant="h6">Preview report data</Typography>
      </AccordionSummary>
      <AccordionDetails id="report-preview-data-content">
        <Stack spacing={3}>
    <ReportSection title="Compliance Summary" subtitle="One row per consolidated product model and control number.">
      <Box sx={{ display: { xs: 'none', sm: 'block' } }}><Table aria-label="Compliance summary table"><TableHead><TableRow><Header>Types of ECPs</Header><Header>Models</Header><Header>With Energy Label</Header><Header>With COE</Header><Header>Non-Compliant</Header><Header>Compliance Percentage (%)</Header></TableRow></TableHead><TableBody>{summary.complianceRows.map((row) => <ComplianceTableRow key={row.typeKey} row={row} />)}<TotalRow values={["Total:", summary.totals.models, summary.totals.labeled, summary.totals.exempted, summary.totals.nonCompliant, formatRate(summary.totals.compliance)]} /></TableBody></Table></Box>
      <Stack spacing={1.25} sx={{ display: { xs: 'flex', sm: 'none' } }}>{summary.complianceRows.map((row) => <MobileReportCard key={row.typeKey} testId="report-mobile-compliance-card" title={row.label} compliance={formatRate(row.compliance)} metrics={[{ label: 'Models', value: row.models }, { label: 'Energy labeled', value: row.labeled }, { label: 'COE exempted', value: row.exempted }, { label: 'Non-compliant', value: row.nonCompliant }]} />)}</Stack>
    </ReportSection>
    <ReportSection title="Non-Compliance Breakdown Summary" subtitle="A consolidated product is counted once per finding category.">
      <Box sx={{ display: { xs: 'none', sm: 'block' } }}><Table aria-label="Non-compliance breakdown table"><TableHead><TableRow><Header>Types of ECPs</Header><Header>Not Registered</Header><Header>Registered but no EL/COE</Header><Header>Placement</Header><Header>Visual Quality</Header><Header>Product Details</Header></TableRow></TableHead><TableBody>{summary.breakdownRows.map((row) => <TableRow key={row.typeKey}><Cell>{row.label}</Cell><Number>{row.notRegistered}</Number><Number>{row.noDocument}</Number><Number>{row.placement}</Number><Number>{row.visualQuality}</Number><Number>{row.productDetails}</Number></TableRow>)}</TableBody></Table></Box>
      <Stack spacing={1.25} sx={{ display: { xs: 'flex', sm: 'none' } }}>{summary.breakdownRows.map((row) => <MobileReportCard key={row.typeKey} testId="report-mobile-breakdown-card" title={row.label} metrics={[{ label: 'Not registered', value: row.notRegistered }, { label: 'No EL/COE', value: row.noDocument }, { label: 'Placement', value: row.placement }, { label: 'Visual quality', value: row.visualQuality }, { label: 'Product details', value: row.productDetails }]} />)}</Stack>
    </ReportSection>
    <ReportSection title="Summary of EMV Results" subtitle="Copy-friendly totals for the finished-store report.">
      <Box sx={{ display: { xs: 'none', sm: 'block' } }}><Table aria-label="Summary of EMV results table"><TableHead><TableRow><Header>Types of ECPs</Header><Header>Compliant Models</Header><Header>Non-Compliant Models</Header><Header>Labeled Models</Header><Header>Exempted Models</Header><Header>Model Count</Header></TableRow></TableHead><TableBody>{summary.emvRows.map((row) => <TableRow key={row.typeKey}><Cell>{row.label}</Cell><Number>{row.compliant}</Number><Number>{row.nonCompliant}</Number><Number>{row.labeled}</Number><Number>{row.exempted}</Number><Number>{row.models}</Number></TableRow>)}<TotalRow values={["Total", summary.totals.compliant, summary.totals.nonCompliant, summary.totals.labeled, summary.totals.exempted, summary.totals.models]} /><TableRow><Cell>Compliance Rate</Cell><Number colSpan={5}>{formatRate(summary.totals.compliance)}</Number></TableRow></TableBody></Table></Box>
      <Stack spacing={1.25} sx={{ display: { xs: 'flex', sm: 'none' } }}>{summary.emvRows.map((row) => <MobileReportCard key={row.typeKey} testId="report-mobile-emv-card" title={row.label} compliance={formatRate(row.models > 0 ? (row.compliant / row.models) * 100 : null)} metrics={[{ label: 'Compliant', value: row.compliant }, { label: 'Non-compliant', value: row.nonCompliant }, { label: 'Labeled', value: row.labeled }, { label: 'Exempted', value: row.exempted }, { label: 'Model count', value: row.models }]} />)}</Stack>
    </ReportSection>
        </Stack>
      </AccordionDetails>
    </Accordion>
    <ReportSection title="Non-Compliance Results" subtitle="NC products appear first and remain consolidated by store and control number.">
      <Box sx={{ display: { xs: 'none', sm: 'block' } }}><Table data-testid="report-nc-table" data-sticky-first-column="true" aria-label="Non-compliance results table" sx={{ minWidth: 1050, '& th:first-of-type': { width: 52, minWidth: 52, maxWidth: 52, p: 0.75, position: 'sticky', left: 0, zIndex: 3 }, '& td:first-of-type': { width: 52, minWidth: 52, maxWidth: 52, p: 0.75, position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper' }, '& th, & td': { p: 0.75 }, '& th:nth-of-type(5), & td:nth-of-type(5)': { minWidth: 220, whiteSpace: 'normal', overflowWrap: 'anywhere' } }}><TableHead><TableRow><Header>No.</Header><Header>ECP Type</Header><Header>Brand Name</Header><Header>Model Code</Header><Header>Description of Non-Compliance</Header><Header>Status</Header><Header>Company</Header><Header>Company Email</Header><Header>PCR Email</Header><Header>Warning</Header></TableRow></TableHead><TableBody>{summary.nonCompliantProducts.length === 0 ? <TableRow><Cell colSpan={10}>No non-compliant products for this store filter.</Cell></TableRow> : summary.nonCompliantProducts.map((product, index) => <NcRow key={product.key} product={product} index={index} />)}</TableBody></Table></Box>
      <Stack spacing={1.25} sx={{ display: { xs: 'flex', sm: 'none' } }}>{summary.nonCompliantProducts.length === 0 ? <Paper data-testid="report-mobile-nc-empty" variant="outlined" sx={{ p: 1.5 }}><Typography variant="body2" color="text.secondary">No non-compliant products for this store filter.</Typography></Paper> : summary.nonCompliantProducts.map((product, index) => <MobileNonComplianceCard key={product.key} product={product} index={index} />)}</Stack>
    </ReportSection>
  </>;
}

function MobileNonComplianceCard({ product, index }: { product: ConsolidatedProduct; index: number }) {
  return <MobileReportCard
    testId="report-mobile-nc-card"
    title={`${index + 1}. ${product.model || 'Not available'}`}
    status={<Chip label="NC" color="error" size="small" />}
    metrics={[{ label: 'ECP type', value: product.productType || 'Not available' }, { label: 'Brand', value: product.brand || 'Not available' }, { label: 'Description', value: product.findings.join('; ') || 'Non-compliant finding' }, { label: 'Company', value: product.companyName || 'Not available' }]}
  />;
}

function ReportSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <Paper sx={{ p: { xs: 1.5, sm: 2.5 }, overflow: 'hidden' }}><Stack spacing={1.5}><Box><Typography component="h2" variant="h6">{title}</Typography><Typography variant="body2" color="text.secondary">{subtitle}</Typography></Box><TableContainer data-testid="table-scroll-cue" data-scroll-cue="true" sx={{ position: 'relative', overflowX: 'auto', overflowY: 'hidden', pb: 1.5, scrollbarGutter: 'stable', '&::after': { content: '""', position: 'absolute', top: 0, right: 0, bottom: 12, width: 12, pointerEvents: 'none', background: (theme) => `linear-gradient(to left, ${theme.palette.divider}, transparent)` } }}>{children}</TableContainer></Stack></Paper>; }
function ComplianceTableRow({ row }: { row: ComplianceRow }) { return <TableRow><Cell>{row.label}</Cell><Number>{row.models}</Number><Number>{row.labeled}</Number><Number>{row.exempted}</Number><Number>{row.nonCompliant}</Number><Number>{formatRate(row.compliance)}</Number></TableRow>; }
function NcRow({ product, index }: { product: ConsolidatedProduct; index: number }) { return <TableRow><Number>{index + 1}</Number><Cell>{product.productType || 'Not available'}</Cell><Cell>{product.brand || 'Not available'}</Cell><Cell>{product.model || 'Not available'}</Cell><Cell>{product.findings.join('; ') || 'Non-compliant finding'}</Cell><Cell>NC</Cell><Cell>{product.companyName || 'Not available'}</Cell><Cell>{product.companyEmail || 'Not available'}</Cell><Cell>{product.pcrEmail || 'Not available'}</Cell><Cell>{product.findings.includes('Not Registered') ? 'Check/scan QR code' : 'Please check if the model is within the scope'}</Cell></TableRow>; }
function Header({ children }: { children: React.ReactNode }) { return <TableCell sx={{ bgcolor: 'action.hover', fontWeight: 800, minWidth: 140, whiteSpace: 'normal' }}>{children}</TableCell>; }
function Cell({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) { return <TableCell colSpan={colSpan} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{children}</TableCell>; }
function Number({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) { return <TableCell align="right" colSpan={colSpan} sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{children}</TableCell>; }
function TotalRow({ values }: { values: React.ReactNode[] }) { return <TableRow sx={{ '& td': { bgcolor: 'action.hover', fontWeight: 800 } }}>{values.map((value, index) => index === 0 ? <Cell key={index}>{value}</Cell> : <Number key={index}>{value}</Number>)}</TableRow>; }
function formatRate(value: number | null): string { return value === null ? 'N/A' : `${value.toFixed(0)}%`; }
function uniqueStores(inspections: InspectionRecord[]): Array<{ key: string; name: string }> { const seen = new Map<string, string>(); inspections.forEach((inspection) => { const key = text(inspection, ['storeId', 'store_id']) || `${text(inspection, ['storeName', 'store_name'])}|${text(inspection, ['location'])}`; if (key && !seen.has(key)) seen.set(key, text(inspection, ['storeName', 'store_name']) || 'Unnamed store'); }); return Array.from(seen, ([key, name]) => ({ key, name })).sort((left, right) => left.name.localeCompare(right.name)); }
function createDraftFromStore(storeKey: string, inspections: InspectionRecord[]): ReportDraft { const draft = createEmptyReportDraft(storeKey); const store = inspections.find((inspection) => (text(inspection, ['storeId', 'store_id']) || `${text(inspection, ['storeName', 'store_name'])}|${text(inspection, ['location'])}`) === storeKey); return store ? { ...draft, storeName: text(store, ['storeName', 'store_name']), regionProvince: text(store, ['location', 'storeLocation', 'store_location']), updatedAt: new Date().toISOString() } : draft; }
function text(record: Record<string, unknown>, keys: string[]): string { const value = keys.map((key) => record[key]).find((candidate) => typeof candidate === 'string' && candidate.trim()); return typeof value === 'string' ? value.trim() : ''; }
function inspectionStoreKey(record: InspectionRecord): string { return text(record, ['storeId', 'store_id']) || `${text(record, ['storeName', 'store_name'])}|${text(record, ['location'])}`; }
