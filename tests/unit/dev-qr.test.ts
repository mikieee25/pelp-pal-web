import { describe, expect, it } from 'vitest';
import { parseNetworkUrl } from '../../scripts/network-url.mjs';

describe('dev server QR URL detection', () => {
  it('extracts the Network address from Next.js startup output', () => {
    expect(parseNetworkUrl('- Local:   http://localhost:3000\n- Network: http://192.168.68.149:3000\n'))
      .toBe('http://192.168.68.149:3000');
  });

  it('waits until a complete Network line is available', () => {
    expect(parseNetworkUrl('- Network: http://192.168.68.149:3000')).toBe('http://192.168.68.149:3000');
    expect(parseNetworkUrl('- Local: http://localhost:3000')).toBeNull();
  });
});
