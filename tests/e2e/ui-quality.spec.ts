import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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

test.describe('workspace accessibility and visual baselines', () => {
  test.beforeEach(async ({ page }) => {
    page.clock.setFixedTime(new Date('2026-10-17T00:00:00.000Z'));
    await seedAuthSession(page);
    await page.route('**/rest/v1/rpc/pull_sync_changes', (route) => route.fulfill({ json: { revisions: [], activities: [], conflicts: [], deletions: [] } }));
  });

  for (const screen of screens) {
    test(`${screen.name} is accessible and visually stable at phone and desktop widths`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.getByRole('heading', { name: screen.heading, exact: true }).first()).toBeVisible();

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
    await expect(page.getByRole('dialog', { name: /scan energy label/i })).toBeVisible();
    await checkAccessibility(page);
  });
});
