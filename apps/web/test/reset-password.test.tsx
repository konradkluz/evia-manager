import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearResetToken, captureResetToken, getResetToken } from '../src/reset/reset-token.ts';
import { getCsrfToken, setCsrfToken } from '../src/session/csrf.ts';
import { getLoginFlow, setLoginFlow } from '../src/session/login-flow.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, createFakeApi, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import { setupUser, userEvent } from './user.ts';

const TOKEN = 'Zx9_-'.repeat(8) + 'abc';
const CHECK = 'POST /api/v1/auth/password-reset/check';
const COMPLETE = 'POST /api/v1/auth/password-reset/complete';
const GOOD_PASSWORD = 'zażółć gęślą jaźń!';
const EMAIL = 'anna.testowa@example.com';
const LOGIN_TOKEN = 'L'.repeat(43);

/** The link as the panel receives it: the fragment is taken in by the entry point before the router exists. */
function openLink(token: string | null = TOKEN) {
  captureResetToken(
    { pathname: '/reset-password', search: '', hash: token === null ? '' : `#${token}` },
    { state: null, replaceState: vi.fn() },
  );
}

/** An anonymous visitor: no session; the link check and the reset answer as a valid link would. */
function resetApi(routes: Record<string, Handler> = {}) {
  return createFakeApi({
    [SESSION_ROUTE]: () => problem(401, 'unauthenticated'),
    [CHECK]: () => json(200, { email: EMAIL }),
    [COMPLETE]: () => json(200, { state: 'second_step', loginToken: LOGIN_TOKEN, methods: ['passkey'] }),
    ...routes,
  });
}

async function openForm(api: ReturnType<typeof resetApi>) {
  openLink();
  const view = await renderPanel('/reset-password', api, { heading: false });
  await screen.findByLabelText('Nowe hasło');
  return view;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearResetToken();
  setLoginFlow(null);
  setCsrfToken(null);
});

describe('W-12 Ustaw nowe hasło: link check (EVM-025 AC2; flows/11)', () => {
  it('EVM-025 AC2 while the link is checked the page shows "Sprawdzamy link…" and a skeleton, no e-mail', async () => {
    openLink();
    let release: (response: Response) => void = () => undefined;
    const api = resetApi({ [CHECK]: () => new Promise<Response>((resolve) => (release = resolve)) });
    await renderPanel('/reset-password', api, { heading: false });
    const status = await screen.findByText('Sprawdzamy link…');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.parentElement?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { level: 1, name: 'Ustaw nowe hasło' })).toBeTruthy();
    expect(document.body.textContent).not.toContain(EMAIL);
    expect(screen.queryByLabelText('Nowe hasło')).toBeNull();
    release(json(200, { email: EMAIL }));
    await screen.findByLabelText('Nowe hasło');
  });

  it('EVM-025 AC2 a valid link: the token goes to the server only in the POST body and nowhere else; the page shows the e-mail of the account', async () => {
    const api = resetApi();
    await openForm(api);
    expect(document.title).toBe('Nowe hasło · EVia Manager');
    const email = screen.getByLabelText('E-mail');
    expect(email.hasAttribute('readonly')).toBe(true);
    expect(email.getAttribute('autocomplete')).toBe('username');
    expect((email as HTMLInputElement).value).toBe(EMAIL);
    const password = screen.getByLabelText('Nowe hasło');
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    expect(password.getAttribute('type')).toBe('password');
    expect(document.activeElement).toBe(password);
    expect(screen.getByText('Co najmniej 15 znaków — może to być zdanie ze spacjami.')).toBeTruthy();
    expect(screen.getByText('Po zapisaniu zakończymy wszystkie sesje tego konta, a logowanie potwierdzisz drugim krokiem.')).toBeTruthy();
    expect(screen.queryByText(/Ustawienie hasła wyloguje/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Wróć do logowania' })).toBeTruthy();

    expect(api.calls(CHECK)).toHaveLength(1);
    const [check] = api.calls(CHECK);
    expect(parseBody(check?.body ?? '')).toEqual({ token: TOKEN });
    expect(check?.method).toBe('POST');
    expect(api.calls(COMPLETE)).toHaveLength(0);
    for (const request of api.requests) {
      expect(request.path).not.toContain(TOKEN);
      expect(request.path).not.toContain('?');
      expect([...request.headers.values()].join('|')).not.toContain(TOKEN);
      if (request !== check) expect(request.body).not.toContain(TOKEN);
    }
    expect(globalThis.location.href).not.toContain(TOKEN);
    expect(document.title).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-025 AC2 the token is kept nowhere but memory: not in localStorage, sessionStorage or the history entry', async () => {
    const api = resetApi();
    const { history } = await openForm(api);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(JSON.stringify(history.location)).not.toContain(TOKEN);
    expect(JSON.stringify(globalThis.history.state)).not.toContain(TOKEN);
  });

  it('EVM-025 AC1 the page has the footer "Prywatność · Pomoc" with fixed anchors and no token in the links', async () => {
    await openForm(resetApi());
    const footer = screen.getByRole('navigation', { name: 'Prywatność i pomoc' });
    expect(footer.innerHTML).not.toContain(TOKEN);
    expect(footer.querySelectorAll('a')).toHaveLength(2);
  });

  it('EVM-025 AC2 a link of another account in this browser: the info alert, without naming that account', async () => {
    const api = resetApi({ [SESSION_ROUTE]: () => json(200, ACTIVE_SESSION) });
    await openForm(api);
    expect(await screen.findByText('Ustawienie hasła wyloguje bieżące konto w tej przeglądarce.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Anna Testowa');
  });

  it('EVM-025 AC2 an invalid link shows one state with no account data, sends nothing without a token and offers a new link', async () => {
    openLink(null);
    const api = resetApi();
    await renderPanel('/reset-password', api, { heading: false });
    const title = await screen.findByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' });
    expect(document.activeElement).toBe(title);
    expect(
      screen.getByText('Otwórz najnowszy link z wiadomości jeszcze raz albo wyślij nowy link — każdy link działa 30 minut.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wyślij nowy link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wróć do logowania' })).toBeTruthy();
    expect(screen.queryByLabelText('E-mail')).toBeNull();
    expect(api.calls(CHECK)).toHaveLength(0);
    expect(document.title).toBe('Nowe hasło · EVia Manager');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-025 AC2 used, expired, superseded and unknown links give the identical page (same answer, same text)', async () => {
    const pages: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      openLink();
      const api = resetApi({ [CHECK]: () => problem(400, 'password_reset_link_invalid') });
      const { unmount, container } = await renderPanel('/reset-password', api, { heading: false });
      await screen.findByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' });
      pages.push(container.innerHTML);
      unmount();
    }
    openLink(null);
    const { unmount, container } = await renderPanel('/reset-password', resetApi(), { heading: false });
    await screen.findByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' });
    pages.push(container.innerHTML);
    unmount();
    expect(new Set(pages).size).toBe(1);
    expect(getResetToken()).toBeNull();
  });

  it('EVM-025 AC2 "Wyślij nowy link" opens W-01 "Zresetuj hasło" with an empty e-mail field in focus; "Wróć do logowania" opens W-01', async () => {
    openLink(null);
    const { history, unmount } = await renderPanel('/reset-password', resetApi(), { heading: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Wyślij nowy link' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login/reset');
    });
    const field = await screen.findByLabelText<HTMLInputElement>('E-mail');
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    unmount();

    openLink(null);
    const second = await renderPanel('/reset-password', resetApi(), { heading: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Wróć do logowania' }));
    await waitFor(() => {
      expect(second.history.location.pathname).toBe('/login');
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeTruthy();
  });

  it('EVM-025 AC2 a second link opened in the same tab replaces the first: the new check, a fresh form, the old token gone', async () => {
    const SECOND = 'N'.repeat(43);
    const api = resetApi();
    await openForm(api);
    await userEvent.type(screen.getByLabelText('Nowe hasło'), 'wpisane');
    act(() => {
      openLink(SECOND);
    });
    await waitFor(() => {
      expect(api.calls(CHECK)).toHaveLength(2);
    });
    expect(api.calls(CHECK).map((request) => parseBody(request.body))).toEqual([{ token: TOKEN }, { token: SECOND }]);
    expect(await screen.findByLabelText<HTMLInputElement>('Nowe hasło')).toHaveProperty('value', '');
    expect(getResetToken()).toBe(SECOND);
  });

  it('EVM-025 AC2 too many requests: the wait comes from Retry-After and "Spróbuj ponownie" asks again with the same token', async () => {
    let answers = 0;
    const api = resetApi({
      [CHECK]: () => (answers++ === 0 ? problem(429, 'rate_limited', {}, { 'Retry-After': '120' }) : json(200, { email: EMAIL })),
    });
    openLink();
    await renderPanel('/reset-password', api, { heading: false });
    expect((await screen.findByRole('alert')).textContent).toContain('Zbyt wiele prób. Spróbuj ponownie za 2 min.');
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await screen.findByLabelText('Nowe hasło');
    expect(api.calls(CHECK).map((request) => parseBody(request.body))).toEqual([{ token: TOKEN }, { token: TOKEN }]);
  });

  it('EVM-025 AC7 a server error shows the help code (trace id prefix), never details', async () => {
    openLink();
    await renderPanel('/reset-password', resetApi({ [CHECK]: () => problem(500, 'internal_error') }), { heading: false });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nie udało się sprawdzić linku.');
    expect(alert.textContent).toContain('(kod: abcdef01)');
  });

  it('EVM-025 AC7 offline at load: the banner and "Spróbuj ponownie", no form; back online the retry works', async () => {
    let online = false;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    let answers = 0;
    const api = resetApi({
      [CHECK]: () => {
        if (answers++ === 0) throw new TypeError('Failed to fetch');
        return json(200, { email: EMAIL });
      },
    });
    openLink();
    await renderPanel('/reset-password', api, { heading: false });
    expect(await screen.findByText('Brak połączenia. Ustawienie hasła wymaga połączenia z internetem.')).toBeTruthy();
    expect(screen.queryByLabelText('Nowe hasło')).toBeNull();
    online = true;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await screen.findByLabelText('Nowe hasło');
  });

  it('EVM-025 AC7 online but the server is unreachable: a connection error with a retry', async () => {
    openLink();
    await renderPanel(
      '/reset-password',
      resetApi({
        [CHECK]: () => {
          throw new TypeError('Failed to fetch');
        },
      }),
      { heading: false },
    );
    expect((await screen.findByRole('alert')).textContent).toContain('Nie udało się połączyć z serwerem.');
  });
});

describe('W-12 Ustaw nowe hasło: setting the password (EVM-025 AC3, AC4, AC5)', () => {
  it('EVM-025 AC3 a password shorter than 15 characters is refused on the page: message under the field, no request', async () => {
    const api = resetApi();
    await openForm(api);
    const user = setupUser();
    await user.type(screen.getByLabelText('Nowe hasło'), 'krótkie hasło');
    await user.tab();
    expect(screen.getByRole('alert').textContent).toBe('Hasło musi mieć co najmniej 15 znaków.');
    expect(screen.getByLabelText('Nowe hasło').getAttribute('aria-invalid')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Ustaw nowe hasło' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Nowe hasło'));
    expect(api.calls(COMPLETE)).toHaveLength(0);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-025 AC3 a password of more than 256 characters is refused on the page', async () => {
    const api = resetApi();
    await openForm(api);
    await setupUser().click(screen.getByLabelText('Nowe hasło'));
    await userEvent.paste('ż'.repeat(257));
    await userEvent.click(screen.getByRole('button', { name: 'Ustaw nowe hasło' }));
    expect(screen.getByRole('alert').textContent).toBe('Hasło może mieć najwyżej 256 znaków.');
    expect(api.calls(COMPLETE)).toHaveLength(0);
  });

  it('EVM-025 AC3 the rules of the server (too weak) keep the form: message under the field, the password is dropped and the link stays', async () => {
    const api = resetApi({
      [COMPLETE]: () => problem(400, 'validation_failed', { errors: [{ pointer: '/password', code: 'too_weak' }] }),
    });
    await openForm(api);
    const user = setupUser();
    await user.click(screen.getByLabelText('Nowe hasło'));
    await user.paste(GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Ustaw nowe hasło' }));
    expect((await screen.findByRole('alert')).textContent).toContain('zbyt łatwe do odgadnięcia');
    expect(screen.getByLabelText<HTMLInputElement>('Nowe hasło').value).toBe('');
    expect(document.activeElement).toBe(screen.getByLabelText('Nowe hasło'));
    expect(getResetToken()).toBe(TOKEN);
  });

  it('EVM-025 AC3 there are no helper questions and no password hint, only the one password field', async () => {
    await openForm(resetApi());
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(1);
    expect(screen.queryByText(/pytanie|podpowiedź hasła/i)).toBeNull();
  });

  it('EVM-025 AC4 a pasted passphrase is sent untrimmed; no session is read afterwards, W-02 opens with the success message and the heading in focus', async () => {
    const api = resetApi();
    setCsrfToken('stale-csrf');
    const { history } = await openForm(api);
    const user = setupUser();
    await user.click(screen.getByLabelText('Nowe hasło'));
    await user.paste(` ${GOOD_PASSWORD} `);
    await user.click(screen.getByRole('button', { name: 'Pokaż' }));
    expect(screen.getByLabelText<HTMLInputElement>('Nowe hasło').value).toBe(` ${GOOD_PASSWORD} `);
    await user.click(screen.getByLabelText('Nowe hasło'));
    await user.keyboard('{Enter}');
    const title = await screen.findByRole('heading', { level: 1, name: 'Potwierdź logowanie' });
    expect(history.location.pathname).toBe('/login/second-step');
    expect(parseBody(api.calls(COMPLETE)[0]?.body ?? '')).toEqual({ token: TOKEN, password: ` ${GOOD_PASSWORD} ` });
    const message = 'Hasło zostało zmienione. Zakończyliśmy wszystkie sesje tego konta. Potwierdź logowanie drugim krokiem.';
    expect(screen.getByText(message).closest('[role="status"]')).toBeTruthy();
    expect(document.activeElement).toBe(title);
    expect(screen.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeTruthy();
    // the server created no session: the panel keeps no CSRF token, the token of the link and the password left memory
    expect(getCsrfToken()).toBeNull();
    expect(getResetToken()).toBeNull();
    expect(getLoginFlow()?.loginToken).toBe(LOGIN_TOKEN);
    expect(document.body.textContent).not.toContain(GOOD_PASSWORD);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-025 AC5 the data of the session this browser had is dropped: the cached session is not shown after the reset', async () => {
    const api = resetApi({ [SESSION_ROUTE]: () => json(200, ACTIVE_SESSION) });
    await openForm(api);
    await screen.findByText('Ustawienie hasła wyloguje bieżące konto w tej przeglądarce.');
    const user = setupUser();
    await user.click(screen.getByLabelText('Nowe hasło'));
    await user.paste(GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Ustaw nowe hasło' }));
    await screen.findByRole('heading', { level: 1, name: 'Potwierdź logowanie' });
    expect(document.body.textContent).not.toContain('Anna Testowa');
  });

  it('EVM-025 AC5 the link that stopped working while typing (400 password_reset_link_invalid) gives the invalid-link state and clears the password', async () => {
    const api = resetApi({ [COMPLETE]: () => problem(400, 'password_reset_link_invalid') });
    await openForm(api);
    const user = setupUser();
    await user.click(screen.getByLabelText('Nowe hasło'));
    await user.paste(GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Ustaw nowe hasło' }));
    await screen.findByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' });
    expect(document.body.textContent).not.toContain(GOOD_PASSWORD);
    expect(getResetToken()).toBeNull();
    expect(getLoginFlow()).toBeNull();
  });

  it('EVM-025 AC6 too many requests while saving: the message with the time from Retry-After and a retry that sends the same password again', async () => {
    let answers = 0;
    const api = resetApi({
      [COMPLETE]: () =>
        answers++ === 0
          ? problem(429, 'rate_limited', {}, { 'Retry-After': '60' })
          : json(200, { state: 'second_step', loginToken: LOGIN_TOKEN, methods: ['passkey'] }),
    });
    await openForm(api);
    const user = setupUser();
    await user.click(screen.getByLabelText('Nowe hasło'));
    await user.paste(GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Ustaw nowe hasło' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Zbyt wiele prób. Spróbuj ponownie za 1 min.');
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await screen.findByRole('heading', { level: 1, name: 'Potwierdź logowanie' });
    expect(api.calls(COMPLETE).map((request) => parseBody(request.body))).toEqual([
      { token: TOKEN, password: GOOD_PASSWORD },
      { token: TOKEN, password: GOOD_PASSWORD },
    ]);
  });

  it('EVM-025 AC7 a server error while saving shows the help code and keeps the form', async () => {
    const api = resetApi({ [COMPLETE]: () => problem(500, 'internal_error') });
    await openForm(api);
    const user = setupUser();
    await user.click(screen.getByLabelText('Nowe hasło'));
    await user.paste(GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Ustaw nowe hasło' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nie udało się ustawić hasła.');
    expect(alert.textContent).toContain('(kod: abcdef01)');
    expect(screen.getByLabelText('Nowe hasło')).toBeTruthy();
  });

  it('EVM-025 AC7 offline after the check: the banner, "Ustaw nowe hasło" unavailable with the hint, the typed password stays, no request', async () => {
    let online = true;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    const api = resetApi();
    await openForm(api);
    const user = setupUser();
    await user.click(screen.getByLabelText('Nowe hasło'));
    await user.paste(GOOD_PASSWORD);
    act(() => {
      online = false;
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(await screen.findByText('Brak połączenia. Ustawienie hasła wymaga połączenia z internetem.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ustaw nowe hasło' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Ustawisz hasło po powrocie połączenia.')).toBeTruthy();
    await user.click(screen.getByLabelText('Nowe hasło'));
    await user.keyboard('{Enter}');
    expect(api.calls(COMPLETE)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Pokaż' }));
    expect(screen.getByLabelText<HTMLInputElement>('Nowe hasło').value).toBe(GOOD_PASSWORD);
  });

  it('EVM-025 AC7 a request rejected for the origin names the supported address; the form stays', async () => {
    const api = resetApi({ [COMPLETE]: () => problem(403, 'csrf_failed') });
    await openForm(api);
    const user = setupUser();
    await user.click(screen.getByLabelText('Nowe hasło'));
    await user.paste(GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Ustaw nowe hasło' }));
    expect((await screen.findByRole('alert')).textContent).toContain('nieobsługiwanym adresem');
  });
});
