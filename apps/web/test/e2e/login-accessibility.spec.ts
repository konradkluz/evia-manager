import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { EMAIL, PASSWORD } from './mock-api.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, session: 'none' });

const WIDTHS = [360, 768, 1280, 1440];
const MINUTE = 60_000;

async function firstStep(page: Page): Promise<void> {
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Hasło').fill(PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
}

test.describe('accessibility of W-01, W-02 and P-11 in the browser, with colour contrast (EVM-067; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    test(`EVM-067 AC2 W-01 (empty, wrong password, 429, expired session) has no axe violations at ${String(width)} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await expect(page.getByLabel('E-mail')).toBeFocused();
      expect(await violations(page)).toEqual([]);

      await page.getByLabel('E-mail').fill(EMAIL);
      await page.getByLabel('Hasło').fill('zle-haslo-zle-haslo');
      await page.getByRole('button', { name: 'Zaloguj się' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      api.failNext.set('POST /api/v1/auth/login', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
      await firstStep(page);
      await expect(page.getByRole('alert')).toContainText('Zbyt wiele prób logowania');
      expect(await violations(page)).toEqual([]);

      api.session = 'active';
      api.expired = true;
      await page.goto('/work-orders');
      await expect(page.getByText(/^Sesja wygasła\./)).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-067 AC4 W-02 (default, server error, first step ran out) has no axe violations at ${String(width)} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await firstStep(page);
      await expect(page.getByRole('heading', { level: 1, name: 'Potwierdź logowanie' })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      api.failNext.set('POST /api/v1/auth/login/passkey/options', { status: 500, code: 'internal_error' });
      await page.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      // No passkey is registered on the synthetic server: the options are refused as an unknown first step.
      await page.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
      await expect(page.getByRole('alert')).toContainText('Logowanie trwało zbyt długo');
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-067 AC6 P-11 (both variants) has no axe violations at ${String(width)} px`, async ({ page, api }) => {
      api.session = 'active';
      await page.setViewportSize({ width, height: 800 });
      await page.clock.install();
      await page.goto('/work-orders');
      await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
      await page.clock.fastForward(58.5 * MINUTE);
      await expect(page.getByRole('alertdialog')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press('Escape');

      api.sessionMinutes = { idle: 9.5, absolute: 9.5 };
      api.deadlines = null;
      await page.reload();
      await page.clock.fastForward(MINUTE);
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Rozumiem' })).toBeFocused();
      expect(await violations(page)).toEqual([]);
    });
  }
});
