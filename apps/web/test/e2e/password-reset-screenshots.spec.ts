import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';
import { EMAIL, PASSWORD, RESET_TOKEN } from './mock-api.ts';

// Screenshots for the UX review of EVM-025 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-025 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirReset']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'none' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('UX review screenshots (EVM-025) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-025 W-01 "Zresetuj hasło" empty, field error, sent and 429 at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await shot(`w01-forgot-link-${px}`);
      await page.getByRole('link', { name: 'Nie pamiętasz hasła?' }).click();
      await expect(page.getByLabel('E-mail')).toBeFocused();
      await shot(`w01-reset-empty-${px}`);
      await page.getByRole('button', { name: 'Wyślij link' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(`w01-reset-field-error-${px}`);
      await page.getByLabel('E-mail').fill(EMAIL);
      await page.getByRole('button', { name: 'Wyślij link' }).click();
      await expect(page.getByText(/^Jeśli konto o tym adresie istnieje/)).toBeVisible();
      await shot(`w01-reset-sent-${px}`);
      api.failNext.set('POST /api/v1/auth/password-reset/request', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
      await page.getByRole('button', { name: 'Wyślij link' }).click();
      await expect(page.getByRole('alert')).toContainText('Zbyt wiele prób');
      await shot(`w01-reset-429-${px}`);
    });

    test(`EVM-025 W-12 form, errors and invalid link at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/reset-password#${RESET_TOKEN}`);
      await expect(page.getByLabel('Nowe hasło', { exact: true })).toBeFocused();
      await shot(`w12-form-${px}`);
      await page.getByLabel('Nowe hasło', { exact: true }).fill('krótkie hasło');
      await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(`w12-too-short-${px}`);
      api.failNext.set('POST /api/v1/auth/password-reset/complete', { status: 500, code: 'internal_error' });
      await page.getByLabel('Nowe hasło', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
      await expect(page.getByRole('alert')).toContainText('Nie udało się ustawić hasła');
      await shot(`w12-server-error-${px}`);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' })).toBeVisible();
      await shot(`w12-invalid-${px}`);
    });

    test(`EVM-025 W-02 after the reset at ${px} px`, async ({ page, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/reset-password#${RESET_TOKEN}`);
      await page.getByLabel('Nowe hasło', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
      await expect(page.getByText(/^Hasło zostało zmienione\./)).toBeVisible();
      await shot(`w02-after-reset-${px}`);
    });
  }

  test('EVM-025 W-12 offline at 360 px', async ({ page, context, shot }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/reset-password#${RESET_TOKEN}`);
    await page.getByLabel('Nowe hasło', { exact: true }).fill(PASSWORD);
    await context.setOffline(true);
    await expect(page.getByText('Ustawisz hasło po powrocie połączenia.')).toBeVisible();
    await shot('w12-offline-360');
  });
});
