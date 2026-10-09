import { expect, test, type Page } from '@playwright/test';

const liveConfig = {
  deviceACode: process.env.E2E_DEVICE_A_CODE,
  deviceAUsername: process.env.E2E_DEVICE_A_USERNAME,
  deviceAPassword: process.env.E2E_DEVICE_A_PASSWORD,
  deviceBCode: process.env.E2E_DEVICE_B_CODE,
  deviceBUsername: process.env.E2E_DEVICE_B_USERNAME,
  deviceBPassword: process.env.E2E_DEVICE_B_PASSWORD,
  inspectionId: process.env.E2E_INSPECTION_ID,
};

const missingLiveConfig = Object.entries(liveConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)
  .join(', ');

test('two enrolled devices receive two consecutive inspection revisions without a refresh', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The live two-device test runs only in the desktop Chromium project.');
  test.skip(
    process.env.E2E_SUPABASE !== '1' || Boolean(missingLiveConfig),
    `Set E2E_SUPABASE=1 and provide ${missingLiveConfig || 'the live Supabase test variables'} to run this test.`,
  );

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const inspectionPath = `/inspect/${encodeURIComponent(liveConfig.inspectionId!)}`;
  const firstUpdate = `two-device-update-${Date.now()}-1`;
  const secondUpdate = `two-device-update-${Date.now()}-2`;

  try {
    await enrollAndSignIn(pageA, liveConfig.deviceACode!, liveConfig.deviceAUsername!, liveConfig.deviceAPassword!);
    await enrollAndSignIn(pageB, liveConfig.deviceBCode!, liveConfig.deviceBUsername!, liveConfig.deviceBPassword!);

    await pageB.goto(inspectionPath);
    await pageB.getByLabel('Remarks / description of non-compliance').waitFor();

    await saveInspectionEdit(pageA, inspectionPath, firstUpdate);
    await saveInspectionEdit(pageA, inspectionPath, secondUpdate);

    await expect.poll(
      () => readRemoteRevisionRemarks(pageB, liveConfig.inspectionId!),
      { timeout: 45_000, message: 'Device B did not receive both inspection revisions without a page refresh.' },
    ).toEqual(expect.arrayContaining([firstUpdate, secondUpdate]));
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function enrollAndSignIn(page: Page, code: string, username: string, password: string): Promise<void> {
  await page.goto('/enroll');
  await page.getByLabel('Enrollment code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/login(?:\?.*)?$/);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|change-password)(?:\?.*)?$/);
  if (page.url().includes('/change-password')) {
    throw new Error('The live E2E account requires a password change before it can run the two-device sync test.');
  }
}

async function saveInspectionEdit(page: Page, inspectionPath: string, remarks: string): Promise<void> {
  await page.goto(inspectionPath);
  const remarksField = page.getByLabel('Remarks / description of non-compliance');
  await remarksField.waitFor();
  await remarksField.fill(remarks);
  await page.getByRole('button', { name: 'Save Inspection' }).click();
  await page.waitForURL(/\/activity$/);
}

async function readRemoteRevisionRemarks(page: Page, inspectionId: string): Promise<string[]> {
  return page.evaluate(async (id) => {
    const request = indexedDB.open('pelp-pal-web', 4);
    return new Promise<string[]>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('inspectionRevisions', 'readonly');
        const getAll = transaction.objectStore('inspectionRevisions').getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => resolve(getAll.result
          .filter((row) => row.inspection_id === id)
          .map((row) => row.payload?.remarks)
          .filter((value): value is string => typeof value === 'string'));
      };
    });
  }, inspectionId);
}
