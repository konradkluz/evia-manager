import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { EMAIL, PASSWORD, TOTP_CODE } from './mock-api.ts';

// The Administrator with the code of the app in the panel (EVM-134; ADR-0023): the changed screens with axe (colour contrast
// included), the keyboard and the text at 200 %. axe-core is injected as a script, which the strict CSP rightly blocks — only the
// accessibility specs bypass it.
test.use({ bypassCSP: true, session: 'none' });

const WIDTHS = [360, 768, 1280, 1440];
const FRESH = /Wpisz nowy kod z aplikacji — ten sam kod nie zadziała drugi raz\./;

async function logInWithCode(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Hasło').fill(PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await page.getByRole('button', { name: 'Użyj innej metody' }).click();
  await page.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
  await page.getByRole('button', { name: 'Potwierdź' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
}

/** The first change of a role after the login with the code: W-04 with the field of the code (K1). */
async function openStepUp(page: Page) {
  await page.goto('/administration/users');
  await page.getByRole('button', { name: /^Akcje konta: Jan Przykładowy,/ }).click();
  await page.getByRole('menuitem', { name: 'Zmień rolę…' }).click();
  const role = page.getByRole('dialog', { name: 'Zmienić rolę konta „Jan Przykładowy”?' });
  await role.getByRole('radio', { name: /^Administrator/ }).check();
  await role.getByRole('button', { name: 'Zmień rolę' }).click();
  return page.getByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zmienić rolę użytkownika' });
}

test.describe('accessibility of the code of the app of the Administrator (EVM-134; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-134 AC1 AC4 W-02 with two methods and W-04 after the login with the code (hint, error) have no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      api.methods = ['passkey', 'totp', 'recovery_code'];
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await page.getByLabel('E-mail').fill(EMAIL);
      await page.getByLabel('Hasło').fill(PASSWORD);
      await page.getByRole('button', { name: 'Zaloguj się' }).click();
      await expect(page.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeFocused();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Użyj innej metody' }).click();
      await expect(page.getByLabel('Kod z aplikacji uwierzytelniającej')).toBeFocused();
      expect(await violations(page)).toEqual([]);
      await page.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
      await page.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();

      const confirm = await openStepUp(page);
      const field = confirm.getByLabel('Kod z aplikacji uwierzytelniającej');
      await expect(field).toHaveAccessibleDescription(FRESH);
      expect(await violations(page)).toEqual([]);
      // The code of the login again: the error is announced and tied to the buttons; the field keeps the focus.
      await field.fill(TOTP_CODE);
      await confirm.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(confirm.getByRole('alert')).toBeVisible();
      await expect(field).toBeFocused();
      expect(await violations(page)).toEqual([]);
      // An account without the method (403 forbidden to its proof): the message names the other one and the focus goes there.
      api.failNext.set('POST /api/v1/auth/step-up/options', { status: 403, code: 'forbidden' });
      await confirm.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
      await expect(confirm.getByRole('alert')).toHaveText('Twoje konto nie ma klucza dostępu. Wpisz kod z aplikacji.');
      await expect(field).toBeFocused();
      expect(await violations(page)).toEqual([]);
      api.failNext.set('POST /api/v1/auth/step-up', { status: 403, code: 'forbidden' });
      await field.fill('654321');
      await confirm.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(confirm.getByRole('alert')).toHaveText('Twoje konto nie ma kodu z aplikacji. Użyj klucza dostępu.');
      await expect(confirm.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeFocused();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-134 AC2 W-03 of the Administrator (the choice, the code) has no axe violations at ${px} px`, async ({ page, api }) => {
      api.session = 'enrollment';
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/mfa-setup');
      await expect(page.getByText('Krok 1 z 3')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('radio', { name: 'Kod z aplikacji uwierzytelniającej' }).check();
      await page.getByRole('button', { name: 'Dalej' }).click();
      await expect(page.getByRole('img', { name: /Kod QR/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-134 AC3 "Konto → Drugi krok logowania" of the Administrator (one key and the hint; the code alone) has no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      api.session = 'active';
      api.account.passkeys = api.account.passkeys.slice(0, 1);
      const [key] = api.account.passkeys;
      if (key === undefined) throw new Error('the synthetic account has a key');
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/account');
      await expect(page.getByText(/Dodaj drugą metodę, np\. kod z aplikacji albo klucz w telefonie/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Dodaj kod z aplikacji' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.account.passkeys = [];
      api.account.totp = { addedAt: '2026-10-03T11:00:00.000Z' };
      await page.reload();
      await expect(page.getByText('To jedyna metoda — najpierw dodaj inną.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.account.passkeys = [{ ...key }];
      await page.reload();
      await page.getByRole('button', { name: 'Usuń kod z aplikacji uwierzytelniającej' }).click();
      const remove = page.getByRole('alertdialog', { name: 'Usunąć kod z aplikacji uwierzytelniającej?' });
      await expect(
        remove.getByText('Bez niego nie zalogujesz się w aplikacji na telefonie ani, jeśli to Twoja metoda, w panelu.'),
      ).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }

  test('EVM-134 AC4 W-04 with the field of the code works from the keyboard and at 200 % of the text without horizontal scrolling', async ({
    page,
    api,
  }) => {
    api.methods = ['passkey', 'totp', 'recovery_code'];
    await page.setViewportSize({ width: 1280, height: 800 });
    await logInWithCode(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    const confirm = await openStepUp(page);
    await expect(confirm.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeFocused();
    // The field of the code is reached with the keyboard (Shift+Tab from the key; the focus stays in the dialog) and Enter sends it.
    const field = confirm.getByLabel('Kod z aplikacji uwierzytelniającej');
    for (let step = 0; step < 10 && !(await field.evaluate((element) => element === document.activeElement)); step++) {
      await page.keyboard.press('Shift+Tab');
    }
    await expect(field).toBeFocused();
    await page.keyboard.type('654321');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Zmieniono rolę.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('EVM-134 AC4 at 200 % of the text W-04 of the Administrator keeps the hint and the buttons inside the dialog', async ({
    page,
    api,
  }) => {
    api.methods = ['passkey', 'totp', 'recovery_code'];
    await page.setViewportSize({ width: 1280, height: 800 });
    await logInWithCode(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    const confirm = await openStepUp(page);
    await expect(confirm.getByText(FRESH)).toBeVisible();
    const fits = await confirm.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
    expect(fits).toBe(true);
    expect(await violations(page)).toEqual([]);
  });
});
