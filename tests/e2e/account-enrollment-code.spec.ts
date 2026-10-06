import { expect, test } from '@playwright/test';
import { seedAuthSession, seedDevice } from './auth-fixtures';

test('an enrolled administrator can generate an enrollment code', async ({ page }) => {
  await seedAuthSession(page);
  await page.route('**/rest/v1/catalog_manifests**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/functions/v1/issue-enrollment-code', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: '123456', assigned_username: 'epred.two', expires_at: '2026-10-13T00:00:00.000Z' }),
    });
  });

  await page.goto('/login');
  await seedDevice(page, 'admin');
  await page.goto('/account');

  await expect(page.getByRole('heading', { name: 'Enrollment code' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Target personnel username' }).fill('epred.two');
  await page.getByRole('button', { name: 'Generate code' }).click();

  await expect(page.getByText('123456')).toBeVisible();
  await expect(page.getByText(/expires/i)).toBeVisible();
});

test('non-administrator accounts do not see enrollment-code controls', async ({ page }) => {
  await seedAuthSession(page);
  await page.goto('/login');
  await seedDevice(page, 'epred');
  await page.goto('/account');

  await expect(page.getByRole('heading', { name: 'Enrollment code' })).not.toBeVisible();
});
