import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';
import { DISPLAY_NAME, PASSWORD, VALID_TOKEN } from './mock-api.ts';

// Screenshots for the UX review of EVM-016 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-016 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirIdentity']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'none' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('UX review screenshots (EVM-016) @screenshots', () => {
  for (const width of WIDTHS) {
    test(`EVM-016 W-13 form, password error and invalid link at ${String(width)} px`, async ({ page, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/activate#${VALID_TOKEN}`);
      await expect(page.getByLabel('Nowe hasło')).toBeFocused();
      await shot(`w13-form-${String(width)}`);
      await page.getByLabel('Nowe hasło').fill('za krótkie');
      await page.getByRole('button', { name: 'Ustaw hasło' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(`w13-error-${String(width)}`);
      await page.getByRole('button', { name: 'Pokaż' }).click();
      await page.getByLabel('Nowe hasło').fill(PASSWORD);
      await shot(`w13-revealed-${String(width)}`);
      await page.goto('/activate');
      await expect(page.getByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' })).toBeVisible();
      await shot(`w13-invalid-${String(width)}`);
    });

    test(`EVM-016 W-03 with the ceremony error at ${String(width)} px`, async ({ page, api, shot }) => {
      api.session = 'enrollment';
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/mfa-setup');
      await expect(page.getByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' })).toBeFocused();
      await shot(`w03-${String(width)}`);
      api.failNext.set('POST /api/v1/account/passkeys/registration-options', { status: 500, code: 'internal_error' });
      await page.getByRole('button', { name: 'Dodaj klucz dostępu' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(`w03-error-${String(width)}`);
    });

    test(`EVM-016 shell with the account menu at ${String(width)} px`, async ({ page, api, shot }) => {
      api.session = 'active';
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders');
      await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń' })).toBeVisible();
      await shot(`shell-${String(width)}`);
      await page.getByRole('button', { name: `Konto: ${DISPLAY_NAME}` }).click();
      await expect(page.getByRole('menuitem', { name: 'Wyloguj' })).toBeFocused();
      await shot(`shell-menu-${String(width)}`);
    });
  }

  test('EVM-016 W-13 offline after the check at 360 px', async ({ page, context, shot }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/activate#${VALID_TOKEN}`);
    await page.getByLabel('Nowe hasło').fill(PASSWORD);
    await context.setOffline(true);
    await expect(page.getByText('Ustawisz hasło po powrocie połączenia.')).toBeVisible();
    await shot('w13-offline-360');
  });
});
