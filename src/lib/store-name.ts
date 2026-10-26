export function normalizeStoreName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-PH');
}
