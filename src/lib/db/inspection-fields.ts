export function readInspectionField(record: Record<string, unknown>, keys: string[]): string {
  const direct = findText(record, keys);
  if (direct) return direct;

  const snapshot = firstObject(record.productSnapshot, record.product_snapshot);
  const sources = [
    firstObject(record.dynamic_fields, record.dynamicFields),
    snapshot,
    firstObject(snapshot?.dynamicFields, snapshot?.dynamic_fields),
  ];
  const wanted = keys.map(normalizeFieldKey);
  for (const source of sources) {
    if (!source) continue;
    const match = Object.entries(source).find(([key, value]) => wanted.includes(normalizeFieldKey(key)) && textValue(value));
    if (match) return textValue(match[1]);
  }
  return '';
}

export function firstObject(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Continue through the remaining legacy representations.
    }
  }
  return undefined;
}

function findText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = textValue(record[key]);
    if (value) return value;
  }
  return '';
}

function textValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function normalizeFieldKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
