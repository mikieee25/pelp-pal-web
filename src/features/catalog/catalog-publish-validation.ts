export const MAX_MASTERLIST_BYTES = 100 * 1024 * 1024;

export type MasterlistInspection = {
  fileName: string;
  sizeBytes: number;
  rowCount: number;
  duplicateIds: string[];
  productTypes: string[];
  sha256: string;
  schemaVersion: number;
};

type MasterlistRow = Record<string, unknown>;

export async function inspectMasterlistFile(file: File): Promise<MasterlistInspection> {
  if (!file.name || file.name.toLowerCase() !== 'masterlist.json') {
    throw new Error('Select a file named masterlist.json.');
  }
  if (file.size === 0) throw new Error('The masterlist file is empty.');
  if (file.size > MAX_MASTERLIST_BYTES) {
    throw new Error('The masterlist file must be smaller than 100 MiB.');
  }

  const bytes = await file.arrayBuffer();
  const digest = await sha256Hex(bytes);
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The masterlist file is not valid JSON.');
  }
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('The masterlist must contain a non-empty JSON array.');
  }

  const ids = new Set<string>();
  const duplicates = new Set<string>();
  const productTypes = new Set<string>();
  let schemaVersion: number | undefined;

  payload.forEach((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Row ${index + 1} must be a JSON object.`);
    }
    const row = value as MasterlistRow;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id) throw new Error(`Row ${index + 1} is missing a valid id.`);
    if (ids.has(id)) duplicates.add(id);
    ids.add(id);

    const productType = typeof row.product_type === 'string' ? row.product_type.trim() : '';
    if (!productType) throw new Error(`Row ${index + 1} is missing product_type.`);
    productTypes.add(productType);

    if (typeof row.source_version !== 'number' || !Number.isInteger(row.source_version)) {
      throw new Error(`Row ${index + 1} is missing a valid source_version.`);
    }
    schemaVersion ??= row.source_version;
    if (row.source_version !== schemaVersion || row.source_version !== 1) {
      throw new Error(`Row ${index + 1} uses an unsupported schema version.`);
    }
  });

  if (duplicates.size > 0) {
    throw new Error(`Duplicate catalog id: ${Array.from(duplicates).join(', ')}`);
  }

  return {
    fileName: file.name,
    sizeBytes: file.size,
    rowCount: payload.length,
    duplicateIds: [],
    productTypes: Array.from(productTypes).sort((left, right) => left.localeCompare(right)),
    sha256: digest,
    schemaVersion: schemaVersion ?? 1,
  };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
