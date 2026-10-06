import { describe, expect, it } from 'vitest';
import { buildSummaryCsv } from '@/features/summary/summary-export';

describe('buildSummaryCsv', () => {
  it('exports all summary sections with Excel-safe CSV escaping', () => {
    const csv = buildSummaryCsv({
      storeLabel: 'Sample, Store',
      generatedAt: '2026-10-06T01:00:00.000Z',
      catalogVersion: 7,
      pendingSync: 2,
      complianceRows: [{ label: 'Air-conditioner', models: 2, labeled: 1, exempted: 0, nonCompliant: 1, compliance: 50 }],
      breakdownRows: [{ label: 'Air-conditioner', notRegistered: 1, noDocument: 0, placement: 1, visualQuality: 0, productDetails: 0 }],
      emvRows: [{ label: 'Air-conditioner', compliant: 1, nonCompliant: 1, labeled: 1, exempted: 0, models: 2 }],
      totals: { models: 2, labeled: 1, exempted: 0, nonCompliant: 1, compliant: 1, compliance: 50 },
      nonCompliantRows: [{ no: 1, ecpType: 'ACU', brandName: 'Brand, Inc.', modelCode: 'M1', description: 'Torn "label"', status: 'NC', company: 'Company', retailPrice: '₱12,500', companyEmail: 'company@example.com', pcrEmail: 'pcr@example.com', warning: 'Check/scan QR code' }],
    });

    expect(csv).toContain('\uFEFFPELP Pal Compliance Summary');
    expect(csv).toContain('Compliance Summary');
    expect(csv).toContain('Generated at,2026-10-06T01:00:00.000Z');
    expect(csv).toContain('Catalog version,7');
    expect(csv).toContain('Pending sync,2');
    expect(csv).toContain('Non-Compliance Breakdown Summary');
    expect(csv).toContain('Summary of EMV Results');
    expect(csv).toContain('Non-Compliance Results');
    expect(csv).toContain('Company,Retail Price,Company Email');
    expect(csv).toContain('Company,"₱12,500"');
    expect(csv).toContain('"Sample, Store"');
    expect(csv).toContain('"Brand, Inc."');
    expect(csv).toContain('"Torn ""label"""');
    expect(csv).toContain('50%');
  });
});
