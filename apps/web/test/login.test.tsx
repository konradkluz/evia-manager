import { act, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts, readDraft, saveDraft } from '../src/session/draft-store.ts';
import { getLoginFlow, setLoginFlow, setLoginNotice } from '../src/session/login-flow.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, ENROLLMENT_SESSION, createFakeApi, json, parseBody, problem, SESSION_ROUTE } from './api-fake.ts';
import { renderPanel } from './render.tsx';

const LOGIN_ROUTE = 'POST /api/v1/auth/login';
const OPTIONS_ROUTE = 'POST /api/v1/auth/login/passkey/options';
const VERIFY_ROUTE = 'POST /api/v1/auth/login/passkey';
const LOGIN_TOKEN = 'L'.repeat(43);
const EMAIL = 'anna.testowa@example.com';
const PASSWORD = 'zażółć gęślą jaźń!';
const OTHER_PERSON = '33333333-3333-4333-8333-333333333333';

const OPTIONS = {
  challenge: 'Y2hhbGxlbmdl',
  rpId: 'localhost',
  userVerification: 'required',
  allowCredentials: [{ id: 'Y3JlZA', type: 'public-key' }],
};
const CREDENTIAL = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'Y2xpZW50', authenticatorData: 'YXV0aA', signature: 'c2ln' },
};

class FakePublicKeyCredential {
  static readonly parseRequestOptionsFromJSON = vi.fn((options: object) => ({ ...options, parsed: true }));
  toJSON() {
    return CREDENTIAL;
  }
}

function stubWebAuthn(get: () => Promise<unknown> = () => Promise.resolve(new FakePublicKeyCredential())) {
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
  const spy = vi.fn(get);
  Object.defineProperty(navigator, 'credentials', { value: { get: spy }, configurable: true });
  return spy;
}

/** A fake server: no session until the passkey (or the password of an account without a second step) is accepted. */
function loginApi(overrides: Record<string, () => Response | Promise<Response>> = {}, session = ACTIVE_SESSION) {
  let started = false;
  const api = createFakeApi({
    [SESSION_ROUTE]: () => (started ? json(200, session) : problem(401, 'unauthenticated')),
    [LOGIN_ROUTE]: () => json(200, { state: 'second_step', loginToken: LOGIN_TOKEN, methods: ['passkey'] }),
    [OPTIONS_ROUTE]: () => json(200, OPTIONS),
    [VERIFY_ROUTE]: () => {
      started = true;
      return json(200, { state: 'active', csrfToken: 'csrf-new' });
    },
    ...overrides,
  });
  return Object.assign(api, {
    /** The server has accepted the login: from now on the session is read. */
    start: () => {
      started = true;
    },
  });
}

async function fillAndSubmit(email = EMAIL, password = PASSWORD) {
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText('E-mail'));
  await user.type(screen.getByLabelText('E-mail'), email);
  await user.type(screen.getByLabelText('Hasło'), password);
  await user.click(screen.getByRole('button', { name: 'Zaloguj się' }));
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'credentials');
  FakePublicKeyCredential.parseRequestOptionsFromJSON.mockClear();
  setLoginFlow(null);
  setLoginNotice(null);
  clearDrafts();
});

describe('W-01 Zaloguj się (EVM-067 AC1-AC3, AC8; flows/01)', () => {
  it('EVM-067 AC1 the empty state: focus on "E-mail", the tab title, autocomplete for password managers, no "Zapamiętaj mnie", axe clean', async () => {
    const { history } = await renderPanel('/login', loginApi());
    expect(history.location.pathname).toBe('/login');
    expect(screen.getByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeTruthy();
    const email = screen.getByLabelText('E-mail');
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute('autocomplete')).toBe('username');
    expect(screen.getByLabelText('Hasło').getAttribute('autocomplete')).toBe('current-password');
    expect(document.title).toBe('Logowanie · EVia Manager');
    expect(screen.queryByText(/zapamiętaj/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it.each([
    ['a wrong password', 'invalid_credentials'],
    ['an unknown e-mail', 'invalid_credentials'],
    ['an invited account', 'invalid_credentials'],
    ['a deactivated account', 'invalid_credentials'],
  ])('EVM-067 AC2 %s: one message, the e-mail stays, the password is cleared, focus on the message', async (_case, code) => {
    const api = loginApi({ [LOGIN_ROUTE]: () => problem(401, code) });
    const { history } = await renderPanel('/login', api);
    await fillAndSubmit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Nieprawidłowy e-mail lub hasło.');
    expect(document.activeElement).toBe(alert);
    expect(screen.getByLabelText<HTMLInputElement>('E-mail').value).toBe(EMAIL);
    expect(screen.getByLabelText<HTMLInputElement>('Hasło').value).toBe('');
    expect(history.location.pathname).toBe('/login');
    // The password goes as typed — no trimming or other changes in the panel (the server normalises, SR-AUTH-01).
    expect(parseBody(api.calls(LOGIN_ROUTE)[0]?.body ?? '')).toEqual({ email: EMAIL, password: PASSWORD });
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-067 AC2 empty fields get the same message without a request', async () => {
    const api = loginApi();
    await renderPanel('/login', api);
    await userEvent.click(screen.getByRole('button', { name: 'Zaloguj się' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nieprawidłowy e-mail lub hasło.');
    expect(api.calls(LOGIN_ROUTE)).toHaveLength(0);
  });

  it('EVM-067 AC2 a rejected shape of the data (400) is the same one message', async () => {
    const api = loginApi({ [LOGIN_ROUTE]: () => problem(400, 'validation_failed') });
    await renderPanel('/login', api);
    await fillAndSubmit();
    expect((await screen.findByRole('alert')).textContent).toBe('Nieprawidłowy e-mail lub hasło.');
  });

  it('EVM-067 AC2 while the request runs the button is busy and the fields stay filled', async () => {
    let answer: (response: Response) => void = () => undefined;
    const api = loginApi({ [LOGIN_ROUTE]: () => new Promise<Response>((resolve) => (answer = resolve)) });
    await renderPanel('/login', api);
    await fillAndSubmit();
    const button = await screen.findByRole('button', { name: 'Zaloguj się' });
    await waitFor(() => {
      expect(button.getAttribute('aria-busy')).toBe('true');
    });
    expect(screen.getByLabelText<HTMLInputElement>('E-mail').value).toBe(EMAIL);
    expect(screen.getByLabelText<HTMLInputElement>('Hasło').value).toBe(PASSWORD);
    await act(async () => {
      answer(problem(401, 'invalid_credentials'));
      await Promise.resolve();
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Nieprawidłowy e-mail lub hasło.');
  });

  it.each([
    [60, 1],
    [61, 2],
    [120, 2],
  ])('EVM-067 AC3 429 with Retry-After %s s: "Zbyt wiele prób logowania. Spróbuj ponownie za %s min."', async (seconds, minutes) => {
    const api = loginApi({ [LOGIN_ROUTE]: () => problem(429, 'rate_limited', {}, { 'Retry-After': String(seconds) }) });
    await renderPanel('/login', api);
    await fillAndSubmit();
    expect((await screen.findByRole('alert')).textContent).toBe(`Zbyt wiele prób logowania. Spróbuj ponownie za ${String(minutes)} min.`);
    expect(screen.getByLabelText<HTMLInputElement>('Hasło').value).toBe('');
  });

  it('EVM-067 AC3 the 429 text is the same for an existing and a non-existing account', async () => {
    const api = loginApi({ [LOGIN_ROUTE]: () => problem(429, 'rate_limited', {}, { 'Retry-After': '60' }) });
    await renderPanel('/login', api);
    await fillAndSubmit('ktos.istniejacy@example.com');
    const first = (await screen.findByRole('alert')).textContent;
    await fillAndSubmit('nie.ma.takiego@example.com');
    await waitFor(() => {
      expect(api.calls(LOGIN_ROUTE)).toHaveLength(2);
    });
    expect((await screen.findByRole('alert')).textContent).toBe(first);
  });

  it('EVM-067 AC2 a server error shows the pattern of styleguide 6.4 with the trace code, a lost connection says so', async () => {
    const api = loginApi({ [LOGIN_ROUTE]: () => problem(500, 'internal_error') });
    await renderPanel('/login', api);
    await fillAndSubmit();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Nie udało się zalogować. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: abcdef01).',
    );
    api.set(LOGIN_ROUTE, () => {
      throw new TypeError('Failed to fetch');
    });
    await fillAndSubmit();
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Nie udało się połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.');
    });
  });

  it('EVM-077 AC6 a login rejected for the origin names the unsupported address and the supported one, without a retry hint', async () => {
    vi.stubEnv('VITE_PANEL_ORIGIN', 'http://localhost:5173');
    try {
      const api = loginApi({ [LOGIN_ROUTE]: () => problem(403, 'csrf_failed') });
      await renderPanel('/login', api);
      await fillAndSubmit();
      const text = (await screen.findByRole('alert')).textContent;
      expect(text).toContain('nieobsługiwanym adresem');
      expect(text).toContain('http://localhost:5173');
      expect(text).not.toContain('Spróbuj ponownie');
      vi.stubEnv('VITE_PANEL_ORIGIN', '');
      await fillAndSubmit();
      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toContain('skonfigurowanym dla tego środowiska');
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('EVM-067 AC8 offline: the banner, the button unavailable with its hint, the typed e-mail stays and no request is sent', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const api = loginApi();
      await renderPanel('/login', api);
      expect(screen.getByText('Brak połączenia. Logowanie wymaga połączenia z internetem.').closest('[role="status"]')).toBeTruthy();
      const button = screen.getByRole('button', { name: 'Zaloguj się' });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByText('Zalogujesz się po powrocie połączenia.')).toBeTruthy();
      await userEvent.type(screen.getByLabelText('E-mail'), EMAIL);
      await userEvent.type(screen.getByLabelText('Hasło'), PASSWORD);
      await userEvent.click(button);
      expect(api.calls(LOGIN_ROUTE)).toHaveLength(0);
      expect(screen.getByLabelText<HTMLInputElement>('E-mail').value).toBe(EMAIL);
      expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    } finally {
      online.mockRestore();
    }
  });

  it('EVM-067 AC5 an expired session lands on W-01 with "Sesja wygasła…" and no data, and the message goes after logging in', async () => {
    const api = createFakeApi({ [SESSION_ROUTE]: () => problem(401, 'session_expired') });
    const { history } = await renderPanel('/work-orders', api);
    expect(history.location.pathname).toBe('/login');
    expect(screen.getByText(/^Sesja wygasła\. Zaloguj się ponownie w tej karcie/).textContent).toBe(
      'Sesja wygasła. Zaloguj się ponownie w tej karcie — niezapisane zmiany przywrócimy, jeśli zalogujesz się na to samo konto.',
    );
    expect(document.title).toBe('Logowanie · EVia Manager');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-067 AC5 a visitor without a session (401 unauthenticated) sees no expiry message', async () => {
    const api = createFakeApi({ [SESSION_ROUTE]: () => problem(401, 'unauthenticated') });
    await renderPanel('/work-orders', api);
    expect(screen.queryByText(/Sesja wygasła/)).toBeNull();
  });

  it('EVM-067 AC1 the address the person was on is offered back as a validated returnTo', async () => {
    const api = createFakeApi({ [SESSION_ROUTE]: () => problem(401, 'unauthenticated') });
    const { history } = await renderPanel('/work-orders?tab=media', api);
    expect(history.location.pathname).toBe('/login');
    expect(new URLSearchParams(history.location.search).get('returnTo')).toBe('/work-orders?tab=media');
  });
});

describe('W-01 → W-02 → the panel (EVM-067 AC1, AC4, AC6, AC8)', () => {
  it('EVM-067 AC1 password then passkey: loginToken only in memory and in POST bodies, new CSRF token, the panel opens on W-10', async () => {
    const get = stubWebAuthn();
    const api = loginApi();
    const { history } = await renderPanel('/login', api);
    await fillAndSubmit();
    expect(await screen.findByRole('heading', { level: 1, name: 'Potwierdź logowanie' })).toBeTruthy();
    expect(history.location.pathname).toBe('/login/second-step');
    // Nothing of the login lives in the address, the title or the storages of the tab.
    expect(
      history.location.href +
        document.title +
        JSON.stringify(Object.entries(localStorage)) +
        JSON.stringify(Object.entries(sessionStorage)),
    ).not.toContain(LOGIN_TOKEN);
    expect(document.body.innerHTML).not.toContain(LOGIN_TOKEN);
    expect(document.body.innerHTML).not.toContain(PASSWORD);
    const key = screen.getByRole('button', { name: 'Użyj klucza dostępu' });
    expect(document.activeElement).toBe(key);
    expect(screen.queryByText(/innej metody|kod z aplikacji|kod odzyskiwania/i)).toBeNull();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);

    await userEvent.click(key);
    expect(await screen.findByRole('heading', { level: 1, name: 'Zlecenia' })).toBeTruthy();
    expect(history.location.pathname).toBe('/work-orders');
    expect(get).toHaveBeenCalledTimes(1);
    expect(FakePublicKeyCredential.parseRequestOptionsFromJSON).toHaveBeenCalledWith(OPTIONS);
    expect(parseBody(api.calls(OPTIONS_ROUTE)[0]?.body ?? '')).toEqual({ loginToken: LOGIN_TOKEN });
    expect(parseBody(api.calls(VERIFY_ROUTE)[0]?.body ?? '')).toEqual({ loginToken: LOGIN_TOKEN, credential: CREDENTIAL });
    // The session was read with the new cookie, and the next mutation would carry the new CSRF token.
    expect(api.calls(SESSION_ROUTE).length).toBeGreaterThanOrEqual(1);
    expect(getLoginFlow()).toBeNull();
    expect(screen.getByRole('button', { name: 'Konto: Anna Testowa' })).toBeTruthy();
  });

  it('EVM-067 AC1 a returnTo of the panel is opened after the second step; the password is gone from the page', async () => {
    stubWebAuthn();
    const { history } = await renderPanel('/login?returnTo=%2Fwork-orders%3Fstatus%3Dopen', loginApi());
    await fillAndSubmit();
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    expect(history.location.pathname).toBe('/work-orders');
    expect(history.location.search).toContain('status=open');
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example/', 'javascript:alert(1)', '/%2F%2Fevil.example', '/login'])(
    'EVM-067 AC1 an external or looping returnTo %s is ignored: W-10',
    async (value) => {
      stubWebAuthn();
      const { history } = await renderPanel(`/login?returnTo=${encodeURIComponent(value)}`, loginApi());
      await fillAndSubmit();
      await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
      await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
      expect(history.location.pathname).toBe('/work-orders');
      expect(history.location.href).not.toContain('evil');
    },
  );

  it('EVM-067 AC4 a cancelled or refused key: "Nie udało się użyć klucza dostępu…", then a retry works with the same token', async () => {
    let attempt = 0;
    stubWebAuthn(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new DOMException('cancelled', 'NotAllowedError'))
        : Promise.resolve(new FakePublicKeyCredential());
    });
    const api = loginApi();
    const { history } = await renderPanel('/login', api);
    await fillAndSubmit();
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się użyć klucza dostępu. Spróbuj ponownie.');
    expect(history.location.pathname).toBe('/login/second-step');
    expect(screen.queryByText(/innej metody/)).toBeNull();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Użyj klucza dostępu' }));
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    expect(api.calls(OPTIONS_ROUTE)).toHaveLength(2);
    expect(parseBody(api.calls(OPTIONS_ROUTE)[1]?.body ?? '')).toEqual({ loginToken: LOGIN_TOKEN });
  });

  it('EVM-067 AC4 a key the server did not accept (401 passkey_failed) gives the same message and the retry stays', async () => {
    stubWebAuthn();
    const api = loginApi({ [VERIFY_ROUTE]: () => problem(401, 'passkey_failed') });
    await renderPanel('/login', api);
    await fillAndSubmit();
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się użyć klucza dostępu. Spróbuj ponownie.');
    expect(screen.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeTruthy();
  });

  it('EVM-067 AC4 a browser without WebAuthn JSON helpers gets the same message', async () => {
    const api = loginApi();
    await renderPanel('/login', api);
    await fillAndSubmit();
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się użyć klucza dostępu. Spróbuj ponownie.');
    expect(api.calls(VERIFY_ROUTE)).toHaveLength(0);
  });

  it('EVM-067 AC4 the ceremony returning no public-key credential is a failed key too', async () => {
    stubWebAuthn(() => Promise.resolve(null));
    await renderPanel('/login', loginApi());
    await fillAndSubmit();
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się użyć klucza dostępu. Spróbuj ponownie.');
  });

  it.each(['login_expired', 'unauthenticated'])(
    'EVM-067 AC4 401 %s: "Logowanie trwało zbyt długo. Zaloguj się ponownie." and the way back to W-01 without the token',
    async (code) => {
      stubWebAuthn();
      const api = loginApi({ [OPTIONS_ROUTE]: () => problem(401, code) });
      const { history } = await renderPanel('/login', api);
      await fillAndSubmit();
      await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Logowanie trwało zbyt długo. Zaloguj się ponownie.');
      expect(screen.queryByRole('button', { name: 'Użyj klucza dostępu' })).toBeNull();
      expect(getLoginFlow()).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Wróć do logowania' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeTruthy();
      expect(history.location.pathname).toBe('/login');
      expect(screen.getByLabelText<HTMLInputElement>('Hasło').value).toBe('');
    },
  );

  it('EVM-067 AC4 429 in the second step shows the same message as W-01', async () => {
    stubWebAuthn();
    const api = loginApi({ [OPTIONS_ROUTE]: () => problem(429, 'rate_limited', {}, { 'Retry-After': '60' }) });
    await renderPanel('/login', api);
    await fillAndSubmit();
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Zbyt wiele prób logowania. Spróbuj ponownie za 1 min.');
  });

  it('EVM-067 AC4 W-02 without the first step (a refresh, a direct visit) goes back to W-01', async () => {
    const { history } = await renderPanel('/login/second-step', loginApi());
    expect(history.location.pathname).toBe('/login');
    expect(screen.getByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeTruthy();
  });

  it('EVM-067 AC4 W-02 offline: the banner, the key button unavailable, no request', async () => {
    stubWebAuthn();
    const api = loginApi();
    await renderPanel('/login', api);
    await fillAndSubmit();
    await screen.findByRole('button', { name: 'Użyj klucza dostępu' });
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      act(() => {
        globalThis.dispatchEvent(new Event('offline'));
      });
      expect(await screen.findByText('Brak połączenia. Logowanie wymaga połączenia z internetem.')).toBeTruthy();
      const key = screen.getByRole('button', { name: 'Użyj klucza dostępu' });
      expect(key.getAttribute('aria-disabled')).toBe('true');
      await userEvent.click(key);
      expect(api.calls(OPTIONS_ROUTE)).toHaveLength(0);
      expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    } finally {
      online.mockRestore();
    }
  });

  it('EVM-067 AC4 "Wróć do logowania" drops the first step; a returnTo comes along', async () => {
    const { history } = await renderPanel('/login?returnTo=%2Fwork-orders%3Fstatus%3Dopen', loginApi());
    await fillAndSubmit();
    await screen.findByRole('heading', { level: 1, name: 'Potwierdź logowanie' });
    await userEvent.click(screen.getByRole('button', { name: 'Wróć do logowania' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeTruthy();
    expect(getLoginFlow()).toBeNull();
    expect(new URLSearchParams(history.location.search).get('returnTo')).toBe('/work-orders?status=open');
  });

  it('EVM-067 AC8 an account without a second step gets a limited session and W-03; no token is kept', async () => {
    const api: ReturnType<typeof loginApi> = loginApi(
      {
        [LOGIN_ROUTE]: () => {
          api.start();
          return json(200, { state: 'mfa_enrollment', csrfToken: 'csrf-enrollment' });
        },
      },
      ENROLLMENT_SESSION,
    );
    const { history } = await renderPanel('/login', api);
    await fillAndSubmit();
    expect(await screen.findByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' })).toBeTruthy();
    expect(history.location.pathname).toBe('/mfa-setup');
    expect(getLoginFlow()).toBeNull();
  });

  it('EVM-067 AC6 the draft of the same person comes back after logging in again, another person gets none', async () => {
    stubWebAuthn();
    saveDraft(ACTIVE_SESSION.user.id, 'work-order', 'Adres: ulica Testowa 1');
    await renderPanel('/login', loginApi());
    await fillAndSubmit();
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    expect(readDraft(ACTIVE_SESSION.user.id, 'work-order')).toBe('Adres: ulica Testowa 1');
  });

  it('EVM-067 AC6 a draft of someone else is discarded when another person logs in in the same tab', async () => {
    stubWebAuthn();
    saveDraft(OTHER_PERSON, 'work-order', 'Adres: ulica Cudza 7');
    await renderPanel('/login', loginApi());
    await fillAndSubmit();
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    expect(readDraft(OTHER_PERSON, 'work-order')).toBeUndefined();
    expect(readDraft(ACTIVE_SESSION.user.id, 'work-order')).toBeUndefined();
  });

  it('EVM-067 AC6 when the new session cannot be read the drafts are dropped and the gate reports the failure', async () => {
    stubWebAuthn();
    saveDraft(ACTIVE_SESSION.user.id, 'work-order', 'x');
    const api = loginApi();
    await renderPanel('/login', api);
    await fillAndSubmit();
    await screen.findByRole('button', { name: 'Użyj klucza dostępu' });
    api.set(VERIFY_ROUTE, () => {
      api.set(SESSION_ROUTE, () => problem(500, 'internal_error'));
      return json(200, { state: 'active', csrfToken: 'csrf-new' });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Coś poszło nie tak' })).toBeTruthy();
    expect(readDraft(ACTIVE_SESSION.user.id, 'work-order')).toBeUndefined();
  });

  it('EVM-067 AC1 nothing of the login is written to localStorage or sessionStorage', async () => {
    stubWebAuthn();
    await renderPanel('/login', loginApi());
    await fillAndSubmit();
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
