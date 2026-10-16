import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { VALID_TOKEN, type MockApi } from './mock-api.ts';
import { BIURO_ID, KASIA_ID } from './mock-users.ts';
import { virtualAuthenticator, watchPage } from './support.ts';

// W-16 "Użytkownicy", the invitation and its resend in the browser (EVM-024 AC1–AC5, AC7, AC8): the real panel under the real
// strict CSP against the synthetic API of mock-api.ts. WebAuthn needs a domain name for the relying party, so the spec runs on
// `localhost`; Chromium and Edge get a virtual authenticator, Firefox has none (ADR-0015: the passkey ceremony is covered by the
// integration tests of the API), so the parts with a key skip there. The worker, the outbox and Mailpit are covered by the API
// integration tests; the whole stack by the QA run of the story.
test.use({ baseURL: 'http://localhost:4173', session: 'active' });

const ORIGIN = 'http://localhost:4173';
const USERS = '/administration/users';
const NO_FIREFOX = 'Firefox has no virtual authenticator; the passkey ceremony is covered by the API integration tests (ADR-0015).';
const INVITE_TITLE = 'Potwierdź tożsamość, aby zaprosić użytkownika';

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

const posts = (api: MockApi, suffix: string) =>
  api.seen.filter((entry) => entry.method === 'POST' && new URL(entry.url).pathname.endsWith(suffix));

async function invite(page: Page, email: string, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Zaproś użytkownika' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Zaproś użytkownika' });
  await expect(dialog.getByRole('textbox', { name: 'E-mail' })).toBeFocused();
  await dialog.getByRole('textbox', { name: 'E-mail' }).fill(email);
  await dialog.getByRole('textbox', { name: 'Nazwa wyświetlana' }).fill(name);
  await dialog.getByRole('button', { name: 'Zaproś' }).click();
}

test.describe('W-16 Użytkownicy in the browser (EVM-024)', () => {
  test('EVM-024 AC8 an Administrator reaches W-16 from the menu: the tab "Użytkownicy", the list with the invitation states, the menu only on the account that waits', async ({
    page,
    api,
  }) => {
    // The window of the confirmation is open, so the log (the second tab) does not open W-04 and take the focus away.
    api.stepUp = 'fresh';
    const problems = await watchPage(page, ORIGIN);
    await page.goto('/work-orders');
    await page.getByRole('link', { name: 'Administracja' }).first().click();
    await expect(page).toHaveURL(`${ORIGIN}${USERS}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Użytkownicy' })).toBeVisible();
    await expect(page).toHaveTitle('Użytkownicy · EVia Manager');
    await expect(page.getByRole('tab', { name: 'Użytkownicy', selected: true })).toBeVisible();
    const table = page.getByRole('table', { name: 'Użytkownicy' });
    await expect(table.getByRole('row')).toHaveCount(6);
    await expect(table.getByText('Anna Testowa (Ty)')).toBeVisible();
    await expect(table.getByText('Nie wysłano')).toBeVisible();
    await expect(table.getByText(/^Wysłano \d{2}\.\d{2}\.\d{4} · ważne do \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/)).toBeVisible();
    await expect(table.getByRole('button', { name: /^Akcje konta:/ })).toHaveCount(2);
    // The arrows move between the tabs and the focus stays on the tab bar (the tabs belong to the layout).
    await page.getByRole('tab', { name: 'Użytkownicy' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(`${ORIGIN}/administration/audit`);
    await expect(page.getByRole('tab', { name: 'Dziennik audytu' })).toBeFocused();
    expect(problems.page).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test('EVM-024 AC1 the invitation goes through: body of identifiers and text only, the toast, the new account "Wysyłanie…", the form empty again', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    await page.goto(USERS);
    await invite(page, 'anna.nowak@example.com', 'Anna Nowak');
    await expect(page.getByText('Wysłano zaproszenie.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const row = page.getByRole('row', { name: /^Anna Nowak, Edytor, Oczekuje na aktywację$/ });
    await expect(row.getByText('Wysyłanie…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zaproś użytkownika' }).first()).toBeFocused();
    const sent = posts(api, '/api/v1/users');
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0]?.postData ?? '{}') as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(['displayName', 'email', 'id', 'role']);
    expect(body).toMatchObject({ email: 'anna.nowak@example.com', displayName: 'Anna Nowak', role: 'editor' });
    expect(sent[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0]?.headers['origin']).toBe(ORIGIN);
    // No link and no token in the page, the address or the stores.
    expect(
      await page.evaluate(() =>
        [document.body.innerText, location.href, JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join(' '),
      ),
    ).not.toMatch(/#|token|\/activate/i);
    await page.getByRole('button', { name: 'Zaproś użytkownika' }).first().click();
    await expect(page.getByRole('textbox', { name: 'E-mail' })).toHaveValue('');
  });

  test('EVM-024 AC1 without a recent confirmation W-04 asks "Potwierdź tożsamość, aby zaprosić użytkownika", the dialog steps aside with its data and the invitation is made once after the key', async ({
    page,
    api,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    await accountWithPasskey(page, api);
    await page.goto(USERS);
    await invite(page, 'anna.nowak@example.com', 'Anna Nowak');
    const confirm = page.getByRole('alertdialog', { name: INVITE_TITLE });
    await expect(confirm).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Zaproś użytkownika' })).toHaveCount(0);
    expect(api.users.accepted).toBe(0);
    await confirm.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
    await expect(page.getByText('Wysłano zaproszenie.')).toBeVisible();
    expect(api.users.accepted).toBe(1);
    // The same request went twice with the same key; the server made one account.
    const sent = posts(api, '/api/v1/users');
    expect(sent).toHaveLength(2);
    expect(sent[0]?.headers['idempotency-key']).toBe(sent[1]?.headers['idempotency-key']);
    expect(sent[0]?.postData).toBe(sent[1]?.postData);
    expect(sent[1]?.headers['x-csrf-token']).toBe('csrf-rotated');
  });

  test('EVM-024 AC1 "Anuluj" in W-04 sends nothing again and the dialog comes back with what was typed', async ({
    page,
    api,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    await accountWithPasskey(page, api);
    await page.goto(USERS);
    await invite(page, 'anna.nowak@example.com', 'Anna Nowak');
    await page.getByRole('alertdialog', { name: INVITE_TITLE }).getByRole('button', { name: 'Anuluj' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zaproś użytkownika' });
    await expect(dialog.getByRole('alert')).toContainText('Nie wysłano zaproszenia — tożsamość nie została potwierdzona.');
    await expect(dialog.getByRole('textbox', { name: 'E-mail' })).toHaveValue('anna.nowak@example.com');
    expect(api.users.accepted).toBe(0);
  });

  test('EVM-024 AC1 a lost answer: the retry sends the same key and the server still has one account', async ({ page, api }) => {
    api.stepUp = 'fresh';
    api.dropResponseNext.add('POST /api/v1/users');
    await page.goto(USERS);
    await invite(page, 'anna.nowak@example.com', 'Anna Nowak');
    const dialog = page.getByRole('dialog', { name: 'Zaproś użytkownika' });
    await expect(dialog.getByRole('alert')).toContainText('Nie udało się wysłać zaproszenia.');
    await dialog.getByRole('button', { name: 'Zaproś' }).click();
    await expect(page.getByText('Wysłano zaproszenie.')).toBeVisible();
    const sent = posts(api, '/api/v1/users');
    expect(sent).toHaveLength(2);
    expect(sent[0]?.headers['idempotency-key']).toBe(sent[1]?.headers['idempotency-key']);
    expect(api.users.accepted).toBe(1);
    await expect(page.getByRole('row', { name: /^Anna Nowak/ })).toHaveCount(1);
  });

  test('EVM-024 AC2 an invalid address is stopped before it is sent, and the server answer 400 is shown under the field', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    await page.goto(USERS);
    await invite(page, 'a@b.test,c@d.test', 'Anna Nowak');
    const dialog = page.getByRole('dialog', { name: 'Zaproś użytkownika' });
    await expect(dialog.getByText('Podaj adres e-mail, np. jan.przykladowy@example.com.')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'E-mail' })).toBeFocused();
    expect(posts(api, '/api/v1/users')).toHaveLength(0);
    // What the panel lets through the server judges: its 400 gets the same sentence under the same field.
    api.failNext.set('POST /api/v1/users', { status: 400, code: 'validation_failed' });
    await dialog.getByRole('textbox', { name: 'E-mail' }).fill('anna.nowak@example.com');
    await dialog.getByRole('button', { name: 'Zaproś' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'E-mail' })).toHaveValue('anna.nowak@example.com');
  });

  test('EVM-024 AC7 an address that exists: the dialog names the account and "Pokaż konto" brings the focus to its row; a deleted account gets no name', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    await page.goto(USERS);
    await invite(page, 'jan.przykladowy@example.com', 'Jan');
    const dialog = page.getByRole('dialog', { name: 'Zaproś użytkownika' });
    await expect(dialog.getByRole('alert')).toContainText('Konto z tym adresem już istnieje: Jan Przykładowy · Aktywne.');
    await dialog.getByRole('button', { name: 'Pokaż konto' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('row', { name: /^Jan Przykładowy/ }).getByText('Jan Przykładowy')).toBeFocused();
    await invite(page, 'usuniety@example.com', 'Ktoś');
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Konto z tym adresem już istnieje.');
    await expect(page.getByRole('button', { name: 'Pokaż konto' })).toHaveCount(0);
    expect(api.users.accepted).toBe(0);
  });

  test('EVM-024 AC5 "Nie wysłano" has "Wyślij ponownie" named with the object; the dialog resends and the state goes back to "Wysyłanie…"', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    await page.goto(USERS);
    await page.getByRole('button', { name: 'Wyślij ponownie zaproszenie: Kasia Testowa, kasia.testowa@example.com' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Wysłać zaproszenie ponownie?' });
    await expect(dialog.getByText('Wyślemy nowy link ważny 72 godziny na adres kasia.testowa@example.com.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Wyślij ponownie' }).click();
    await expect(page.getByText('Wysłano zaproszenie ponownie.')).toBeVisible();
    await expect(page.getByRole('row', { name: /^Kasia Testowa/ }).getByText('Wysyłanie…')).toBeVisible();
    expect(posts(api, `/api/v1/users/${KASIA_ID}/invitations`)).toHaveLength(1);
  });

  test('EVM-024 AC4 the menu of the account that waits resends the invitation after W-04, and the focus returns to the menu button', async ({
    page,
    api,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    await accountWithPasskey(page, api);
    await page.goto(USERS);
    const trigger = page.getByRole('button', { name: 'Akcje konta: Biuro Testowe, biuro@example.com' });
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Wyślij zaproszenie ponownie…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Wysłać zaproszenie ponownie?' });
    await expect(dialog.getByText('Poprzedni link przestanie działać.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Wyślij ponownie' }).click();
    await page
      .getByRole('alertdialog', { name: 'Potwierdź tożsamość, aby ponownie wysłać zaproszenie' })
      .getByRole('button', { name: 'Użyj klucza dostępu' })
      .click();
    await expect(page.getByText('Wysłano zaproszenie ponownie.')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(posts(api, `/api/v1/users/${BIURO_ID}/invitations`)).toHaveLength(2);
    await expect(trigger).toBeFocused();
  });

  test('EVM-024 AC8 an Edytor has no "Administracja", the address gives "Brak dostępu" and the panel does not ask for the list', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    await page.goto(USERS);
    await expect(page.getByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Administracja' })).toHaveCount(0);
    await expect(page).toHaveTitle('Brak dostępu · EVia Manager');
    await expect(page.getByRole('tab')).toHaveCount(0);
    expect(api.seen.filter((entry) => entry.url.includes('/api/v1/users') && !entry.url.includes('assignable'))).toEqual([]);
    await page.getByRole('button', { name: 'Przejdź do zleceń' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/work-orders`);
  });

  test('EVM-024 AC5 offline the invitation and the resend are disabled with their reason and nothing is sent', async ({
    page,
    api,
    context,
  }) => {
    api.stepUp = 'fresh';
    await page.goto(USERS);
    await expect(page.getByRole('table', { name: 'Użytkownicy' })).toBeVisible();
    await context.setOffline(true);
    const button = page.getByRole('button', { name: 'Zaproś użytkownika' }).first();
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('title', 'Zmienisz po powrocie połączenia.');
    await expect(page.getByRole('button', { name: /^Akcje konta/ }).first()).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('button', { name: /^Wyślij ponownie zaproszenie/ })).toHaveAttribute('aria-disabled', 'true');
    await button.click({ force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(posts(api, '/api/v1/users')).toHaveLength(0);
    await context.setOffline(false);
  });

  test('EVM-024 AC5 a failed read shows "Nie udało się wczytać użytkowników." and "Spróbuj ponownie" reads the list again', async ({
    page,
    api,
  }) => {
    api.failNext.set('GET /api/v1/users', { status: 500, code: 'internal_error' });
    await page.goto(USERS);
    await expect(page.getByRole('heading', { name: 'Nie udało się wczytać użytkowników.' })).toBeVisible();
    await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(page.getByRole('table', { name: 'Użytkownicy' })).toBeVisible();
  });
});

test.describe('W-13 opened from the link of an invitation (EVM-024 AC3)', () => {
  test.use({ session: 'none' });

  test('EVM-024 AC3 the token leaves the address bar and the history at once, opening the page does not use the invitation, and the token is only in the body of POST', async ({
    page,
    api,
    browserName,
  }) => {
    await page.goto(`/activate#${VALID_TOKEN}`);
    await expect(page.getByLabel('Nowe hasło')).toBeVisible();
    expect(page.url()).toBe(`${ORIGIN}/activate`);
    if (browserName !== 'firefox') {
      const cdp = await page.context().newCDPSession(page);
      const history = (await cdp.send('Page.getNavigationHistory')) as { entries: { url: string }[] };
      expect(history.entries.map((entry) => entry.url).filter((url) => url.includes(VALID_TOKEN))).toEqual([]);
    }
    // Opening only checks the link (a scanner of links in the mail does the same); the invitation is used by the password, not by the visit.
    const withToken = api.seen.filter((entry) => entry.postData?.includes(VALID_TOKEN));
    expect(withToken.map((entry) => `${entry.method} ${new URL(entry.url).pathname}`)).toEqual(['POST /api/v1/auth/activation/check']);
    expect(api.seen.filter((entry) => entry.url.includes(VALID_TOKEN))).toEqual([]);
    expect(api.seen.filter((entry) => Object.values(entry.headers).some((value) => value.includes(VALID_TOKEN)))).toEqual([]);
  });
});
