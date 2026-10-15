import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareReportPhoto } from '@/features/report/report-images';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('prepareReportPhoto', () => {
  it('resizes the long side to at most 1280px and re-encodes as JPEG at quality 0.8', async () => {
    const drawImage = vi.fn();
    const encoded = new Blob(['jpeg'], { type: 'image/jpeg' });
    const bitmap = { width: 3000, height: 1500, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type, quality) => {
      expect(type).toBe('image/jpeg');
      expect(quality).toBe(0.8);
      callback(encoded);
    });

    const prepared = await prepareReportPhoto(new Blob(['source']));

    expect(prepared).toMatchObject({ width: 1280, height: 640, blob: encoded });
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1280, 640);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
