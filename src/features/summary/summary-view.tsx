'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { MobileReportCard } from '@/components/report/mobile-report-card';
import { InlineNotice, PageHeader, PageShell, Section, Surface } from '@/components/ui';
import { getBrowserRepository } from '@/lib/db/browser';
import { useRepositoryRevision } from '@/lib/db/use-repository-revision';
import type { InspectionRecord } from '@/lib/db/records';
import { buildSummaryCsv, type SummaryCsvData } from '@/features/summary/summary-export';
import { buildReportDiagnostics } from '@/features/report/report-diagnostics';
import { productTypeKey } from '@/features/report/report-model';
import { enrichInspectionsWithActivity } from '@/lib/db/inspection-enrichment';
import { readInspectionField } from '@/lib/db/inspection-fields';
import { normalizeInspectionAnswers } from '@/lib/inspection-outcome';

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
  companyName: string;
  retailPrice: string;
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
  const repositoryRevision = useRepositoryRevision(repository);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [catalogVersion, setCatalogVersion] = useState<number>();
  const [pendingSync, setPendingSync] = useState(0);

  useEffect(() => {
    let active = true;
    void repository.listCompletedInspections()
      .then(async (rows) => {
      const [catalogs, manifest, syncCounts, activities] = await Promise.all([
        repository.getCatalogByIds?.(rows.map((row) => readInspectionField(row, ['catalogId', 'catalog_id', 'productId', 'product_id']) || row.id)) ?? Promise.resolve([]),
        repository.getCatalogManifestState?.('masterlist'),
        repository.getSyncStatusCounts?.(),
        repository.listActivity?.({ limit: 100000 }) ?? Promise.resolve([]),
      ]);
      const catalogById = new Map(catalogs.map((catalog) => [catalog.id, catalog]));
        const enrichedRows = enrichInspectionsWithActivity(rows, activities);
        const catalogEnrichedRows = enrichedRows.map((row) => {
          const catalogId = readInspectionField(row, ['catalogId', 'catalog_id', 'productId', 'product_id']);
          const catalog = catalogId ? catalogById.get(catalogId) : undefined;
          return catalog && !row.dynamic_fields ? { ...row, dynamic_fields: catalog.dynamic_fields } : row;
        });
        if (active) {
          setInspections(catalogEnrichedRows);
          setCatalogVersion(manifest?.version);
          setPendingSync(syncCounts?.pendingCount ?? 0);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => { active = false; };
  }, [repository, repositoryRevision]);

  const products = useMemo(() => {
    const normalized = inspections
      .map(toProductRecord)
      .filter((record) => storeFilter === 'all' || recordStoreName(record) === storeFilter);
    return consolidateProducts(normalized);
  }, [inspections, storeFilter]);
  const filteredInspections = useMemo(
    () => inspections.filter((record) => storeFilter === 'all' || recordStoreName(record) === storeFilter),
    [inspections, storeFilter],
  );
  const diagnostics = useMemo(
    () => buildReportDiagnostics(filteredInspections, { catalogVersion, pendingSync }),
    [catalogVersion, filteredInspections, pendingSync],
  );

  const stores = useMemo(
    () => Array.from(new Set(inspections.map(recordStoreName).filter(Boolean))).sort(),
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
      company: product.companyName || 'Not available',
      retailPrice: product.retailPrice || 'Not available',
      companyEmail: textValue(latest?.companyEmail) || 'Not available',
      pcrEmail: textValue(latest?.pcrEmail) || 'Not available',
      warning: warningFor(description),
    };
  }), [ncProducts]);
  const exportData = useMemo<SummaryCsvData>(() => ({
    storeLabel: storeFilter === 'all' ? 'All finished stores' : storeFilter,
    generatedAt: new Date().toISOString(),
    catalogVersion,
    pendingSync,
    complianceRows,
    breakdownRows,
    emvRows: complianceRows.map((row) => ({ ...row, compliant: row.models - row.nonCompliant })),
    totals: { models: total, labeled: totalLabeled, exempted: totalExempted, nonCompliant: totalNonCompliant, compliant: totalCompliant, compliance: percentage(total, totalNonCompliant) },
    nonCompliantRows,
  }), [breakdownRows, catalogVersion, complianceRows, nonCompliantRows, pendingSync, storeFilter, total, totalCompliant, totalExempted, totalLabeled, totalNonCompliant]);

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

  return <PageShell>
    <PageHeader title="Summary" subtitle={<><span>Consolidated compliance results from completed inspections on this device.</span><span className="block text-xs text-muted">{catalogVersion !== undefined ? `Catalog v${catalogVersion}` : 'Catalog version unavailable'} · {pendingSync} pending sync</span></>} actions={<button type="button" onClick={downloadCsv} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-border-strong px-4 font-semibold text-primary sm:w-auto"><Download aria-hidden="true" className="size-4" />Download CSV</button>} />
    <Surface data-testid="summary-filter-bar" className="sticky top-0 z-10 mb-6 space-y-3 p-4 sm:flex sm:items-center sm:justify-between sm:space-y-0">
      <div><h2 className="font-semibold text-ink">Report filters</h2><p className="text-sm text-muted">Select a finished store or view all stores.</p></div>
      <label className="block text-sm font-medium text-ink">Finished store<select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="mt-1.5 h-12 w-full rounded-control border border-border-strong bg-white px-3 text-base outline-none focus:ring-2 focus:ring-focus sm:min-w-64"><option value="all">All finished stores</option>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
    </Surface>
    <ReportDiagnosticsCard diagnostics={diagnostics} />
    {status === 'error' && <InlineNotice severity="warning">The local report could not be loaded. The zero-filled report is still available; refresh to retry.</InlineNotice>}
    <div className="space-y-8">
      <ReportSection title="Compliance Summary" subtitle="One row per product model and control number. A product is non-compliant when any inspection reports an NC finding.">
        <div className="hidden md:block"><ComplianceTable rows={complianceRows} total={{ models: total, labeled: totalLabeled, exempted: totalExempted, nonCompliant: totalNonCompliant, compliance: percentage(total, totalNonCompliant) }} /></div>
        <div className="space-y-3 md:hidden">{complianceRows.map((row) => <MobileReportCard key={row.typeKey} testId="summary-mobile-compliance-card" title={row.label} compliance={formatPercentage(row.compliance)} metrics={[{ label: 'Product models', value: row.models }, { label: 'Energy labeled', value: row.labeled }, { label: 'COE exempted', value: row.exempted }, { label: 'Non-compliant', value: row.nonCompliant }]} />)}</div>
      </ReportSection>
      <ReportSection title="Non-Compliance Breakdown Summary" subtitle="A product can be counted in more than one finding category when it has multiple NC findings.">
        <div className="hidden md:block"><BreakdownTable rows={breakdownRows} /></div><div className="space-y-3 md:hidden">{breakdownRows.map((row) => <MobileReportCard key={row.typeKey} testId="summary-mobile-breakdown-card" title={row.label} metrics={[{ label: 'Not registered', value: row.notRegistered }, { label: 'No EL/COE', value: row.noDocument }, { label: 'Placement', value: row.placement }, { label: 'Visual quality', value: row.visualQuality }, { label: 'Product details', value: row.productDetails }]} />)}</div>
      </ReportSection>
      <ReportSection title="Summary of EMV Results" subtitle="Copy-friendly totals for the finished store report.">
        <div className="hidden md:block"><EmvTable rows={complianceRows} total={{ compliant: totalCompliant, nonCompliant: totalNonCompliant, labeled: totalLabeled, exempted: totalExempted, models: total, compliance: percentage(total, totalNonCompliant) }} /></div><div className="space-y-3 md:hidden">{complianceRows.map((row) => <MobileReportCard key={row.typeKey} testId="summary-mobile-emv-card" title={row.label} compliance={formatPercentage(row.models > 0 ? percentage(row.models, row.nonCompliant) : null)} metrics={[{ label: 'Compliant', value: row.models - row.nonCompliant }, { label: 'Non-compliant', value: row.nonCompliant }, { label: 'Labeled', value: row.labeled }, { label: 'Exempted', value: row.exempted }, { label: 'Model count', value: row.models }]} />)}</div>
      </ReportSection>
      <ReportSection title="Non-Compliance Results" subtitle="NC products are listed first and consolidated by store, model, and control number.">
        <div className="hidden md:block"><NcTable products={ncProducts} /></div><div className="space-y-3 md:hidden">{ncProducts.length === 0 ? <Surface data-testid="summary-mobile-nc-empty" className="p-4"><p className="text-sm text-muted">No non-compliant products for this store filter.</p></Surface> : ncProducts.map((product, index) => <MobileNonComplianceCard key={product.key} product={product} index={index} />)}</div>
      </ReportSection>
    </div>
    {status === 'ready' && inspections.length === 0 && <p className="mt-4 text-xs text-muted">No completed inspections yet. The report will update automatically after an inspection is saved.</p>}
  </PageShell>;
}

function ReportDiagnosticsCard({ diagnostics }: { diagnostics: ReturnType<typeof buildReportDiagnostics> }) {
  const warnings = [
    diagnostics.missingModelCount && `${diagnostics.missingModelCount} product model${diagnostics.missingModelCount === 1 ? '' : 's'} missing a model code`,
    diagnostics.missingCompanyCount && `${diagnostics.missingCompanyCount} product${diagnostics.missingCompanyCount === 1 ? '' : 's'} missing Company`,
    diagnostics.missingRetailPriceCount && `${diagnostics.missingRetailPriceCount} product${diagnostics.missingRetailPriceCount === 1 ? '' : 's'} missing Retail Price`,
    diagnostics.missingCompanyEmailCount && `${diagnostics.missingCompanyEmailCount} product${diagnostics.missingCompanyEmailCount === 1 ? '' : 's'} missing Company Email`,
    diagnostics.missingPcrEmailCount && `${diagnostics.missingPcrEmailCount} product${diagnostics.missingPcrEmailCount === 1 ? '' : 's'} missing PCR Email`,
  ].filter((value): value is string => Boolean(value));
  return <Surface className="mb-6 space-y-2 p-4">
      <h2 className="font-semibold text-ink">Report diagnostics</h2>
      <p className="text-sm text-muted">{diagnostics.inspectionCount.toLocaleString()} completed inspections → {diagnostics.productCount.toLocaleString()} consolidated product models · {diagnostics.nonCompliantCount.toLocaleString()} NC inspection records</p>
      <p className="text-xs text-muted">Generated {new Date(diagnostics.generatedAt).toLocaleString()} · {diagnostics.catalogVersion === undefined ? 'Catalog version unavailable' : `Catalog v${diagnostics.catalogVersion}`} · {diagnostics.pendingSync} pending sync</p>
      {warnings.length > 0 ? <InlineNotice severity="warning">Export review: {warnings.join(' · ')}.</InlineNotice> : <InlineNotice severity="success">All tracked export fields are populated.</InlineNotice>}
  </Surface>;
}

function MobileNonComplianceCard({ product, index }: { product: Product; index: number }) {
  const latest = product.records[0];
  return <MobileReportCard
    testId="summary-mobile-nc-card"
    title={`${index + 1}. ${product.model || 'Not available'}`}
    status={<span className="rounded-lg bg-danger-soft px-2 py-1 text-xs font-semibold text-danger">NC</span>}
    metrics={[
      { label: 'ECP type', value: product.productType || 'Not available' },
      { label: 'Brand', value: textValue(latest?.brand) || 'Not available' },
      { label: 'Description', value: findingDescription(product.records) },
      { label: 'Company', value: product.companyName || 'Not available' },
    ]}
  />;
}

function ReportSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <Section title={title}>
    <div className="space-y-3">
      <p className="text-sm text-muted">{subtitle}</p>
      {children}
    </div>
  </Section>;
}

function ComplianceTable({ rows, total }: { rows: ReportRow[]; total: Omit<ReportRow, 'typeKey' | 'label'> }) {
  return <DataTable ariaLabel="Compliance summary table" headers={['Types of ECPs (A)', 'Number of Product Models (B)', 'Product Models with Energy Label (C)', 'Product Models with Certificate of Exemption (D)', 'Non-Compliant Product Models', 'Compliance Percentage (%)']} rows={[...rows.map((row) => [row.label, row.models, row.labeled, row.exempted, row.nonCompliant, formatPercentage(row.compliance)]), ['Total:', total.models, total.labeled, total.exempted, total.nonCompliant, formatPercentage(total.compliance)]]} />;
}

function BreakdownTable({ rows }: { rows: BreakdownRow[] }) {
  const total = {
    notRegistered: sum(rows, (row) => row.notRegistered),
    noDocument: sum(rows, (row) => row.noDocument),
    placement: sum(rows, (row) => row.placement),
    visualQuality: sum(rows, (row) => row.visualQuality),
    productDetails: sum(rows, (row) => row.productDetails),
  };
  return <DataTable ariaLabel="Non-compliance breakdown table" headers={['Types of ECPs', 'Not Registered', 'Registered but no EL/COE', 'Placement', 'Visual Quality', 'Product Details']} rows={[...rows.map((row) => [row.label, row.notRegistered, row.noDocument, row.placement, row.visualQuality, row.productDetails]), ['Total:', total.notRegistered, total.noDocument, total.placement, total.visualQuality, total.productDetails]]} />;
}

function EmvTable({ rows, total }: { rows: ReportRow[]; total: { compliant: number; nonCompliant: number; labeled: number; exempted: number; models: number; compliance: number | null } }) {
  return <DataTable ariaLabel="EMV results summary table" headers={['Types of ECPs', 'Compliant Models', 'Non-Compliant Models', 'Labeled Models', 'Exempted Models', 'Model Count']} rows={[...rows.map((row) => [row.label, row.models - row.nonCompliant, row.nonCompliant, row.labeled, row.exempted, row.models]), ['Total', total.compliant, total.nonCompliant, total.labeled, total.exempted, total.models], ['Compliance Rate', formatPercentage(total.compliance), '', '', '', '']]} />;
}

function NcTable({ products }: { products: Product[] }) {
    const rows = products.length === 0 ? [['No non-compliant products for this store filter.']] : products.map((product, index) => {
        const latest = product.records[0];
        const description = findingDescription(product.records);
        return [index + 1, product.productType || 'Not available', textValue(latest.brand) || 'Not available', product.model || 'Not available', description, 'NC', product.companyName || 'Not available', textValue(latest.companyEmail) || 'Not available', textValue(latest.pcrEmail) || 'Not available', warningFor(description)];
      });
  return <DataTable ariaLabel="Non-compliance results table" testId="summary-nc-table" headers={['No.', 'ECP Type', 'Brand Name', 'Model Code', 'Description of Non-Compliance', 'Status', 'Company', 'Company Email', 'PCR Email', 'Warning']} rows={rows} />;
}

function DataTable({ ariaLabel, headers, rows, testId }: { ariaLabel: string; headers: string[]; rows: React.ReactNode[][]; testId?: string }) {
  return <div data-testid="table-scroll-cue" data-scroll-cue="true" className="relative overflow-x-auto pb-3"><table data-testid={testId} data-sticky-first-column={testId === 'summary-nc-table' ? 'true' : undefined} aria-label={ariaLabel} className="min-w-[820px] border-collapse text-left text-sm"><thead className="bg-surface-alt"><tr>{headers.map((header, index) => <th key={header} scope="col" className={`px-2 py-2 font-semibold text-ink ${index === 0 ? 'sticky left-0 z-20 w-12 border-r-2 border-border-strong bg-surface-alt' : ''}`}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-border last:border-0">{headers.map((_, index) => <td key={index} className={`max-w-[260px] whitespace-normal break-words px-2 py-2 align-top text-ink ${index === 0 ? 'sticky left-0 z-10 border-r-2 border-border-strong bg-white font-semibold' : ''} ${typeof row[index] === 'number' ? 'tabular-nums text-right' : ''}`}>{row[index] ?? ''}</td>)}</tr>)}</tbody></table></div>;
}

function toProductRecord(record: InspectionRecord): InspectionRecord {
  return { ...record, ...normalizeInspectionAnswers(record) };
}

function consolidateProducts(records: InspectionRecord[]): Product[] {
  const grouped = new Map<string, InspectionRecord[]>();
  records.forEach((record) => {
    const store = textValue(record.storeId) || `${recordStoreName(record)}|${recordLocation(record)}`;
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
      storeName: recordStoreName(latest) || 'Store not recorded',
      controlNumber: textValue(latest.controlNumber),
      model: textValue(latest.model) || textValue(latest.modelNumber),
      productType: textValue(latest.productType) || textValue(latest.ecpType),
      typeKey: productTypeKey(textValue(latest.productType) || textValue(latest.ecpType)),
      records: ordered,
      nonCompliant: findings,
      hasLabel: ordered.some((record) => textValue(record.labeling) === 'with_label'),
      hasCoe: ordered.some((record) => textValue(record.labeling) === 'with_coe'),
      companyName: catalogFieldText(latest, ['companyName', 'company_name', 'company', 'Company Name', 'Company']) || textValue(latest.companyName),
      retailPrice: catalogFieldText(latest, ['retailPrice', 'retail_price', 'Retail Price', 'Latest Average Price', 'latestAveragePrice']),
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

function isNonCompliant(record: InspectionRecord): boolean {
  return normalizeInspectionAnswers(record).outcome === 'non_compliant';
}

function textValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function recordStoreName(record: InspectionRecord): string {
  return textValue(record.storeName) || textValue(record.store_name);
}

function recordLocation(record: InspectionRecord): string {
  return textValue(record.location) || textValue(record.storeLocation) || textValue(record.store_location);
}

function catalogFieldText(record: InspectionRecord | undefined, keys: string[]): string {
  if (!record) return '';
  return readInspectionField(record, keys);
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
