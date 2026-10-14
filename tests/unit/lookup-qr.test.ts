import { describe, expect, it } from 'vitest';
import { extractLookupQuery, parseScannedValue } from '@/features/lookup/qr-value';
import { isCompleteDoeUrl } from '@/features/lookup/doe-record';

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

describe('parseScannedValue', () => {
  it('classifies a DOE vapproved URL without changing the full value', () => {
    const url = 'https://pelp.doe.gov.ph/vapproved.php?AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    expect(parseScannedValue(url)).toEqual({ kind: 'doe_url', value: url });
  });

  it('classifies control numbers separately from free text', () => {
    expect(parseScannedValue('CN:ACU-0020-2026-000331-rev.0')).toEqual({ kind: 'control_number', value: 'ACU-0020-2026-000331-rev.0' });
    expect(parseScannedValue('LG LA0600BS')).toEqual({ kind: 'text', value: 'LG LA0600BS' });
  });
});

describe('isCompleteDoeUrl', () => {
  it('accepts a complete DOE vapproved URL', () => {
    expect(isCompleteDoeUrl('https://pelp.doe.gov.ph/vapproved.php?AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe(true);
  });

  it('rejects incomplete or unsafe DOE URLs', () => {
    expect(isCompleteDoeUrl('https://pelp.doe.gov.ph/vapproved.php')).toBe(false);
    expect(isCompleteDoeUrl('https://example.com/vapproved.php?AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe(false);
    expect(isCompleteDoeUrl('https://pelp.doe.gov.ph/vapproved.php?short')).toBe(false);
  });
});
