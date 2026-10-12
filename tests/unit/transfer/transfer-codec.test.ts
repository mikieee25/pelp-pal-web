import { describe, expect, it } from 'vitest';
import {
  decodeEvidenceBlob,
  parseTransferFile,
  previewTransferBundle,
  serializeTransferBundle,
  type TransferBundle,
} from '@/lib/transfer/transfer-codec';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function makeBundle(overrides: Partial<TransferBundle> = {}): TransferBundle {
  const base64 = toBase64(jpeg);
  return {
    format: 'pelp-pal-transfer',
    schemaVersion: 1,
    exportMode: 'pending',
    exportedAt: '2026-10-12T08:00:00.000Z',
    appVersion: '0.1.0',
    organizationId: 'org-1',
    sourceAccountId: 'account-source',
    records: {
      inspections: [{ id: 'inspection-1', storeName: 'ร้านค้า 東京', status: 'completed' }],
      revisions: [{ id: 'revision-1', inspection_id: 'inspection-1', revision: 1, payload: { id: 'inspection-1' } }],
      activities: [{ id: 'activity-1', inspection_id: 'inspection-1', event_type: 'inspection_completed' }],
      evidence: [{ id: 'evidence-1', inspectionId: 'inspection-1', fileName: 'label.jpg', mimeType: 'image/jpeg', size: jpeg.length }],
      evidenceBlobs: [{ id: 'blob-1', evidenceId: 'evidence-1', fileName: 'label.jpg', mimeType: 'image/jpeg', size: jpeg.length, base64 }],
      outbox: [{ id: 'outbox-1', aggregateId: 'inspection-1', kind: 'inspection', status: 'pending', nextAttemptAt: '2026-10-12T08:00:00.000Z', payload: { inspection_id: 'inspection-1' } }],
    },
    ...overrides,
  };
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fileFor(value: unknown): File {
  const text = JSON.stringify(value);
  const file = new File([text], 'recovery.pelp.json', { type: 'application/json' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer });
  return file;
}

describe('transfer codec', () => {
  it('round-trips Unicode names and evidence bytes', async () => {
    const bundle = makeBundle();
    const file = await serializeTransferBundle(bundle);
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(JSON.stringify(bundle)).buffer });
    const parsed = await parseTransferFile(file);

    expect(parsed.records.inspections[0].storeName).toBe('ร้านค้า 東京');
    expect(await decodeEvidenceBlob(parsed.records.evidenceBlobs[0])).toEqual(jpeg);
    expect(file.name).toBe('pelp-recovery-pending.pelp.json');
    expect(file.type).toBe('application/json');
  });

  it.each([
    ['wrong format', { format: 'other' }],
    ['unsupported version', { schemaVersion: 999 }],
  ])('rejects %s', async (_label, override) => {
    await expect(parseTransferFile(fileFor({ ...makeBundle(), ...override }))).rejects.toThrow();
  });

  it('rejects missing record ids and malformed evidence', async () => {
    const missingId = makeBundle({ records: { ...makeBundle().records, inspections: [{ status: 'completed' }] } });
    await expect(parseTransferFile(fileFor(missingId))).rejects.toThrow(/id/i);

    const invalidBase64 = makeBundle({
      records: {
        ...makeBundle().records,
        evidenceBlobs: [{ ...makeBundle().records.evidenceBlobs[0], base64: '!' }],
      },
    });
    await expect(parseTransferFile(fileFor(invalidBase64))).rejects.toThrow(/base64/i);

    const wrongChecksum = makeBundle({
      records: {
        ...makeBundle().records,
        evidenceBlobs: [{ ...makeBundle().records.evidenceBlobs[0], sha256: '0'.repeat(64) }],
      },
    });
    await expect(parseTransferFile(fileFor(wrongChecksum))).rejects.toThrow(/checksum/i);
  });

  it('reports counts and refuses credentials or cursor state', async () => {
    const bundle = makeBundle();
    expect(previewTransferBundle(bundle, 123)).toMatchObject({
      fileSize: 123,
      inspectionCount: 1,
      revisionCount: 1,
      activityCount: 1,
      evidenceCount: 1,
      outboxCount: 1,
    });

    expect(JSON.stringify(bundle)).not.toMatch(/access_token|refresh_token|password|change_cursor|cursor/i);
    await expect(parseTransferFile(fileFor({ ...bundle, access_token: 'secret' }))).rejects.toThrow(/credential/i);
  });
});
