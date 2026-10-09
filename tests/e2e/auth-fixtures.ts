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

export async function seedAuthSession(page: Page): Promise<void> {
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
        role: 'admin',
        is_active: true,
        credential_version: 1,
        must_change_password: false,
      }),
    });
  });
  await page.addInitScript((session) => {
    window.localStorage.setItem('pelp-pal-web-auth', JSON.stringify(session));
  }, testSession());
}

export async function seedDevice(page: Page, role: 'admin' | 'epred' | 'guest' = 'admin'): Promise<void> {
  await page.evaluate((assignedRole) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('pelp-pal-web', 4);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      const stores: Record<string, { keyPath: string; indexes?: Array<[string, string | string[]]> }> = {
        device: { keyPath: 'id', indexes: [['installationId', 'installationId'], ['authUserId', 'authUserId']] },
        accounts: { keyPath: 'id', indexes: [['organizationId', 'organizationId'], ['username', 'username'], ['organization+username', ['organizationId', 'username']]] },
        catalog: { keyPath: 'id', indexes: [['catalogScope', 'catalogScope']] },
        activity: { keyPath: 'id', indexes: [['change_cursor', 'change_cursor'], ['inspection_id', 'inspection_id'], ['server_created_at', 'server_created_at'], ['server_created_at+id', ['server_created_at', 'id']]] },
        inspections: { keyPath: 'id', indexes: [['organizationId', 'organizationId'], ['ownerUsername', 'ownerUsername'], ['updatedAt', 'updatedAt']] },
        inspectionRevisions: { keyPath: 'id', indexes: [['inspection_id', 'inspection_id'], ['change_cursor', 'change_cursor']] },
        inspectionDrafts: { keyPath: 'id', indexes: [['updatedAt', 'updatedAt']] },
        evidence: { keyPath: 'id', indexes: [['inspectionId', 'inspectionId'], ['displayOrder', 'displayOrder']] },
        evidenceBlobs: { keyPath: 'id', indexes: [['evidenceId', 'evidenceId']] },
        conflicts: { keyPath: 'id', indexes: [['inspection_id', 'inspection_id'], ['change_cursor', 'change_cursor'], ['status', 'status']] },
        tombstones: { keyPath: 'id', indexes: [['change_cursor', 'change_cursor'], ['inspection_id', 'inspection_id']] },
        outbox: { keyPath: 'id', indexes: [['aggregateId', 'aggregateId'], ['status', 'status'], ['nextAttemptAt', 'nextAttemptAt']] },
        syncState: { keyPath: 'id' },
        syncCursors: { keyPath: 'id' },
        accountResetReceipts: { keyPath: 'id' },
        stores: { keyPath: 'id', indexes: [['storeId', 'storeId'], ['location', 'location'], ['name', 'name'], ['updatedAt', 'updatedAt']] },
        reportDrafts: { keyPath: 'id', indexes: [['storeKey', 'storeKey'], ['updatedAt', 'updatedAt']] },
      };
      for (const [name, schema] of Object.entries(stores)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: schema.keyPath });
        for (const [indexName, keyPath] of schema.indexes ?? []) store.createIndex(indexName, keyPath);
      }
    };
    request.onsuccess = () => {
      const transaction = request.result.transaction('device', 'readwrite');
      transaction.objectStore('device').put({
        id: 'current',
        installationId: '00000000-0000-4000-8000-000000000002',
        authUserId: '00000000-0000-4000-8000-000000000001',
        organizationId: '00000000-0000-4000-8000-000000000003',
        assignedUsername: assignedRole === 'admin' ? 'admin.one' : 'epred.one',
        assignedRole,
        catalogScope: 'masterlist',
        enrolled: true,
        updatedAt: new Date().toISOString(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
  }), role);
}
