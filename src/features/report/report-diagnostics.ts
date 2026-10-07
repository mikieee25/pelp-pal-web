import type { InspectionRecord } from '@/lib/db/records';
import { readInspectionField } from '@/lib/db/inspection-fields';

export type ReportDiagnostics = {
  inspectionCount: number;
  productCount: number;
  nonCompliantCount: number;
  missingModelCount: number;
  missingCompanyCount: number;
  missingRetailPriceCount: number;
  missingCompanyEmailCount: number;
  missingPcrEmailCount: number;
  pendingSync: number;
  catalogVersion?: number;
  generatedAt: string;
};

export function buildReportDiagnostics(
  inspections: InspectionRecord[],
  options: { catalogVersion?: number; pendingSync?: number } = {},
): ReportDiagnostics {
  const products = new Map<string, InspectionRecord>();
  inspections.forEach((record) => {
    const control = readInspectionField(record, ['controlNumber', 'control_number', 'product_control_number']);
    const model = readInspectionField(record, ['model', 'modelNumber', 'model_number', 'model_number_code']);
    const store = readInspectionField(record, ['storeId', 'store_id', 'storeName', 'store_name']) || 'unknown';
    products.set(`${store}|${control || model || record.id}`.toLowerCase(), record);
  });
  const rows = Array.from(products.values());
  return {
    inspectionCount: inspections.length,
    productCount: rows.length,
    nonCompliantCount: inspections.filter(isNonCompliant).length,
    missingModelCount: rows.filter((record) => !readInspectionField(record, ['model', 'modelNumber', 'model_number', 'model_number_code'])).length,
    missingCompanyCount: rows.filter((record) => !catalogFieldText(record, ['companyName', 'company_name', 'company', 'Company Name', 'Company'])).length,
    missingRetailPriceCount: rows.filter((record) => !catalogFieldText(record, ['retailPrice', 'retail_price', 'Retail Price', 'Latest Average Price', 'latestAveragePrice'])).length,
    missingCompanyEmailCount: rows.filter((record) => !readInspectionField(record, ['companyEmail', 'company_email', 'Company Email'])).length,
    missingPcrEmailCount: rows.filter((record) => !readInspectionField(record, ['pcrEmail', 'pcr_email', 'PCR Email'])).length,
    pendingSync: options.pendingSync ?? 0,
    catalogVersion: options.catalogVersion,
    generatedAt: new Date().toISOString(),
  };
}

function catalogFieldText(record: InspectionRecord, keys: string[]): string {
  return readInspectionField(record, keys);
}

function isNonCompliant(record: InspectionRecord): boolean {
  const normalize = (value: string) => value.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  return normalize(text(record, ['outcome', 'compliance', 'compliance_status'])) === 'non_compliant'
    || ['not_registered', 'registered_only'].includes(normalize(text(record, ['labeling', 'label_status', 'labeling_answer'])))
    || ['placement', 'visualQuality', 'visual_quality', 'productDetails', 'product_details']
      .some((key) => ['failing', 'nc', 'non_compliant'].includes(normalize(text(record, [key, `${key}_answer`]))));
}

function text(record: InspectionRecord, keys: string[]): string {
  return keys.map((key) => record[key]).map(textValue).find(Boolean) ?? '';
}

function textValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

