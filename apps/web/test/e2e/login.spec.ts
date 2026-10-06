import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { DISPLAY_NAME, EMAIL, LOGIN_TOKEN, PASSWORD, type MockApi } from './mock-api.ts';
import { virtualAuthenticator, watchPage } from './support.ts';

// Logging in, the second step and the end of the session in the browser (EVM-067 AC1–AC8; styleguide 4.17): the real
// panel under the real strict CSP against the synthetic API of mock-api.ts. WebAuthn needs a domain name for the relying
// party, so the spec runs on `localhost`; Chromium and Edge get a virtual authenticator, Firefox has none (ADR-0015:
// the passkey ceremony is covered by the integration tests of the API), so the parts with a key skip there.
test.use({ baseURL: 'http://localhost:4173', session: 'none' });

const ORIGIN = 'http://localhost:4173';
const MINUTE = 60_000;
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

async function logInWithPassword(page: Page, password = PASSWORD): Promise<void> {
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Hasło').fill(password);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
}

/** Everything the tab keeps that could outlive it or be read by another page: storages, databases, cookies, address, title. */
async function whatTheTabKeeps(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    return JSON.stringify({
      href: location.href,
      title: document.title,
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
      databases,
      cookie: document.cookie,
      html: document.documentElement.outerHTML,
    });
  });
}

test.describe('W-01 Zaloguj się in the browser (EVM-067 AC1–AC3, AC8)', () => {
  test('EVM-067 AC2 a wrong password: one message with focus on it, the e-mail stays, the password is cleared', async ({ page, api }) => {
    const problems = await watchPage(page, ORIGIN);
    await page.goto('/login');
    await expect(page.getByLabel('E-mail')).toBeFocused();
    await expect(page).toHaveTitle('Logowanie · EVia Manager');
    await logInWithPassword(page, 'zle-haslo-zle-haslo');
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText('Nieprawidłowy e-mail lub hasło.');
    await expect(alert).toBeFocused();
    await expect(page.getByLabel('E-mail')).toHaveValue(EMAIL);
    await expect(page.getByLabel('Hasło')).toHaveValue('');
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    // The browser itself named the origin of the mutation; the password travelled only in the body of the login.
    const login = api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/api/v1/auth/login'));
    expect(login).toHaveLength(1);
    expect(login[0]?.headers['origin']).toBe(ORIGIN);
    expect(api.seen.filter((entry) => entry.url.includes('zle-haslo') || JSON.stringify(entry.headers).includes('zle-haslo'))).toEqual([]);
    expect(problems.page).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test('EVM-067 AC3 429: the wait comes from Retry-After', async ({ page, api }) => {
    api.failNext.set('POST /api/v1/auth/login', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
    await page.goto('/login');
    await logInWithPassword(page);
    await expect(page.getByRole('alert')).toHaveText('Zbyt wiele prób logowania. Spróbuj ponownie za 1 min.');
  });

  test('EVM-067 AC8 offline: the banner, the button unavailable with its hint, the typed e-mail stays', async ({ page, context }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(EMAIL);
    await context.setOffline(true);
    await expect(page.getByText('Brak połączenia. Logowanie wymaga połączenia z internetem.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zaloguj się' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Zalogujesz się po powrocie połączenia.')).toBeVisible();
    await expect(page.getByLabel('E-mail')).toHaveValue(EMAIL);
    await context.setOffline(false);
    await expect(page.getByText('Brak połączenia. Logowanie wymaga połączenia z internetem.')).toHaveCount(0);
  });

  test('EVM-067 AC8 an account without a second step lands on W-03 with a limited session', async ({ page, api }) => {
    api.loginMode = 'mfa_enrollment';
    await page.goto('/login');
    await logInWithPassword(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' })).toBeVisible();
    await expect(page).toHaveURL(`${ORIGIN}/mfa-setup`);
    expect(await whatTheTabKeeps(page)).not.toContain(PASSWORD);
  });

  test('EVM-067 AC1 an address of the panel opened without a session returns after logging in as a validated path', async ({ page }) => {
    await page.goto('/work-orders?status=open');
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/work-orders?status=open');
    await expect(page.getByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeVisible();
    await expect(page.getByText(/Sesja wygasła/)).toHaveCount(0);
  });
});

test.describe('W-02 and the whole login with a passkey (EVM-067 AC1, AC4, AC6)', () => {
  test('EVM-067 AC1 password and passkey: the panel opens, and the token and the password live only in memory and in the right POST bodies', async ({
    page,
    api,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    const problems = await watchPage(page, ORIGIN);
    await accountWithPasskey(page, api);
    await page.goto('/login');
    await logInWithPassword(page);

    // W-02: the focus is on the key, there is no other method, and nothing of the login is in the address or any storage.
    await expect(page.getByRole('heading', { level: 1, name: 'Potwierdź logowanie' })).toBeVisible();
    await expect(page).toHaveURL(`${ORIGIN}/login/second-step`);
    await expect(page.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeFocused();
    await expect(page.getByText(/innej metody|kod z aplikacji|kod odzyskiwania/i)).toHaveCount(0);
    const atSecondStep = await whatTheTabKeeps(page);
    expect(atSecondStep).not.toContain(LOGIN_TOKEN);
    expect(atSecondStep).not.toContain(PASSWORD);

    await page.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await expect(page).toHaveURL(`${ORIGIN}/work-orders`);
    await expect(page.getByRole('button', { name: `Konto: ${DISPLAY_NAME}` })).toBeVisible();
    expect(api.session).toBe('active');

    // After logging in: still nothing in the storages, the databases, the cookies readable by the page, the title.
    const afterLogin = await whatTheTabKeeps(page);
    expect(afterLogin).not.toContain(LOGIN_TOKEN);
    expect(afterLogin).not.toContain(PASSWORD);
    const storages = JSON.parse(afterLogin) as { local: unknown[]; session: unknown[]; databases: unknown[]; cookie: string };
    expect(storages.local).toEqual([]);
    expect(storages.session).toEqual([]);
    expect(storages.databases).toEqual([]);
    expect(storages.cookie).toBe('');

    // Where the secrets travelled: the token only in the bodies of the two passkey calls, the password only in the login body.
    const tokenCarriers = api.seen.filter(
      (entry) =>
        entry.url.includes(LOGIN_TOKEN) ||
        JSON.stringify(entry.headers).includes(LOGIN_TOKEN) ||
        (entry.postData ?? '').includes(LOGIN_TOKEN),
    );
    expect(tokenCarriers.map((entry) => `${entry.method} ${new URL(entry.url).pathname}`)).toEqual([
      'POST /api/v1/auth/login/passkey/options',
      'POST /api/v1/auth/login/passkey',
    ]);
    for (const entry of tokenCarriers) expect(entry.url).not.toContain(LOGIN_TOKEN);
    const passwordCarriers = api.seen.filter(
      (entry) =>
        entry.url.includes(PASSWORD) || JSON.stringify(entry.headers).includes(PASSWORD) || (entry.postData ?? '').includes(PASSWORD),
    );
    expect(passwordCarriers.map((entry) => `${entry.method} ${new URL(entry.url).pathname}`)).toEqual(['POST /api/v1/auth/login']);
    // The mutations of the login name the origin (the browser adds it) and the next mutation carries the new CSRF token.
    for (const entry of api.seen.filter((item) => item.method === 'POST')) expect(entry.headers['origin']).toBe(ORIGIN);
    const history = (await (await page.context().newCDPSession(page)).send('Page.getNavigationHistory')) as { entries: { url: string }[] };
    expect(history.entries.map((entry) => entry.url).filter((url) => url.includes(LOGIN_TOKEN) || url.includes('second-step'))).toEqual([]);

    await page.getByRole('button', { name: `Konto: ${DISPLAY_NAME}` }).click();
    await page.getByRole('menuitem', { name: 'Wyloguj' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    expect(api.seen.find((entry) => entry.url.endsWith('/api/v1/auth/logout'))?.headers['x-csrf-token']).toBe('csrf-active');

    expect(problems.page).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  for (const [returnTo, expected] of [
    ['/work-orders?status=open', '/work-orders?status=open'],
    ['//evil.example', '/work-orders'],
    ['/\\evil.example', '/work-orders'],
    ['/%2F%2Fevil.example', '/work-orders'],
    ['https://evil.example/', '/work-orders'],
    ['javascript:alert(1)', '/work-orders'],
  ] as const) {
    test(`EVM-067 AC1 returnTo ${returnTo}: ${expected === '/work-orders' ? 'ignored (W-10)' : 'opened'}`, async ({
      page,
      api,
      browserName,
    }) => {
      test.skip(browserName === 'firefox', NO_FIREFOX);
      await accountWithPasskey(page, api);
      await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      await logInWithPassword(page);
      await page.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
      expect(page.url()).toBe(`${ORIGIN}${expected}`);
    });
  }

  test('EVM-067 AC4 a key that is not the account\'s: the message and a retry; a first step that ran out: "Logowanie trwało zbyt długo"', async ({
    page,
    api,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    await accountWithPasskey(page, api);
    await page.goto('/login');
    await logInWithPassword(page);
    // The server refuses the assertion once (a key of another account, SR-AUTH-09) …
    api.failNext.set('POST /api/v1/auth/login/passkey', { status: 401, code: 'passkey_failed' });
    await page.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
    await expect(page.getByRole('alert')).toHaveText('Nie udało się użyć klucza dostępu. Spróbuj ponownie.');
    await expect(page).toHaveURL(`${ORIGIN}/login/second-step`);
    // … and the first step runs out before the next try.
    api.failNext.set('POST /api/v1/auth/login/passkey/options', { status: 401, code: 'login_expired' });
    await page.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
    await expect(page.getByRole('alert')).toContainText('Logowanie trwało zbyt długo. Zaloguj się ponownie.');
    await page.getByRole('button', { name: 'Wróć do logowania' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    await expect(page.getByLabel('Hasło')).toHaveValue('');
  });

  test('EVM-067 AC4 a refresh on W-02 loses the token by design and returns to W-01', async ({ page, api, browserName }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    await accountWithPasskey(page, api);
    await page.goto('/login');
    await logInWithPassword(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Potwierdź logowanie' })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    await expect(page.getByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeVisible();
  });
});

test.describe('P-11 Sesja wygasa in the browser (EVM-067 AC5, AC6; styleguide 4.17)', () => {
  test.use({ session: 'active' });

  test('EVM-067 AC6 the dialog 2 min before the end, "Przedłuż sesję" with the CSRF token, no request while waiting; then the end sends the tab to W-01 by itself', async ({
    page,
    api,
  }) => {
    await page.clock.install();
    await page.goto('/work-orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    const afterLoad = api.seen.length;

    // Ten minutes of ticks: the tab asks the server for nothing.
    await page.clock.runFor(10 * MINUTE);
    expect(api.seen.length).toBe(afterLoad);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    // 58.5 min after the first read: the server is asked, then the dialog shows.
    await page.clock.fastForward(48.5 * MINUTE);
    const dialog = page.getByRole('alertdialog', { name: 'Sesja wkrótce wygaśnie' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Sesja wygaśnie za 2 min z powodu braku aktywności.');
    await expect(page.getByRole('button', { name: 'Przedłuż sesję' })).toBeFocused();
    expect(api.seen.filter((entry) => entry.method === 'POST')).toEqual([]);

    api.clockOffsetMs = 58.5 * MINUTE;
    await page.getByRole('button', { name: 'Przedłuż sesję' }).click();
    await expect(dialog).toHaveCount(0);
    const extend = api.seen.find((entry) => entry.url.endsWith('/api/v1/auth/session/extend'));
    expect(extend?.method).toBe('POST');
    expect(extend?.headers['x-csrf-token']).toBe('csrf-active');
    expect(extend?.headers['origin']).toBe(ORIGIN);

    // The session ends on the server; the next confirmation sends the tab to W-01 without a click, with the view cleared.
    api.expired = true;
    await page.clock.fastForward(58.5 * MINUTE);
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    await expect(page.getByText(/^Sesja wygasła\. Zaloguj się ponownie w tej karcie/)).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page).toHaveTitle('Logowanie · EVia Manager');
    const kept = JSON.parse(await whatTheTabKeeps(page)) as { local: unknown[]; session: unknown[]; databases: unknown[] };
    expect([kept.local, kept.session, kept.databases]).toEqual([[], [], []]);
  });

  test('EVM-067 AC6 near the 12 h limit the dialog has no "Przedłuż sesję", only "Rozumiem" and "Wyloguj"', async ({ page, api }) => {
    api.sessionMinutes = { idle: 9.5, absolute: 9.5 };
    await page.clock.install();
    await page.goto('/work-orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await page.clock.fastForward(MINUTE);
    const dialog = page.getByRole('alertdialog', { name: 'Sesja wkrótce wygaśnie' });
    await expect(dialog).toContainText(
      /Sesja wygaśnie o \d\d:\d\d \(limit 12 godzin od zalogowania\)\. Zapisz zmiany — potem zaloguj się ponownie\./,
    );
    await expect(page.getByRole('button', { name: 'Przedłuż sesję' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Rozumiem' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
  });

  test('EVM-067 AC6 Esc closes the dialog without extending anything', async ({ page, api }) => {
    await page.clock.install();
    await page.goto('/work-orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await page.clock.fastForward(58.5 * MINUTE);
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(api.seen.filter((entry) => entry.url.endsWith('/session/extend'))).toEqual([]);
  });

  for (const exit of ['Przedłuż sesję', 'Escape'] as const) {
    test(`EVM-067 AC6 focus returns to the field that had it when the dialog closes with ${exit}`, async ({ page, api }) => {
      await page.clock.install();
      await page.goto('/work-orders');
      await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
      // A field outside the React tree stands for "the person was typing in a form" (WCAG 2.4.3).
      await page.evaluate(() => {
        const field = document.createElement('input');
        field.id = 'probe';
        field.setAttribute('aria-label', 'Pole próbne');
        document.body.append(field);
        field.focus();
      });
      await expect(page.getByLabel('Pole próbne')).toBeFocused();
      await page.clock.fastForward(58.5 * MINUTE);
      await expect(page.getByRole('alertdialog')).toBeVisible();
      if (exit === 'Escape') await page.keyboard.press('Escape');
      else {
        // The mock server runs on the real clock, the tab on the fast-forwarded one: the new deadlines follow the tab.
        api.clockOffsetMs = 58.5 * MINUTE;
        await page.getByRole('button', { name: exit }).click();
      }
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect(page.getByLabel('Pole próbne')).toBeFocused();
    });
  }

  test('EVM-067 AC6 "Wyloguj" in the dialog ends the session on the server and leaves for W-01', async ({ page, api }) => {
    api.sessionMinutes = { idle: 2.5, absolute: 700 };
    await page.clock.install();
    await page.goto('/work-orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await page.clock.fastForward(MINUTE);
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: 'Wyloguj' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    expect(api.session).toBe('none');
    await expect(page.getByText(/^Sesja wygasła/)).toHaveCount(0);
  });
});
