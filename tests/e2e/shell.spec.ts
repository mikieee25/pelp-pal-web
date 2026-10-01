import { expect, test } from '@playwright/test';

test('renders the public shell without Supabase configuration', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'PELP Pal' })).toBeVisible();
  await expect(page.getByText(/offline-first inspection workspace/i)).toBeVisible();
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
});
