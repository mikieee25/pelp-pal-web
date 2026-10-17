import { expect, test } from '@playwright/test';
import { seedAuthSession } from './auth-fixtures';

test('direct Personnel navigation requires an account before rendering workspace content', async ({ page }) => {
  await page.goto('/personnel');

  await expect(page).toHaveURL(/\/login\?next=%2Fpersonnel$/);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Personnel', exact: true })).not.toBeVisible();
});

test('non-administrator workspace navigation does not expose Personnel', async ({ page }) => {
  await seedAuthSession(page, { role: 'inspector' });
  await page.goto('/dashboard');

  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Personnel' })).not.toBeVisible();
});
