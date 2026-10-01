import { describe, expect, it } from 'vitest';
import { buildEvidencePath, validateEvidenceBytes } from '@/lib/evidence/validation';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('evidence validation', () => {
  it('builds the shared private storage path', () => {
    expect(buildEvidencePath('org-1', 'inspection-1', 'evidence-1')).toBe('org-1/inspection-1/evidence-1.jpg');
  });

  it('accepts bounded JPEG bytes and returns a SHA-256 digest', async () => {
    const result = await validateEvidenceBytes(jpeg);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.sizeBytes).toBe(jpeg.length);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects non-JPEG bytes', async () => {
    await expect(validateEvidenceBytes(new Uint8Array([1, 2, 3]))).rejects.toThrow('JPEG');
  });
});
