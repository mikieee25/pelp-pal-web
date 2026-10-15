import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocalEvidenceRecord } from '@/lib/db/records';
import { buildEvidencePath, readEvidenceArrayBuffer, validateEvidenceBytes } from '@/lib/evidence/validation';

export type EvidenceRepairResult = {
  evidenceId: string;
  remotePath: string;
  status: 'uploaded' | 'already_present' | 'failed';
  sha256?: string;
  message?: string;
};

export async function repairMissingEvidence(
  client: SupabaseClient,
  organizationId: string,
  evidence: LocalEvidenceRecord[],
  onProgress?: (completed: number, total: number, result: EvidenceRepairResult) => void,
): Promise<EvidenceRepairResult[]> {
  const results: EvidenceRepairResult[] = new Array(evidence.length);
  const listings = new Map<string, Promise<Set<string>>>();
  let nextIndex = 0;
  let completed = 0;
  const listInspectionFiles = (inspectionId: string): Promise<Set<string>> => {
    let listing = listings.get(inspectionId);
    if (!listing) {
      listing = client.storage.from('inspection-evidence')
        .list(`${organizationId}/${inspectionId}`, { limit: 100 })
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return new Set((data ?? []).map((file) => file.name));
        });
      listings.set(inspectionId, listing);
    }
    return listing;
  };
  const worker = async () => {
    while (nextIndex < evidence.length) {
      const index = nextIndex++;
      const item = evidence[index];
      const remotePath = buildEvidencePath(organizationId, item.inspectionId, item.id);
      let result: EvidenceRepairResult;
      try {
        const existingFiles = await listInspectionFiles(item.inspectionId);
        const fileName = remotePath.slice(remotePath.lastIndexOf('/') + 1);
        if (existingFiles.has(fileName)) {
          const bytes = new Uint8Array(await readEvidenceArrayBuffer(item.blob));
          const { sha256 } = await validateEvidenceBytes(bytes);
          result = { evidenceId: item.id, remotePath, status: 'already_present', sha256 };
        } else {
          const arrayBuffer = await readEvidenceArrayBuffer(item.blob);
          const bytes = new Uint8Array(arrayBuffer);
          const { sha256 } = await validateEvidenceBytes(bytes);
          const jpeg = new Blob([arrayBuffer], { type: 'image/jpeg' });
          const { error: uploadError } = await client.storage.from('inspection-evidence').upload(remotePath, jpeg, {
            contentType: 'image/jpeg', upsert: true,
          });
          if (uploadError) throw new Error(uploadError.message);
          result = { evidenceId: item.id, remotePath, status: 'uploaded', sha256 };
        }
      } catch (error) {
        result = {
          evidenceId: item.id,
          remotePath,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      results[index] = result;
      completed += 1;
      onProgress?.(completed, evidence.length, result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, evidence.length) }, () => worker()));
  return results;
}
