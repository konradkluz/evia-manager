import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { DISPLAY_NAME, type MockApi } from './mock-api.ts';
import { virtualAuthenticator, watchPage } from './support.ts';

// Step-up (W-04) and the audit log (W-18) in the browser (EVM-029 AC1–AC8): the real panel under the real strict CSP
// against the synthetic API of mock-api.ts. WebAuthn needs a domain name for the relying party, so the spec runs on
// `localhost`; Chromium and Edge get a virtual authenticator, Firefox has none (ADR-0015: the passkey ceremony is
// covered by the integration tests of the API), so the parts with a key skip there.
test.use({ baseURL: 'http://localhost:4173', session: 'active' });

const ORIGIN = 'http://localhost:4173';
const AUDIT = '/administration/audit';
const TITLE = 'Potwierdź tożsamość, aby przejrzeć dziennik audytu';
const NO_FIREFOX = 'Firefox has no virtual authenticator; the passkey ceremony is covered by the API integration tests (ADR-0015).';

/** Registers a passkey in the virtual authenticator (what EVM-016 did for the account) and teaches the server its id. */
async function accountWithPasskey(page: Page, api: MockApi): Promise<void> {
  await virtualAuthenticator(page);
  await page.goto('/login');
  api.credentialId = await page.evaluate(async () => {
    const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON({
      rp: { id: 'localhost', name: 'EVia Manager' },
      user: { id: 'dXNlci1oYW5kbGU', name: 'anna.testowa@example.com', displayName: 'Anna Testowa' },
      challenge: 'Y2hhbGxlbmdl',
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      attestation: 'none',
    });
    const credential = await navigator.credentials.create({ publicKey });
    if (!(credential instanceof PublicKeyCredential)) throw new Error('no credential');
    return credential.id;
  });
}

const reads = (api: MockApi) => api.seen.filter((entry) => entry.method === 'GET' && entry.url.includes('/api/v1/audit/events'));

test.describe('W-04 and W-18 in the browser (EVM-029)', () => {
  test('EVM-029 AC1 AC3 the log asks for the key, then it is read again by itself; the rotated token replaces the old one', async ({
    page,
    api,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    const problems = await watchPage(page, ORIGIN);
    await accountWithPasskey(page, api);
    await page.goto(AUDIT);
    const dialog = page.getByRole('alertdialog', { name: TITLE });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeFocused();
    expect(reads(api)).toHaveLength(1);

    await dialog.getByRole('button', { name: 'Użyj klucza dostępu' }).click();

    await expect(page.getByRole('table', { name: 'Dziennik audytu — zdarzenia od najnowszych' })).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(reads(api)).toHaveLength(2);
    // The step-up request travelled with the CSRF token of the old session and the origin the browser itself named.
    const stepUp = api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/api/v1/auth/step-up'));
    expect(stepUp).toHaveLength(1);
    expect(stepUp[0]?.headers['x-csrf-token']).toBe('csrf-active');
    expect(stepUp[0]?.headers['origin']).toBe(ORIGIN);
    // Nothing of the log or of the confirmation is kept by the tab outside its memory (SR-WEB-05).
    const kept = await page.evaluate(() =>
      JSON.stringify({
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
        title: document.title,
        href: location.href,
      }),
    );
    expect(kept).not.toContain(DISPLAY_NAME);
    expect(kept).not.toContain('csrf-');
    await expect(page).toHaveTitle('Dziennik audytu · EVia Manager');
    expect(problems.page).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test('EVM-029 AC2 an open window shows the log with no dialog', async ({ page, api }) => {
    api.stepUp = 'fresh';
    await page.goto(AUDIT);
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(api.seen.filter((entry) => entry.url.includes('/step-up'))).toEqual([]);
  });

  test('EVM-029 AC4 "Anuluj" leaves the log without data; the button asks again; Esc is "Anuluj" and focus returns to the page', async ({
    page,
    api,
  }) => {
    await page.goto(AUDIT);
    const dialog = page.getByRole('alertdialog', { name: TITLE });
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(page.getByRole('heading', { name: 'Potwierdź tożsamość, aby zobaczyć dziennik audytu.' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    expect(api.seen.filter((entry) => entry.url.includes('/step-up'))).toEqual([]);
    await page.getByRole('button', { name: 'Potwierdź tożsamość' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Potwierdź tożsamość' })).toBeFocused();
  });

  test('EVM-029 AC4 the dialog traps the focus: Tab stays between "Anuluj" and "Użyj klucza dostępu"', async ({ page }) => {
    await page.goto(AUDIT);
    const dialog = page.getByRole('alertdialog', { name: TITLE });
    const key = dialog.getByRole('button', { name: 'Użyj klucza dostępu' });
    await expect(key).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(key).toBeFocused();
    // The page behind is inert: however far Tab goes, the focus never reaches the menu or the filters behind the dialog.
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => document.activeElement?.closest('dialog') !== null || document.activeElement === document.body),
      ).toBe(true);
    }
    await expect(dialog.getByText(/kod odzyskiwania/i)).toHaveCount(0);
  });

  test('EVM-029 AC4 a refused key keeps the dialog with a message', async ({ page, api, browserName }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    await accountWithPasskey(page, api);
    // The server knows another key: the browser's key is not accepted.
    api.credentialId = 'a-different-credential-id';
    await page.goto(AUDIT);
    await page.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
    // Virtual authenticator finds no allowed key or the server refuses it: either way the same message, dialog stays.
    await expect(page.getByRole('alert')).toHaveText('Nie udało się użyć klucza dostępu. Spróbuj ponownie.');
    await expect(page.getByRole('alertdialog', { name: TITLE })).toBeVisible();
  });

  test('EVM-029 AC5 filters and pages by cursor: 25 per page, no total, filters not in the address', async ({ page, api }) => {
    api.stepUp = 'fresh';
    await page.goto(AUDIT);
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(26);
    await page.getByRole('button', { name: 'Następna strona' }).click();
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(16);
    await expect(page.getByText('Wczytano następną stronę zdarzeń')).toBeAttached();
    await expect(page.getByRole('heading', { level: 2, name: /Zdarzenia od najnowszych/ })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Następna strona' })).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('combobox', { name: 'Wynik' }).selectOption({ label: 'Odmowa' });
    await expect(
      page.getByRole('group', { name: 'Aktywne filtry' }).getByRole('button', { name: 'Usuń filtr Wynik: Odmowa' }),
    ).toBeVisible();
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(9);
    await expect(page.getByRole('table').getByText('Osoba niezalogowana').first()).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(26);
  });

  test('EVM-029 AC7 Edytor: no "Administracja" in the menu, the address gives "Brak dostępu" and no request for the log', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    await page.goto(AUDIT);
    await expect(page.getByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Administracja' })).toHaveCount(0);
    await expect(page).toHaveTitle('Brak dostępu · EVia Manager');
    expect(reads(api)).toEqual([]);
    await page.getByRole('button', { name: 'Przejdź do zleceń' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/work-orders`);
  });

  test('EVM-029 AC7 an Administrator reaches the log from the menu', async ({ page, api }) => {
    api.stepUp = 'fresh';
    await page.goto('/work-orders');
    await page.getByRole('link', { name: 'Administracja' }).first().click();
    await expect(page).toHaveURL(`${ORIGIN}${AUDIT}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Dziennik audytu' })).toBeVisible();
  });

  test('EVM-029 AC8 429 of the log: the wait from Retry-After and the filters stay', async ({ page, api }) => {
    api.stepUp = 'fresh';
    await page.goto(AUDIT);
    await expect(page.getByRole('table')).toBeVisible();
    api.failNext.set('GET /api/v1/audit/events', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
    await page.getByRole('combobox', { name: 'Wynik' }).selectOption({ label: 'Udane' });
    await expect(page.getByRole('alert')).toContainText('Zbyt wiele zapytań. Spróbuj ponownie za 1 min.');
    await expect(page.getByRole('combobox', { name: 'Wynik' })).toHaveValue('success');
  });

  test('EVM-029 AC8 offline: the dialog says that the confirmation needs the internet and sends nothing', async ({
    page,
    api,
    context,
  }) => {
    await page.goto(AUDIT);
    const dialog = page.getByRole('alertdialog', { name: TITLE });
    await expect(dialog).toBeVisible();
    await context.setOffline(true);
    await expect(dialog.getByText('Brak połączenia. Potwierdzenie wymaga połączenia z internetem.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Użyj klucza dostępu' })).toHaveAttribute('aria-disabled', 'true');
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeEnabled();
    expect(api.seen.filter((entry) => entry.url.includes('/step-up'))).toEqual([]);
    await context.setOffline(false);
  });
});
