import { expect, test } from '@playwright/test';
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

test('desktop fallback can export and preview the same JSON accepted on mobile-sized browsers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The recovery smoke test runs once in desktop Chromium; mobile API behavior is covered by the same file contract and unit mocks.');
  await seedAuthSession(page);
  await page.goto('/sync');

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

test('live recovery handoff is available for disposable authenticated accounts', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The live handoff test runs only in desktop Chromium.');
  test.skip(
    process.env.E2E_SUPABASE !== '1',
    'Set E2E_SUPABASE=1 and provide disposable authenticated test accounts before running live recovery handoff coverage.',
  );

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await seedAuthSession(pageA);
    await seedAuthSession(pageB);
    await pageA.goto('/sync');
    await pageB.goto('/sync');
    await expect(pageA.getByRole('button', { name: 'Export recovery JSON' })).toBeVisible();
    await expect(pageB.getByRole('button', { name: 'Import and merge JSON' })).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
