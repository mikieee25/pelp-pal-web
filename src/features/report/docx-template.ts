import JSZip from 'jszip';
import type { ReportDraft } from '@/lib/db/records';
import type { ConsolidatedProduct, ReportSummary } from './report-model';
import { DOCX_SLOTS } from './docx-slots';

export type EmvReportExportInput = {
  draft: ReportDraft;
  summary: ReportSummary;
  nonCompliantProducts: ConsolidatedProduct[];
};

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

  const serialized = new XMLSerializer().serializeToString(document);
  zip.file(DOCX_SLOTS.documentXml, serialized);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
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
  const rows = table.getElementsByTagNameNS(WORD_NAMESPACE, 'tr');
  products.slice(0, Math.max(0, rows.length - 1)).forEach((product, index) => {
    const cells = rowCells(rows[index + 1]);
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
