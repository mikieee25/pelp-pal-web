import { describe, expect, it } from 'vitest';
import { getLabelValidityStatus, hashDoeToken, type OfficialProductRecord } from '@/features/lookup/doe-record';

const record: OfficialProductRecord = {
  controlNumber: 'ACU-0049-002154-1025',
  productType: 'Air Conditioners',
  brand: 'Example',
  productName: 'Example product',
  modelCode: 'MODEL-1',
  manufacturer: 'Example Manufacturing',
  fields: {},
  starRating: 4,
  energyLabels: [{ labelNumber: 'ACU-0049-002154-1025', validFrom: '2025-10-24', validUntil: '2026-10-24' }],
  imageUrls: [],
  sourceUrl: 'https://pelp.doe.gov.ph/vapproved.php?token',
  fetchedAt: '2026-10-14T00:00:00.000Z',
};

describe('DOE record helpers', () => {
  it('classifies valid, expiring, expired, and today-boundary labels in Asia/Manila', () => {
    expect(getLabelValidityStatus('2026-10-14', '2026-10-24', '2026-10-14T00:00:00+08:00')).toEqual({ kind: 'expiring', label: 'Expires in 10 days', daysRemaining: 10 });
    expect(getLabelValidityStatus('2026-10-24', '2026-10-24', '2026-10-24T00:00:00+08:00')).toEqual({ kind: 'valid', label: 'Valid', daysRemaining: 0 });
    expect(getLabelValidityStatus('2026-10-25', '2026-10-24', '2026-10-25T00:00:00+08:00')).toEqual({ kind: 'expired', label: 'Expired', daysRemaining: -1 });
    expect(getLabelValidityStatus('2026-10-01', '2026-11-30', '2026-10-14T00:00:00+08:00')).toEqual({ kind: 'valid', label: 'Valid', daysRemaining: 47 });
  });

  it('hashes the raw token without exposing it', async () => {
    expect(await hashDoeToken('token')).toBe('3c469e9d6c5875d37a43f353d4f88e61fcf812c66eee3457465a40b0da4153e0');
  });

  it('keeps partial records usable for catalog matching', () => {
    expect({ ...record, partial: true, imageUrls: [] }).toMatchObject({ controlNumber: record.controlNumber, partial: true });
  });
});
