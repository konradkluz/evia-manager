import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';
import { EMAIL, PASSWORD, TOTP_CODE } from './mock-api.ts';

// Screenshots for the UX review of EVM-134 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-134 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirAdminTotp']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'none' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('UX review screenshots (EVM-134) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-134 W-02 with two methods, W-04 after the login with the code (hint, used code) at ${px} px`, async ({ page, api, shot }) => {
      api.methods = ['passkey', 'totp', 'recovery_code'];
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await page.getByLabel('E-mail').fill(EMAIL);
      await page.getByLabel('Hasło').fill(PASSWORD);
      await page.getByRole('button', { name: 'Zaloguj się' }).click();
      await page.getByRole('button', { name: 'Użyj innej metody' }).click();
      await expect(page.getByLabel('Kod z aplikacji uwierzytelniającej')).toBeFocused();
      await shot(`w02-administrator-code-${px}`);
      await page.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
      await page.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();

      await page.goto('/administration/users');
      await page.getByRole('button', { name: /^Akcje konta: Jan Przykładowy,/ }).click();
      await page.getByRole('menuitem', { name: 'Zmień rolę…' }).click();
      const role = page.getByRole('dialog', { name: 'Zmienić rolę konta „Jan Przykładowy”?' });
      await role.getByRole('radio', { name: /^Administrator/ }).check();
      await shot(`w16-role-administrator-${px}`);
      await role.getByRole('button', { name: 'Zmień rolę' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zmienić rolę użytkownika' });
      await expect(confirm.getByText(/Wpisz nowy kod/)).toBeVisible();
      await shot(`w04-step-up-administrator-${px}`);
      await confirm.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
      await confirm.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(confirm.getByRole('alert')).toBeVisible();
      await shot(`w04-step-up-used-code-${px}`);
    });

    test(`EVM-134 W-03 of the Administrator: the choice and the code at ${px} px`, async ({ page, api, shot }) => {
      api.session = 'enrollment';
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/mfa-setup');
      await expect(page.getByText('Krok 1 z 3')).toBeVisible();
      await shot(`w03-administrator-choice-${px}`);
      await page.getByRole('radio', { name: 'Kod z aplikacji uwierzytelniającej' }).check();
      await page.getByRole('button', { name: 'Dalej' }).click();
      await expect(page.getByRole('img', { name: /Kod QR/ })).toBeVisible();
      await shot(`w03-administrator-code-${px}`);
    });

    test(`EVM-134 W-15 of the Administrator: one key with the hint, a key and the code, the code alone, W-04 with the code at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      api.session = 'active';
      await page.setViewportSize({ width, height: 900 });
      api.account.passkeys = api.account.passkeys.slice(0, 1);
      await page.goto('/account');
      await expect(page.getByText(/Dodaj drugą metodę/)).toBeVisible();
      await shot(`w15-administrator-one-key-${px}`);
      api.account.totp = { addedAt: '2026-10-03T11:00:00.000Z' };
      await page.reload();
      await expect(page.getByRole('button', { name: 'Usuń kod z aplikacji uwierzytelniającej' })).toBeVisible();
      await shot(`w15-administrator-key-and-code-${px}`);
      api.account.passkeys = [];
      await page.reload();
      await expect(page.getByText('To jedyna metoda — najpierw dodaj inną.')).toBeVisible();
      await shot(`w15-administrator-code-alone-${px}`);
      await page.getByRole('button', { name: 'Zmień hasło' }).click();
      await page.getByLabel('Bieżące hasło').fill(PASSWORD);
      await page.getByLabel('Nowe hasło').fill('zupełnie nowe hasło do konta');
      await page.getByRole('button', { name: 'Zapisz nowe hasło' }).click();
      await expect(page.getByRole('dialog', { name: 'Potwierdź tożsamość, aby zmienić hasło' })).toBeVisible();
      await shot(`w04-reauth-administrator-${px}`);
    });

    test(`EVM-134 W-16 the warning of the sole Administrator and the reset of the second step of an Administrator at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      api.session = 'active';
      api.stepUp = 'fresh';
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/administration/users');
      await expect(page.getByText(/Jesteś jedynym aktywnym administratorem/)).toBeVisible();
      await shot(`w16-sole-administrator-${px}`);
      const jan = api.users.users.find((user) => user.displayName === 'Jan Przykładowy');
      if (jan !== undefined) jan.role = 'administrator';
      await page.reload();
      await page.getByRole('button', { name: /^Akcje konta: Jan Przykładowy,/ }).click();
      await page.getByRole('menuitem', { name: 'Zresetuj drugi krok logowania…' }).click();
      await expect(page.getByRole('dialog', { name: /Zresetować drugi krok logowania konta/ })).toBeVisible();
      await shot(`w16-reset-administrator-${px}`);
    });
  }
});
