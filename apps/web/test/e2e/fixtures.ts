import { test as base } from '@playwright/test';
import { installMockApi, type MockApi, type SessionKind } from './mock-api.ts';

/**
 * `test` of the panel's browser specs: every test gets the synthetic API (see mock-api.ts) in front of the panel, with
 * a session of the kind set by `test.use({ session })` — `active` by default, as the shell specs of EVM-008 expect.
 */
export const test = base.extend<{ session: SessionKind; api: MockApi }>({
  session: ['active', { option: true }],
  api: [
    async ({ page, session, baseURL }, use) => {
      await use(await installMockApi(page, session, new URL(baseURL ?? '').origin));
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
