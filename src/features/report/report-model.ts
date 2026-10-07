import type { InspectionRecord } from '@/lib/db/records';
import { readInspectionField } from '@/lib/db/inspection-fields';

export const ECP_TYPES = [
  { typeKey: 'air-conditioner', label: 'Air-conditioner' },
  { typeKey: 'refrigerating-appliance', label: 'Refrigerating Appliances' },
  { typeKey: 'television-set', label: 'Television Sets' },
  { typeKey: 'lighting-product', label: 'Lighting Products' },
  { typeKey: 'energy-saving-device', label: 'Energy Saving Device' },
] as const;

export type ConsolidatedProduct = {
  key: string;
  storeKey: string;
  storeName: string;
  location: string;
  controlNumber: string;
  brand: string;
  model: string;
  productType: string;
  typeKey: string;
  records: InspectionRecord[];
  nonCompliant: boolean;
  hasLabel: boolean;
  hasCoe: boolean;
  findings: string[];
  companyName: string;
  companyEmail: string;
  pcrEmail: string;
};

export type ComplianceRow = {
  typeKey: string;
  label: string;
  models: number;
  labeled: number;
  exempted: number;
  nonCompliant: number;
  compliance: number | null;
};

export type BreakdownRow = {
  typeKey: string;
  label: string;
  notRegistered: number;
  noDocument: number;
  placement: number;
  visualQuality: number;
  productDetails: number;
};

export type ReportSummary = {
  complianceRows: ComplianceRow[];
  breakdownRows: BreakdownRow[];
  emvRows: Array<ComplianceRow & { compliant: number }>;
  totals: {
    models: number;
    labeled: number;
    exempted: number;
    nonCompliant: number;
    compliant: number;
    compliance: number | null;
  };
  nonCompliantProducts: ConsolidatedProduct[];
};

export function consolidateReportProducts(inspections: InspectionRecord[], storeKey?: string): ConsolidatedProduct[] {
  const grouped = new Map<string, InspectionRecord[]>();
  for (const inspection of inspections) {
    const currentStoreKey = firstText(inspection, ['storeId', 'store_id']) || `${firstText(inspection, ['storeName', 'store_name'])}|${firstText(inspection, ['location', 'storeLocation', 'store_location'])}`;
    if (storeKey && currentStoreKey !== storeKey) continue;
    const controlNumber = firstText(inspection, ['controlNumber', 'control_number', 'productControlNumber', 'product_control_number']);
    const model = firstText(inspection, ['model', 'modelNumber', 'model_number', 'modelNumberCode', 'model_number_code']);
    const key = `${currentStoreKey}|${controlNumber || model || inspection.id}`.toLowerCase();
    grouped.set(key, [...(grouped.get(key) ?? []), inspection]);
  }

  return Array.from(grouped.entries()).map(([key, records]) => {
    const ordered = [...records].sort((left, right) => timestamp(right).localeCompare(timestamp(left)));
    const latest = ordered[0] ?? records[0];
    const productType = firstText(latest, ['productType', 'product_type', 'ecpType', 'ecp_type', 'type']);
    const findings = getFindings(ordered);
    return {
      key,
      storeKey: firstText(latest, ['storeId', 'store_id']) || `${firstText(latest, ['storeName', 'store_name'])}|${firstText(latest, ['location', 'storeLocation', 'store_location'])}`,
      storeName: firstText(latest, ['storeName', 'store_name']) || 'Store not recorded',
      location: firstText(latest, ['location', 'storeLocation', 'store_location']),
      controlNumber: firstText(latest, ['controlNumber', 'control_number', 'productControlNumber', 'product_control_number']),
      brand: firstText(latest, ['brand', 'brandName', 'brand_name']),
      model: firstText(latest, ['model', 'modelNumber', 'model_number', 'modelNumberCode', 'model_number_code']),
      productType,
      typeKey: productTypeKey(productType),
      records: ordered,
      nonCompliant: ordered.some(isNonCompliant),
      hasLabel: ordered.some((record) => firstText(record, ['labeling', 'label_status', 'labelStatus']) === 'with_label'),
      hasCoe: ordered.some((record) => firstText(record, ['labeling', 'label_status', 'labelStatus']) === 'with_coe'),
      findings,
      companyName: readInspectionField(latest, ['companyName', 'company_name', 'company', 'Company Name', 'Company']),
      companyEmail: readInspectionField(latest, ['companyEmail', 'company_email', 'Company Email']),
      pcrEmail: readInspectionField(latest, ['pcrEmail', 'pcr_email', 'PCR Email']),
    };
  }).sort((left, right) => Number(right.nonCompliant) - Number(left.nonCompliant) || left.storeName.localeCompare(right.storeName) || left.key.localeCompare(right.key));
}

export function buildReportSummary(products: ConsolidatedProduct[]): ReportSummary {
  const complianceRows = ECP_TYPES.map((type) => {
    const matching = products.filter((product) => product.typeKey === type.typeKey);
    const models = matching.length;
    const nonCompliant = matching.filter((product) => product.nonCompliant).length;
    return {
      typeKey: type.typeKey,
      label: type.label,
      models,
      labeled: matching.filter((product) => product.hasLabel).length,
      exempted: matching.filter((product) => product.hasCoe).length,
      nonCompliant,
      compliance: percentage(models, nonCompliant),
    };
  });
  const breakdownRows = ECP_TYPES.map((type) => {
    const matching = products.filter((product) => product.typeKey === type.typeKey && product.nonCompliant);
    return {
      typeKey: type.typeKey,
      label: type.label,
      notRegistered: matching.filter((product) => product.findings.includes('Not Registered')).length,
      noDocument: matching.filter((product) => product.findings.includes('Registered but no EL/COE')).length,
      placement: matching.filter((product) => product.findings.includes('Placement')).length,
      visualQuality: matching.filter((product) => product.findings.includes('Visual Quality')).length,
      productDetails: matching.filter((product) => product.findings.includes('Product Details')).length,
    };
  });
  const totals = {
    models: sum(complianceRows, (row) => row.models),
    labeled: sum(complianceRows, (row) => row.labeled),
    exempted: sum(complianceRows, (row) => row.exempted),
    nonCompliant: sum(complianceRows, (row) => row.nonCompliant),
    compliant: 0,
    compliance: null as number | null,
  };
  totals.compliant = totals.models - totals.nonCompliant;
  totals.compliance = percentage(totals.models, totals.nonCompliant);
  return {
    complianceRows,
    breakdownRows,
    emvRows: complianceRows.map((row) => ({ ...row, compliant: row.models - row.nonCompliant })),
    totals,
    nonCompliantProducts: products.filter((product) => product.nonCompliant),
  };
}

export function productTypeKey(value: string): string {
  const normalized = value.toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ').replace(/\s+/g, ' ').trim();
  if (normalized.includes('air condition') || normalized === 'acu' || normalized === 'ac' || normalized.includes('aircon')) return 'air-conditioner';
  if (normalized.includes('refrigerat') || normalized === 'ref' || normalized === 'refrigerating appliance') return 'refrigerating-appliance';
  if (normalized.includes('television') || normalized === 'tvl' || normalized === 'tv') return 'television-set';
  if (normalized.includes('lighting') || normalized.includes('fluorescent lamp') || normalized.includes('led lamp') || ['cfl', 'led', 'lamp'].includes(normalized)) return 'lighting-product';
  if (normalized.includes('energy saving')
    || normalized.includes('energy efficient device')
    || normalized.includes('washing machine')
    || normalized.includes('display monitor')
    || normalized.includes('electric fan')
    || ['cwm', 'dmu', 'efu', 'esd', 'monitors', 'fans'].includes(normalized)) return 'energy-saving-device';
  return normalized;
}

function getFindings(records: InspectionRecord[]): string[] {
  const findings = new Set<string>();
  for (const record of records) {
    const labeling = firstText(record, ['labeling', 'label_status', 'labelStatus']);
    if (labeling === 'not_registered') findings.add('Not Registered');
    if (labeling === 'registered_only') findings.add('Registered but no EL/COE');
    if (isNcValue(firstText(record, ['placement']))) findings.add('Placement');
    if (isNcValue(firstText(record, ['visualQuality', 'visual_quality']))) findings.add('Visual Quality');
    if (isNcValue(firstText(record, ['productDetails', 'product_details']))) findings.add('Product Details');
    const remarks = firstText(record, ['remarks', 'notes']);
    if (remarks) findings.add(remarks);
  }
  return Array.from(findings);
}

function isNonCompliant(record: InspectionRecord): boolean {
  return firstText(record, ['outcome', 'compliance', 'complianceStatus', 'compliance_status']) === 'non_compliant'
    || getFindings([record]).some((finding) => ['Not Registered', 'Registered but no EL/COE', 'Placement', 'Visual Quality', 'Product Details'].includes(finding));
}

function isNcValue(value: string): boolean {
  const normalized = value.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  return normalized === 'failing' || normalized === 'nc' || normalized === 'non_compliant';
}

function firstText(record: Record<string, unknown>, keys: string[]): string {
  const value = keys.map((key) => record[key]).find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(record: InspectionRecord): string {
  return firstText(record, ['completedAt', 'completed_at', 'updatedAt', 'updated_at', 'server_created_at']);
}

function percentage(models: number, nonCompliant: number): number | null {
  return models > 0 ? ((models - nonCompliant) / models) * 100 : null;
}

function sum<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}
