import { expect, test } from './fixtures';
import { seedAuthSession } from './auth-fixtures';

test('a prepared shell opens a fresh inspection and keeps its draft offline after reload', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
  const shell = await page.evaluate(async () => {
    const worker = (await navigator.serviceWorker.ready).active;
    if (!worker) throw new Error('Service worker is not active');
    return await new Promise<{ routes: number; template: boolean }>((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => reject(new Error('Offline shell preparation timed out')), 60_000);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timeout);
        if (event.data.type !== 'PREPARE_OFFLINE_RESULT') reject(new Error(event.data.message));
        else resolve({ routes: event.data.cachedRoutes, template: event.data.templateCached });
      };
      worker.postMessage({ type: 'PREPARE_OFFLINE' }, [channel.port2]);
    });
  });
  expect(shell).toEqual({ routes: 12, template: true });

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
  const wordDownload = page.waitForEvent('download');
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
  await page.context().setOffline(false);
});
