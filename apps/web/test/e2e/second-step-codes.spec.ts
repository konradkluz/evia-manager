import { expect, test } from './fixtures.ts';
import { EMAIL, PASSWORD, RECOVERY_CODE, TOTP_CODE, TOTP_SECRET } from './mock-api.ts';
import { watchPage } from './support.ts';

// The code of the authenticator app and the recovery codes in the browser (EVM-023 AC1–AC8): the real panel under the real
// strict CSP (the QR code is drawn locally — no inline script, no foreign request) against the synthetic API of mock-api.ts.
test.use({ baseURL: 'http://localhost:4173', session: 'none' });

const ORIGIN = 'http://localhost:4173';

test.describe('W-02: logowanie kodem z aplikacji i kodem odzyskiwania (EVM-023 AC2, AC3, AC5)', () => {
  test('EVM-023 AC2 an Editor logs in with the code: no auto-submit, the same code cannot be used twice, nothing in storage or in the address', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    api.methods = ['totp', 'recovery_code'];
    const problems = await watchPage(page, ORIGIN);
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    const field = page.getByLabel('Kod z aplikacji uwierzytelniającej');
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(field).toHaveAttribute('inputmode', 'numeric');
    await expect(field).toHaveAttribute('spellcheck', 'false');
    await field.pressSequentially(TOTP_CODE);
    // Six digits do not send the code on their own (WCAG 3.2.2).
    await page.waitForTimeout(200);
    expect(api.seen.some((entry) => entry.url.endsWith('/auth/login/totp'))).toBe(false);
    await page.getByRole('button', { name: 'Potwierdź' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await expect(page).toHaveURL(`${ORIGIN}/work-orders`);
    expect(page.url()).not.toContain(TOTP_CODE);
    expect(await page.evaluate(() => globalThis.localStorage.length + globalThis.sessionStorage.length)).toBe(0);
    expect(problems.foreignRequests).toEqual([]);
    expect(problems.console).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);

    // The same code again: refused (the server counts every step of the code once).
    await page.getByRole('button', { name: `Konto: Anna Testowa` }).click();
    await page.getByRole('menuitem', { name: 'Wyloguj' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await page.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
    await page.getByRole('button', { name: 'Potwierdź' }).click();
    await expect(page.getByRole('alert')).toContainText('Kod jest nieprawidłowy lub wygasł. Wpisz nowy kod z aplikacji.');
    await expect(page.getByLabel('Kod z aplikacji uwierzytelniającej')).toHaveValue('');
    await expect(page.getByLabel('Kod z aplikacji uwierzytelniającej')).toBeFocused();
  });

  test('EVM-023 AC3 the Administrator gets only the passkey from the server: no field for a code of the app', async ({ page, api }) => {
    api.methods = ['passkey', 'recovery_code'];
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await expect(page.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeFocused();
    await expect(page.getByLabel('Kod z aplikacji uwierzytelniającej')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Użyj innej metody' })).toHaveCount(0);
  });

  test('EVM-023 AC5 a recovery code logs in once: the message with the count and the hint, "Przejdź dalej", and the same code is refused', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    api.methods = ['totp', 'recovery_code'];
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await page.getByRole('button', { name: 'Nie masz dostępu do metody? Użyj kodu odzyskiwania' }).click();
    await expect(page.getByLabel('Kod odzyskiwania')).toBeFocused();
    await page.getByLabel('Kod odzyskiwania').fill('abcde-fghij klmno-pqrst');
    await page.getByRole('button', { name: 'Potwierdź' }).click();
    const status = page.getByRole('status').filter({ hasText: 'Zalogowano kodem odzyskiwania.' });
    await expect(status).toContainText('Pozostało 9 kodów. Wysłaliśmy e-mail z informacją o tym logowaniu.');
    await expect(status).toContainText('Jeśli nie masz już żadnej metody, poproś administratora o reset drugiego kroku logowania.');
    await expect(page.getByRole('button', { name: 'Przejdź dalej' })).toBeFocused();
    await page.getByRole('button', { name: 'Przejdź dalej' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();

    await page.getByRole('button', { name: `Konto: Anna Testowa` }).click();
    await page.getByRole('menuitem', { name: 'Wyloguj' }).click();
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await page.getByRole('button', { name: 'Nie masz dostępu do metody? Użyj kodu odzyskiwania' }).click();
    await page.getByLabel('Kod odzyskiwania').fill(RECOVERY_CODE);
    await page.getByRole('button', { name: 'Potwierdź' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Kod jest nieprawidłowy lub wygasł. Sprawdź kod albo użyj innego kodu odzyskiwania.',
    );
  });

  test('EVM-023 AC8 offline W-02 keeps the typed code and disables "Potwierdź"', async ({ page, context, api }) => {
    api.role = 'editor';
    api.methods = ['totp'];
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await page.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
    await context.setOffline(true);
    await expect(page.getByText('Brak połączenia. Logowanie wymaga połączenia z internetem.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Potwierdź' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByLabel('Kod z aplikacji uwierzytelniającej')).toHaveValue(TOTP_CODE);
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'Potwierdź' })).not.toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('W-03: konfiguracja kodu z aplikacji i kody odzyskiwania (EVM-023 AC1, AC4, AC6, AC8)', () => {
  test.use({ session: 'enrollment' });

  test('EVM-023 AC1 AC4 an Editor sets up the code: the QR is drawn in the page, a wrong code is refused, a right one shows the recovery codes once', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    const problems = await watchPage(page, ORIGIN);
    await page.goto('/mfa-setup');
    await expect(page.getByText('Krok 1 z 3')).toBeVisible();
    await page.getByRole('radio', { name: 'Kod z aplikacji uwierzytelniającej' }).check();
    await page.getByRole('button', { name: 'Dalej' }).click();
    const qr = page.getByRole('img', { name: 'Kod QR do zeskanowania w aplikacji uwierzytelniającej' });
    await expect(qr).toBeVisible();
    // The secret is asked for by the user, as text; it is not in the markup of the QR and never in a foreign request.
    await page.getByRole('button', { name: /Pokaż klucz do wpisania/ }).click();
    await expect(page.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeVisible();
    expect(await qr.evaluate((element) => element.outerHTML.includes('JBSWY3DP'))).toBe(false);

    const field = page.getByLabel('Kod z aplikacji uwierzytelniającej', { exact: true }).last();
    await field.fill('000000');
    await page.getByRole('button', { name: 'Potwierdź kod' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Kod jest nieprawidłowy. Sprawdź, czy czas w telefonie jest ustawiony automatycznie',
    );
    await expect(field).toBeFocused();
    await field.fill(TOTP_CODE);
    await page.getByRole('button', { name: 'Potwierdź kod' }).click();

    await expect(page.getByRole('heading', { level: 2, name: 'Kody odzyskiwania', exact: true })).toBeFocused();
    await expect(page.getByRole('list', { name: 'Kody odzyskiwania' }).getByRole('listitem')).toHaveCount(10);
    await expect(page.getByText('Metody logowania: kod z aplikacji · klucz dostępu: nie')).toBeVisible();
    await expect(page).toHaveURL(`${ORIGIN}/mfa-setup`);
    await page.getByRole('button', { name: 'Zakończ konfigurację' }).click();
    await expect(page.getByRole('alert')).toHaveText('Potwierdź, że kody są zapisane.');
    await page.getByRole('checkbox', { name: 'Kody są zapisane w bezpiecznym miejscu' }).check();
    await page.getByRole('button', { name: 'Zakończ konfigurację' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await expect(page.getByText('Drugi krok logowania jest skonfigurowany.')).toBeVisible();

    const confirm = api.seen.find((entry) => entry.url.endsWith('/account/totp/confirm'));
    expect(confirm?.headers['x-csrf-token']).toBe('csrf-enrollment');
    expect(await page.evaluate(() => globalThis.localStorage.length + globalThis.sessionStorage.length)).toBe(0);
    expect(problems.foreignRequests).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
    // Nothing of the secret or of the codes stays in the page after the step.
    expect(await page.evaluate(() => document.body.textContent)).not.toContain('ABCDEFGHIJ');
    expect(await page.evaluate(() => document.body.textContent)).not.toContain(TOTP_SECRET);
  });

  test('EVM-023 AC3 the Administrator has no choice in the panel: straight to the passkey', async ({ page }) => {
    await page.goto('/mfa-setup');
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByText('Klucz dostępu jest obowiązkowy.')).toBeVisible();
    await expect(page.getByText('Krok 2 z 3')).toBeVisible();
  });

  test('EVM-023 AC8 offline W-03 keeps the step and the typed code, the buttons wait for the connection', async ({
    page,
    context,
    api,
  }) => {
    api.role = 'editor';
    await page.goto('/mfa-setup');
    await page.getByRole('radio', { name: 'Kod z aplikacji uwierzytelniającej' }).check();
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.getByRole('img', { name: /Kod QR/ })).toBeVisible();
    await page.getByLabel('Kod z aplikacji uwierzytelniającej', { exact: true }).last().fill(TOTP_CODE);
    await context.setOffline(true);
    await expect(
      page.getByText('Brak połączenia. Konfiguracja wymaga połączenia z internetem. Postęp zostaje na tej karcie.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Potwierdź kod' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('img', { name: /Kod QR/ })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'Potwierdź kod' })).not.toHaveAttribute('aria-disabled', 'true');
  });
});
