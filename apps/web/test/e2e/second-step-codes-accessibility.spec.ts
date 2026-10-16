import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { EMAIL, PASSWORD, TOTP_CODE } from './mock-api.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, session: 'none' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('accessibility of the code of the app and the recovery codes in the browser, with colour contrast (EVM-023; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-023 AC2 AC5 W-02 (code, recovery code, error, the step after the recovery code) has no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      api.role = 'editor';
      api.methods = ['totp', 'recovery_code'];
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await page.getByLabel('E-mail').fill(EMAIL);
      await page.getByLabel('Hasło').fill(PASSWORD);
      await page.getByRole('button', { name: 'Zaloguj się' }).click();
      await expect(page.getByLabel('Kod z aplikacji uwierzytelniającej')).toBeFocused();
      expect(await violations(page)).toEqual([]);

      await page.getByLabel('Kod z aplikacji uwierzytelniającej').fill('000000');
      await page.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(page.getByRole('alert')).toContainText('Kod jest nieprawidłowy lub wygasł.');
      expect(await violations(page)).toEqual([]);

      await page.getByRole('button', { name: 'Nie masz dostępu do metody? Użyj kodu odzyskiwania' }).click();
      await expect(page.getByLabel('Kod odzyskiwania')).toBeFocused();
      expect(await violations(page)).toEqual([]);

      await page.getByLabel('Kod odzyskiwania').fill('ABCDEFGHIJKLMNOPQRST');
      await page.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(page.getByRole('button', { name: 'Przejdź dalej' })).toBeFocused();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-023 AC1 AC4 W-03 (choice, QR with the key, error, recovery codes) has no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      api.session = 'enrollment';
      api.role = 'editor';
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/mfa-setup');
      await expect(page.getByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' })).toBeFocused();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('radio', { name: 'Kod z aplikacji uwierzytelniającej' }).check();
      await page.getByRole('button', { name: 'Dalej' }).click();
      await expect(page.getByRole('img', { name: /Kod QR/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('button', { name: /Pokaż klucz do wpisania/ }).click();
      await expect(page.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeVisible();
      const field = page.getByLabel('Kod z aplikacji uwierzytelniającej', { exact: true }).last();
      await field.fill('000000');
      await page.getByRole('button', { name: 'Potwierdź kod' }).click();
      await expect(page.getByRole('alert')).toContainText('Kod jest nieprawidłowy.');
      expect(await violations(page)).toEqual([]);

      await field.fill(TOTP_CODE);
      await page.getByRole('button', { name: 'Potwierdź kod' }).click();
      await expect(page.getByRole('list', { name: 'Kody odzyskiwania' })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('button', { name: 'Zakończ konfigurację' }).click();
      await expect(page.getByRole('alert')).toHaveText('Potwierdź, że kody są zapisane.');
      expect(await violations(page)).toEqual([]);
    });
  }
});
