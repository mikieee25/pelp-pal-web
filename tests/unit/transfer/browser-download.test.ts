import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from '@/lib/transfer/browser-download';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser file download', () => {
  it('keeps the object URL alive after the click before revoking it', () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:offline-export'), revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    downloadBlob(new Blob(['offline data']), 'offline-export.json');

    expect(click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(revoke).toHaveBeenCalledWith('blob:offline-export');
  });
});
