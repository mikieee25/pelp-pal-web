import { expect, test } from './fixtures';
import { seedAuthSession } from './auth-fixtures';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

test('a prepared shell opens a fresh inspection and keeps its draft offline after reload', async ({ page }) => {
  await seedAuthSession(page);
  const catalogJson = JSON.stringify([{ id: 'offline-product-1', product_type: 'Air Conditioners', model: 'OFFLINE-1', brand: 'Offline Test' }]);
  await page.route('**/rest/v1/catalog_manifests*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ catalog_role: 'masterlist', version: 1, integrity_hash: createHash('sha256').update(catalogJson).digest('hex'), row_count: 1, schema_version: 1, storage_path: 'masterlist.json' }]),
  }));
  await page.route('**/storage/v1/object/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: catalogJson }));
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
  await page.goto('/sync');
  await page.getByRole('button', { name: 'Prepare for offline work' }).click();
  await expect(page.getByText(/Ready for offline work\. 1 catalog products and 12 app pages are saved/i)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Catalog saved and verified')).toBeVisible();
  await expect(page.getByText('App pages and Word template')).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('pelp-pal-web');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('stores', 'readwrite');
        transaction.objectStore('stores').put({ id: 'current', storeId: 'offline-store-1', name: 'Offline Test Store', location: 'NCR', updatedAt: new Date().toISOString() });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.context().setOffline(true);
  const inspectionId = '7c62033a-631e-4a66-876e-8f34a8965781';
  await page.goto(`/inspect/work?inspectionId=${inspectionId}`);
  const remarks = page.getByRole('textbox', { name: 'Remarks' });
  await expect(remarks).toBeVisible();
  await remarks.fill('saved without a connection');
  await expect.poll(() => page.evaluate((id) => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('pelp-pal-web');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('inspectionDrafts').objectStore('inspectionDrafts').get(id);
      read.onsuccess = () => { db.close(); resolve(String(read.result?.remarks ?? '')); };
      read.onerror = () => reject(read.error);
    };
  }), inspectionId)).toBe('saved without a connection');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Remarks' })).toHaveValue('saved without a connection');

  const reportTemplate = await page.evaluate(async () => {
    const response = await fetch('/EMV Report Sample.docx');
    return { ok: response.ok, signature: Array.from(new Uint8Array(await response.arrayBuffer()).slice(0, 2)) };
  });
  expect(reportTemplate).toEqual({ ok: true, signature: [80, 75] });

  await page.goto('/report');
  const wordDownload = page.waitForEvent('download', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Download Word report' }).click();
  const wordFile = await wordDownload;
  expect(wordFile.suggestedFilename()).toMatch(/\.docx$/i);
  const wordBytes = await wordFile.createReadStream();
  const firstBytes = await new Promise<number[]>((resolve, reject) => {
    const chunks: Buffer[] = [];
    wordBytes.on('data', (chunk: Buffer) => chunks.push(chunk));
    wordBytes.on('end', () => resolve(Array.from(Buffer.concat(chunks).subarray(0, 2))));
    wordBytes.on('error', reject);
  });
  expect(firstBytes).toEqual([80, 75]);

  await page.goto('/sync');
  await page.getByRole('button', { name: 'Advanced' }).click();
  const recoveryDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export recovery JSON' }).click();
  const recoveryDownload = await recoveryDownloadPromise;
  expect(recoveryDownload.suggestedFilename()).toMatch(/\.pelp\.json$/i);
  const recoveryPath = await recoveryDownload.path();
  expect(recoveryPath).not.toBeNull();
  const recovery = JSON.parse(readFileSync(recoveryPath!, 'utf8')) as { format?: string; records?: { inspections?: unknown[] } };
  expect(recovery.format).toBe('pelp-pal-transfer');
  expect(recovery.records?.inspections).toEqual(expect.any(Array));
  await page.context().setOffline(false);
});
