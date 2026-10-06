import { expect, test } from '@playwright/test';
import { seedAuthSession } from './auth-fixtures';

test('redirects signed-out users from workspace routes to login', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await expect(page.getByRole('heading', { name: 'Good to see you back' })).not.toBeVisible();
});

test('keeps browser enrollment public while workspace routes are protected', async ({ page }) => {
  await page.goto('/enroll');

  await expect(page.getByRole('heading', { name: 'Enroll this browser' })).toBeVisible();
});

test('returns a signed-in user to the requested internal workspace path', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/lookup?q=air');

  await expect(page).toHaveURL(/\/lookup\?q=air$/);
  await expect(page.getByRole('heading', { name: 'Find a product' })).toBeVisible();
});
