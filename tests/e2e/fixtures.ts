import { expect, test as base } from '@playwright/test';

type Fixtures = {
  networkIsolation: {
    requests: string[];
    allowBlockedRequest: (url: string) => void;
  };
};

export const test = base.extend<Fixtures>({
  networkIsolation: async ({ context }, use) => {
    const requests: string[] = [];
    const allowedForAssertion = new Set<string>();
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
        await route.continue();
        return;
      }
      requests.push(url.href);
      await route.abort('blockedbyclient');
    });
    await use({ requests, allowBlockedRequest: (url) => allowedForAssertion.add(url) });
    const unexpected = requests.filter((url) => !allowedForAssertion.has(url));
    expect(unexpected, `Unmocked external requests: ${unexpected.join(', ')}`).toEqual([]);
  },
});

export { expect };
export type { Page } from '@playwright/test';
