import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';
import { EMAIL, PASSWORD, TOTP_CODE } from './mock-api.ts';

// Screenshots for the UX review of EVM-023 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-023 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirCodes']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'none' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('UX review screenshots (EVM-023) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-023 W-02 code, error, recovery code and the step after it at ${px} px`, async ({ page, api, shot }) => {
      api.role = 'editor';
      api.methods = ['totp', 'recovery_code'];
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await page.getByLabel('E-mail').fill(EMAIL);
      await page.getByLabel('Hasło').fill(PASSWORD);
      await page.getByRole('button', { name: 'Zaloguj się' }).click();
      await expect(page.getByLabel('Kod z aplikacji uwierzytelniającej')).toBeFocused();
      await shot(`w02-code-${px}`);
      await page.getByLabel('Kod z aplikacji uwierzytelniającej').fill('000000');
      await page.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(`w02-code-error-${px}`);
      await page.getByRole('button', { name: 'Nie masz dostępu do metody? Użyj kodu odzyskiwania' }).click();
      await shot(`w02-recovery-${px}`);
      await page.getByLabel('Kod odzyskiwania').fill('ABCDEFGHIJKLMNOPQRST');
      await page.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(page.getByRole('button', { name: 'Przejdź dalej' })).toBeFocused();
      await shot(`w02-recovered-${px}`);
    });

    test(`EVM-023 W-02 with two methods for an Editor at ${px} px`, async ({ page, api, shot }) => {
      api.role = 'editor';
      api.methods = ['passkey', 'totp', 'recovery_code'];
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await page.getByLabel('E-mail').fill(EMAIL);
      await page.getByLabel('Hasło').fill(PASSWORD);
      await page.getByRole('button', { name: 'Zaloguj się' }).click();
      await expect(page.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeFocused();
      await shot(`w02-two-methods-${px}`);
    });

    test(`EVM-023 W-03 choice, QR, error, recovery codes and the missing tick at ${px} px`, async ({ page, api, shot }) => {
      api.session = 'enrollment';
      api.role = 'editor';
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/mfa-setup');
      await expect(page.getByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' })).toBeFocused();
      await shot(`w03-choice-${px}`);
      await page.getByRole('radio', { name: 'Kod z aplikacji uwierzytelniającej' }).check();
      await page.getByRole('button', { name: 'Dalej' }).click();
      await expect(page.getByRole('img', { name: /Kod QR/ })).toBeVisible();
      await shot(`w03-qr-${px}`);
      await page.getByRole('button', { name: /Pokaż klucz do wpisania/ }).click();
      const field = page.getByLabel('Kod z aplikacji uwierzytelniającej', { exact: true }).last();
      await field.fill('000000');
      await page.getByRole('button', { name: 'Potwierdź kod' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(`w03-qr-error-${px}`);
      await field.fill(TOTP_CODE);
      await page.getByRole('button', { name: 'Potwierdź kod' }).click();
      await expect(page.getByRole('list', { name: 'Kody odzyskiwania' })).toBeVisible();
      await shot(`w03-codes-${px}`);
      await page.getByRole('button', { name: 'Zakończ konfigurację' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(`w03-codes-unticked-${px}`);
    });

    test(`EVM-023 W-03 loading of the QR, the Administrator and offline at ${px} px`, async ({ page, api, context, shot }) => {
      api.session = 'enrollment';
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/mfa-setup');
      await expect(page.getByText('Krok 2 z 3')).toBeVisible();
      await shot(`w03-administrator-${px}`);
      await context.setOffline(true);
      await expect(page.getByText(/Brak połączenia\. Konfiguracja wymaga/)).toBeVisible();
      await shot(`w03-offline-${px}`);
    });
  }
});
