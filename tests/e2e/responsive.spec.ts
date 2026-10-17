import { expect, test } from '@playwright/test';
import { seedAuthSession } from './auth-fixtures';

test('keeps dashboard actions and stats visible without horizontal overflow', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/dashboard');

  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const scan = page.getByRole('link', { name: 'Scan label' });
    await expect(scan).toBeVisible();
    const box = await scan.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(43);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('keeps the lookup search, QR action, and product filters inside narrow screens', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/lookup');

  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const search = page.getByRole('textbox', { name: 'Search local catalog' });
    const scan = page.getByRole('button', { name: 'Scan QR code' });
    const field = await search.locator('xpath=ancestor::form').boundingBox();
    const scanBox = await scan.boundingBox();
    await expect(search).toBeVisible();
    await expect(scan).toBeVisible();
    expect(field).not.toBeNull();
    expect(scanBox).not.toBeNull();
    expect(field!.x).toBeGreaterThanOrEqual(0);
    expect(field!.x + field!.width).toBeLessThanOrEqual(width);
    expect(scanBox!.x + scanBox!.width).toBeLessThanOrEqual(field!.x + field!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('keeps Activity store rows, filters, and actions inside the viewport', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/activity');

  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('group', { name: 'Activity outcome filter' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('keeps Summary cards and tables responsive without horizontal overflow', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/summary');

  const complianceTable = page.getByRole('table', { name: 'Compliance summary table' });
  const mobileCards = page.getByTestId('summary-mobile-compliance-card').first();
  await expect(page.getByTestId('summary-filter-bar')).toBeVisible();

  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width >= 768) {
      await expect(complianceTable).toBeVisible();
      await expect(mobileCards).toBeHidden();
    } else {
      await expect(complianceTable).toBeHidden();
      await expect(mobileCards).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('keeps Report fields and download action usable at every viewport', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/report');

  const download = page.getByRole('button', { name: 'Download Word report' });
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('textbox', { name: 'Store name' })).toBeVisible();
    await expect(download).toBeVisible();
    const box = await download.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(43);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('keeps new and existing inspection forms and sticky actions usable at every viewport', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/store?returnTo=%2Fdashboard');
  await page.getByRole('textbox', { name: 'Store name' }).fill('Responsive Test Store');
  await page.getByRole('combobox', { name: 'Location' }).click();
  await page.getByRole('combobox', { name: 'Location' }).selectOption('NCR');
  await page.getByRole('button', { name: 'Save store details' }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByText('Store: Responsive Test Store', { exact: true }).filter({ visible: true })).toBeVisible();

  await page.goto('/inspect/new?catalogId=responsive-fixture');
  await expect(page.getByRole('heading', { name: 'Inspection' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Product control number' })).toBeVisible();

  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId('action-bar')).toBeVisible();
    const saveDraft = page.getByRole('button', { name: 'Save draft' });
    await expect(saveDraft).toBeVisible();
    await expect.poll(async () => {
      const box = await saveDraft.boundingBox();
      return box !== null && box.height >= 43 && box.x + box.width <= width;
    }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('keeps inspection view and edit actions responsive', async ({ page }) => {
  await seedAuthSession(page);
  await page.route('**/rest/v1/rpc/pull_sync_changes', (route) => route.fulfill({ json: { revisions: [], activities: [], conflicts: [], deletions: [] } }));
  await page.goto('/sync');
  await page.getByTestId('sync-advanced-accordion').getByText('Advanced', { exact: true }).click();
  const inspection = { id: 'responsive-existing-inspection', status: 'completed', storeName: 'sample', controlNumber: 'ACU-0014-000863', model: 'FTKQ20BVA/RKQ20BVA', productType: 'Air Conditioners', location: 'Mindanao', outcome: 'compliant', currentStep: 'checklist', labeling: 'with_label', placement: 'passing', visualQuality: 'passing', productDetails: 'passing' };
  await page.getByLabel('Import and merge JSON').setInputFiles({ name: 'responsive.pelp.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    format: 'pelp-pal-transfer', schemaVersion: 1, exportMode: 'records', exportedAt: '2026-10-12T08:00:00.000Z', appVersion: '0.1.0', organizationId: '00000000-0000-4000-8000-000000000003',
    records: { inspections: [inspection], revisions: [], activities: [{ id: 'responsive-activity', inspection_id: inspection.id, event_type: 'inspection_completed', payload: inspection }], evidence: [], evidenceBlobs: [], outbox: [] },
  })) });
  await page.getByRole('button', { name: 'Merge imported data' }).click();
  await expect(page.getByRole('heading', { name: 'Review import' })).not.toBeVisible();

  for (const path of [`/inspect/${inspection.id}?view=1`, `/inspect/${inspection.id}`]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Inspection', exact: true })).toBeVisible();
    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByTestId('action-bar')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
});

test('keeps Personnel rows and account actions inside all viewport widths', async ({ page }) => {
  await seedAuthSession(page);
  await page.route('**/rest/v1/rpc/current_account', (route) => route.fulfill({ json: { account_id: '00000000-0000-4000-8000-000000000001', organization_id: '00000000-0000-4000-8000-000000000003', username: 'admin.one', role: 'admin', is_active: true, credential_version: 1, must_change_password: false } }));
  await page.route('**/functions/v1/personnel-management', (route) => route.fulfill({ json: { personnel: [{ id: 'person-e2e', organization_id: 'org-e2e', username: 'staff.one', display_name: 'Staff One', role: 'epred', is_active: true, archived_at: null, archived_by: null, must_change_password: false, updated_at: '2026-10-15T00:00:00Z' }] } }));
  await page.goto('/personnel');
  await expect(page.getByText('Staff One', { exact: true })).toBeVisible();

  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const actions = page.getByRole('button', { name: 'Actions for Staff One' });
    await expect(actions).toBeVisible();
    const box = await actions.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('keeps Account sync access instructions readable beside the action', async ({ page }) => {
  await seedAuthSession(page);
  await page.route('**/rest/v1/rpc/current_account', (route) => route.fulfill({ json: { account_id: '00000000-0000-4000-8000-000000000001', organization_id: '00000000-0000-4000-8000-000000000003', username: 'staff.one', role: 'epred', is_active: true, credential_version: 1, must_change_password: false } }));
  await page.goto('/account');

  const action = page.getByRole('link', { name: 'View sync status' });
  const instructions = page.getByText('Sign in on another browser with this account to continue the same shared workspace.');
  await expect(action).toBeVisible();
  await expect(instructions).toBeVisible();
  for (const width of [320, 375, 768, 912, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const textBox = await instructions.boundingBox();
    const actionBox = await action.boundingBox();
    expect(textBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    expect(textBox!.width).toBeGreaterThanOrEqual(width >= 600 ? 200 : 150);
    expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('keeps Store details and save controls usable at every viewport', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/store?returnTo=%2Fdashboard');

  const save = page.getByRole('button', { name: 'Save store details' });
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('textbox', { name: 'Store name' })).toBeVisible();
    await expect(save).toBeVisible();
    const box = await save.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(43);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('keeps inspection status and actions inside the mobile card', async ({ page }) => {
  await seedAuthSession(page);
  await page.route('**/rest/v1/rpc/pull_sync_changes', (route) => route.fulfill({ json: { revisions: [], activities: [], conflicts: [], deletions: [] } }));
  await page.goto('/sync');
  await expect(page.locator('[data-testid="sync-status-pill"]:visible').first()).toBeVisible();
  await page.getByTestId('sync-advanced-accordion').getByText('Advanced', { exact: true }).click();
  const inspection = { id: 'mobile-inspection', status: 'completed', storeName: 'sample', controlNumber: 'ACU-0014-000863', model: 'FTKQ20BVA/RKQ20BVA', productType: 'Air Conditioners', location: 'Mindanao', outcome: 'compliant' };
  await page.getByLabel('Import and merge JSON').setInputFiles({ name: 'mobile.pelp.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    format: 'pelp-pal-transfer', schemaVersion: 1, exportMode: 'records', exportedAt: '2026-10-12T08:00:00.000Z', appVersion: '0.1.0', organizationId: '00000000-0000-4000-8000-000000000003',
    records: { inspections: [inspection], revisions: [], activities: [{ id: 'mobile-activity', inspection_id: inspection.id, event_type: 'inspection_completed', payload: inspection }], evidence: [], evidenceBlobs: [], outbox: [] },
  })) });
  await page.getByRole('button', { name: 'Merge imported data' }).click();
  await expect(page.getByRole('heading', { name: 'Review import' })).not.toBeVisible();
  await page.goto('/activity');
  await page.getByRole('button', { name: 'Expand sample inspections' }).click();
  const inspectionRow = page.getByRole('link', { name: new RegExp(`${inspection.controlNumber}.*${inspection.model}`) });
  await expect(inspectionRow).toBeVisible();
  await expect(inspectionRow).toContainText('Compliant');
  const rowBox = await inspectionRow.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(rowBox!.x).toBeGreaterThanOrEqual(0);
  expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  await expect(page.getByRole('button', { name: `Inspection actions for ${inspection.controlNumber}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `Delete inspection ${inspection.controlNumber}` })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('keeps the login form usable without horizontal overflow', async ({ page }) => {
  await page.goto('/login');
  const username = page.getByRole('textbox', { name: /username/i });
  const password = page.getByRole('textbox', { name: /password/i });
  await expect(username).toBeVisible();
  await expect(password).toBeVisible();
  const signInButton = page.getByRole('button', { name: /sign in/i });
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const field of [username, password]) {
      const fieldBox = await field.boundingBox();
      expect(fieldBox).not.toBeNull();
      expect(fieldBox!.x).toBeGreaterThanOrEqual(0);
      expect(fieldBox!.x + fieldBox!.width).toBeLessThanOrEqual(width);
    }
    const buttonBox = await signInButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.height).toBeGreaterThanOrEqual(43);
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
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
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
  await expect(page.locator('[data-testid="sync-status-pill"]:visible').first()).toBeVisible();
  await page.getByTestId('sync-advanced-accordion').getByText('Advanced', { exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Recovery transfer' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  for (const name of ['Force upload inspections', 'Force download inspections', 'Export recovery JSON']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    expect(box!.height).toBeGreaterThanOrEqual(43);
  }
  const importInput = page.getByLabel('Import and merge JSON');
  await expect(importInput).toBeVisible();
  const importBox = await importInput.locator('xpath=ancestor::label').boundingBox();
  expect(importBox).not.toBeNull();
  expect(importBox!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  expect(importBox!.height).toBeGreaterThanOrEqual(43);
});
