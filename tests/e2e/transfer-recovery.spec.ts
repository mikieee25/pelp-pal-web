import { expect, installNetworkIsolation, test } from './fixtures';
import { seedAuthSession } from './auth-fixtures';

const emptyBundle = {
  format: 'pelp-pal-transfer',
  schemaVersion: 1,
  exportMode: 'records',
  exportedAt: '2026-10-12T08:00:00.000Z',
  appVersion: '0.1.0',
  organizationId: '00000000-0000-4000-8000-000000000003',
  records: { inspections: [], revisions: [], activities: [], evidence: [], evidenceBlobs: [], outbox: [] },
};

async function openAdvanced(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-testid="sync-status-pill"]:visible').first()).toBeVisible();
  await page.getByTestId('sync-advanced-accordion').getByText('Advanced', { exact: true }).click();
}

async function mockOfflineSync(page: import('@playwright/test').Page) {
  await page.route('**/rest/v1/rpc/pull_sync_changes', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ revisions: [], activities: [], conflicts: [], deletions: [] }),
  }));
  await page.route('**/rest/v1/inspections?*', (route) => route.fulfill({
    status: 200,
    headers: { 'content-range': '*/0' },
    body: '',
  }));
}

test('desktop fallback can export and preview the same JSON accepted on mobile-sized browsers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The recovery smoke test runs once in desktop Chromium; mobile API behavior is covered by the same file contract and unit mocks.');
  await seedAuthSession(page);
  await mockOfflineSync(page);
  await page.goto('/sync');
  await openAdvanced(page);

  await expect(page.getByRole('button', { name: 'Export recovery JSON' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export recovery JSON' }).click();
  await expect((await download).suggestedFilename()).toMatch(/\.pelp\.json$/);

  const input = page.getByLabel('Import and merge JSON');
  await input.setInputFiles({
    name: 'recovery.pelp.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(emptyBundle), 'utf8'),
  });
  await expect(page.getByRole('heading', { name: 'Review import' })).toBeVisible();
  await expect(page.getByText(/nothing changes until you confirm/i)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Review import' })).not.toBeVisible();
});

test('exports and merges an inspection between isolated browsers', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const blockedRequestsA = await installNetworkIsolation(contextA);
  const blockedRequestsB = await installNetworkIsolation(contextB);
  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await seedAuthSession(pageA);
    await seedAuthSession(pageB);
    for (const page of [pageA, pageB]) {
      await page.route('**/rest/v1/rpc/pull_sync_changes', (route) => route.fulfill({ json: { revisions: [], activities: [], conflicts: [], deletions: [] } }));
      await page.route('**/rest/v1/rpc/push_inspection_revisions', (route) => route.fulfill({ status: 503, json: { message: 'Offline recovery test' } }));
      await mockOfflineSync(page);
    }
    await pageA.goto('/sync');
    await pageB.goto('/sync');
    await openAdvanced(pageA);
    await openAdvanced(pageB);
    const inspection = { id: 'handoff-inspection', status: 'completed', currentRevision: 1, storeName: 'Recovery Store', controlNumber: 'ACU-HANDOFF', productType: 'Air Conditioners', model: 'HANDOFF-100', placement: 'failing', completedAt: '2026-10-12T08:00:00.000Z' };
    const recovery = { ...emptyBundle, exportMode: 'pending', records: {
      inspections: [inspection],
      revisions: [{ id: 'handoff-revision', inspection_id: inspection.id, revision: 1, payload: inspection }],
      activities: [{ id: 'handoff-activity', inspection_id: inspection.id, event_type: 'inspection_completed', payload: inspection }],
      evidence: [], evidenceBlobs: [],
      outbox: [{ id: 'handoff-outbox', aggregateId: inspection.id, kind: 'inspection', status: 'pending', payload: { inspection_id: inspection.id, revisions: [{ id: 'handoff-revision', inspection_id: inspection.id, revision: 1, payload: inspection }], events: [] } }],
    } };
    await pageA.getByLabel('Import and merge JSON').setInputFiles({ name: 'source.pelp.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recovery)) });
    await pageA.getByRole('button', { name: 'Merge imported data' }).click();
    await expect(pageA.getByRole('heading', { name: 'Review import' })).not.toBeVisible();
    await expect(pageA.getByRole('button', { name: 'Export recovery JSON' })).toBeEnabled();
    const downloadPromise = pageA.waitForEvent('download');
    await pageA.getByRole('button', { name: 'Export recovery JSON' }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    await pageB.getByLabel('Import and merge JSON').setInputFiles(path!);
    await expect(pageB.getByText('1 inspections', { exact: true })).toBeVisible();
    await pageB.getByRole('button', { name: 'Merge imported data' }).click();
    await expect(pageB.getByRole('heading', { name: 'Review import' })).not.toBeVisible();
    await pageB.goto('/activity');
    await pageB.getByRole('button', { name: /recovery store.*1 inspection/i }).click();
    const importedInspection = pageB.getByRole('link', { name: /ACU-HANDOFF/ });
    await expect(importedInspection).toBeVisible();
    await pageB.getByRole('button', { name: 'Non-compliant', exact: true }).click();
    await expect(importedInspection).toBeVisible();
    await pageB.goto('/summary');
    await expect(pageB.getByRole('table', { name: 'Non-compliance results table' })).toContainText('HANDOFF-100');
  } finally {
    expect(blockedRequestsA, 'Browser A attempted an unmocked external request').toEqual([]);
    expect(blockedRequestsB, 'Browser B attempted an unmocked external request').toEqual([]);
    await contextA.close();
    await contextB.close();
  }
});
