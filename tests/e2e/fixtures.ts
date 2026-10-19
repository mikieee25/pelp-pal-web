import { expect, test as base } from '@playwright/test';

type Fixtures = {
  networkIsolation: {
    requests: string[];
    allowBlockedRequest: (url: string) => void;
  };
};

export async function installNetworkIsolation(context: import('@playwright/test').BrowserContext) {
  const requests: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      await route.continue();
      return;
    }
    requests.push(url.href);
    await route.abort('blockedbyclient');
  });
  return requests;
}

export const test = base.extend<Fixtures>({
  networkIsolation: [async ({ context }, fixtureUse) => {
    const requests = await installNetworkIsolation(context);
    const allowedForAssertion = new Set<string>();
    await fixtureUse({ requests, allowBlockedRequest: (url) => allowedForAssertion.add(url) });
    const unexpected = requests.filter((url) => !allowedForAssertion.has(url));
    expect(unexpected, `Unmocked external requests: ${unexpected.join(', ')}`).toEqual([]);
  }, { auto: true }],
});

export { expect };
export type { Page } from '@playwright/test';
