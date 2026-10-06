import { expect, test } from '@playwright/test';
import { seedAuthSession } from './auth-fixtures';

test('renders the public shell without Supabase configuration', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'PELP Pal' })).toBeVisible();
  await expect(page.getByText(/offline-first inspection workspace/i)).toBeVisible();
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
});

test('keeps login field labels inside their inputs', async ({ page }) => {
  await page.goto('/login');

  for (const name of ['Username', 'Password']) {
    const input = page.getByRole('textbox', { name });
    const label = page.locator('label').filter({ hasText: name }).first();
    const inputBox = await input.boundingBox();
    const labelBox = await label.boundingBox();

    expect(inputBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(inputBox!.y + inputBox!.height);
  }
});

test('does not navigate after invalid credentials', async ({ page }) => {
  await page.route('**/functions/v1/account-login', async (route) => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid credentials' }) });
  });
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('definitely-invalid-user');
  await page.getByLabel(/password/i).fill('definitely-invalid-password');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page.getByRole('alert').filter({ hasText: /invalid credentials/i })).toBeVisible();
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
});

test('loads the workspace without client runtime or hydration errors', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !text.includes('/_next/hmr') && !text.includes('WebSocket connection')) {
      browserErrors.push(text);
    }
  });

  await seedAuthSession(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /good to see you back/i })).toBeVisible();

  expect(browserErrors).toEqual([]);
});
