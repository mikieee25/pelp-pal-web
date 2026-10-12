import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareTransferFile, receiveTransferFile } from '@/lib/transfer/transfer-file';

const fileText = JSON.stringify({ format: 'pelp-pal-transfer', schemaVersion: 1, exportMode: 'records', exportedAt: '2026-10-12T08:00:00.000Z', appVersion: '0.1.0', organizationId: 'org-1', records: { inspections: [], revisions: [], activities: [], evidence: [], evidenceBlobs: [], outbox: [] } });

function file(): File {
  const value = new File([fileText], 'recovery.pelp.json', { type: 'application/json' });
  Object.defineProperty(value, 'arrayBuffer', { value: async () => new TextEncoder().encode(fileText).buffer });
  return value;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transfer file delivery', () => {
  it('uses Web Share when file sharing is supported', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });

    await expect(shareTransferFile(file())).resolves.toEqual({ status: 'shared' });
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.any(File)] }));
  });

  it('downloads when sharing is unsupported or rejected', async () => {
    const click = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:recovery'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('document', { createElement: vi.fn(() => ({ click, set href(_: string) {}, set download(_: string) {} })), body: { appendChild: vi.fn(), removeChild: vi.fn() } });
    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => false), configurable: true });
    await expect(shareTransferFile(file())).resolves.toEqual({ status: 'downloaded' });

    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
    Object.defineProperty(navigator, 'share', { value: vi.fn().mockRejectedValue(new Error('blocked')), configurable: true });
    await expect(shareTransferFile(file())).resolves.toEqual({ status: 'downloaded' });
    expect(click).toHaveBeenCalled();
  });

  it('reports a canceled native share without losing the file', async () => {
    const error = new DOMException('Canceled', 'AbortError');
    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
    Object.defineProperty(navigator, 'share', { value: vi.fn().mockRejectedValue(error), configurable: true });
    await expect(shareTransferFile(file())).resolves.toEqual({ status: 'canceled' });
  });

  it('accepts the same JSON file on every browser platform', async () => {
    await expect(receiveTransferFile(file())).resolves.toMatchObject({
      format: 'pelp-pal-transfer',
      schemaVersion: 1,
    });
  });
});
