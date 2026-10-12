import { expect, test } from '@playwright/test';
import { seedAuthSession } from './auth-fixtures';

test('keeps inspection status and actions inside the mobile card', async ({ page }) => {
  await seedAuthSession(page);
  await page.route('**/rest/v1/rpc/pull_sync_changes', (route) => route.fulfill({ json: { revisions: [], activities: [], conflicts: [], deletions: [] } }));
  await page.goto('/sync');
  const inspection = { id: 'mobile-inspection', status: 'completed', storeName: 'sample', controlNumber: 'ACU-0014-000863', model: 'FTKQ20BVA/RKQ20BVA', productType: 'Air Conditioners', location: 'Mindanao', outcome: 'compliant' };
  await page.getByLabel('Import and merge JSON').setInputFiles({ name: 'mobile.pelp.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    format: 'pelp-pal-transfer', schemaVersion: 1, exportMode: 'records', exportedAt: '2026-10-12T08:00:00.000Z', appVersion: '0.1.0', organizationId: '00000000-0000-4000-8000-000000000003',
    records: { inspections: [inspection], revisions: [], activities: [{ id: 'mobile-activity', inspection_id: inspection.id, event_type: 'inspection_completed', payload: inspection }], evidence: [], evidenceBlobs: [], outbox: [] },
  })) });
  await page.getByRole('button', { name: 'Merge imported data' }).click();
  await expect(page.getByRole('heading', { name: 'Review import' })).not.toBeVisible();
  await page.goto('/activity');
  const heading = page.getByRole('heading', { name: inspection.controlNumber, exact: true });
  await expect(heading).toBeVisible();
  const card = page.locator('[data-inspection-card]').filter({ has: heading });
  const cardBox = await card.boundingBox();
  expect(cardBox).not.toBeNull();
  for (const control of [card.getByText('Compliant', { exact: true }), card.getByRole('link', { name: 'View', exact: true }), card.getByRole('link', { name: 'Edit inspection', exact: true }), card.getByRole('button', { name: /Inspection actions/ })]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(cardBox!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('keeps the login form usable without horizontal overflow', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('textbox', { name: /username/i })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /password/i })).toBeVisible();
  const signInButton = page.getByRole('button', { name: /sign in/i });
  const buttonBox = await signInButton.boundingBox();

  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('keeps mobile workspace navigation visible', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Dashboard' }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('keeps lookup search and QR scanning usable on narrow screens', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/lookup');
  await expect(page.getByRole('textbox', { name: /search local catalog/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /scan qr code/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('keeps sync actions usable without horizontal overflow', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/sync');

  await expect(page.getByRole('heading', { name: 'Recovery transfer' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  for (const name of ['Force upload inspections', 'Force download inspections', 'Sync everything', 'Export recovery JSON', 'Import and merge JSON']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
