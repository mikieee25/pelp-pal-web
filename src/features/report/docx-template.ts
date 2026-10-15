import JSZip from 'jszip';
import type { ReportDraft } from '@/lib/db/records';
import type { ConsolidatedProduct, ReportSummary } from './report-model';
import { DOCX_SLOTS } from './docx-slots';
import { readEvidenceArrayBuffer } from '@/lib/evidence/validation';

export type EmvReportExportInput = {
  draft: ReportDraft;
  summary: ReportSummary;
  nonCompliantProducts: ConsolidatedProduct[];
  photoAppendix?: ReportPhotoProduct[];
};

export type ReportPhotoProduct = { controlNumber: string; brand: string; model: string; photos: Array<{ blob: Blob; width: number; height: number }> };

const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export async function populateEmvReportTemplate(input: EmvReportExportInput): Promise<Blob> {
  const response = await fetch('/EMV Report Sample.docx');
  if (!response.ok) throw new Error(`The EMV report template could not be loaded (HTTP ${response.status}).`);
  const sourceBytes = await response.arrayBuffer();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(sourceBytes);
  } catch (error) {
    throw new Error(`The EMV report template could not be opened: ${error instanceof Error ? error.message : String(error)}`);
  }
  const documentEntry = zip.file(DOCX_SLOTS.documentXml);
  if (!documentEntry) throw new Error('The EMV report template is missing word/document.xml.');

  const xml = await documentEntry.async('string');
  const parser = new DOMParser();
  const document = parser.parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The EMV report template contains invalid document XML.');

  populateMetadata(document, input.draft);
  populateSummary(document, input.summary);
  populateAnnex(document, input.nonCompliantProducts);
  await populatePhotoAppendix(document, zip, input.photoAppendix ?? []);

  const serialized = new XMLSerializer().serializeToString(document);
  zip.file(DOCX_SLOTS.documentXml, serialized);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

async function populatePhotoAppendix(document: XMLDocument, zip: JSZip, products: ReportPhotoProduct[]): Promise<void> {
  const photoProducts = products.filter((product) => product.photos.length > 0);
  if (!photoProducts.length) return;
  const relsPath = 'word/_rels/document.xml.rels';
  const relsFile = zip.file(relsPath);
  if (!relsFile) throw new Error('The EMV report template has no document relationships file.');
  const parser = new DOMParser();
  const rels = parser.parseFromString(await relsFile.async('string'), 'application/xml');
  if (rels.querySelector('parsererror')) throw new Error('The EMV report relationships are invalid.');
  const relRoot = rels.documentElement;
  const relationshipNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const relationshipType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
  let relationId = Math.max(0, ...Array.from(relRoot.children).map((item) => Number(item.getAttribute('Id')?.replace(/^rId/, '') ?? 0))) + 1;
  let imageIndex = 1;
  const body = document.getElementsByTagNameNS(WORD_NAMESPACE, 'body')[0];
  if (!body) throw new Error('The EMV report template has no document body.');
  const finalSection = Array.from(body.children).find((item) => item.localName === 'sectPr');
  const insert = (element: Element) => body.insertBefore(element, finalSection ?? null);
  for (const product of photoProducts) {
    insert(textParagraph(document, `Photo evidence — ${product.controlNumber || 'Control number unavailable'}`, true));
    insert(textParagraph(document, `Brand: ${product.brand || 'Not available'} · Model: ${product.model || 'Not available'}`, false));
    for (const photo of product.photos) {
      const id = `rId${relationId++}`;
      const name = `evidence-${imageIndex++}.jpeg`;
      relRoot.appendChild(createXmlElement(rels, relationshipNs, 'Relationship', { Id: id, Type: relationshipType, Target: `media/${name}` }));
      zip.file(`word/media/${name}`, await readEvidenceArrayBuffer(photo.blob));
      insert(photoParagraph(document, id, name, photo.width, photo.height, imageIndex));
    }
  }
  const root = document.documentElement;
  for (const prefix of ['wp', 'a', 'pic', 'r']) root.setAttributeNS('http://www.w3.org/2000/xmlns/', `xmlns:${prefix}`, namespaceFor(prefix));
  zip.file(relsPath, new XMLSerializer().serializeToString(rels));
}

function textParagraph(document: XMLDocument, text: string, heading: boolean): Element {
  const paragraph = document.createElementNS(WORD_NAMESPACE, 'w:p');
  const run = document.createElementNS(WORD_NAMESPACE, 'w:r');
  const value = document.createElementNS(WORD_NAMESPACE, 'w:t');
  if (heading) {
    const properties = document.createElementNS(WORD_NAMESPACE, 'w:pPr');
    const style = document.createElementNS(WORD_NAMESPACE, 'w:pStyle');
    style.setAttributeNS(WORD_NAMESPACE, 'w:val', 'Heading2');
    properties.appendChild(style);
    paragraph.appendChild(properties);
  }
  value.setAttribute('xml:space', 'preserve');
  value.textContent = text;
  run.appendChild(value);
  paragraph.appendChild(run);
  return paragraph;
}

function photoParagraph(document: XMLDocument, relationshipId: string, name: string, width: number, height: number, drawingId: number): Element {
  const cm8 = 2_880_000;
  const safeWidth = width > 0 ? width : 4;
  const safeHeight = height > 0 ? height : 3;
  const cx = cm8;
  const cy = Math.round(cx * safeHeight / safeWidth);
  const paragraph = document.createElementNS(WORD_NAMESPACE, 'w:p');
  const run = document.createElementNS(WORD_NAMESPACE, 'w:r');
  const drawing = createXmlElement(document, namespaceFor('w'), 'w:drawing');
  const inline = createXmlElement(document, namespaceFor('wp'), 'wp:inline', { distT: '0', distB: '0', distL: '0', distR: '0' });
  inline.appendChild(createXmlElement(document, namespaceFor('wp'), 'wp:extent', { cx: String(cx), cy: String(cy) }));
  inline.appendChild(createXmlElement(document, namespaceFor('wp'), 'wp:docPr', { id: String(drawingId), name }));
  inline.appendChild(createXmlElement(document, namespaceFor('wp'), 'wp:cNvGraphicFramePr'));
  const graphic = createXmlElement(document, namespaceFor('a'), 'a:graphic');
  const graphicData = createXmlElement(document, namespaceFor('a'), 'a:graphicData', { uri: 'http://schemas.openxmlformats.org/drawingml/2006/picture' });
  const picture = createXmlElement(document, namespaceFor('pic'), 'pic:pic');
  const nonVisual = createXmlElement(document, namespaceFor('pic'), 'pic:nvPicPr');
  nonVisual.appendChild(createXmlElement(document, namespaceFor('pic'), 'pic:cNvPr', { id: String(drawingId), name }));
  nonVisual.appendChild(createXmlElement(document, namespaceFor('pic'), 'pic:cNvPicPr'));
  picture.appendChild(nonVisual);
  const fill = createXmlElement(document, namespaceFor('pic'), 'pic:blipFill');
  fill.appendChild(createXmlElement(document, namespaceFor('a'), 'a:blip', { 'r:embed': relationshipId }));
  const stretch = createXmlElement(document, namespaceFor('a'), 'a:stretch');
  stretch.appendChild(createXmlElement(document, namespaceFor('a'), 'a:fillRect'));
  fill.appendChild(stretch);
  picture.appendChild(fill);
  const shape = createXmlElement(document, namespaceFor('pic'), 'pic:spPr');
  const transform = createXmlElement(document, namespaceFor('a'), 'a:xfrm');
  transform.appendChild(createXmlElement(document, namespaceFor('a'), 'a:off', { x: '0', y: '0' }));
  transform.appendChild(createXmlElement(document, namespaceFor('a'), 'a:ext', { cx: String(cx), cy: String(cy) }));
  shape.appendChild(transform);
  const geometry = createXmlElement(document, namespaceFor('a'), 'a:prstGeom', { prst: 'rect' });
  geometry.appendChild(createXmlElement(document, namespaceFor('a'), 'a:avLst'));
  shape.appendChild(geometry);
  picture.appendChild(shape);
  graphicData.appendChild(picture);
  graphic.appendChild(graphicData);
  inline.appendChild(graphic);
  drawing.appendChild(inline);
  run.appendChild(drawing);
  paragraph.appendChild(run);
  return paragraph;
}

function createXmlElement(document: XMLDocument, namespace: string, qualifiedName: string, attributes: Record<string, string> = {}): Element {
  const element = document.createElementNS(namespace, qualifiedName);
  for (const [name, value] of Object.entries(attributes)) {
    if (name.includes(':')) element.setAttributeNS(namespaceFor(name.slice(0, name.indexOf(':'))), name, value);
    else element.setAttribute(name, value);
  }
  return element;
}

function namespaceFor(prefix: string): string {
  return ({ w: WORD_NAMESPACE, wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', a: 'http://schemas.openxmlformats.org/drawingml/2006/main', pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture', r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' } as Record<string, string>)[prefix] ?? '';
}

export async function downloadEmvReport(input: EmvReportExportInput): Promise<void> {
  const blob = await populateEmvReportTemplate(input);
  const filename = `EMV-Report-${sanitizeFilename(input.draft.storeName || input.draft.storeKey)}-${sanitizeFilename(input.draft.inspectionDate || new Date().toISOString().slice(0, 10))}.docx`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function populateMetadata(document: XMLDocument, draft: ReportDraft): void {
  replaceParagraphContaining(document, DOCX_SLOTS.paragraphs.inspectionMetadata, `Date of Inspection: ${draft.inspectionDate || '________________'}    Region/Province: ${draft.regionProvince || '________________'}`);
  replaceParagraphContaining(document, DOCX_SLOTS.paragraphs.monitoringTeam, `DOE Monitoring Team (DMT): ${draft.monitoringTeam || '________________'}`);
  replaceParagraphContaining(document, DOCX_SLOTS.paragraphs.storeName, `Name of Store: ${draft.storeName || '________________'}`);
  replaceParagraphContaining(document, DOCX_SLOTS.paragraphs.address, `Address: ${draft.address || '________________'}`);
  replaceParagraphContaining(document, DOCX_SLOTS.paragraphs.email, `Email Address: ${draft.email || '________________'}`);
  replaceParagraphContaining(document, DOCX_SLOTS.paragraphs.contactNumber, `Contact Number: ${draft.contactNumber || '________________'}`);
  replaceParagraphContaining(document, DOCX_SLOTS.paragraphs.representative, `Store Representative: ${draft.storeRepresentative || '________________'}`);
  replaceFollowingParagraph(document, DOCX_SLOTS.paragraphs.findings, draft.findings || '');
  replaceFollowingParagraph(document, DOCX_SLOTS.paragraphs.recommendations, draft.recommendations || '');
  replaceParagraphContaining(document, DOCX_SLOTS.paragraphs.signatures, `Team Leader: ${draft.teamLeader || '________________'}    Acknowledged by: ${draft.acknowledgedBy || '________________'}`);
  replaceParagraphContaining(document, DOCX_SLOTS.paragraphs.designations, `Designation: ${draft.teamLeaderDesignation || '________________'}    Designation: ${draft.representativeDesignation || '________________'}`);
}

function populateSummary(document: XMLDocument, summary: ReportSummary): void {
  const table = tables(document)[DOCX_SLOTS.summaryTableIndex];
  if (!table) throw new Error('The EMV report template is missing the monitoring summary table.');
  const rows = table.getElementsByTagNameNS(WORD_NAMESPACE, 'tr');
  summary.complianceRows.forEach((row, index) => {
    const cells = rowCells(rows[index + 2]);
    if (cells.length >= 6) {
      setCellText(cells[1], String(row.labeled));
      setCellText(cells[2], String(row.exempted));
      setCellText(cells[3], String(row.nonCompliant));
      setCellText(cells[4], '0');
      setCellText(cells[5], String(row.models));
    }
  });
  const totalCells = rowCells(rows[7]);
  if (totalCells.length >= 5) {
    setCellText(totalCells[1], `${summary.totals.labeled} / ${summary.totals.exempted}`);
    setCellText(totalCells[2], String(summary.totals.nonCompliant));
    setCellText(totalCells[3], '0');
    setCellText(totalCells[4], String(summary.totals.models));
  }
  const rateCells = rowCells(rows[8]);
  if (rateCells[1]) setCellText(rateCells[1], formatRate(summary.totals.compliance));
}

function populateAnnex(document: XMLDocument, products: ConsolidatedProduct[]): void {
  const table = tables(document)[DOCX_SLOTS.annexTableIndex];
  if (!table) throw new Error('The EMV report template is missing the Annex A table.');
  const initialRows = Array.from(table.getElementsByTagNameNS(WORD_NAMESPACE, 'tr'));
  const templateRow = initialRows[1];
  if (!templateRow && products.length > 0) throw new Error('The Annex A table has no product row template.');
  products.forEach((product, index) => {
    let row = initialRows[index + 1];
    if (!row && templateRow) {
      row = templateRow.cloneNode(true) as Element;
      table.appendChild(row);
    }
    const cells = rowCells(row);
    if (cells.length < 5) return;
    setCellText(cells[0], String(index + 1));
    setCellText(cells[1], product.productType || 'Not available');
    setCellText(cells[2], product.brand || 'Not available');
    setCellText(cells[3], product.model || 'Not available');
    setCellText(cells[4], product.findings.join('; ') || 'Non-compliant finding');
  });
}

function tables(document: XMLDocument): Element[] {
  return Array.from(document.getElementsByTagNameNS(WORD_NAMESPACE, 'tbl'));
}

function rowCells(row: Element | undefined): Element[] {
  return row ? Array.from(row.getElementsByTagNameNS(WORD_NAMESPACE, 'tc')) : [];
}

function setCellText(cell: Element, value: string): void {
  const document = cell.ownerDocument;
  const paragraph = cell.getElementsByTagNameNS(WORD_NAMESPACE, 'p')[0];
  const paragraphProperties = paragraph?.getElementsByTagNameNS(WORD_NAMESPACE, 'pPr')[0]?.cloneNode(true);
  const runProperties = paragraph?.getElementsByTagNameNS(WORD_NAMESPACE, 'rPr')[0]?.cloneNode(true);
  Array.from(cell.childNodes).forEach((child) => {
    if (child.nodeType === 1 && (child as Element).localName === 'tcPr') return;
    cell.removeChild(child);
  });
  const newParagraph = document.createElementNS(WORD_NAMESPACE, 'w:p');
  if (paragraphProperties) newParagraph.appendChild(paragraphProperties);
  const run = document.createElementNS(WORD_NAMESPACE, 'w:r');
  if (runProperties) run.appendChild(runProperties);
  const text = document.createElementNS(WORD_NAMESPACE, 'w:t');
  text.setAttribute('xml:space', 'preserve');
  text.textContent = value;
  run.appendChild(text);
  newParagraph.appendChild(run);
  cell.appendChild(newParagraph);
}

function replaceParagraphContaining(document: XMLDocument, label: string, value: string): void {
  const paragraph = Array.from(document.getElementsByTagNameNS(WORD_NAMESPACE, 'p')).find((candidate) => paragraphText(candidate).includes(label));
  if (paragraph) setParagraphText(paragraph, value);
}

function replaceFollowingParagraph(document: XMLDocument, label: string, value: string): void {
  const paragraph = Array.from(document.getElementsByTagNameNS(WORD_NAMESPACE, 'p')).find((candidate) => paragraphText(candidate).includes(label));
  let next = paragraph?.nextElementSibling;
  while (next && next.localName !== 'p') next = next.nextElementSibling;
  if (next?.localName === 'p') setParagraphText(next, value);
}

function paragraphText(paragraph: Element): string {
  return Array.from(paragraph.getElementsByTagNameNS(WORD_NAMESPACE, 't')).map((text) => text.textContent ?? '').join('');
}

function setParagraphText(paragraph: Element, value: string): void {
  const document = paragraph.ownerDocument;
  const paragraphProperties = paragraph.getElementsByTagNameNS(WORD_NAMESPACE, 'pPr')[0]?.cloneNode(true);
  const runProperties = paragraph.getElementsByTagNameNS(WORD_NAMESPACE, 'rPr')[0]?.cloneNode(true);
  Array.from(paragraph.childNodes).forEach((child) => {
    if (child.nodeType === 1 && (child as Element).localName === 'pPr') return;
    paragraph.removeChild(child);
  });
  if (paragraphProperties && !paragraph.getElementsByTagNameNS(WORD_NAMESPACE, 'pPr')[0]) paragraph.appendChild(paragraphProperties);
  const run = document.createElementNS(WORD_NAMESPACE, 'w:r');
  if (runProperties) run.appendChild(runProperties);
  const text = document.createElementNS(WORD_NAMESPACE, 'w:t');
  text.setAttribute('xml:space', 'preserve');
  text.textContent = value;
  run.appendChild(text);
  paragraph.appendChild(run);
}

function formatRate(value: number | null): string { return value === null ? 'N/A' : `${value.toFixed(0)}%`; }
function sanitizeFilename(value: string): string { return value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'report'; }
