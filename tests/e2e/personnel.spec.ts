import { expect, test } from '@playwright/test';
import { seedAuthSession } from './auth-fixtures';

test('direct Personnel navigation requires an account before rendering workspace content', async ({ page }) => {
  await page.goto('/personnel');

  await expect(page).toHaveURL(/\/login\?next=%2Fpersonnel$/);
  await expect(page.getByRole('heading', { name: 'Account' })).not.toBeVisible();
});

test('unenrolled workspace navigation does not expose Personnel', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: /good to see you back/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Personnel' })).not.toBeVisible();
});
