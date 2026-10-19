import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './fixtures';
import { seedAuthSession } from './auth-fixtures';

const screens = [
  { name: 'dashboard', path: '/dashboard', heading: 'Dashboard' },
  { name: 'lookup', path: '/lookup', heading: 'Find a product' },
  { name: 'activity', path: '/activity', heading: 'Activity' },
  { name: 'summary', path: '/summary', heading: 'Summary' },
  { name: 'report', path: '/report', heading: 'Report' },
  { name: 'sync', path: '/sync', heading: 'Sync' },
  { name: 'account', path: '/account', heading: 'Account' },
] as const;

async function checkAccessibility(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations, results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(', ')).join('; ')}`).join('\n')).toEqual([]);
}

async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
}

test.describe('workspace accessibility and visual baselines', () => {
  test.beforeEach(async ({ page }) => {
    page.clock.setFixedTime(new Date('2026-10-17T00:00:00.000Z'));
    await seedAuthSession(page);
    await page.route('**/rest/v1/rpc/pull_sync_changes', (route) => route.fulfill({ json: { revisions: [], activities: [], conflicts: [], deletions: [] } }));
    await page.route('**/rest/v1/inspections?*', (route) => route.fulfill({
      status: 200,
      headers: { 'content-range': '*/0' },
      body: '',
    }));
  });

  for (const screen of screens) {
    test(`${screen.name} is accessible and visually stable at phone and desktop widths`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.getByRole('heading', { name: screen.heading, exact: true }).first()).toBeVisible();
      await expect(page.locator('header').getByTestId('sync-status-pill-full-label')).toHaveText('Up to date', { timeout: 15_000 });

      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await checkAccessibility(page);
        await expect(page).toHaveScreenshot(`${screen.name}-${width}.png`, { fullPage: true, animations: 'disabled' });
      }
    });
  }

  test('filters sheet and scanner dialog have no accessibility violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/activity');
    await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /open filters/i }).click();
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
    await checkAccessibility(page);
    await page.getByRole('button', { name: /apply filters/i }).click();

    await page.goto('/lookup');
    await expect(page.getByRole('heading', { name: 'Find a product', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Scan QR code' }).click();
    const scannerDialog = page.getByRole('dialog', { name: /scan energy label/i });
    await expect(scannerDialog).toBeVisible();
    await expect(page.locator('[data-slot="modal-container"]')).not.toHaveAttribute('data-entering', 'true');
    const centering = await scannerDialog.evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect();
      const containerBounds = dialog.closest('[data-slot="modal-container"]')!.getBoundingClientRect();
      return { dialogCenter: bounds.left + bounds.width / 2, containerCenter: containerBounds.left + containerBounds.width / 2 };
    });
    expect(Math.abs(centering.dialogCenter - centering.containerCenter)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Close' }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Scan QR code' }).click();
    const desktopDialog = page.getByRole('dialog', { name: /scan energy label/i });
    await expect(desktopDialog).toBeVisible();
    await expect(page.locator('[data-slot="modal-container"]')).not.toHaveAttribute('data-entering', 'true');
    const desktopCenter = await desktopDialog.evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect();
      return { dialogCenter: bounds.left + bounds.width / 2, viewportCenter: document.body.getBoundingClientRect().width / 2 };
    });
    expect(Math.abs(desktopCenter.dialogCenter - desktopCenter.viewportCenter)).toBeLessThanOrEqual(1);
    await checkAccessibility(page);
  });

  test('activity filter popovers, row menu, navigation drawer, and confirmation dialog are accessible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/activity');
    await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /open filters/i }).click();
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
    await checkAccessibility(page);
    await page.getByRole('button', { name: /apply filters/i }).click();

    await page.getByRole('button', { name: 'Open workspace menu' }).click();
    const workspaceDrawer = page.getByRole('dialog', { name: 'Workspace menu' });
    await expect(workspaceDrawer).toBeVisible();
    await settleAnimations(page);
    await checkAccessibility(page);
    await page.getByRole('button', { name: 'Close workspace menu' }).click();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/activity');
    await page.getByTestId('activity-more-filters').click();
    await expect(page.getByRole('region', { name: 'More activity filters' })).toBeVisible();
    await checkAccessibility(page);

    await seedCompletedActivity(page);
    await page.reload();
    const storeDisclosure = page.getByRole('button', { name: 'Axe Store NCR · 1 inspection' });
    await expect(storeDisclosure).toBeVisible();
    await expect(page.getByTestId('activity-list')).toContainText('AXE-INSPECTION-001');
    const rowMenuButton = page.locator('button[aria-label^="Inspection actions for "]');
    await expect(rowMenuButton).toBeVisible();
    await rowMenuButton.click();
    await expect(page.getByRole('menu', { name: 'Inspection actions for AXE-INSPECTION-001' })).toBeVisible();
    await checkAccessibility(page);
    await page.getByRole('menuitem', { name: 'Delete inspection' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Delete inspection?' });
    await expect(confirmation).toBeVisible();
    await settleAnimations(page);
    await checkAccessibility(page);
  });
});

async function seedCompletedActivity(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pelp-pal-web');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(['activity', 'inspections'], 'readwrite');
    const inspectionId = 'axe-inspection-1';
    const accountScopeKey = '00000000-0000-4000-8000-000000000003:00000000-0000-4000-8000-000000000001';
    transaction.objectStore('inspections').put({
      id: inspectionId,
      accountScopeKey,
      status: 'completed',
      controlNumber: 'AXE-INSPECTION-001',
      storeName: 'Axe Store',
      location: 'NCR',
      productType: 'Air Conditioners',
      brand: 'Sample Brand',
      model: 'Model 1',
      outcome: 'compliant',
    });
    transaction.objectStore('activity').put({
      id: `local-inspection-completed:${inspectionId}`,
      accountScopeKey,
      inspection_id: inspectionId,
      event_type: 'inspection_completed',
      server_created_at: '2026-10-17T00:00:00.000Z',
      payload: { control_number: 'AXE-INSPECTION-001' },
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    window.localStorage.setItem('pelp-pal:activity-view:v2', JSON.stringify({
      filters: { outcome: 'all', productType: '', storeName: '', inspector: '', syncStatus: 'all', evidence: 'all', dateFrom: '', dateTo: '' },
      expandedStoreKeys: ['axe store\u0000ncr'],
    }));
    database.close();
  });
}
