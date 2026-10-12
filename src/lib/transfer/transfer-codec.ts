export type TransferExportMode = 'pending' | 'full' | 'records';

export type TransferEvidenceBlob = {
  id: string;
  evidenceId: string;
  fileName: string;
  mimeType: string;
  size: number;
  base64: string;
  sha256?: string;
};

export type TransferBundle = {
  format: 'pelp-pal-transfer';
  schemaVersion: 1;
  exportMode: TransferExportMode;
  exportedAt: string;
  appVersion: string;
  organizationId: string;
  sourceAccountId?: string;
  records: {
    inspections: Record<string, unknown>[];
    revisions: Record<string, unknown>[];
    activities: Record<string, unknown>[];
    evidence: Record<string, unknown>[];
    evidenceBlobs: TransferEvidenceBlob[];
    outbox: Record<string, unknown>[];
  };
};

export type TransferImportPreview = {
  exportMode: TransferExportMode;
  organizationId: string;
  fileSize: number;
  inspectionCount: number;
  revisionCount: number;
  activityCount: number;
  evidenceCount: number;
  evidenceBytes: number;
  outboxCount: number;
};

export type TransferImportPlan = TransferImportPreview & {
  importedCount: number;
  skippedCount: number;
  conflictCount: number;
  duplicateEvidenceCount: number;
};

export type TransferMergeResult = TransferImportPlan & {
  completedAt: string;
};

const FORMAT = 'pelp-pal-transfer';
const SCHEMA_VERSION = 1;
const FORBIDDEN_KEYS = new Set([
  'access_token',
  'refresh_token',
  'password',
  'password_hash',
  'service_role_key',
  'change_cursor',
  'changeCursor',
  'syncCursors',
  'sync_cursors',
]);

export async function serializeTransferBundle(bundle: TransferBundle): Promise<File> {
  validateBundle(bundle);
  await Promise.all(bundle.records.evidenceBlobs.map(decodeEvidenceBlob));
  const filename = `pelp-recovery-${bundle.exportMode}.pelp.json`;
  return new File([JSON.stringify(bundle)], filename, { type: 'application/json' });
}

export async function parseTransferFile(file: File): Promise<TransferBundle> {
  if (!(file instanceof File)) throw new Error('Choose a JSON recovery file.');
  if (file.size === 0) throw new Error('The recovery file is empty.');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(await file.arrayBuffer()));
  } catch {
    throw new Error('The recovery file is not valid UTF-8 JSON.');
  }
  validateBundle(value);
  await Promise.all(value.records.evidenceBlobs.map(decodeEvidenceBlob));
  return value;
}

export function previewTransferBundle(bundle: TransferBundle, fileSize = 0): TransferImportPreview {
  validateBundle(bundle);
  return {
    exportMode: bundle.exportMode,
    organizationId: bundle.organizationId,
    fileSize,
    inspectionCount: bundle.records.inspections.length,
    revisionCount: bundle.records.revisions.length,
    activityCount: bundle.records.activities.length,
    evidenceCount: bundle.records.evidence.length,
    evidenceBytes: bundle.records.evidenceBlobs.reduce((total, item) => total + item.size, 0),
    outboxCount: bundle.records.outbox.length,
  };
}

export async function encodeEvidenceBlob(
  bytes: Uint8Array,
  details: Omit<TransferEvidenceBlob, 'base64' | 'size' | 'sha256'>,
): Promise<TransferEvidenceBlob> {
  return {
    ...details,
    size: bytes.byteLength,
    base64: toBase64(bytes),
    sha256: await sha256Hex(bytes),
  };
}

export async function decodeEvidenceBlob(value: TransferEvidenceBlob): Promise<Uint8Array> {
  const bytes = fromBase64(value.base64);
  if (bytes.byteLength !== value.size) throw new Error(`Evidence ${value.id} has an invalid byte length.`);
  if (value.sha256 && (await sha256Hex(bytes)) !== value.sha256.toLowerCase()) {
    throw new Error(`Evidence ${value.id} failed its checksum validation.`);
  }
  return bytes;
}

function validateBundle(value: unknown): asserts value is TransferBundle {
  if (!isRecord(value)) throw new Error('The recovery file must contain a JSON object.');
  if (Object.keys(value).some((key) => FORBIDDEN_KEYS.has(key))) {
    throw new Error('The recovery file contains credentials or synchronization cursor state.');
  }
  if (value.format !== FORMAT) throw new Error('This is not a PELP Pal recovery file.');
  if (value.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported recovery file version: ${String(value.schemaVersion)}.`);
  if (!isTransferMode(value.exportMode)) throw new Error('The recovery file has an unsupported export mode.');
  if (!isoTimestamp(value.exportedAt) || typeof value.appVersion !== 'string' || !value.appVersion.trim()) {
    throw new Error('The recovery file has invalid export metadata.');
  }
  if (typeof value.organizationId !== 'string' || !value.organizationId.trim()) throw new Error('The recovery file is missing its organization.');
  if (value.sourceAccountId !== undefined && (typeof value.sourceAccountId !== 'string' || !value.sourceAccountId.trim())) {
    throw new Error('The recovery file has an invalid source account.');
  }
  if (!isRecord(value.records)) throw new Error('The recovery file is missing its records.');
  for (const name of ['inspections', 'revisions', 'activities', 'evidence', 'outbox'] as const) {
    const rows = value.records[name];
    if (!Array.isArray(rows) || rows.some((row) => !isRecord(row) || typeof row.id !== 'string' || !row.id)) {
      throw new Error(`The recovery file has invalid ${name} records.`);
    }
    assertUniqueIds(rows, name);
    if (rows.some(containsForbiddenKey)) throw new Error(`The recovery file has forbidden synchronization data in ${name}.`);
  }
  if (!Array.isArray(value.records.evidenceBlobs)) throw new Error('The recovery file has invalid evidence blobs.');
  assertUniqueIds(value.records.evidenceBlobs, 'evidence blobs');
  for (const blob of value.records.evidenceBlobs) {
    if (!isTransferEvidenceBlob(blob)) throw new Error('The recovery file has invalid evidence metadata.');
    if (containsForbiddenKey(blob)) throw new Error('The recovery file has forbidden synchronization data in evidence.');
    fromBase64(blob.base64);
    if (blob.sha256 && !/^[a-f0-9]{64}$/i.test(blob.sha256)) throw new Error(`Evidence ${blob.id} has an invalid checksum.`);
  }
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEYS.has(key) || containsForbiddenKey(child));
}

function assertUniqueIds(rows: Array<{ id?: unknown }>, name: string): void {
  const ids = rows.map((row) => row.id);
  if (new Set(ids).size !== ids.length) throw new Error(`The recovery file contains duplicate ${name} IDs.`);
}

function isTransferEvidenceBlob(value: unknown): value is TransferEvidenceBlob {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.evidenceId === 'string'
    && typeof value.fileName === 'string'
    && typeof value.mimeType === 'string'
    && Number.isInteger(value.size)
    && value.size >= 0
    && typeof value.base64 === 'string';
}

function isTransferMode(value: unknown): value is TransferExportMode {
  return value === 'pending' || value === 'full' || value === 'records';
}

function isoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && value.endsWith('Z');
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Evidence contains invalid base64 data.');
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}
