import { describe, expect, it } from 'vitest';
import { extractLookupQuery } from '@/features/lookup/qr-value';

describe('extractLookupQuery', () => {
  it('extracts the control number from an energy label payload', () => {
    expect(extractLookupQuery('CN:ACU-0020-2026-000331-rev.0')).toBe('ACU-0020-2026-000331-rev.0');
  });

  it('extracts a control number from a public energy-label URL path', () => {
    expect(extractLookupQuery('https://pelp.eumb.ph/public-portal/ACU-0020-2026-000331-rev.0/energy-label')).toBe('ACU-0020-2026-000331-rev.0');
  });

  it('keeps an unstructured QR payload searchable', () => {
    expect(extractLookupQuery('LG LA0600BS')).toBe('LG LA0600BS');
  });
});
