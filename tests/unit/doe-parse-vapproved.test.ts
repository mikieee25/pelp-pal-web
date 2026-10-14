import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVapproved } from '../../supabase/functions/doe-product-lookup/parse-vapproved';
import { isAllowedDoeUrl, isBlockedDoeResponse } from '../../supabase/functions/doe-product-lookup/security';

const fixture = readFileSync(resolve(process.cwd(), 'supabase/functions/doe-product-lookup/fixtures/doe-vapproved-sample.html'), 'utf8');
const expected = JSON.parse(readFileSync(resolve(process.cwd(), 'supabase/functions/doe-product-lookup/fixtures/doe-vapproved-sample.expected.json'), 'utf8')) as Record<string, unknown>;

describe('DOE vapproved parser', () => {
  it('matches the representative fixture output', () => {
    const parsed = parseVapproved(fixture, 'https://pelp.doe.gov.ph/vapproved.php?AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed).toMatchObject(expected);
  });

  it('rejects unsafe URLs and accepts only the single token query', () => {
    expect(isAllowedDoeUrl('http://pelp.doe.gov.ph/vapproved.php?AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe(false);
    expect(isAllowedDoeUrl('https://evil.example/vapproved.php?AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe(false);
    expect(isAllowedDoeUrl('https://pelp.doe.gov.ph/other.php?AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe(false);
    expect(isAllowedDoeUrl('https://pelp.doe.gov.ph/vapproved.php?short')).toBe(false);
    expect(isAllowedDoeUrl('https://pelp.doe.gov.ph/vapproved.php?AbCdEfGhIjKlMnOpQrStUvWxYz012345&other=value')).toBe(false);
  });

  it('detects upstream block responses', () => {
    expect(isBlockedDoeResponse(403, '', null)).toBe(true);
    expect(isBlockedDoeResponse(200, 'Just a moment...', null)).toBe(true);
    expect(isBlockedDoeResponse(200, '', 'challenge')).toBe(true);
    expect(isBlockedDoeResponse(200, '<html>record</html>', null)).toBe(false);
  });

  it('returns no control number when the upstream page is not a record', () => {
    expect(parseVapproved('<html><body><label>Brand:</label></div><div class="col-md-7">Example</div></body></html>', 'https://pelp.doe.gov.ph/vapproved.php?AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBeNull();
  });

  it('returns a partial record when only the control number is readable', () => {
    const parsed = parseVapproved('<b>ACU-0049-002154-1025</b>', 'https://pelp.doe.gov.ph/vapproved.php?AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    expect(parsed).toMatchObject({ controlNumber: 'ACU-0049-002154-1025', partial: true });
  });
});
