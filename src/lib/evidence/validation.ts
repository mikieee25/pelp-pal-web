export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

export type EvidenceValidation = {
  mimeType: 'image/jpeg';
  sizeBytes: number;
  sha256: string;
};

export function buildEvidencePath(organizationId: string, inspectionId: string, evidenceId: string, revisionId?: string): string {
  for (const segment of [organizationId, inspectionId, evidenceId, revisionId]) {
    if (segment === undefined) continue;
    if (!segment || segment.includes('/') || segment.includes('\\') || segment === '.' || segment === '..') {
      throw new Error('Evidence path contains an unsafe segment.');
    }
  }
  return `${organizationId}/${inspectionId}/${evidenceId}${revisionId ? `-${revisionId}` : ''}.jpg`;
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
