import type { CatalogRecord } from '@/lib/db/records';

const ECP_TYPE_KEYS = ['ecp_type', 'ecpType', 'product_type', 'productType', 'type'];

export function getEcpType(row: CatalogRecord): string | undefined {
  const value = ECP_TYPE_KEYS
    .map((key) => row[key])
    .find((candidate) => typeof candidate === 'string' && candidate.trim());

  return typeof value === 'string' ? value.trim() : undefined;
}

export function getEcpTypes(rows: CatalogRecord[]): string[] {
  return Array.from(new Set(rows.map(getEcpType).filter((value): value is string => Boolean(value))))
    .sort((left, right) => left.localeCompare(right));
}
