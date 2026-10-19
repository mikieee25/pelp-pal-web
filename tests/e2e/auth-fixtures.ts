import type { Page } from '@playwright/test';

const authUserId = '00000000-0000-4000-8000-000000000001';

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function testSession() {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({
    aud: 'authenticated',
    role: 'authenticated',
    sub: authUserId,
    iat: now,
    exp: now + 3600,
  })}.test-signature`;
  return {
    access_token: accessToken,
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: now + 3600,
    token_type: 'bearer',
    user: { id: authUserId, aud: 'authenticated', role: 'authenticated', email: 'account-test@auth.pelp-pal.test' },
  };
}

export async function seedAuthSession(page: Page, options: { role?: 'admin' | 'inspector' } = {}): Promise<void> {
  await page.route('**/auth/v1/user', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(testSession().user),
    });
  });
  await page.route('**/rest/v1/rpc/current_account', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        account_id: authUserId,
        organization_id: '00000000-0000-4000-8000-000000000003',
        username: 'admin.one',
        role: options.role ?? 'admin',
        is_active: true,
        credential_version: 1,
        must_change_password: false,
      }),
    });
  });
  await page.route('**/rest/v1/catalog_manifests*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }));
  await page.route('**/rest/v1/rpc/pull_sync_changes', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ revisions: [], activities: [], conflicts: [], deletions: [] }),
  }));
  await page.route('**/rest/v1/inspections?*', (route) => route.fulfill({
    status: 200,
    headers: { 'content-range': '*/0' },
    body: '',
  }));
  await page.addInitScript((session) => {
    window.localStorage.setItem('pelp-pal-web-auth', JSON.stringify(session));
    window.localStorage.setItem('pelp-pal-local-session', JSON.stringify({ username: 'admin.one' }));
  }, testSession());
}

