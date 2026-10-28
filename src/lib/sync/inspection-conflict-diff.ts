export type InspectionConflictDifference = {
  field: string;
  localValue: string;
  serverValue: string;
};

const ignoredFields = new Set([
  'accountscopekey',
  'clientcreatedat',
  'completedat',
  'createdat',
  'currentrevision',
  'currentrevisionid',
  'evidence',
  'id',
  'servercreatedat',
  'updatedat',
  'visibletoscopekeys',
]);

export function diffInspectionVersions(
  local: Record<string, unknown>,
  server: Record<string, unknown>,
): InspectionConflictDifference[] {
  const localFields = flatten(local);
  const serverFields = flatten(server);
  const keys = new Set([...localFields.keys(), ...serverFields.keys()]);
  const differences: InspectionConflictDifference[] = [];

  for (const key of keys) {
    const localValue = localFields.get(key);
    const serverValue = serverFields.get(key);
    if (localValue === serverValue) continue;
    differences.push({
      field: displayPath(key),
      localValue: localValue ?? '—',
      serverValue: serverValue ?? '—',
    });
  }

  return differences;
}

function flatten(record: Record<string, unknown>): Map<string, string> {
  const fields = new Map<string, string>();
  const visit = (value: unknown, path: string[]) => {
    if (value === undefined) return;
    if (Array.isArray(value)) {
      fields.set(path.join('.'), value.map(displayValue).join(', '));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [rawKey, child] of Object.entries(value)) {
        const key = canonicalKey(rawKey);
        if (ignoredFields.has(normalizeKey(rawKey)) || normalizeKey(rawKey).startsWith('evidence')) continue;
        visit(child, [...path, key]);
      }
      return;
    }
    fields.set(path.join('.'), displayValue(value));
  };

  visit(record, []);
  return fields;
}

function canonicalKey(key: string): string {
  const normalized = normalizeKey(key);
  if (['dynamicfields', 'checklistanswers'].includes(normalized)) return 'checklist';
  if (['productsnapshot', 'productdetails'].includes(normalized)) return 'product details';
  if (['productcontrolnumber', 'controlnumber', 'controlno'].includes(normalized)) return 'control number';
  if (['model', 'modelcode', 'modelnumber', 'modelnumbercode'].includes(normalized)) return 'model code';
  if (['brandname'].includes(normalized)) return 'brand';
  if (['storename'].includes(normalized)) return 'store name';
  if (['storelocation', 'storelocationname'].includes(normalized)) return 'location';
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
}

function displayPath(path: string): string {
  return path.split('.').map((part) => part.replace(/\b\w/g, (letter) => letter.toUpperCase())).join(': ');
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
