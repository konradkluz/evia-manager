import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLoginFlow, setLoginFlow } from '../src/session/login-flow.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, createFakeApi, json, parseBody, problem, SESSION_ROUTE } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';

const TOTP_ROUTE = 'POST /api/v1/auth/login/totp';
const RECOVERY_ROUTE = 'POST /api/v1/auth/login/recovery-code';
const OPTIONS_ROUTE = 'POST /api/v1/auth/login/passkey/options';
const LOGIN_TOKEN = 'L'.repeat(43);
const EDITOR_SESSION = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'editor' as const } };
const WRONG_TOTP = 'Kod jest nieprawidłowy lub wygasł. Wpisz nowy kod z aplikacji.';
const WRONG_RECOVERY = 'Kod jest nieprawidłowy lub wygasł. Sprawdź kod albo użyj innego kodu odzyskiwania.';
const CODE = 'ABCD2345EFGH6723ABCD';

/** A fake server: no session until a code is accepted; then `session` is read. */
function api(routes: Parameters<typeof createFakeApi>[0] = {}, session: typeof ACTIVE_SESSION = ACTIVE_SESSION) {
  let started = false;
  const fake = createFakeApi({
    [SESSION_ROUTE]: () => (started ? json(200, session) : problem(401, 'unauthenticated')),
    [TOTP_ROUTE]: () => {
      started = true;
      return json(200, { state: 'active', csrfToken: 'csrf-new' });
    },
    [RECOVERY_ROUTE]: () => {
      started = true;
      return json(200, { state: 'active', csrfToken: 'csrf-new', remainingCodes: 9 });
    },
    'GET /api/v1/work-orders': () => json(200, { items: [], nextCursor: null }),
    ...routes,
  });
  return fake;
}

async function open(methods: readonly string[], fake = api(), extra: { passwordChanged?: true } = {}) {
  setLoginFlow({ loginToken: LOGIN_TOKEN, methods, returnTo: '/work-orders', ...extra });
  const rendered = await renderPanel('/login/second-step', fake, { heading: false });
  await screen.findByRole('heading', { level: 1, name: 'Potwierdź logowanie' });
  return { ...rendered, fake };
}

afterEach(() => {
  vi.restoreAllMocks();
  setLoginFlow(null);
});

describe('W-02 kod z aplikacji (EVM-023 AC2)', () => {
  it('EVM-023 AC2 the code field: label, one-time-code, numeric keyboard, no spell checker, focus on it, axe clean', async () => {
    await open(['totp', 'recovery_code']);
    const field = screen.getByLabelText('Kod z aplikacji uwierzytelniającej');
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('autocomplete')).toBe('one-time-code');
    expect(field.getAttribute('inputmode')).toBe('numeric');
    expect(field.getAttribute('spellcheck')).toBe('false');
    expect(field.getAttribute('autocapitalize')).toBe('off');
    expect(screen.getByText('6 cyfr z aplikacji uwierzytelniającej.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Potwierdź' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Użyj klucza dostępu' })).toBeNull();
    // One method only: no "Użyj innej metody"; the recovery code is the secondary link.
    expect(screen.queryByRole('button', { name: 'Użyj innej metody' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Nie masz dostępu do metody? Użyj kodu odzyskiwania' })).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-023 AC2 six digits do not send the code on their own; "Potwierdź" (and Enter) does, and the panel opens', async () => {
    const { fake, history } = await open(['totp']);
    await userEvent.type(screen.getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    expect(fake.calls(TOTP_ROUTE)).toHaveLength(0);
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Zlecenia' })).toBeTruthy();
    expect(history.location.pathname).toBe('/work-orders');
    expect(parseBody(fake.calls(TOTP_ROUTE)[0]?.body ?? '')).toEqual({ loginToken: LOGIN_TOKEN, code: '123456' });
    expect(getLoginFlow()).toBeNull();
    // The code is nowhere in the address, the title or the storage.
    expect(`${history.location.href}${document.title}`).not.toContain('123456');
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });

  it('EVM-023 AC2 a pasted code with a space ("123 456") is sent without it', async () => {
    const { fake } = await open(['totp']);
    await userEvent.click(screen.getByLabelText('Kod z aplikacji uwierzytelniającej'));
    await userEvent.paste('123 456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    expect(parseBody(fake.calls(TOTP_ROUTE)[0]?.body ?? '')).toEqual({ loginToken: LOGIN_TOKEN, code: '123456' });
  });

  it('EVM-023 AC2 a code used a second time (rejected): one message, the field cleared and focused, a new try possible', async () => {
    const { fake } = await open(['totp']);
    fake.set(TOTP_ROUTE, () => problem(401, 'totp_failed'));
    const field = screen.getByLabelText<HTMLInputElement>('Kod z aplikacji uwierzytelniającej');
    await userEvent.type(field, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect((await screen.findByRole('alert')).textContent).toContain(WRONG_TOTP);
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it.each(['12345', '1234567', 'abcdef', ''])('EVM-023 AC2 the input "%s" is not a code: no request, the same message', async (input) => {
    const { fake } = await open(['totp']);
    if (input !== '') await userEvent.type(screen.getByLabelText('Kod z aplikacji uwierzytelniającej'), input);
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect((await screen.findByRole('alert')).textContent).toContain(WRONG_TOTP);
    expect(fake.calls(TOTP_ROUTE)).toHaveLength(0);
  });

  it('EVM-023 AC2 a network error keeps the typed code and says so', async () => {
    const { fake } = await open(['totp']);
    fake.set(TOTP_ROUTE, () => Promise.reject(new TypeError('network')));
    const field = screen.getByLabelText<HTMLInputElement>('Kod z aplikacji uwierzytelniającej');
    await userEvent.type(field, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nie udało się połączyć z serwerem');
    expect(field.value).toBe('123456');
  });

  it('EVM-023 AC8 429 in the second step shows the message of W-01 with the time of the server', async () => {
    const { fake } = await open(['totp']);
    fake.set(TOTP_ROUTE, () => problem(429, 'rate_limited', {}, { 'Retry-After': '900' }));
    await userEvent.type(screen.getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Zbyt wiele prób logowania. Spróbuj ponownie za 15 min.');
  });

  it('EVM-023 AC2 the fifth failure ends the attempt: the server forgets the token and W-02 says the login took too long', async () => {
    const { fake } = await open(['totp']);
    fake.set(TOTP_ROUTE, () => problem(401, 'unauthenticated'));
    await userEvent.type(screen.getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Logowanie trwało zbyt długo. Zaloguj się ponownie.');
    await userEvent.click(screen.getByRole('button', { name: 'Wróć do logowania' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeTruthy();
    expect(getLoginFlow()).toBeNull();
  });

  it('EVM-023 AC8 offline: the banner, "Potwierdź" unavailable, the typed code stays, nothing is sent', async () => {
    const { fake } = await open(['totp']);
    const field = screen.getByLabelText<HTMLInputElement>('Kod z aplikacji uwierzytelniającej');
    await userEvent.type(field, '123456');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(await screen.findByText('Brak połączenia. Logowanie wymaga połączenia z internetem.')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Potwierdź' });
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(confirm);
    await userEvent.type(field, '{Enter}');
    expect(fake.calls(TOTP_ROUTE)).toHaveLength(0);
    expect(field.value).toBe('123456');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-023 AC2 while the code is checked the button is busy and cannot send it twice', async () => {
    let finish: () => void = () => undefined;
    const { fake } = await open(['totp']);
    fake.set(
      TOTP_ROUTE,
      () =>
        new Promise<Response>((resolve) => {
          finish = () => {
            resolve(json(200, { state: 'active', csrfToken: 'csrf-new' }));
          };
        }),
    );
    fake.set(SESSION_ROUTE, () => json(200, ACTIVE_SESSION));
    await userEvent.type(screen.getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    const busy = await screen.findByRole('button', { name: 'Potwierdź' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    await userEvent.click(busy);
    expect(fake.calls(TOTP_ROUTE)).toHaveLength(1);
    finish();
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
  });
});

describe('W-02 metody z serwera (EVM-023 AC2, AC3)', () => {
  it('EVM-023 AC3 an Administrator gets only the passkey from the server: no code field, no code link to a method he has not', async () => {
    await open(['passkey']);
    expect(screen.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeTruthy();
    expect(screen.queryByLabelText('Kod z aplikacji uwierzytelniającej')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Użyj innej metody' })).toBeNull();
    expect(screen.queryByRole('button', { name: /kodu odzyskiwania/ })).toBeNull();
  });

  it('EVM-023 AC3 a value of the enum that the panel does not know is ignored, not a failure', async () => {
    await open(['sms', 'passkey', 'something_new']);
    expect(screen.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Użyj innej metody' })).toBeNull();
  });

  it('EVM-023 AC3 a refusal of the API (403: no code for this role in the panel) is shown as a server error, not as a wrong code', async () => {
    const { fake } = await open(['totp']);
    fake.set(TOTP_ROUTE, () => problem(403, 'forbidden'));
    await userEvent.type(screen.getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nie udało się zalogować');
    expect(screen.queryByText(WRONG_TOTP)).toBeNull();
  });

  it('EVM-023 AC7 two methods: the first of the server is shown, "Użyj innej metody" switches both ways and moves the focus', async () => {
    await open(['totp', 'passkey', 'recovery_code']);
    expect(document.activeElement).toBe(screen.getByLabelText('Kod z aplikacji uwierzytelniającej'));
    await userEvent.click(screen.getByRole('button', { name: 'Użyj innej metody' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(screen.queryByLabelText('Kod z aplikacji uwierzytelniającej')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Użyj innej metody' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Kod z aplikacji uwierzytelniającej'));
  });

  it('EVM-023 AC2 the passkey first (order of the server) and the code as the other method', async () => {
    await open(['passkey', 'totp']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Użyj klucza dostępu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Użyj innej metody' }));
    expect(screen.getByLabelText('Kod z aplikacji uwierzytelniającej')).toBeTruthy();
  });

  it('EVM-025 AC5 after a password reset the code is the second step as well, with the message above it', async () => {
    const { fake } = await open(['totp', 'recovery_code'], api(), { passwordChanged: true });
    expect(screen.getByText(/Hasło zostało zmienione/).closest('[role="status"]')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Potwierdź logowanie' }));
    await userEvent.type(screen.getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    expect(fake.calls(TOTP_ROUTE)).toHaveLength(1);
  });

  it('EVM-023 AC2 a login that ends in the limited session (enrolment) leads to W-03', async () => {
    const fake = api({ [SESSION_ROUTE]: () => json(200, { ...ACTIVE_SESSION, state: 'mfa_enrollment' }) });
    fake.set(TOTP_ROUTE, () => json(200, { state: 'mfa_enrollment', csrfToken: 'csrf-new' }));
    const { history } = await open(['totp'], fake);
    await userEvent.type(screen.getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/mfa-setup');
    });
  });
});

describe('W-02 kod odzyskiwania (EVM-023 AC5)', () => {
  it('EVM-023 AC5 the link opens a field in monospace without autofill; the secondary way back is "Użyj innej metody"', async () => {
    await open(['passkey', 'recovery_code']);
    await userEvent.click(screen.getByRole('button', { name: 'Nie masz dostępu do metody? Użyj kodu odzyskiwania' }));
    const field = screen.getByLabelText('Kod odzyskiwania');
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(field.getAttribute('spellcheck')).toBe('false');
    expect(field.className).toContain('text-mono');
    expect(screen.getByText('Kod z listy kodów odzyskiwania. Spacje i łączniki nie mają znaczenia.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Użyj klucza dostępu' })).toBeNull();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Użyj innej metody' }));
    expect(screen.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeTruthy();
  });

  it('EVM-023 AC5 only the recovery code is left (no other method): the field is shown at once', async () => {
    await open(['recovery_code']);
    expect(document.activeElement).toBe(screen.getByLabelText('Kod odzyskiwania'));
    expect(screen.queryByRole('button', { name: 'Użyj innej metody' })).toBeNull();
  });

  it('EVM-023 AC5 spaces, hyphens and lower case are dropped before the send; the Editor sees the count, the e-mail and the hint', async () => {
    const { fake } = await open(['totp', 'recovery_code'], api({}, EDITOR_SESSION));
    await userEvent.click(screen.getByRole('button', { name: 'Nie masz dostępu do metody? Użyj kodu odzyskiwania' }));
    await userEvent.type(screen.getByLabelText('Kod odzyskiwania'), 'abcd-2345 efgh-6723 abcd');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    const status = (await screen.findByText(/Zalogowano kodem odzyskiwania\./)).closest('[role="status"]');
    expect(status?.textContent).toContain(
      'Zalogowano kodem odzyskiwania. Pozostało 9 kodów. Wysłaliśmy e-mail z informacją o tym logowaniu.',
    );
    expect(status?.textContent).toContain('Jeśli nie masz już żadnej metody, poproś administratora o reset drugiego kroku logowania.');
    expect(parseBody(fake.calls(RECOVERY_ROUTE)[0]?.body ?? '')).toEqual({ loginToken: LOGIN_TOKEN, code: CODE });
    // The step before the panel: the only action is "Przejdź dalej", the focus is on it, the code is gone from the page.
    const next = screen.getByRole('button', { name: 'Przejdź dalej' });
    expect(document.activeElement).toBe(next);
    expect(screen.queryByLabelText('Kod odzyskiwania')).toBeNull();
    expect(document.body.textContent).not.toContain(CODE);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-023 AC5 an Administrator gets the hint about another administrator; "Przejdź dalej" opens the panel at returnTo', async () => {
    const { history } = await open(['recovery_code']);
    await userEvent.type(screen.getByLabelText('Kod odzyskiwania'), CODE);
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    const status = (await screen.findByText(/Zalogowano kodem odzyskiwania\./)).closest('[role="status"]');
    expect(status?.textContent).toContain('Bez klucza dostępu kolejne logowanie znów wymaga kodu.');
    expect(status?.textContent).toContain('Poproś innego administratora o reset drugiego kroku logowania.');
    expect(history.location.pathname).toBe('/login/second-step');
    await userEvent.click(screen.getByRole('button', { name: 'Przejdź dalej' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zlecenia' })).toBeTruthy();
  });

  it.each([
    [1, 'Pozostał 1 kod.'],
    [2, 'Pozostały 2 kody.'],
    [5, 'Pozostało 5 kodów.'],
    [22, 'Pozostały 22 kody.'],
    [0, 'To był ostatni kod.'],
  ])('EVM-023 AC5 the count of the codes left (%i) is spoken in Polish: "%s"', async (remaining, text) => {
    const fake = api({ [RECOVERY_ROUTE]: () => json(200, { state: 'active', csrfToken: 'csrf-new', remainingCodes: remaining }) });
    fake.set(SESSION_ROUTE, () => json(200, EDITOR_SESSION));
    await open(['recovery_code'], fake);
    await userEvent.type(screen.getByLabelText('Kod odzyskiwania'), CODE);
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    const status = (await screen.findByText(/Zalogowano kodem odzyskiwania\./)).closest('[role="status"]');
    expect(status?.textContent).toContain(`Zalogowano kodem odzyskiwania. ${text} Wysłaliśmy e-mail`);
  });

  it('EVM-023 AC5 a code used a second time (rejected): one message, the field cleared and focused', async () => {
    const { fake } = await open(['recovery_code']);
    fake.set(RECOVERY_ROUTE, () => problem(401, 'recovery_code_failed'));
    const field = screen.getByLabelText<HTMLInputElement>('Kod odzyskiwania');
    await userEvent.type(field, CODE);
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect((await screen.findByRole('alert')).textContent).toContain(WRONG_RECOVERY);
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
  });

  it.each(['ABCD', `${CODE}A`, 'ABCD1890EFGH6723ABCD'])(
    'EVM-023 AC5 the input "%s" cannot be a recovery code: no request',
    async (input) => {
      const { fake } = await open(['recovery_code']);
      await userEvent.type(screen.getByLabelText('Kod odzyskiwania'), input);
      await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
      expect((await screen.findByRole('alert')).textContent).toContain(WRONG_RECOVERY);
      expect(fake.calls(RECOVERY_ROUTE)).toHaveLength(0);
    },
  );

  it('EVM-023 AC5 the passkey step of W-02 still asks the server for options (nothing of the code path changed it)', async () => {
    const fake = api({ [OPTIONS_ROUTE]: () => problem(401, 'login_expired') });
    await open(['passkey', 'totp'], fake);
    await userEvent.click(screen.getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Logowanie trwało zbyt długo.');
  });
});
