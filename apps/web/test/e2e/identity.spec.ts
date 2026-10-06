import { expect, test } from './fixtures.ts';
import { DISPLAY_NAME, PASSWORD, VALID_TOKEN, type MockApi } from './mock-api.ts';
import { virtualAuthenticator, watchPage } from './support.ts';

// First Administrator in the browser (EVM-016 AC3–AC6): the one-time link, the password, the passkey and the logout,
// against the synthetic API of mock-api.ts, under the real strict CSP. WebAuthn needs a domain name for the relying
// party, so the whole spec runs on `localhost` (an IP address is not a valid RP ID); Chromium and Edge get a virtual
// authenticator, Firefox has none (ADR-0015: its passkey part is covered by the integration tests of the API).
test.use({ baseURL: 'http://localhost:4173', session: 'none' });

const ORIGIN = 'http://localhost:4173';
const OFFLINE = 'Brak połączenia. Ustawienie hasła wymaga połączenia z internetem.';

function everywhere(api: MockApi, token: string) {
  const leaked: string[] = [];
  for (const entry of api.seen) {
    const isLinkPost = /\/api\/v1\/auth\/activation\/(check|password)$/.test(entry.url) && entry.method === 'POST';
    if (entry.url.includes(token)) leaked.push(`url ${entry.url}`);
    if (Object.values(entry.headers).some((value) => value.includes(token))) leaked.push(`header of ${entry.url}`);
    if (!isLinkPost && (entry.postData ?? '').includes(token)) leaked.push(`body of ${entry.url}`);
  }
  return leaked;
}

test.describe('W-13 Ustaw hasło in the browser (EVM-016 AC3, AC5)', () => {
  test('EVM-016 AC5 the token leaves the address bar, the history and the page at once and reaches the server only in POST bodies', async ({
    page,
    api,
    browserName,
  }) => {
    const problems = await watchPage(page, ORIGIN);
    const requestUrls: string[] = [];
    page.on('request', (request) => requestUrls.push(request.url()));
    await page.goto(`/activate#${VALID_TOKEN}`);
    const password = page.getByLabel('Nowe hasło');
    await expect(password).toBeVisible();
    await expect(password).toBeFocused();

    expect(page.url()).toBe(`${ORIGIN}/activate`);
    await expect(page).toHaveTitle('Aktywacja konta · EVia Manager');
    expect(
      await page.evaluate(() => [
        location.href,
        document.title,
        document.body.innerHTML,
        JSON.stringify(localStorage),
        JSON.stringify(sessionStorage),
        document.cookie,
      ]),
    ).not.toEqual(expect.arrayContaining([expect.stringContaining(VALID_TOKEN)]));
    if (browserName !== 'firefox') {
      const cdp = await page.context().newCDPSession(page);
      const history = (await cdp.send('Page.getNavigationHistory')) as { entries: { url: string }[] };
      expect(history.entries.map((entry) => entry.url).filter((url) => url.includes(VALID_TOKEN))).toEqual([]);
    }
    // The page knows only what the check returned: the e-mail and the role of the link, read-only.
    await expect(page.getByLabel('E-mail')).toHaveValue('anna.testowa@example.com');
    await expect(page.getByLabel('E-mail')).toHaveAttribute('readonly', '');
    await expect(page.getByText('Aktywacja konta · rola: Administrator')).toBeVisible();

    await password.fill(PASSWORD);
    await page.getByRole('button', { name: 'Ustaw hasło' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' })).toBeVisible();
    expect(page.url()).toBe(`${ORIGIN}/mfa-setup`);

    expect(everywhere(api, VALID_TOKEN)).toEqual([]);
    expect(requestUrls.filter((url) => url.includes(VALID_TOKEN))).toEqual([]);
    const posts = api.seen.filter((entry) => entry.postData?.includes(VALID_TOKEN));
    expect(posts.map((entry) => `${entry.method} ${new URL(entry.url).pathname}`)).toEqual([
      'POST /api/v1/auth/activation/check',
      'POST /api/v1/auth/activation/password',
    ]);
    // The browser itself named the origin of the mutations (the synthetic server refuses them otherwise).
    for (const post of posts) expect(post.headers['origin']).toBe(ORIGIN);
    expect(problems.page).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test('EVM-016 AC5 a refresh turns the link into the invalid-link page, and every invalid link looks the same', async ({ page, api }) => {
    const text = async () => (await page.getByRole('main').innerText()).replace(/\s+/g, ' ');

    await page.goto(`/activate#${'U'.repeat(43)}`);
    const heading = page.getByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' });
    await expect(heading).toBeFocused();
    const unknown = await text();

    await page.goto('/activate');
    await expect(heading).toBeVisible();
    const noToken = await text();

    await page.goto(`/activate#${VALID_TOKEN}`);
    await expect(page.getByLabel('Nowe hasło')).toBeVisible();
    await page.reload();
    await expect(heading).toBeVisible();
    const afterRefresh = await text();

    api.tokenValid = () => false;
    await page.goto(`/activate#${VALID_TOKEN}`);
    await expect(heading).toBeVisible();
    const used = await text();

    expect(new Set([unknown, noToken, afterRefresh, used]).size).toBe(1);
    expect(unknown).not.toMatch(/@|rola|Administrator|hasło/);
    expect(unknown).toContain('poproś administratora o nowy link');
    await page.getByRole('button', { name: 'Przejdź do logowania' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/login`);
  });

  test('EVM-016 AC3 a short password gets one message on the page, the server message for a weak one, and the field is cleared', async ({
    page,
  }) => {
    await page.goto(`/activate#${VALID_TOKEN}`);
    const password = page.getByLabel('Nowe hasło');
    await password.fill('za krótkie');
    await page.getByRole('button', { name: 'Ustaw hasło' }).click();
    await expect(page.getByRole('alert')).toHaveText('Hasło musi mieć co najmniej 15 znaków.');
    await password.fill('password-password');
    await page.getByRole('button', { name: 'Ustaw hasło' }).click();
    await expect(page.getByRole('alert')).toHaveText(/zbyt łatwe do odgadnięcia albo pojawiło się w wycieku danych/);
    await expect(password).toHaveValue('');
    await expect(password).toBeFocused();
  });

  test('EVM-016 AC3 offline after the link check: the banner, the button unavailable, the typed password stays', async ({
    page,
    context,
  }) => {
    await page.goto(`/activate#${VALID_TOKEN}`);
    await page.getByLabel('Nowe hasło').fill(PASSWORD);
    await context.setOffline(true);
    await expect(page.getByText(OFFLINE)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ustaw hasło' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Ustawisz hasło po powrocie połączenia.')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText(OFFLINE)).toHaveCount(0);
    await expect(page.getByLabel('Nowe hasło')).toHaveValue(PASSWORD);
  });
});

test.describe('W-03 and the panel after registering the key (EVM-016 AC4)', () => {
  test.use({ session: 'enrollment' });

  test('EVM-016 AC4 a session without the second step sees only W-03 on every address, with "Wyloguj"', async ({ page }) => {
    for (const path of ['/work-orders', '/', '/nie-ma-takiej-strony']) {
      await page.goto(path);
      await expect(page).toHaveURL(`${ORIGIN}/mfa-setup`);
      await expect(page.getByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' })).toBeFocused();
    }
    await expect(page).toHaveTitle('Konfiguracja logowania · EVia Manager');
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Wyloguj' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dodaj klucz dostępu' })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
  });

  test('EVM-016 AC4 the passkey is created by the browser, verified against the origin and the challenge, and the panel opens', async ({
    page,
    api,
    browserName,
  }) => {
    test.skip(
      browserName === 'firefox',
      'Firefox has no virtual authenticator; the passkey ceremony is covered by the API integration tests (ADR-0015).',
    );
    await virtualAuthenticator(page);
    await page.goto('/mfa-setup');
    await page.getByRole('button', { name: 'Dodaj klucz dostępu' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await expect(page).toHaveURL(`${ORIGIN}/work-orders`);
    await expect(page.getByText('Drugi krok logowania jest skonfigurowany.')).toBeVisible();
    await expect(page.getByRole('button', { name: `Konto: ${DISPLAY_NAME}` })).toBeVisible();
    expect(api.session).toBe('active');
    const register = api.seen.find((entry) => entry.method === 'POST' && entry.url.endsWith('/api/v1/account/passkeys'));
    expect(register?.headers['x-csrf-token']).toBe('csrf-enrollment');
    const sent = JSON.parse(register?.postData ?? '{}') as { credential: { type: string; response: Record<string, string> } };
    expect(sent.credential.type).toBe('public-key');
    expect(Object.keys(sent.credential.response)).toEqual(expect.arrayContaining(['clientDataJSON', 'attestationObject']));
    // The next mutation uses the token of the new session.
    await page.getByRole('button', { name: `Konto: ${DISPLAY_NAME}` }).click();
    await page.getByRole('menuitem', { name: 'Wyloguj' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    expect(api.seen.findLast((entry) => entry.url.endsWith('/auth/logout'))?.headers['x-csrf-token']).toBe('csrf-active');
  });

  test('EVM-016 AC4 a failed or refused ceremony shows one error and W-03 stays', async ({ page, api, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox has no virtual authenticator.');
    await virtualAuthenticator(page);
    api.failNext.set('POST /api/v1/account/passkeys', { status: 400, code: 'passkey_verification_failed' });
    await page.goto('/mfa-setup');
    await page.getByRole('button', { name: 'Dodaj klucz dostępu' }).click();
    await expect(page.getByRole('alert')).toContainText('Nie udało się dodać klucza dostępu. Spróbuj ponownie.');
    await expect(page).toHaveURL(`${ORIGIN}/mfa-setup`);
    expect(api.session).toBe('enrollment');
    await page.getByRole('button', { name: 'Dodaj klucz dostępu' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
  });
});

test.describe('logout (EVM-016 AC6)', () => {
  test.use({ session: 'active' });

  test('EVM-016 AC6 "Wyloguj" from the account menu by keyboard: the session ends, the tab leaves for the login page and stays out', async ({
    page,
    api,
  }) => {
    await page.goto('/work-orders');
    const trigger = page.getByRole('button', { name: `Konto: ${DISPLAY_NAME}` });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const logout = page.getByRole('menuitem', { name: 'Wyloguj' });
    await expect(logout).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(`${ORIGIN}/login`);
    await expect(page.getByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeVisible();
    const request = api.seen.find((entry) => entry.url.endsWith('/api/v1/auth/logout'));
    expect(request?.method).toBe('POST');
    expect(request?.headers['x-csrf-token']).toBe('csrf-active');
    expect(request?.headers['origin']).toBe(ORIGIN);
    expect(api.session).toBe('none');
    // The old session is gone: the panel does not come back from the tab's memory.
    await page.goto('/work-orders');
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    await expect(page.getByText('Zlecenia', { exact: true })).toHaveCount(0);
  });

  test('EVM-016 AC6 the account menu is on every screen width and closes with Esc, returning focus to its button', async ({ page }) => {
    for (const width of [360, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders');
      const trigger = page.getByRole('button', { name: `Konto: ${DISPLAY_NAME}` });
      await expect(trigger).toBeVisible();
      await trigger.click();
      await expect(page.getByRole('menuitem', { name: 'Wyloguj' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test('EVM-016 AC6 a failing logout leaves the panel in place and says so', async ({ page, api }) => {
    api.failNext.set('POST /api/v1/auth/logout', { status: 500, code: 'internal_error' });
    await page.goto('/work-orders');
    await page.getByRole('button', { name: `Konto: ${DISPLAY_NAME}` }).click();
    await page.getByRole('menuitem', { name: 'Wyloguj' }).click();
    await expect(page.getByRole('alert')).toHaveText('Nie udało się wylogować. Spróbuj ponownie.');
    await expect(page).toHaveURL(`${ORIGIN}/work-orders`);
    expect(api.session).toBe('active');
  });
});
