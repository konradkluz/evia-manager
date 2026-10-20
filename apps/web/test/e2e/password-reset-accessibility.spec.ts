import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { EMAIL, PASSWORD, RESET_TOKEN } from './mock-api.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, session: 'none' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('accessibility of the password reset screens in the browser, with colour contrast (EVM-025; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-025 AC1 W-01 "Zresetuj hasło" (empty, sent, field error, 429) has no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      expect(await violations(page)).toEqual([]);
      await page.getByRole('link', { name: 'Nie pamiętasz hasła?' }).click();
      await expect(page.getByLabel('E-mail')).toBeFocused();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('button', { name: 'Wyślij link' }).click();
      await expect(page.getByRole('alert')).toHaveText('Wpisz poprawny adres e-mail.');
      expect(await violations(page)).toEqual([]);

      await page.getByLabel('E-mail').fill(EMAIL);
      await page.getByRole('button', { name: 'Wyślij link' }).click();
      await expect(page.getByText(/^Jeśli konto o tym adresie istnieje/)).toBeVisible();
      expect(await violations(page)).toEqual([]);

      api.failNext.set('POST /api/v1/auth/password-reset/request', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
      await page.getByRole('button', { name: 'Wyślij link' }).click();
      await expect(page.getByRole('alert')).toContainText('Zbyt wiele prób');
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-025 AC2 W-12 (loading is skipped; form, field error, invalid link, server error) has no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/reset-password#${RESET_TOKEN}`);
      await expect(page.getByLabel('Nowe hasło', { exact: true })).toBeFocused();
      expect(await violations(page)).toEqual([]);

      await page.getByLabel('Nowe hasło', { exact: true }).fill('krótkie hasło');
      await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      api.failNext.set('POST /api/v1/auth/password-reset/complete', { status: 500, code: 'internal_error' });
      await page.getByLabel('Nowe hasło', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
      await expect(page.getByRole('alert')).toContainText('Nie udało się ustawić hasła');
      expect(await violations(page)).toEqual([]);

      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-025 AC4 W-02 after the reset (the success message) has no axe violations at ${px} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/reset-password#${RESET_TOKEN}`);
      await page.getByLabel('Nowe hasło', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
      await expect(page.getByText(/^Hasło zostało zmienione\./)).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
