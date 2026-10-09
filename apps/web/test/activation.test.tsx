import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureActivationToken, clearActivationToken, getActivationToken } from '../src/activation/activation-token.ts';
import { axeViolations } from './a11y.ts';
import { ENROLLMENT_SESSION, createFakeApi, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { renderPanel } from './render.tsx';

const TOKEN = 'Zx9_-'.repeat(8) + 'abc';
const CHECK = 'POST /api/v1/auth/activation/check';
const PASSWORD = 'POST /api/v1/auth/activation/password';
const GOOD_PASSWORD = 'zażółć gęślą jaźń!';
const EMAIL = 'anna.testowa@example.com';

/** The link as the panel receives it: the fragment is taken in by the entry point before the router exists. */
function openLink(token: string | null = TOKEN) {
  captureActivationToken(
    { pathname: '/activate', search: '', hash: token === null ? '' : `#${token}` },
    { state: null, replaceState: vi.fn() },
  );
}

/**
 * An anonymous visitor: the session answers 401 until the password is set. A route override that answers the password
 * call receives `grant` and calls it when the (fake) server would have created the session.
 */
function anonymousApi(routes: Record<string, Handler> | ((grant: () => Response) => Record<string, Handler>) = {}) {
  let session = false;
  const grant = () => {
    session = true;
    return json(200, { csrfToken: ENROLLMENT_SESSION.csrfToken });
  };
  return {
    api: createFakeApi({
      [SESSION_ROUTE]: () => (session ? json(200, ENROLLMENT_SESSION) : problem(401, 'unauthenticated')),
      [CHECK]: () => json(200, { email: EMAIL, role: 'administrator' }),
      [PASSWORD]: grant,
      ...(typeof routes === 'function' ? routes(grant) : routes),
    }),
  };
}

async function openForm(api: ReturnType<typeof anonymousApi>['api']) {
  openLink();
  const view = await renderPanel('/activate', api, { heading: false });
  await screen.findByLabelText('Nowe hasło');
  return view;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearActivationToken();
});

describe('W-13 Ustaw hasło: link check (EVM-016 AC5; flows/11)', () => {
  it('EVM-016 AC5 while the link is checked the page shows "Sprawdzamy link…" and a skeleton, no e-mail and no role', async () => {
    openLink();
    let release: (response: Response) => void = () => undefined;
    const { api } = anonymousApi({ [CHECK]: () => new Promise<Response>((resolve) => (release = resolve)) });
    await renderPanel('/activate', api, { heading: false });
    const status = await screen.findByText('Sprawdzamy link…');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.parentElement?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { level: 1, name: 'Ustaw hasło' })).toBeTruthy();
    expect(document.body.textContent).not.toContain(EMAIL);
    expect(document.body.textContent).not.toContain('rola');
    expect(screen.queryByLabelText('Nowe hasło')).toBeNull();
    release(json(200, { email: EMAIL, role: 'administrator' }));
    await screen.findByLabelText('Nowe hasło');
  });

  it('EVM-016 AC5 a valid link: the token goes to the server only in the POST body, nowhere else; the page shows e-mail and role', async () => {
    const { api } = anonymousApi();
    await openForm(api);
    expect(document.title).toBe('Aktywacja konta · EVia Manager');
    expect(screen.getByText('Aktywacja konta · rola: Administrator')).toBeTruthy();
    const email = screen.getByLabelText('E-mail');
    expect(email.hasAttribute('readonly')).toBe(true);
    expect(email.getAttribute('autocomplete')).toBe('username');
    expect((email as HTMLInputElement).value).toBe(EMAIL);
    const password = screen.getByLabelText('Nowe hasło');
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    expect(password.getAttribute('type')).toBe('password');
    expect(document.activeElement).toBe(password);
    expect(screen.getByText('Co najmniej 15 znaków — może to być zdanie ze spacjami.')).toBeTruthy();
    expect(screen.getByText('Następny krok: drugi krok logowania.')).toBeTruthy();
    expect(screen.queryByText(/Ustawienie hasła wyloguje/)).toBeNull();

    expect(api.calls(CHECK)).toHaveLength(1);
    const [check] = api.calls(CHECK);
    expect(parseBody(check?.body ?? '')).toEqual({ token: TOKEN });
    expect(check?.method).toBe('POST');
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

  it('EVM-016 AC5 a link of another account in this browser: the info alert, without naming that account', async () => {
    const { api } = anonymousApi({ [SESSION_ROUTE]: () => json(200, { ...ENROLLMENT_SESSION, state: 'active' }) });
    await openForm(api);
    expect(await screen.findByText('Ustawienie hasła wyloguje bieżące konto w tej przeglądarce.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Anna Testowa');
  });

  it('EVM-016 AC5 roles of the account are named in Polish', async () => {
    for (const [role, label] of [
      ['editor', 'Edytor'],
      ['read_only', 'Tylko odczyt'],
    ] as const) {
      const { api } = anonymousApi({ [CHECK]: () => json(200, { email: EMAIL, role }) });
      const { unmount } = await openForm(api);
      expect(screen.getByText(`Aktywacja konta · rola: ${label}`)).toBeTruthy();
      unmount();
    }
  });

  it('EVM-016 AC5 an invalid link shows one state with no account data and sends nothing without a token', async () => {
    openLink(null);
    const { api } = anonymousApi();
    await renderPanel('/activate', api, { heading: false });
    const title = await screen.findByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' });
    expect(document.activeElement).toBe(title);
    expect(screen.getByText(/poproś administratora o nowy link/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Przejdź do logowania' })).toBeTruthy();
    expect(screen.queryByLabelText('E-mail')).toBeNull();
    expect(api.calls(CHECK)).toHaveLength(0);
    expect(document.title).toBe('Aktywacja konta · EVia Manager');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-016 AC5 used, changed, superseded and expired links give the identical page (same answer, same text)', async () => {
    const pages: string[] = [];
    for (const status of [400, 400, 400]) {
      openLink();
      const { api } = anonymousApi({ [CHECK]: () => problem(status, 'activation_link_invalid') });
      const { unmount, container } = await renderPanel('/activate', api, { heading: false });
      await screen.findByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' });
      pages.push(container.innerHTML);
      unmount();
    }
    openLink(null);
    const { unmount, container } = await renderPanel('/activate', anonymousApi().api, { heading: false });
    await screen.findByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' });
    pages.push(container.innerHTML);
    unmount();
    expect(new Set(pages).size).toBe(1);
    expect(getActivationToken()).toBeNull();
  });

  it('EVM-016 AC5 a second link opened in the same tab replaces the first: the new check, a fresh form, the old token gone', async () => {
    const SECOND = 'N'.repeat(43);
    const { api } = anonymousApi({
      [CHECK]: (request) => json(200, { email: parseBody(request.body) && EMAIL, role: 'administrator' }),
    });
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
    expect(getActivationToken()).toBe(SECOND);
  });

  it('EVM-016 AC5 "Przejdź do logowania" leads to the login page', async () => {
    openLink(null);
    const { history } = await renderPanel('/activate', anonymousApi().api, { heading: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Przejdź do logowania' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeTruthy();
    expect(document.title).toBe('Logowanie · EVia Manager');
  });

  it('EVM-016 AC5 too many requests: the wait comes from Retry-After and "Spróbuj ponownie" asks again with the same token', async () => {
    let answers = 0;
    const { api } = anonymousApi({
      [CHECK]: () =>
        answers++ === 0 ? problem(429, 'rate_limited', {}, { 'Retry-After': '120' }) : json(200, { email: EMAIL, role: 'administrator' }),
    });
    openLink();
    await renderPanel('/activate', api, { heading: false });
    expect((await screen.findByRole('alert')).textContent).toContain('Zbyt wiele prób. Spróbuj ponownie za 2 min.');
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await screen.findByLabelText('Nowe hasło');
    expect(api.calls(CHECK).map((request) => parseBody(request.body))).toEqual([{ token: TOKEN }, { token: TOKEN }]);
  });

  it('EVM-016 AC5 a server error shows the help code (trace id prefix), never details', async () => {
    const { api } = anonymousApi({ [CHECK]: () => problem(500, 'internal_error') });
    openLink();
    await renderPanel('/activate', api, { heading: false });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nie udało się sprawdzić linku.');
    expect(alert.textContent).toContain('(kod: abcdef01)');
  });

  it('EVM-016 AC5 offline at load: the banner and "Spróbuj ponownie", no form; back online the retry works', async () => {
    let online = false;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    let answers = 0;
    const { api } = anonymousApi({
      [CHECK]: () => {
        if (answers++ === 0) throw new TypeError('Failed to fetch');
        return json(200, { email: EMAIL, role: 'administrator' });
      },
    });
    openLink();
    await renderPanel('/activate', api, { heading: false });
    expect(await screen.findByText('Brak połączenia. Ustawienie hasła wymaga połączenia z internetem.')).toBeTruthy();
    expect(screen.queryByLabelText('Nowe hasło')).toBeNull();
    online = true;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await screen.findByLabelText('Nowe hasło');
  });

  it('EVM-016 AC5 online but the server is unreachable: a connection error with a retry', async () => {
    const { api } = anonymousApi({
      [CHECK]: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    openLink();
    await renderPanel('/activate', api, { heading: false });
    expect((await screen.findByRole('alert')).textContent).toContain('Nie udało się połączyć z serwerem.');
  });
});

describe('W-13 Ustaw hasło: setting the password (EVM-016 AC3, AC4)', () => {
  it('EVM-016 AC3 a password shorter than 15 characters is refused on the page: message under the field, no request', async () => {
    const { api } = anonymousApi();
    await openForm(api);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nowe hasło'), 'krótkie hasło');
    await user.tab();
    expect(screen.getByRole('alert').textContent).toBe('Hasło musi mieć co najmniej 15 znaków.');
    expect(screen.getByLabelText('Nowe hasło').getAttribute('aria-invalid')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Ustaw hasło' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Nowe hasło'));
    expect(api.calls(PASSWORD)).toHaveLength(0);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-016 AC3 a password of more than 256 characters is refused on the page', async () => {
    const { api } = anonymousApi();
    await openForm(api);
    await userEvent.setup().click(screen.getByLabelText('Nowe hasło'));
    await userEvent.paste('ż'.repeat(257));
    await userEvent.click(screen.getByRole('button', { name: 'Ustaw hasło' }));
    expect(screen.getByRole('alert').textContent).toBe('Hasło może mieć najwyżej 256 znaków.');
    expect(api.calls(PASSWORD)).toHaveLength(0);
  });

  it('EVM-016 AC3 a pasted passphrase with spaces and Polish letters is accepted untrimmed; the token and password leave memory and W-03 opens', async () => {
    const { api } = anonymousApi();
    const { history } = await openForm(api);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Nowe hasło'));
    await user.paste(` ${GOOD_PASSWORD} `);
    await user.click(screen.getByRole('button', { name: 'Pokaż' }));
    expect(screen.getByLabelText<HTMLInputElement>('Nowe hasło').value).toBe(` ${GOOD_PASSWORD} `);
    await user.click(screen.getByLabelText('Nowe hasło'));
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' })).toBeTruthy();
    expect(history.location.pathname).toBe('/mfa-setup');
    const [request] = api.calls(PASSWORD);
    expect(parseBody(request?.body ?? '')).toEqual({ token: TOKEN, password: ` ${GOOD_PASSWORD} ` });
    expect(getActivationToken()).toBeNull();
    expect(api.calls(SESSION_ROUTE).length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).not.toContain(GOOD_PASSWORD);
  });

  it('EVM-016 AC3 while the password is saved the button is in the loading state and cannot be pressed twice', async () => {
    let release: (response: Response) => void = () => undefined;
    const { api } = anonymousApi((grant) => ({
      [PASSWORD]: () =>
        new Promise<Response>((resolve) => {
          release = () => {
            resolve(grant());
          };
        }),
    }));
    await openForm(api);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nowe hasło'), GOOD_PASSWORD);
    const button = screen.getByRole('button', { name: 'Ustaw hasło' });
    await user.click(button);
    await waitFor(() => {
      expect(button.getAttribute('aria-busy')).toBe('true');
    });
    await user.click(button);
    await user.type(screen.getByLabelText('Nowe hasło'), '{Enter}');
    expect(api.calls(PASSWORD)).toHaveLength(1);
    release(new Response());
    await screen.findByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' });
  });

  it.each([
    ['too_weak', 'To hasło jest zbyt łatwe do odgadnięcia albo pojawiło się w wycieku danych. Wybierz inne — np. zdanie z kilku słów.'],
    ['too_short', 'Hasło musi mieć co najmniej 15 znaków.'],
    ['too_long', 'Hasło może mieć najwyżej 256 znaków.'],
  ])(
    'EVM-016 AC3 the server rejects the password (%s): one message, the field is cleared and focused, the password is not echoed',
    async (code, text) => {
      const { api } = anonymousApi({
        [PASSWORD]: () => problem(400, 'validation_failed', { errors: [{ pointer: '/password', code }] }),
      });
      await openForm(api);
      const user = userEvent.setup();
      await user.type(screen.getByLabelText('Nowe hasło'), GOOD_PASSWORD);
      await user.click(screen.getByRole('button', { name: 'Ustaw hasło' }));
      expect((await screen.findByRole('alert')).textContent).toBe(text);
      const field = screen.getByLabelText<HTMLInputElement>('Nowe hasło');
      expect(field.value).toBe('');
      expect(document.activeElement).toBe(field);
      expect(document.body.textContent).not.toContain(GOOD_PASSWORD);
      // The link is still fine: the user tries another password with the same token.
      expect(getActivationToken()).toBe(TOKEN);
    },
  );

  it('EVM-016 AC5 the link stops working between the check and the save: the invalid-link state, password cleared, token dropped', async () => {
    const { api } = anonymousApi({ [PASSWORD]: () => problem(400, 'activation_link_invalid') });
    await openForm(api);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nowe hasło'), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Ustaw hasło' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Link jest nieważny lub wygasł.' })).toBeTruthy();
    expect(screen.queryByLabelText('Nowe hasło')).toBeNull();
    expect(getActivationToken()).toBeNull();
    expect(document.body.textContent).not.toContain(GOOD_PASSWORD);
  });

  it('EVM-016 AC3 too many requests on save: the wait, the password stays and "Spróbuj ponownie" sends the same data', async () => {
    let answers = 0;
    const { api } = anonymousApi((grant) => ({
      [PASSWORD]: () => (answers++ === 0 ? problem(429, 'rate_limited', {}, { 'Retry-After': '30' }) : grant()),
    }));
    await openForm(api);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nowe hasło'), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Ustaw hasło' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Zbyt wiele prób. Spróbuj ponownie za 1 min.')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Nowe hasło').value).toBe(GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await screen.findByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' });
    expect(api.calls(PASSWORD).map((request) => parseBody(request.body))).toEqual([
      { token: TOKEN, password: GOOD_PASSWORD },
      { token: TOKEN, password: GOOD_PASSWORD },
    ]);
  });

  it('EVM-077 AC6 a rejected origin on save says the panel was opened under an unsupported address', async () => {
    vi.stubEnv('VITE_PANEL_ORIGIN', 'http://localhost:5173');
    try {
      const { api } = anonymousApi({ [PASSWORD]: () => problem(403, 'csrf_failed') });
      await openForm(api);
      const user = userEvent.setup();
      await user.type(screen.getByLabelText('Nowe hasło'), GOOD_PASSWORD);
      await user.click(screen.getByRole('button', { name: 'Ustaw hasło' }));
      const text = (await screen.findByRole('alert')).textContent;
      expect(text).toContain('nieobsługiwanym adresem');
      expect(text).toContain('http://localhost:5173');
      expect(text).not.toContain('kod:');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('EVM-016 AC3 a server error or no connection on save keeps the form and the typed password', async () => {
    let mode: 'server' | 'network' = 'server';
    const { api } = anonymousApi({
      [PASSWORD]: () => {
        if (mode === 'network') throw new TypeError('Failed to fetch');
        return problem(500, 'internal_error');
      },
    });
    await openForm(api);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nowe hasło'), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Ustaw hasło' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nie udało się ustawić hasła.');
    expect((await screen.findByRole('alert')).textContent).toContain('(kod: abcdef01)');
    mode = 'network';
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Nie udało się połączyć z serwerem.');
    });
    expect(screen.getByLabelText<HTMLInputElement>('Nowe hasło').value).toBe(GOOD_PASSWORD);
  });

  it('EVM-016 AC3 an unreadable OK answer on save keeps the form and the password and offers a new attempt', async () => {
    const { api } = anonymousApi({ [PASSWORD]: () => json(200, null) });
    await openForm(api);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nowe hasło'), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Ustaw hasło' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nie udało się połączyć z serwerem.');
    expect(screen.getByLabelText<HTMLInputElement>('Nowe hasło').value).toBe(GOOD_PASSWORD);
  });

  it('EVM-016 AC3 offline after the check: the banner, the button is unavailable with the reason, the password stays in the tab', async () => {
    const { api } = anonymousApi();
    await openForm(api);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nowe hasło'), GOOD_PASSWORD);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('Brak połączenia. Ustawienie hasła wymaga połączenia z internetem.')).toBeTruthy();
    expect(screen.getByText('Ustawisz hasło po powrocie połączenia.')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Ustaw hasło' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await user.click(button);
    await user.keyboard('{Enter}');
    expect(api.calls(PASSWORD)).toHaveLength(0);
    expect(screen.getByLabelText<HTMLInputElement>('Nowe hasło').value).toBe(GOOD_PASSWORD);
  });

  it('EVM-016 AC4 the password is set but the new session cannot be read: W-03 still opens (the gate reports the failure)', async () => {
    let fail = false;
    const { api } = anonymousApi({
      [SESSION_ROUTE]: () => (fail ? problem(500, 'internal_error') : problem(401, 'unauthenticated')),
      [PASSWORD]: () => {
        fail = true;
        return json(200, { csrfToken: 'csrf-enrollment' });
      },
    });
    const { history } = await openForm(api);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nowe hasło'), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Ustaw hasło' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/mfa-setup');
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Coś poszło nie tak' })).toBeTruthy();
  });
});
