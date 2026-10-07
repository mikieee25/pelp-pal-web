import { describe, expect, it } from 'vitest';
import { buildReportDiagnostics } from '@/features/report/report-diagnostics';

describe('buildReportDiagnostics', () => {
  it('counts products and missing export fields without mutating records', () => {
    const rows = [
      { id: '1', storeId: 'store-1', controlNumber: 'AC-1', model: 'M1', outcome: 'non_compliant', companyName: 'Company A', retailPrice: 100 },
      { id: '2', storeId: 'store-1', controlNumber: 'AC-1', model: 'M1', outcome: 'non_compliant' },
      { id: '3', storeId: 'store-2', controlNumber: 'TV-1', outcome: 'compliant' },
    ];
    expect(buildReportDiagnostics(rows, { catalogVersion: 4, pendingSync: 2 })).toMatchObject({
      inspectionCount: 3,
      productCount: 2,
      nonCompliantCount: 2,
      missingModelCount: 1,
      missingCompanyCount: 2,
      missingRetailPriceCount: 2,
      pendingSync: 2,
      catalogVersion: 4,
    });
  });

  it('counts checklist failures as non-compliant inspections and reads contact fields from dynamic fields', () => {
    const diagnostics = buildReportDiagnostics([
      {
        id: '1',
        storeId: 'store-1',
        controlNumber: 'AC-1',
        model: 'M1',
        productType: 'ACU',
        labeling: 'with_label',
        placement: 'failing',
        dynamic_fields: JSON.stringify({ 'Company Email': 'company@example.com', 'PCR Email': 'pcr@example.com' }),
      },
    ]);

    expect(diagnostics.nonCompliantCount).toBe(1);
    expect(diagnostics.missingCompanyEmailCount).toBe(0);
    expect(diagnostics.missingPcrEmailCount).toBe(0);
  });
});
