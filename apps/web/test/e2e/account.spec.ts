import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { PASSWORD, TOTP_CODE } from './mock-api.ts';
import { watchPage } from './support.ts';

// W-15 "Konto" in the browser (EVM-028 AC1–AC6, AC8): the real panel under the real strict CSP against the synthetic API of
// mock-api.ts. The policy of the real server (the counter of the guesses, the roles, the e-mails, the audit, the limit of 5
// sessions, the retention) is covered by the API integration tests; the passkey ceremony of W-04 by the component tests and the
// API tests (ADR-0015), so the full re-authentication here uses the code of the app of an Editor.
test.use({ baseURL: 'http://localhost:4173', session: 'active' });

const ORIGIN = 'http://localhost:4173';
const ACCOUNT = '/account';
const NEW_PASSWORD = 'zupełnie nowe hasło do konta';

/** W-04, the full re-authentication with the password and the code of the app (the code works once on the synthetic server). */
async function confirmIdentity(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog.getByLabel('Hasło')).toBeFocused();
  await dialog.getByLabel('Hasło').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Dalej' }).click();
  await dialog.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
  await dialog.getByRole('button', { name: 'Potwierdź' }).click();
}

test.describe('W-15 Konto w przeglądarce (EVM-028)', () => {
  test('EVM-028 AC1 the display name is changed, the header shows it at once, nothing leaves the origin and nothing is stored', async ({
    page,
  }) => {
    const problems = await watchPage(page, ORIGIN);
    await page.goto(ACCOUNT);
    await expect(page.getByRole('heading', { level: 1, name: 'Konto' })).toBeVisible();
    await expect(page).toHaveTitle('Konto · EVia Manager');
    const field = page.getByLabel('Nazwa wyświetlana');
    await field.fill('Anna Nowak');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByText('Zapisano nazwę.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Konto: Anna Nowak' })).toBeVisible();
    await field.fill('');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByText('Podaj nazwę wyświetlaną.')).toBeVisible();
    expect(await page.evaluate(() => globalThis.localStorage.length + globalThis.sessionStorage.length)).toBe(0);
    expect(problems.page).toEqual([]);
    expect(problems.console).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
  });

  test('EVM-028 AC2 the password is changed after the second step: W-04 asks for the code only, the notice counts the other sessions, they can be ended', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    api.stepUp = 'fresh';
    await page.goto(ACCOUNT);
    await page.getByRole('button', { name: 'Zmień hasło' }).click();
    await expect(page.getByLabel('Bieżące hasło')).toBeFocused();
    await page.getByLabel('Bieżące hasło').fill(PASSWORD);
    await page.getByLabel('Nowe hasło').fill('krótkie');
    await page.getByRole('button', { name: 'Zapisz nowe hasło' }).click();
    await expect(page.getByText('Hasło musi mieć co najmniej 15 znaków.')).toBeVisible();
    await page.getByLabel('Nowe hasło').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Zapisz nowe hasło' }).click();
    const dialog = page.getByRole('dialog', { name: 'Potwierdź tożsamość, aby zmienić hasło' });
    await expect(dialog.getByLabel('Hasło')).toHaveCount(0);
    await dialog.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
    await dialog.getByRole('button', { name: 'Potwierdź' }).click();
    const notice = page.getByRole('status').filter({ hasText: 'Hasło zostało zmienione.' });
    await expect(notice).toHaveText('Hasło zostało zmienione. Wysłaliśmy e-mail z informacją. Konto ma jeszcze 2 inne aktywne sesje.');
    await expect(notice).toBeFocused();
    await expect(page.getByLabel('Bieżące hasło')).toHaveCount(0);
    expect(api.account.password).toBe(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Zakończ pozostałe sesje' }).first().click();
    await expect(page.getByText('Zakończono 2 sesje.')).toBeVisible();
    expect(api.account.sessions).toHaveLength(1);
    const sent = api.seen.find((entry) => entry.url.endsWith('/account/password'));
    expect(sent?.postData).not.toBeNull();
    // The old password is refused from now on.
    await page.getByRole('button', { name: 'Zmień hasło' }).click();
    await page.getByLabel('Bieżące hasło').fill(PASSWORD);
    await page.getByLabel('Nowe hasło').fill('jeszcze inne hasło do konta');
    api.usedCodes.clear();
    await page.getByRole('button', { name: 'Zapisz nowe hasło' }).click();
    await expect(page.getByText('Bieżące hasło jest nieprawidłowe.')).toBeVisible();
    await expect(page.getByLabel('Bieżące hasło')).toBeFocused();
  });

  test('EVM-028 AC3 AC4 a key is removed after the full re-authentication; the last method of an Editor cannot be removed and the reason is shown', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    await page.goto(ACCOUNT);
    await page.getByRole('button', { name: 'Usuń klucz dostępu Telefon' }).click();
    const alert = page.getByRole('alertdialog', { name: 'Usunąć klucz dostępu „Telefon”?' });
    await expect(alert.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await alert.getByRole('button', { name: 'Usuń klucz' }).click();
    await confirmIdentity(page, 'Potwierdź tożsamość, aby usunąć klucz dostępu');
    await expect(page.getByText('Usunięto klucz dostępu.')).toBeVisible();
    await expect(page.getByText(/^Telefon · dodano/)).toHaveCount(0);
    await expect(page.getByText('Laptop w biurze · dodano 03.10.2026')).toBeVisible();
    const last = page.getByRole('button', { name: 'Usuń klucz dostępu Laptop w biurze' });
    await expect(last).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('To jedyna metoda — najpierw dodaj inną.')).toBeVisible();
    expect(api.account.passkeys).toHaveLength(1);
    expect(api.account.mark).toBeNull();
  });

  test('EVM-028 AC3 a code of the app is added: W-04 first, then the QR code and the field; the method is on the list afterwards', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    await page.goto(ACCOUNT);
    await expect(page.getByText('Nie dodano.')).toBeVisible();
    await page.getByRole('button', { name: 'Dodaj kod z aplikacji' }).click();
    await confirmIdentity(page, 'Potwierdź tożsamość, aby dodać kod z aplikacji');
    const dialog = page.getByRole('dialog', { name: 'Dodaj kod z aplikacji' });
    await expect(dialog.getByRole('img', { name: /kod QR/i })).toBeVisible();
    // The code works once on the synthetic server: the one of the re-authentication is spent, so a new step is needed.
    api.usedCodes.clear();
    await dialog.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
    await dialog.getByRole('button', { name: 'Potwierdź kod' }).click();
    await expect(page.getByText('Dodano kod z aplikacji.')).toBeVisible();
    await expect(page.getByText(/^Dodano \d{2}\.\d{2}\.\d{4}$/)).toBeVisible();
    expect(api.account.totp).not.toBeNull();
    // The secret is not left in the page.
    await expect(page.locator('body')).not.toContainText('JBSWY3DPEHPK3PXP');
  });

  test('EVM-028 AC5 new recovery codes: the warning, W-04, ten codes once, the reminder when leaving too early, then they are gone', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    await page.goto(ACCOUNT);
    await expect(page.getByText('Pozostało 7 kodów · wygenerowano 03.10.2026')).toBeVisible();
    await page.getByRole('button', { name: 'Wygeneruj nowe kody…' }).click();
    const alert = page.getByRole('alertdialog', { name: 'Wygenerować nowe kody odzyskiwania?' });
    await expect(alert.getByText('Dotychczasowe kody przestaną działać.')).toBeVisible();
    await alert.getByRole('button', { name: 'Wygeneruj nowe kody' }).click();
    await confirmIdentity(page, 'Potwierdź tożsamość, aby wygenerować nowe kody odzyskiwania');
    const dialog = page.getByRole('dialog', { name: 'Nowe kody odzyskiwania' });
    await expect(dialog.getByRole('listitem')).toHaveCount(10);
    await page.keyboard.press('Escape');
    await expect(dialog.getByText(/Najpierw zapisz kody/)).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Kody są zapisane w bezpiecznym miejscu' }).check();
    await dialog.getByRole('button', { name: 'Zakończ' }).click();
    await expect(page.getByText('Wygenerowano nowe kody odzyskiwania.')).toBeVisible();
    await expect(page.getByText('Pozostało 10 kodów · wygenerowano')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('ABCDEFGHIJKLMNOPQRST');
  });

  test('EVM-028 AC6 AC8 "Moje sesje": the step-up first, the full IP, "Ta sesja" without a button, one session ended, then all the others', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    await page.goto(ACCOUNT);
    await page.getByRole('button', { name: 'Pokaż sesje' }).click();
    const stepUp = page.getByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zobaczyć swoje sesje' });
    await stepUp.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
    await stepUp.getByRole('button', { name: 'Potwierdź' }).click();
    const table = page.getByRole('table', { name: 'Lista moich sesji' });
    await expect(table).toBeVisible();
    await expect(table.getByText('198.51.100.23')).toBeVisible();
    await expect(table.getByText('2001:db8:5::17')).toBeVisible();
    await expect(table.getByText('Ta sesja')).toBeVisible();
    await expect(table.getByRole('button', { name: /^Zakończ sesję/ })).toHaveCount(2);
    await expect(page.getByRole('heading', { level: 3, name: 'Zalogowane przeglądarki · 3' })).toBeFocused();
    await table.getByRole('button', { name: 'Zakończ sesję Firefox · Windows, 203.0.113.45' }).click();
    await expect(page.getByText('Zakończono sesję: Firefox · Windows.')).toBeVisible();
    await expect(table.getByText('Firefox · Windows')).toHaveCount(0);
    await page.getByRole('button', { name: 'Zakończ pozostałe sesje' }).click();
    await expect(page.getByText('Zakończono 1 sesję.')).toBeVisible();
    await expect(page.getByText('Konto jest zalogowane tylko w tej przeglądarce.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('EVM-028 AC8 "Konto" is in the account menu of every screen and the anchor #drugi-krok brings the focus to the card', async ({
    page,
  }) => {
    await page.goto('/work-orders');
    await page.getByRole('button', { name: 'Konto: Anna Testowa' }).click();
    await page.getByRole('menuitem', { name: 'Konto' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/account`);
    await page.goto(`${ACCOUNT}#drugi-krok`);
    await expect(page.getByRole('heading', { level: 2, name: 'Drugi krok logowania' })).toBeFocused();
  });

  test('EVM-028 AC8 offline every change is off and says why; the data of the form stays', async ({ page, context }) => {
    await page.goto(ACCOUNT);
    await expect(page.getByRole('heading', { level: 2, name: 'Profil' })).toBeVisible();
    await page.getByLabel('Nazwa wyświetlana').fill('Anna Nowak');
    await context.setOffline(true);
    await expect(page.getByText(/Brak połączenia\. Zmiany konta są niedostępne/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zapisz', exact: true })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('button', { name: 'Zmień hasło' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByLabel('Nazwa wyświetlana')).toHaveValue('Anna Nowak');
    await context.setOffline(false);
  });
});
