import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';
import { EMAIL, PASSWORD } from './mock-api.ts';

// Screenshots for the UX review of EVM-067 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-067 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirLogin']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'none' });

const WIDTHS = [360, 768, 1280, 1440];
const MINUTE = 60_000;

async function firstStep(page: Page, password = PASSWORD): Promise<void> {
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Hasło').fill(password);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
}

test.describe('UX review screenshots (EVM-067) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-067 W-01 empty, error, 429 and expired session at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await expect(page.getByLabel('E-mail')).toBeFocused();
      await shot(`w01-empty-${px}`);
      await firstStep(page, 'zle-haslo-zle-haslo');
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(`w01-error-${px}`);
      api.failNext.set('POST /api/v1/auth/login', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
      await firstStep(page);
      await expect(page.getByRole('alert')).toContainText('Zbyt wiele prób logowania');
      await shot(`w01-429-${px}`);
      api.session = 'active';
      api.expired = true;
      await page.goto('/work-orders');
      await expect(page.getByText(/^Sesja wygasła\./)).toBeVisible();
      await shot(`w01-expired-${px}`);
    });

    test(`EVM-067 W-02 default and error at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await firstStep(page);
      await expect(page.getByRole('heading', { level: 1, name: 'Potwierdź logowanie' })).toBeVisible();
      await shot(`w02-${px}`);
      api.failNext.set('POST /api/v1/auth/login/passkey/options', { status: 500, code: 'internal_error' });
      await page.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(`w02-error-${px}`);
      await page.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
      await expect(page.getByRole('alert')).toContainText('Logowanie trwało zbyt długo');
      await shot(`w02-too-long-${px}`);
    });

    test(`EVM-067 P-11 both variants at ${px} px`, async ({ page, api, shot }) => {
      api.session = 'active';
      await page.setViewportSize({ width, height: 800 });
      await page.clock.install();
      await page.goto('/work-orders');
      await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
      await page.clock.fastForward(58.5 * MINUTE);
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await shot(`p11-idle-${px}`);
      await page.keyboard.press('Escape');
      api.sessionMinutes = { idle: 9.5, absolute: 9.5 };
      api.deadlines = null;
      await page.reload();
      await page.clock.fastForward(MINUTE);
      await expect(page.getByRole('button', { name: 'Rozumiem' })).toBeFocused();
      await shot(`p11-limit-${px}`);
    });
  }

  test('EVM-067 W-01 offline at 360 px', async ({ page, context, shot }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(EMAIL);
    await context.setOffline(true);
    await expect(page.getByText('Zalogujesz się po powrocie połączenia.')).toBeVisible();
    await shot('w01-offline-360');
  });
});
