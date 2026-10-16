export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_EVIDENCE_IMAGES = 3;
export const MAX_EVIDENCE_IMAGES_MESSAGE = 'A maximum of three photos is allowed.';

export type EvidenceValidation = {
  mimeType: 'image/jpeg';
  sizeBytes: number;
  sha256: string;
};

export function buildEvidencePath(organizationId: string, inspectionId: string, evidenceId: string): string {
  for (const segment of [organizationId, inspectionId, evidenceId]) {
    if (!segment || segment.includes('/') || segment.includes('\\') || segment === '.' || segment === '..') {
      throw new Error('Evidence path contains an unsafe segment.');
    }
  }
  return `${organizationId}/${inspectionId}/${evidenceId}.jpg`;
}

export async function readEvidenceArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes.buffer;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Photo data could not be read.'));
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(reader.result)
      : reject(new Error('Photo data could not be read.'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function validateEvidenceBytes(
  bytes: Uint8Array,
  maxBytes = EVIDENCE_MAX_BYTES,
): Promise<EvidenceValidation> {
  if (bytes.length === 0 || bytes.length > maxBytes) throw new Error('Evidence exceeds the JPEG size limit.');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error('Evidence must be a JPEG.');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return {
    mimeType: 'image/jpeg',
    sizeBytes: bytes.length,
    sha256: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''),
  };
}
