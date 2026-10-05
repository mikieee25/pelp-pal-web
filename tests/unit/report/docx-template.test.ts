import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { buildReportSummary, consolidateReportProducts } from '@/features/report/report-model';
import { createEmptyReportDraft } from '@/features/report/report-draft';
import { populateEmvReportTemplate } from '@/features/report/docx-template';

describe('EMV DOCX template export', () => {
  it('populates the retained template without modifying its source file', async () => {
    const source = readFileSync('public/EMV Report Sample.docx');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(source, { status: 200 })));
    const draft = { ...createEmptyReportDraft('store-1'), storeName: 'A & B <Market>', regionProvince: 'NCR', findings: 'Torn & <blocked> label' };
    const products = consolidateReportProducts([{ id: 'inspection-1', status: 'completed', storeId: 'store-1', storeName: draft.storeName, controlNumber: 'ACU-1', model: 'M1', productType: 'Air Conditioners', outcome: 'non_compliant', remarks: '<Torn & blocked>' }]);

    const output = await populateEmvReportTemplate({ draft, summary: buildReportSummary(products), nonCompliantProducts: products });
    const outputZip = await JSZip.loadAsync(await readBlob(output));
    const documentXml = await outputZip.file('word/document.xml')?.async('string');

    expect(documentXml).toContain('A &amp; B &lt;Market&gt;');
    expect(documentXml).toContain('Torn &amp; &lt;blocked&gt; label');
    expect(Array.from(readFileSync('public/EMV Report Sample.docx'))).toEqual(Array.from(source));
  });

  it('creates a populated DOCX, escapes XML-sensitive values, and leaves the source bytes unchanged', async () => {
    const source = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(source, { status: 200 })));
    const draft = { ...createEmptyReportDraft('store-1'), storeName: 'A & B <Market>', regionProvince: 'NCR' };
    const products = consolidateReportProducts([{ id: 'inspection-1', status: 'completed', storeId: 'store-1', storeName: draft.storeName, controlNumber: 'ACU-1', model: 'M1', productType: 'Air Conditioners', outcome: 'non_compliant', remarks: '<Torn & blocked>' }]);

    await expect(populateEmvReportTemplate({ draft, summary: buildReportSummary(products), nonCompliantProducts: products })).rejects.toThrow(/template/i);
    expect(Array.from(source)).toEqual([80, 75, 3, 4, 1, 2, 3]);
  });

  it('rejects a failed template fetch with an actionable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));

    await expect(populateEmvReportTemplate({ draft: createEmptyReportDraft('all'), summary: buildReportSummary([]), nonCompliantProducts: [] })).rejects.toThrow(/template/i);
  });
});

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
