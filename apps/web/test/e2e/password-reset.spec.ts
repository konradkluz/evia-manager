import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { EMAIL, LOGIN_TOKEN, PASSWORD, RESET_TOKEN, type MockApi } from './mock-api.ts';
import { virtualAuthenticator, watchPage } from './support.ts';

// Password reset in the browser (EVM-025 AC1–AC7): the request from W-01, the one-time link, W-12, W-02 and the session
// that appears only after the passkey — the real panel under the real strict CSP against the synthetic API of mock-api.ts.
// The full stack with the real mailbox (Mailpit) is covered by the API integration tests and the QA run. WebAuthn needs
// a domain name for the relying party, so the spec runs on `localhost`; Firefox has no virtual authenticator (ADR-0015).
test.use({ baseURL: 'http://localhost:4173', session: 'none' });

const ORIGIN = 'http://localhost:4173';
const SENT = 'Jeśli konto o tym adresie istnieje, wyślemy na nie link do ustawienia nowego hasła. Link jest ważny 30 minut.';
const CHANGED = 'Hasło zostało zmienione. Zakończyliśmy wszystkie sesje tego konta. Potwierdź logowanie drugim krokiem.';
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

/** Where the token must never appear: addresses, headers and every body but the two POSTs of the link. */
function leaks(api: MockApi, token: string): string[] {
  const found: string[] = [];
  for (const entry of api.seen) {
    const isLinkPost = /\/api\/v1\/auth\/password-reset\/(check|complete)$/.test(entry.url) && entry.method === 'POST';
    if (entry.url.includes(token)) found.push(`url ${entry.url}`);
    if (Object.values(entry.headers).some((value) => value.includes(token))) found.push(`header of ${entry.url}`);
    if (!isLinkPost && (entry.postData ?? '').includes(token)) found.push(`body of ${entry.url}`);
  }
  return found;
}

test.describe('W-01 "Zresetuj hasło" in the browser (EVM-025 AC1, AC6, AC7)', () => {
  test('EVM-025 AC1 "Nie pamiętasz hasła?" opens the reset form; the same message appears for any address and the address travels only in the POST body', async ({
    page,
    api,
  }) => {
    const problems = await watchPage(page, ORIGIN);
    await page.goto('/login');
    await page.getByRole('link', { name: 'Nie pamiętasz hasła?' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zresetuj hasło' })).toBeVisible();
    await expect(page).toHaveURL(`${ORIGIN}/login/reset`);
    await expect(page).toHaveTitle('Zresetuj hasło · EVia Manager');
    await expect(page.getByLabel('E-mail')).toBeFocused();
    await expect(page.getByLabel('E-mail')).toHaveValue('');

    await page.getByLabel('E-mail').fill('nie.ma.takiego@example.com');
    await page.getByRole('button', { name: 'Wyślij link' }).click();
    await expect(page.getByText(SENT)).toBeVisible();
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByRole('button', { name: 'Wyślij link' }).click();
    await expect(page.getByText(SENT)).toBeVisible();
    await expect(page.getByLabel('E-mail')).toHaveValue(EMAIL);
    await expect(page).toHaveURL(`${ORIGIN}/login/reset`);

    const requests = api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/api/v1/auth/password-reset/request'));
    expect(requests.map((entry) => entry.postData)).toEqual([
      JSON.stringify({ email: 'nie.ma.takiego@example.com' }),
      JSON.stringify({ email: EMAIL }),
    ]);
    // The browser itself named the origin of the mutation; the address is in no URL and no other body.
    for (const entry of requests) expect(entry.headers['origin']).toBe(ORIGIN);
    expect(api.seen.filter((entry) => entry.url.includes(EMAIL))).toEqual([]);
    expect(problems.page).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test('EVM-025 AC6 429: the same message with the wait from Retry-After; the e-mail stays', async ({ page, api }) => {
    api.failNext.set('POST /api/v1/auth/password-reset/request', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
    await page.goto('/login/reset');
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByRole('button', { name: 'Wyślij link' }).click();
    await expect(page.getByRole('alert')).toHaveText('Zbyt wiele prób. Spróbuj ponownie za 1 min.');
    await expect(page.getByLabel('E-mail')).toHaveValue(EMAIL);
  });

  test('EVM-025 AC7 offline: the banner, the button unavailable with its hint, the typed e-mail stays', async ({ page, context }) => {
    await page.goto('/login/reset');
    await page.getByLabel('E-mail').fill(EMAIL);
    await context.setOffline(true);
    await expect(page.getByText('Brak połączenia. Wysłanie linku wymaga połączenia z internetem.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wyślij link' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByLabel('E-mail')).toHaveValue(EMAIL);
    await context.setOffline(false);
    await expect(page.getByText('Brak połączenia. Wysłanie linku wymaga połączenia z internetem.')).toHaveCount(0);
  });
});

test.describe('W-12 Ustaw nowe hasło in the browser (EVM-025 AC2–AC5)', () => {
  test('EVM-025 AC2 the token leaves the address bar, the history and the page at once and reaches the server only in the two POST bodies', async ({
    page,
    api,
    browserName,
  }) => {
    const problems = await watchPage(page, ORIGIN);
    const requestUrls: string[] = [];
    page.on('request', (request) => requestUrls.push(request.url()));
    await page.goto(`/reset-password#${RESET_TOKEN}`);
    const password = page.getByLabel('Nowe hasło', { exact: true });
    await expect(password).toBeVisible();
    await expect(password).toBeFocused();

    expect(page.url()).toBe(`${ORIGIN}/reset-password`);
    await expect(page).toHaveTitle('Nowe hasło · EVia Manager');
    expect(
      await page.evaluate(() => [
        location.href,
        document.title,
        document.body.innerHTML,
        JSON.stringify(localStorage),
        JSON.stringify(sessionStorage),
        document.cookie,
      ]),
    ).not.toEqual(expect.arrayContaining([expect.stringContaining(RESET_TOKEN)]));
    expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain(RESET_TOKEN);
    if (browserName !== 'firefox') {
      const cdp = await page.context().newCDPSession(page);
      const history = (await cdp.send('Page.getNavigationHistory')) as { entries: { url: string }[] };
      expect(history.entries.map((entry) => entry.url).filter((url) => url.includes(RESET_TOKEN))).toEqual([]);
    }
    // The page knows only what the check returned: the e-mail of the link, read-only.
    await expect(page.getByLabel('E-mail')).toHaveValue(EMAIL);
    await expect(page.getByLabel('E-mail')).toHaveAttribute('readonly', '');

    await password.fill(PASSWORD);
    await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Potwierdź logowanie' })).toBeVisible();
    expect(page.url()).toBe(`${ORIGIN}/login/second-step`);

    expect(leaks(api, RESET_TOKEN)).toEqual([]);
    expect(requestUrls.filter((url) => url.includes(RESET_TOKEN))).toEqual([]);
    const posts = api.seen.filter((entry) => entry.postData?.includes(RESET_TOKEN));
    expect(posts.map((entry) => `${entry.method} ${new URL(entry.url).pathname}`)).toEqual([
      'POST /api/v1/auth/password-reset/check',
      'POST /api/v1/auth/password-reset/complete',
    ]);
    for (const post of posts) expect(post.headers['origin']).toBe(ORIGIN);
    expect(problems.page).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test('EVM-025 AC2 opening the page twice does not spend the link: only the completion does, and then the link is invalid', async ({
    page,
  }) => {
    await page.goto(`/reset-password#${RESET_TOKEN}`);
    await expect(page.getByLabel('Nowe hasło', { exact: true })).toBeVisible();
    await page.goto(`/reset-password#${RESET_TOKEN}`);
    await expect(page.getByLabel('Nowe hasło', { exact: true })).toBeVisible();
    await page.getByLabel('Nowe hasło', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Potwierdź logowanie' })).toBeVisible();
    await page.goto(`/reset-password#${RESET_TOKEN}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' })).toBeVisible();
  });

  test('EVM-025 AC2 a refresh turns the link into the invalid-link page; "Wyślij nowy link" opens the empty reset form', async ({
    page,
  }) => {
    await page.goto(`/reset-password#${RESET_TOKEN}`);
    await expect(page.getByLabel('Nowe hasło', { exact: true })).toBeVisible();
    await page.reload();
    const title = page.getByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' });
    await expect(title).toBeVisible();
    await expect(title).toBeFocused();
    await expect(page.getByLabel('E-mail')).toHaveCount(0);
    await page.getByRole('button', { name: 'Wyślij nowy link' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/login/reset`);
    await expect(page.getByLabel('E-mail')).toBeFocused();
    await expect(page.getByLabel('E-mail')).toHaveValue('');
  });

  test('EVM-025 AC3 a short and a too weak password are refused with the message under the field; the link stays valid', async ({
    page,
  }) => {
    await page.goto(`/reset-password#${RESET_TOKEN}`);
    await page.getByLabel('Nowe hasło', { exact: true }).fill('krótkie hasło');
    await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
    await expect(page.getByRole('alert')).toHaveText('Hasło musi mieć co najmniej 15 znaków.');
    await page.getByLabel('Nowe hasło', { exact: true }).fill('password password password');
    await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
    await expect(page.getByRole('alert')).toContainText('zbyt łatwe do odgadnięcia');
    await expect(page.getByLabel('Nowe hasło', { exact: true })).toHaveValue('');
    await page.getByLabel('Nowe hasło', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Potwierdź logowanie' })).toBeVisible();
  });

  test('EVM-025 AC7 offline after the check: "Ustaw nowe hasło" is unavailable, the typed password stays', async ({ page, context }) => {
    await page.goto(`/reset-password#${RESET_TOKEN}`);
    await page.getByLabel('Nowe hasło', { exact: true }).fill(PASSWORD);
    await context.setOffline(true);
    await expect(page.getByText('Brak połączenia. Ustawienie hasła wymaga połączenia z internetem.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ustaw nowe hasło' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Ustawisz hasło po powrocie połączenia.')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'Ustaw nowe hasło' })).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Pokaż' }).click();
    await expect(page.getByLabel('Nowe hasło', { exact: true })).toHaveValue(PASSWORD);
  });

  test('EVM-025 AC4 AC5 the whole way: new password, W-02 with the message, the session appears only after the passkey; the old session is gone', async ({
    page,
    api,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    await accountWithPasskey(page, api);
    api.session = 'active';
    await page.goto('/work-orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();

    await page.goto(`/reset-password#${RESET_TOKEN}`);
    await expect(page.getByText('Ustawienie hasła wyloguje bieżące konto w tej przeglądarce.')).toBeVisible();
    await page.getByLabel('Nowe hasło', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();

    const title = page.getByRole('heading', { level: 1, name: 'Potwierdź logowanie' });
    await expect(title).toBeVisible();
    await expect(title).toBeFocused();
    await expect(page.getByText(CHANGED)).toBeVisible();
    // The server created no session and the panel shows none of the earlier one.
    expect(api.session).toBe('none');
    expect(await page.evaluate(() => document.cookie)).toBe('');
    expect(api.loginToken).toBe(LOGIN_TOKEN);

    await page.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await expect(page).toHaveURL(`${ORIGIN}/work-orders`);
    expect(api.session).toBe('active');
  });

  test('EVM-025 AC4 a refresh on W-02 loses the message and the first step: back to W-01 without the message', async ({ page }) => {
    await page.goto(`/reset-password#${RESET_TOKEN}`);
    await page.getByLabel('Nowe hasło', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
    await expect(page.getByText(CHANGED)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeVisible();
    await expect(page.getByText(CHANGED)).toHaveCount(0);
  });

  test('EVM-025 AC4 a message put in the address is never shown on W-02', async ({ page }) => {
    await page.goto(`/login/second-step?message=${encodeURIComponent(CHANGED)}#${encodeURIComponent(CHANGED)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeVisible();
    await expect(page.getByText(CHANGED)).toHaveCount(0);
  });
});
