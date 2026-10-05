'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { DownloadRounded } from '@mui/icons-material';
import { getBrowserRepository } from '@/lib/db/browser';
import type { InspectionRecord } from '@/lib/db/records';
import { fadeUp } from '@/lib/animation/gsap';
import { buildSummaryCsv, type SummaryCsvData } from '@/features/summary/summary-export';

const ECP_TYPES = [
  { key: 'air-conditioner', label: 'Air-conditioner' },
  { key: 'refrigerating-appliance', label: 'Refrigerating Appliances' },
  { key: 'television-set', label: 'Television Sets' },
  { key: 'lighting-product', label: 'Lighting Products' },
  { key: 'energy-saving-device', label: 'Energy Saving Device' },
] as const;

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
};

type ReportRow = {
  typeKey: string;
  label: string;
  models: number;
  labeled: number;
  exempted: number;
  nonCompliant: number;
  compliance: number | null;
};

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
  const contentRef = useRef<HTMLDivElement>(null);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useLayoutEffect(() => fadeUp(contentRef.current), []);

  useEffect(() => {
    let active = true;
    void repository.listCompletedInspections(500)
      .then((rows) => {
        if (active) {
          setInspections(rows);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => { active = false; };
  }, [repository]);

  const products = useMemo(() => {
    const normalized = inspections
      .map(toProductRecord)
      .filter((record) => storeFilter === 'all' || record.storeName === storeFilter);
    return consolidateProducts(normalized);
  }, [inspections, storeFilter]);

  const stores = useMemo(
    () => Array.from(new Set(inspections.map((inspection) => textValue(inspection.storeName)).filter(Boolean))).sort(),
    [inspections],
  );
  const complianceRows = useMemo(() => createComplianceRows(products), [products]);
  const breakdownRows = useMemo(() => createBreakdownRows(products), [products]);
  const ncProducts = useMemo(() => products.filter((product) => product.nonCompliant), [products]);
  const total = sum(complianceRows, (row) => row.models);
  const totalNonCompliant = sum(complianceRows, (row) => row.nonCompliant);
  const totalCompliant = Math.max(0, total - totalNonCompliant);
  const totalLabeled = sum(complianceRows, (row) => row.labeled);
  const totalExempted = sum(complianceRows, (row) => row.exempted);
  const nonCompliantRows = useMemo(() => ncProducts.map((product, index) => {
    const latest = product.records[0];
    const description = findingDescription(product.records);
    return {
      no: index + 1,
      ecpType: product.productType || 'Not available',
      brandName: textValue(latest?.brand) || 'Not available',
      modelCode: product.model || 'Not available',
      description,
      status: 'NC',
      company: textValue(latest?.companyName) || 'Not available',
      companyEmail: textValue(latest?.companyEmail) || 'Not available',
      pcrEmail: textValue(latest?.pcrEmail) || 'Not available',
      warning: warningFor(description),
    };
  }), [ncProducts]);
  const exportData = useMemo<SummaryCsvData>(() => ({
    storeLabel: storeFilter === 'all' ? 'All finished stores' : storeFilter,
    complianceRows,
    breakdownRows,
    emvRows: complianceRows.map((row) => ({ ...row, compliant: row.models - row.nonCompliant })),
    totals: { models: total, labeled: totalLabeled, exempted: totalExempted, nonCompliant: totalNonCompliant, compliant: totalCompliant, compliance: percentage(total, totalNonCompliant) },
    nonCompliantRows,
  }), [breakdownRows, complianceRows, nonCompliantRows, storeFilter, total, totalCompliant, totalExempted, totalLabeled, totalNonCompliant]);

  const downloadCsv = () => {
    const blob = new Blob([buildSummaryCsv(exportData)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pelp-pal-summary-${fileSlug(exportData.storeLabel)}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Container ref={contentRef} maxWidth="xl" sx={{ px: { xs: 2, sm: 3, md: 4 }, py: { xs: 3, md: 5 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'flex-start' }} justifyContent="space-between" sx={{ mb: { xs: 3, md: 4 } }}>
        <Stack spacing={0.75}>
          <Typography variant="overline" color="primary.main" sx={{ fontWeight: 800, letterSpacing: '0.1em' }}>
            Local report
          </Typography>
          <Typography component="h1" variant="h4" sx={{ fontSize: { xs: '1.8rem', sm: '2.125rem' } }}>
            Summary
          </Typography>
          <Typography color="text.secondary">
            Consolidated compliance results from completed inspections on this device.
          </Typography>
        </Stack>
        <Button variant="outlined" startIcon={<DownloadRounded />} onClick={downloadCsv} sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}>
          Download CSV
        </Button>
      </Stack>

      <Paper elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, mb: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
          <Box>
            <Typography variant="h6">Report filters</Typography>
            <Typography variant="body2" color="text.secondary">
              Select a finished store or view the consolidated report for all stores.
            </Typography>
          </Box>
          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 280 } }}>
            <InputLabel id="summary-store-filter-label">Finished store</InputLabel>
            <Select
              labelId="summary-store-filter-label"
              label="Finished store"
              value={storeFilter}
              onChange={(event) => setStoreFilter(event.target.value)}
            >
              <MenuItem value="all">All finished stores</MenuItem>
              {stores.map((store) => <MenuItem key={store} value={store}>{store}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {status === 'error' && <Alert severity="error" sx={{ mb: 3 }}>The local report could not be loaded. The zero-filled report is still available; refresh to retry.</Alert>}

      <Stack spacing={3}>
        <ReportSection title="Compliance Summary" subtitle="One row per product model and control number. A product is non-compliant when any inspection reports an NC finding.">
          <ComplianceTable rows={complianceRows} total={{ models: total, labeled: totalLabeled, exempted: totalExempted, nonCompliant: totalNonCompliant, compliance: percentage(total, totalNonCompliant) }} />
        </ReportSection>

        <ReportSection title="Non-Compliance Breakdown Summary" subtitle="A product can be counted in more than one finding category when it has multiple NC findings.">
          <BreakdownTable rows={breakdownRows} />
        </ReportSection>

        <ReportSection title="Summary of EMV Results" subtitle="Copy-friendly totals for the finished store report.">
          <EmvTable rows={complianceRows} total={{ compliant: totalCompliant, nonCompliant: totalNonCompliant, labeled: totalLabeled, exempted: totalExempted, models: total, compliance: percentage(total, totalNonCompliant) }} />
        </ReportSection>

        <ReportSection title="Non-Compliance Results" subtitle="NC products are listed first and consolidated by store, model, and control number.">
          <NcTable products={ncProducts} />
        </ReportSection>
      </Stack>

      {status === 'ready' && inspections.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          No completed inspections yet. The report will update automatically after an inspection is saved.
        </Typography>
      )}
    </Container>
  );
}

function ReportSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 2 }}>
    <Stack spacing={1.5}>
      <Box>
        <Typography component="h2" variant="h6">{title}</Typography>
        <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
      </Box>
      {children}
    </Stack>
  </Paper>;
}

function ComplianceTable({ rows, total }: { rows: ReportRow[]; total: Omit<ReportRow, 'typeKey' | 'label'> }) {
  return <ReportTable ariaLabel="Compliance summary table" minWidth={850}>
    <TableHead><TableRow>
      <HeaderCell>Types of ECPs (A)</HeaderCell>
      <HeaderCell align="right">Number of Product Models (B)</HeaderCell>
      <HeaderCell align="right">Product Models with Energy Label (C)</HeaderCell>
      <HeaderCell align="right">Product Models with Certificate of Exemption (D)</HeaderCell>
      <HeaderCell align="right">Non-Compliant Product Models</HeaderCell>
      <HeaderCell align="right">Compliance Percentage (%)</HeaderCell>
    </TableRow></TableHead>
    <TableBody>
      {rows.map((row) => <TableRow key={row.typeKey}><BodyCell>{row.label}</BodyCell><NumberCell>{row.models}</NumberCell><NumberCell>{row.labeled}</NumberCell><NumberCell>{row.exempted}</NumberCell><NumberCell>{row.nonCompliant}</NumberCell><NumberCell>{formatPercentage(row.compliance)}</NumberCell></TableRow>)}
      <TotalRow><BodyCell>Total:</BodyCell><NumberCell>{total.models}</NumberCell><NumberCell>{total.labeled}</NumberCell><NumberCell>{total.exempted}</NumberCell><NumberCell>{total.nonCompliant}</NumberCell><NumberCell>{formatPercentage(total.compliance)}</NumberCell></TotalRow>
    </TableBody>
  </ReportTable>;
}

function BreakdownTable({ rows }: { rows: BreakdownRow[] }) {
  const total = {
    notRegistered: sum(rows, (row) => row.notRegistered),
    noDocument: sum(rows, (row) => row.noDocument),
    placement: sum(rows, (row) => row.placement),
    visualQuality: sum(rows, (row) => row.visualQuality),
    productDetails: sum(rows, (row) => row.productDetails),
  };
  return <ReportTable ariaLabel="Non-compliance breakdown table" minWidth={820}>
    <TableHead><TableRow>
      <HeaderCell>Types of ECPs</HeaderCell>
      <HeaderCell align="right">Not Registered</HeaderCell>
      <HeaderCell align="right">Registered but no EL/COE</HeaderCell>
      <HeaderCell align="right">Placement</HeaderCell>
      <HeaderCell align="right">Visual Quality</HeaderCell>
      <HeaderCell align="right">Product Details</HeaderCell>
    </TableRow></TableHead>
    <TableBody>
      {rows.map((row) => <TableRow key={row.typeKey}><BodyCell>{row.label}</BodyCell><NumberCell>{row.notRegistered}</NumberCell><NumberCell>{row.noDocument}</NumberCell><NumberCell>{row.placement}</NumberCell><NumberCell>{row.visualQuality}</NumberCell><NumberCell>{row.productDetails}</NumberCell></TableRow>)}
      <TotalRow><BodyCell>Total:</BodyCell><NumberCell>{total.notRegistered}</NumberCell><NumberCell>{total.noDocument}</NumberCell><NumberCell>{total.placement}</NumberCell><NumberCell>{total.visualQuality}</NumberCell><NumberCell>{total.productDetails}</NumberCell></TotalRow>
    </TableBody>
  </ReportTable>;
}

function EmvTable({ rows, total }: { rows: ReportRow[]; total: { compliant: number; nonCompliant: number; labeled: number; exempted: number; models: number; compliance: number | null } }) {
  return <ReportTable ariaLabel="EMV results summary table" minWidth={720}>
    <TableHead><TableRow>
      <HeaderCell>Types of ECPs</HeaderCell>
      <HeaderCell align="right">Compliant Models</HeaderCell>
      <HeaderCell align="right">Non-Compliant Models</HeaderCell>
      <HeaderCell align="right">Labeled Models</HeaderCell>
      <HeaderCell align="right">Exempted Models</HeaderCell>
      <HeaderCell align="right">Model Count</HeaderCell>
    </TableRow></TableHead>
    <TableBody>
      {rows.map((row) => <TableRow key={row.typeKey}><BodyCell>{row.label}</BodyCell><NumberCell>{row.models - row.nonCompliant}</NumberCell><NumberCell>{row.nonCompliant}</NumberCell><NumberCell>{row.labeled}</NumberCell><NumberCell>{row.exempted}</NumberCell><NumberCell>{row.models}</NumberCell></TableRow>)}
      <TotalRow><BodyCell>Total</BodyCell><NumberCell>{total.compliant}</NumberCell><NumberCell>{total.nonCompliant}</NumberCell><NumberCell>{total.labeled}</NumberCell><NumberCell>{total.exempted}</NumberCell><NumberCell>{total.models}</NumberCell></TotalRow>
      <TableRow><BodyCell>Compliance Rate</BodyCell><NumberCell colSpan={5}>{formatPercentage(total.compliance)}</NumberCell></TableRow>
    </TableBody>
  </ReportTable>;
}

function NcTable({ products }: { products: Product[] }) {
  return <ReportTable ariaLabel="Non-compliance results table" minWidth={1050}>
    <TableHead><TableRow>
      <HeaderCell>No.</HeaderCell><HeaderCell>ECP Type</HeaderCell><HeaderCell>Brand Name</HeaderCell><HeaderCell>Model Code</HeaderCell><HeaderCell>Description of Non-Compliance</HeaderCell><HeaderCell>Status</HeaderCell><HeaderCell>Company</HeaderCell><HeaderCell>Company Email</HeaderCell><HeaderCell>PCR Email</HeaderCell><HeaderCell>Warning</HeaderCell>
    </TableRow></TableHead>
    <TableBody>
      {products.length === 0 ? <TableRow><BodyCell colSpan={10}><Typography variant="body2" color="text.secondary">No non-compliant products for this store filter.</Typography></BodyCell></TableRow> : products.map((product, index) => {
        const latest = product.records[0];
        const description = findingDescription(product.records);
        return <TableRow key={product.key} sx={{ '& td': { verticalAlign: 'top' } }}>
          <NumberCell>{index + 1}</NumberCell>
          <BodyCell>{product.productType || 'Not available'}</BodyCell>
          <BodyCell>{textValue(latest.brand) || 'Not available'}</BodyCell>
          <BodyCell>{product.model || 'Not available'}</BodyCell>
          <BodyCell>{description}</BodyCell>
          <BodyCell><Chip label="NC" color="error" size="small" /></BodyCell>
          <BodyCell>{textValue(latest.companyName) || 'Not available'}</BodyCell>
          <BodyCell>{textValue(latest.companyEmail) || 'Not available'}</BodyCell>
          <BodyCell>{textValue(latest.pcrEmail) || 'Not available'}</BodyCell>
          <BodyCell>{warningFor(description)}</BodyCell>
        </TableRow>;
      })}
    </TableBody>
  </ReportTable>;
}

function ReportTable({ ariaLabel, minWidth, children }: { ariaLabel: string; minWidth: number; children: React.ReactNode }) {
  return <TableContainer
    data-testid="table-scroll-container"
    sx={{
      overflowX: 'auto',
      overflowY: 'hidden',
      pb: 1.5,
      scrollbarGutter: 'stable',
    }}
  >
    <Table aria-label={ariaLabel} size="small" sx={{ minWidth }}>{children}</Table>
  </TableContainer>;
}

function HeaderCell({ children, align }: { children: React.ReactNode; align?: 'right' | 'left' }) {
  return <TableCell align={align} sx={{ bgcolor: 'action.hover', fontWeight: 800, whiteSpace: 'normal', minWidth: align === 'right' ? 150 : 180 }}>{children}</TableCell>;
}

function BodyCell({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <TableCell colSpan={colSpan} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{children}</TableCell>;
}

function NumberCell({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <TableCell align="right" colSpan={colSpan} sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{children}</TableCell>;
}

function TotalRow({ children }: { children: React.ReactNode }) {
  return <TableRow sx={{ '& td': { bgcolor: 'action.hover', fontWeight: 800 } }}>{children}</TableRow>;
}

function toProductRecord(record: InspectionRecord): InspectionRecord {
  return record;
}

function consolidateProducts(records: InspectionRecord[]): Product[] {
  const grouped = new Map<string, InspectionRecord[]>();
  records.forEach((record) => {
    const store = textValue(record.storeId) || `${textValue(record.storeName)}|${textValue(record.location)}`;
    const control = textValue(record.controlNumber);
    const model = textValue(record.model) || textValue(record.modelNumber);
    const key = `${store}|${control || model || record.id}`.toLowerCase();
    const current = grouped.get(key) ?? [];
    current.push(record);
    grouped.set(key, current);
  });

  return Array.from(grouped.entries()).map(([key, groupedRecords]) => {
    const ordered = [...groupedRecords].sort((left, right) => timestamp(right).localeCompare(timestamp(left)));
    const latest = ordered[0];
    const findings = ordered.some(isNonCompliant);
    return {
      key,
      storeName: textValue(latest.storeName) || 'Store not recorded',
      controlNumber: textValue(latest.controlNumber),
      model: textValue(latest.model) || textValue(latest.modelNumber),
      productType: textValue(latest.productType) || textValue(latest.ecpType),
      typeKey: productTypeKey(textValue(latest.productType) || textValue(latest.ecpType)),
      records: ordered,
      nonCompliant: findings,
      hasLabel: ordered.some((record) => textValue(record.labeling) === 'with_label'),
      hasCoe: ordered.some((record) => textValue(record.labeling) === 'with_coe'),
    };
  }).sort((left, right) => Number(right.nonCompliant) - Number(left.nonCompliant) || right.key.localeCompare(left.key));
}

function createComplianceRows(products: Product[]): ReportRow[] {
  return ECP_TYPES.map((type) => {
    const matching = products.filter((product) => product.typeKey === type.key);
    const models = matching.length;
    const nonCompliant = matching.filter((product) => product.nonCompliant).length;
    return { typeKey: type.key, label: type.label, models, labeled: matching.filter((product) => product.hasLabel).length, exempted: matching.filter((product) => product.hasCoe).length, nonCompliant, compliance: percentage(models, nonCompliant) };
  });
}

function createBreakdownRows(products: Product[]): BreakdownRow[] {
  return ECP_TYPES.map((type) => {
    const matching = products.filter((product) => product.typeKey === type.key && product.nonCompliant);
    return {
      typeKey: type.key,
      label: type.label,
      notRegistered: matching.filter((product) => product.records.some((record) => textValue(record.labeling) === 'not_registered')).length,
      noDocument: matching.filter((product) => product.records.some((record) => textValue(record.labeling) === 'registered_only')).length,
      placement: matching.filter((product) => product.records.some((record) => textValue(record.placement) === 'failing')).length,
      visualQuality: matching.filter((product) => product.records.some((record) => textValue(record.visualQuality) === 'failing')).length,
      productDetails: matching.filter((product) => product.records.some((record) => textValue(record.productDetails) === 'failing')).length,
    };
  });
}

function findingDescription(records: InspectionRecord[]): string {
  const findings = new Set<string>();
  records.forEach((record) => {
    if (textValue(record.labeling) === 'not_registered') findings.add('Not Registered');
    if (textValue(record.labeling) === 'registered_only') findings.add('Registered but no EL/COE');
    if (textValue(record.placement) === 'failing') findings.add('Placement');
    if (textValue(record.visualQuality) === 'failing') findings.add('Visual Quality');
    if (textValue(record.productDetails) === 'failing') findings.add('Product Details');
    if (textValue(record.remarks)) findings.add(textValue(record.remarks));
  });
  return Array.from(findings).join('; ') || 'Non-compliant finding';
}

function warningFor(description: string): string {
  if (description.includes('Not Registered')) return 'Check/scan QR code';
  if (description.includes('EL/COE')) return 'Please check if the model is within the scope';
  return 'Review non-compliant finding';
}

function productTypeKey(value: string): string {
  const normalized = value.toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ').replace(/\s+/g, ' ').trim();
  if (normalized.includes('air condition') || normalized === 'acu') return 'air-conditioner';
  if (normalized.includes('refrigerat') || normalized === 'ref') return 'refrigerating-appliance';
  if (normalized.includes('television') || normalized === 'tvl') return 'television-set';
  if (normalized.includes('lighting') || normalized.includes('led lamp') || normalized === 'led') return 'lighting-product';
  if (normalized.includes('energy saving') || normalized === 'esd') return 'energy-saving-device';
  return normalized;
}

function isNonCompliant(record: InspectionRecord): boolean {
  return textValue(record.outcome) === 'non_compliant'
    || textValue(record.labeling) === 'not_registered'
    || textValue(record.labeling) === 'registered_only'
    || [record.placement, record.visualQuality, record.productDetails].some((value) => textValue(value) === 'failing');
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(record: InspectionRecord): string {
  return textValue(record.completedAt) || textValue(record.updatedAt);
}

function percentage(models: number, nonCompliant: number): number | null {
  return models > 0 ? ((models - nonCompliant) / models) * 100 : null;
}

function formatPercentage(value: number | null): string {
  return value === null ? 'N/A' : `${value.toFixed(0)}%`;
}

function sum<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}

function fileSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all-stores';
}
