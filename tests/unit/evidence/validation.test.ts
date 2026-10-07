import { describe, expect, it, vi } from 'vitest';
import { buildEvidencePath, validateEvidenceBytes } from '@/lib/evidence/validation';
import { optimizeEvidenceImage } from '@/lib/evidence/image-optimization';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('evidence validation', () => {
  it('builds the shared private storage path', () => {
    expect(buildEvidencePath('org-1', 'inspection-1', 'evidence-1')).toBe('org-1/inspection-1/evidence-1.jpg');
    expect(buildEvidencePath('org-1', 'inspection-1', 'evidence-1', 'revision-1')).toBe('org-1/inspection-1/evidence-1-revision-1.jpg');
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

  it('keeps the original image when browser compression APIs are unavailable', async () => {
    const file = new File([new Uint8Array(3 * 1024 * 1024)], 'camera.jpg', { type: 'image/jpeg' });
    await expect(optimizeEvidenceImage(file)).resolves.toBe(file);
  });

  it('converts a small PNG to JPEG before it enters the sync pipeline', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'camera.png', { type: 'image/png' });
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 80, close }));
    const toBlob = vi.fn((callback: BlobCallback) => callback(new Blob([jpeg], { type: 'image/jpeg' })));
    vi.stubGlobal('document', { createElement: vi.fn(() => ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob })) });

    await expect(optimizeEvidenceImage(file)).resolves.toMatchObject({ type: 'image/jpeg' });
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.82);
    expect(close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
