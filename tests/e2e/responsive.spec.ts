import { expect, test } from '@playwright/test';
import { seedAuthSession } from './auth-fixtures';

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
