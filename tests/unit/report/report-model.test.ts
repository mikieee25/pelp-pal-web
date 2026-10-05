import { describe, expect, it } from 'vitest';
import { buildReportSummary, consolidateReportProducts } from '@/features/report/report-model';

describe('report model', () => {
  it('always returns fixed ECP rows and safe zero-state rates', () => {
    const summary = buildReportSummary([]);

    expect(summary.complianceRows).toHaveLength(5);
    expect(summary.complianceRows.map((row) => row.models)).toEqual([0, 0, 0, 0, 0]);
    expect(summary.complianceRows.every((row) => row.compliance === null)).toBe(true);
    expect(summary.totals.compliance).toBeNull();
  });

  it('consolidates a product by store and control number with NC priority', () => {
    const products = consolidateReportProducts([
      { id: 'one', status: 'completed', storeId: 'store-1', storeName: 'Store', controlNumber: 'ACU-1', model: 'Model 1', productType: 'Air Conditioners', outcome: 'compliant', labeling: 'with_label', username: 'alice' },
      { id: 'two', status: 'completed', storeId: 'store-1', storeName: 'Store', controlNumber: 'ACU-1', model: 'Model 1', productType: 'Air Conditioners', outcome: 'non_compliant', placement: 'NC', remarks: 'Torn label', username: 'bob' },
      { id: 'three', status: 'completed', storeId: 'store-2', storeName: 'Other Store', controlNumber: 'ACU-1', model: 'Model 1', productType: 'Air Conditioners', outcome: 'compliant', username: 'alice' },
    ]);

    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({ storeKey: 'store-1', controlNumber: 'ACU-1', nonCompliant: true, hasLabel: true });
    expect(products[0]?.records).toHaveLength(2);
    expect(products[0]?.findings).toContain('Placement');
  });

  it('de-duplicates NC categories for one consolidated product', () => {
    const products = consolidateReportProducts([
      { id: 'one', status: 'completed', storeName: 'Store', controlNumber: 'REF-1', productType: 'REF', labeling: 'registered_only', placement: 'NC', username: 'alice' },
      { id: 'two', status: 'completed', storeName: 'Store', controlNumber: 'REF-1', productType: 'REF', labeling: 'registered_only', placement: 'NC', username: 'bob' },
    ]);

    const summary = buildReportSummary(products);
    const row = summary.breakdownRows.find((item) => item.typeKey === 'refrigerating-appliance');
    expect(row).toMatchObject({ noDocument: 1, placement: 1 });
    expect(summary.nonCompliantProducts[0]?.findings).toEqual(['Registered but no EL/COE', 'Placement']);
  });
});
