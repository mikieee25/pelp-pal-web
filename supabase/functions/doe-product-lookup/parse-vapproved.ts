export type ParsedDoeRecord = {
  controlNumber: string;
  productType?: string;
  brand?: string;
  productName?: string;
  modelCode?: string;
  manufacturer?: string;
  fields: Record<string, string>;
  starRating: number;
  energyLabels: { labelNumber: string; validFrom?: string; validUntil?: string }[];
  imageUrls: string[];
  sourceUrl: string;
  fetchedAt: string;
  partial?: boolean;
};

const htmlDecode = (value: string) => value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function parseVapproved(html: string, sourceUrl: string, fetchedAt = new Date().toISOString()): ParsedDoeRecord | null {
  const fields: Record<string, string> = {};
  const fieldPattern = /<label[^>]*>\s*([^<]+?)\s*:?\s*<\/label>\s*<\/div>\s*<div[^>]*class=["'][^"']*col-md-7[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  for (const match of html.matchAll(fieldPattern)) {
    const label = htmlDecode(match[1]);
    const value = htmlDecode(match[2]);
    if (label && value) fields[label] = value;
  }
  const controlNumber = fields['Control Number'] ?? fields['Control number'] ?? html.match(/<b>\s*([A-Z0-9]+(?:-[A-Z0-9.]+){2,})\s*<\/b>/i)?.[1]?.trim();
  if (!controlNumber) return null;

  const find = (...names: string[]) => Object.entries(fields).find(([label]) => names.some((name) => key(label) === key(name)))?.[1];
  const energyLabels = Array.from(html.matchAll(/<b>\s*([^<]+)\s*<\/b>\s*<br\s*\/?>\s*\(\s*([^)]*?)\s*\)/gi)).map((match) => {
    const dates = htmlDecode(match[2]).split(/\s+[-–]\s+/);
    return { labelNumber: htmlDecode(match[1]), validFrom: parseDate(dates[0] ?? ''), validUntil: parseDate(dates[1] ?? '') };
  });
  const imageUrls = Array.from(html.matchAll(/<img[^>]+class=["'][^"']*img-thumbnail[^"']*["'][^>]+src=["']([^"']+)["']/gi)).map((match) => match[1]).filter((value) => /^primg\/[\w./%+-]+\.(?:png|jpe?g|webp)$/i.test(value)).map((value) => `https://pelp.doe.gov.ph/${value.replace(/^\/+/, '')}`);
  const record: ParsedDoeRecord = {
    controlNumber,
    productType: find('Product Type', 'ECP Type'),
    brand: find('Brand', 'Brand Name'),
    productName: find('Product Name', 'Product Model'),
    modelCode: find('Model Code', 'Model Number'),
    manufacturer: find('Manufacturer', 'Company', 'Company Name'),
    fields,
    starRating: (html.match(/fa-star(?!-o)/gi) ?? []).length,
    energyLabels,
    imageUrls,
    sourceUrl,
    fetchedAt,
  };
  if (!record.productType && !record.brand && !record.productName && !record.modelCode && !record.manufacturer) record.partial = true;
  return record;
}

function parseDate(value: string): string | undefined {
  const match = value.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return undefined;
  const month = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(match[2].toLowerCase());
  if (month < 0) return undefined;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1]))).toISOString().slice(0, 10);
}
