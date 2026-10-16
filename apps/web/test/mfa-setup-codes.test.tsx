import type { CurrentSession } from '@evia/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSetupFinishing } from '../src/mfa/setup-progress.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, ENROLLMENT_SESSION, createFakeApi, json, parseBody, problem, SESSION_ROUTE } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { createQueryClient } from '../src/app.tsx';

const START_ROUTE = 'POST /api/v1/account/totp/enrolment';
const CONFIRM_ROUTE = 'POST /api/v1/account/totp/confirm';
const CODES_ROUTE = 'POST /api/v1/account/recovery-codes';
const OPTIONS_ROUTE = 'POST /api/v1/account/passkeys/registration-options';
const REGISTER_ROUTE = 'POST /api/v1/account/passkeys';
const STEP_UP_OPTIONS = 'POST /api/v1/auth/step-up/options';
const STEP_UP = 'POST /api/v1/auth/step-up';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/EVia%20Manager:anna.testowa%40example.com?secret=${SECRET}&issuer=EVia%20Manager`;
const CODES = [
  'ABCDEFGHIJKLMNOPQRST',
  'ABCDEFGHIJKLMNOPQRS2',
  'ABCDEFGHIJKLMNOPQRS3',
  'ABCDEFGHIJKLMNOPQRS4',
  'ABCDEFGHIJKLMNOPQRS5',
  'ABCDEFGHIJKLMNOPQRS6',
  'ABCDEFGHIJKLMNOPQRS7',
  'ABCDEFGHIJKLMNOPQR22',
  'ABCDEFGHIJKLMNOPQR23',
  'ABCDEFGHIJKLMNOPQR24',
];
const EDITOR: CurrentSession = { ...ENROLLMENT_SESSION, user: { ...ENROLLMENT_SESSION.user, role: 'editor' } };
const READ_ONLY: CurrentSession = { ...ENROLLMENT_SESSION, user: { ...ENROLLMENT_SESSION.user, role: 'read_only' } };
const WRONG = 'Kod jest nieprawidłowy. Sprawdź, czy czas w telefonie jest ustawiony automatycznie, i wpisz nowy kod.';

const CREDENTIAL = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'Y2xpZW50', attestationObject: 'YXR0ZXN0', authenticatorData: 'YXV0aA', signature: 'c2ln' },
};
class FakePublicKeyCredential {
  static readonly parseCreationOptionsFromJSON = vi.fn((options: object) => options);
  static readonly parseRequestOptionsFromJSON = vi.fn((options: object) => options);
  toJSON() {
    return CREDENTIAL;
  }
}

/** The fake server: an enrolment session of `role` that turns `active` once the method is confirmed. */
function enrolmentApi(role: CurrentSession = EDITOR, overrides: Record<string, () => Response | Promise<Response>> = {}) {
  let active = false;
  return createFakeApi({
    [SESSION_ROUTE]: () => json(200, active ? { ...ACTIVE_SESSION, user: role.user, csrfToken: 'csrf-rotated' } : role),
    [START_ROUTE]: () => json(200, { secret: SECRET, otpauthUri: URI }, { 'Cache-Control': 'no-store' }),
    [CONFIRM_ROUTE]: () => {
      active = true;
      return json(200, { state: 'active', csrfToken: 'csrf-rotated' });
    },
    [OPTIONS_ROUTE]: () =>
      json(200, { rp: { id: 'localhost', name: 'EVia Manager' }, user: { id: 'dXNlcg', name: 'a', displayName: 'A' }, challenge: 'Y2g' }),
    [REGISTER_ROUTE]: () => {
      active = true;
      return json(201, {
        id: '22222222-2222-4222-8222-222222222222',
        createdAt: '2026-10-06T10:00:00Z',
        deviceType: 'multi_device',
        backedUp: true,
      });
    },
    [CODES_ROUTE]: () => json(200, { codes: CODES }, { 'Cache-Control': 'no-store' }),
    'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }),
    'GET /api/v1/work-orders': () => json(200, { items: [], nextCursor: null }),
    ...overrides,
  });
}

async function toTotpStep(role: CurrentSession = EDITOR, overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const api = enrolmentApi(role, overrides);
  const rendered = await renderPanel('/mfa-setup', api);
  await userEvent.click(screen.getByRole('radio', { name: 'Kod z aplikacji uwierzytelniającej' }));
  await userEvent.click(screen.getByRole('button', { name: 'Dalej' }));
  return { ...rendered, api };
}

async function confirmWith(code = '123456') {
  await userEvent.type(await screen.findByLabelText('Kod z aplikacji uwierzytelniającej'), code);
  await userEvent.click(screen.getByRole('button', { name: 'Potwierdź kod' }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'credentials');
  setSetupFinishing(false);
});

describe('W-03 krok 1: wybór metody (EVM-023 AC1, AC8)', () => {
  it('EVM-023 AC8 an Editor chooses between the passkey and the code, with the note about the phone as text; step 1 of 3, focus on the title', async () => {
    await renderPanel('/mfa-setup', enrolmentApi(EDITOR));
    const title = screen.getByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' });
    expect(document.activeElement).toBe(title);
    expect(screen.getByText('Krok 1 z 3')).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Wybierz metodę' });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Klucz dostępu — Windows Hello/ }).checked).toBe(true);
    expect(screen.getByText(/Aplikacja EVia Manager na telefonie wymaga kodu z aplikacji uwierzytelniającej/)).toBeTruthy();
    expect(document.title).toBe('Konfiguracja logowania · EVia Manager');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-023 AC8 a Read-only user can set up the code too, without any information about the phone', async () => {
    await renderPanel('/mfa-setup', enrolmentApi(READ_ONLY));
    expect(screen.getByRole('radio', { name: 'Kod z aplikacji uwierzytelniającej' })).toBeTruthy();
    expect(screen.queryByText(/telefonie/)).toBeNull();
  });

  it('EVM-023 AC3 an Administrator has no choice: no code of the app in the panel, straight to the passkey', async () => {
    await renderPanel('/mfa-setup', enrolmentApi(ENROLLMENT_SESSION));
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dalej' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dodaj klucz dostępu' })).toBeTruthy();
  });

  it('EVM-023 AC1 the choice of the code leads to step 2 and the way back returns to the choice', async () => {
    const { api } = await toTotpStep();
    expect(await screen.findByRole('heading', { level: 2, name: 'Kod z aplikacji uwierzytelniającej' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Kod z aplikacji uwierzytelniającej' }));
    expect(screen.getByText('Krok 2 z 3')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Wybierz inną metodę' }));
    expect(screen.getByText('Krok 1 z 3')).toBeTruthy();
    expect(api.calls(START_ROUTE)).toHaveLength(1);
  });
});

describe('W-03 krok 2: kod z aplikacji (EVM-023 AC1)', () => {
  it('EVM-023 AC1 QR drawn in the browser with a name, the key to type in is behind "Pokaż klucz do wpisania", the field is a code field, axe clean', async () => {
    const { api, container } = await toTotpStep();
    const qr = await screen.findByRole('img', { name: 'Kod QR do zeskanowania w aplikacji uwierzytelniającej' });
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(screen.getByText('Zeskanuj kod QR w aplikacji uwierzytelniającej.')).toBeTruthy();
    // The secret is not on the page as text until it is asked for; nothing leaves the browser except the call to the API.
    const toggle = screen.getByRole('button', { name: /Pokaż klucz do wpisania/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const secret = screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
    expect(secret.closest('[hidden]')).not.toBeNull();
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(secret.closest('[hidden]')).toBeNull();
    expect(container.querySelector('img, script, iframe, [src]')).toBeNull();
    expect(api.requests.map((request) => request.path)).toEqual(['/api/v1/auth/session', '/api/v1/account/totp/enrolment']);
    const field = screen.getByLabelText('Kod z aplikacji uwierzytelniającej', { selector: 'input' });
    expect(field.getAttribute('autocomplete')).toBe('one-time-code');
    expect(field.getAttribute('inputmode')).toBe('numeric');
    expect(field.getAttribute('spellcheck')).toBe('false');
    expect(screen.getByText('Metoda zacznie działać dopiero po potwierdzeniu kodu.')).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-023 AC1 while the secret is made there is a status text and a skeleton; the secret request goes once', async () => {
    let finish: () => void = () => undefined;
    const { api } = await toTotpStep(EDITOR, {
      [START_ROUTE]: () =>
        new Promise<Response>((resolve) => {
          finish = () => {
            resolve(json(200, { secret: SECRET, otpauthUri: URI }));
          };
        }),
    });
    expect((await screen.findByText('Przygotowujemy kod QR…')).closest('[aria-busy="true"]')).not.toBeNull();
    finish();
    await screen.findByRole('img', { name: /Kod QR/ });
    expect(api.calls(START_ROUTE)).toHaveLength(1);
  });

  it('EVM-023 AC1 six digits do not send the code on their own; a wrong code gives the message, clears the field, focuses it, the method stays inactive', async () => {
    const { api } = await toTotpStep(EDITOR, { [CONFIRM_ROUTE]: () => problem(400, 'totp_verification_failed') });
    const field = await screen.findByLabelText<HTMLInputElement>('Kod z aplikacji uwierzytelniającej', { selector: 'input' });
    await userEvent.type(field, '123456');
    expect(api.calls(CONFIRM_ROUTE)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź kod' }));
    expect((await screen.findByRole('alert')).textContent).toContain(WRONG);
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    expect(screen.queryByRole('heading', { level: 2, name: 'Kody odzyskiwania' })).toBeNull();
    expect(screen.getByText('Krok 2 z 3')).toBeTruthy();
  });

  it.each(['12345', 'abcdef', ''])('EVM-023 AC1 the input "%s" is not a code: no request, the same message', async (input) => {
    const { api } = await toTotpStep();
    if (input !== '')
      await userEvent.type(await screen.findByLabelText('Kod z aplikacji uwierzytelniającej', { selector: 'input' }), input);
    await userEvent.click(await screen.findByRole('button', { name: 'Potwierdź kod' }));
    expect((await screen.findByRole('alert')).textContent).toContain(WRONG);
    expect(api.calls(CONFIRM_ROUTE)).toHaveLength(0);
  });

  it('EVM-023 AC1 a correct code activates the method: the CSRF header of the enrolment, the new session, step 3 on the same page (no panel yet)', async () => {
    const { api, history } = await toTotpStep();
    await confirmWith('123 456');
    expect(await screen.findByRole('heading', { level: 2, name: 'Kody odzyskiwania' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Kody odzyskiwania' }));
    expect(history.location.pathname).toBe('/mfa-setup');
    const [confirm] = api.calls(CONFIRM_ROUTE);
    expect(confirm?.headers.get('X-CSRF-Token')).toBe('csrf-enrollment');
    expect(parseBody(confirm?.body ?? '')).toEqual({ code: '123456' });
    expect(api.calls(SESSION_ROUTE).length).toBeGreaterThanOrEqual(2);
    // The secret and the QR are gone with the step.
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.body.textContent).not.toContain('JBSW');
    expect(screen.getByText('Krok 3 z 3')).toBeTruthy();
  });

  it('EVM-023 AC1 once the step is over the mutation cache keeps no secret (gcTime 0)', async () => {
    const queryClient = createQueryClient();
    await renderPanel('/mfa-setup', enrolmentApi(EDITOR), { queryClient });
    await userEvent.click(screen.getByRole('radio', { name: 'Kod z aplikacji uwierzytelniającej' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dalej' }));
    await confirmWith();
    await screen.findByRole('list', { name: 'Kody odzyskiwania' });
    const kept = queryClient
      .getMutationCache()
      .getAll()
      .map((mutation) => JSON.stringify(mutation.state.data ?? ''));
    expect(kept.some((data) => data.includes(SECRET))).toBe(false);
  });

  it.each([
    [409, 'mfa_already_configured', 'Drugi krok logowania jest już skonfigurowany. Zaloguj się ponownie.', false],
    [503, 'service_unavailable', 'Konfiguracja kodu z aplikacji jest chwilowo niedostępna.', true],
    [500, 'internal_error', 'Nie udało się rozpocząć konfiguracji kodu z aplikacji. Spróbuj ponownie.', true],
  ])('EVM-023 AC1 the start answered %i: one message%s', async (status, code, text, retry) => {
    await toTotpStep(EDITOR, { [START_ROUTE]: () => problem(status, code) });
    expect((await screen.findByRole('alert')).textContent).toContain(text);
    expect(Boolean(screen.queryByRole('button', { name: 'Spróbuj ponownie' }))).toBe(retry);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Wybierz inną metodę' })).toBeTruthy();
  });

  it('EVM-023 AC1 a failed start can be repeated and then gives the secret', async () => {
    const { api } = await toTotpStep(EDITOR, { [START_ROUTE]: () => problem(500, 'internal_error') });
    await screen.findByRole('alert');
    api.set(START_ROUTE, () => json(200, { secret: SECRET, otpauthUri: URI }));
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('img', { name: /Kod QR/ })).toBeTruthy();
  });

  it('EVM-023 AC8 429 on the confirmation says when to try again, from Retry-After; the typed code stays', async () => {
    await toTotpStep(EDITOR, { [CONFIRM_ROUTE]: () => problem(429, 'rate_limited', {}, { 'Retry-After': '60' }) });
    await confirmWith();
    expect((await screen.findByRole('alert')).textContent).toContain('Zbyt wiele prób. Spróbuj ponownie za 1 min.');
    expect(screen.getByLabelText<HTMLInputElement>('Kod z aplikacji uwierzytelniającej', { selector: 'input' }).value).toBe('123456');
  });

  it('EVM-023 AC8 another failure of the confirmation gives a code for support and keeps the typed code', async () => {
    await toTotpStep(EDITOR, { [CONFIRM_ROUTE]: () => problem(500, 'internal_error') });
    await confirmWith();
    expect((await screen.findByRole('alert')).textContent).toContain('Nie udało się potwierdzić kodu.');
    expect(screen.getByLabelText<HTMLInputElement>('Kod z aplikacji uwierzytelniającej', { selector: 'input' }).value).toBe('123456');
  });

  it('EVM-023 AC8 offline: the banner, the buttons unavailable, the progress and the typed code stay, nothing is sent; back online it works', async () => {
    const { api } = await toTotpStep();
    const field = await screen.findByLabelText<HTMLInputElement>('Kod z aplikacji uwierzytelniającej', { selector: 'input' });
    await userEvent.type(field, '123456');
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    const banner = await screen.findByText('Brak połączenia. Konfiguracja wymaga połączenia z internetem. Postęp zostaje na tej karcie.');
    expect(banner.closest('[role="status"]')).not.toBeNull();
    const confirm = screen.getByRole('button', { name: 'Potwierdź kod' });
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(confirm);
    expect(api.calls(CONFIRM_ROUTE)).toHaveLength(0);
    expect(field.value).toBe('123456');
    expect(screen.getByRole('img', { name: /Kod QR/ })).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    onLine.mockReturnValue(true);
    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Potwierdź kod' }).getAttribute('aria-disabled')).not.toBe('true');
    });
  });

  it('EVM-023 AC1 the secret, the address and the code are never in storage, in the title or in the address, and not in the query cache', async () => {
    const queryClient = createQueryClient();
    const api = enrolmentApi(EDITOR);
    const { history } = await renderPanel('/mfa-setup', api, { queryClient });
    await userEvent.click(screen.getByRole('radio', { name: 'Kod z aplikacji uwierzytelniającej' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dalej' }));
    await screen.findByRole('img', { name: /Kod QR/ });
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
    expect(`${document.title}${history.location.href}`).not.toContain('JBSW');
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => JSON.stringify(query.state.data ?? '')),
    ).not.toEqual(expect.arrayContaining([expect.stringContaining(SECRET)]));
  });
});

describe('W-03 krok 3: kody odzyskiwania (EVM-023 AC4, AC6)', () => {
  it('EVM-023 AC4 ten codes of 20 characters as a list, the warning, the summary of the methods, "Kopiuj kody" and "Drukuj kody", axe clean', async () => {
    await toTotpStep();
    await confirmWith();
    const list = await screen.findByRole('list', { name: 'Kody odzyskiwania' });
    const items = Array.from(list.querySelectorAll('li'));
    expect(items).toHaveLength(10);
    expect(items.map((item) => item.textContent.replaceAll(' ', ''))).toEqual(CODES);
    expect(items[0]?.textContent).toBe('ABCDE FGHIJ KLMNO PQRST');
    expect(
      screen.getByText(
        /Te 10 kodów pozwoli Ci się zalogować, gdy stracisz dostęp do metody\. Każdy kod działa raz\. Pokazujemy je tylko teraz\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Zapisz kody poza telefonem — nie przechowuj ich w telefonie z aplikacją uwierzytelniającą.')).toBeTruthy();
    expect(screen.getByText('Metody logowania: kod z aplikacji · klucz dostępu: nie')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kopiuj kody' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Drukuj kody' })).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-023 AC4 the codes are made once per visit (the confirmation of the code opened the window: no step-up), with the CSRF token of the new session', async () => {
    const { api } = await toTotpStep();
    await confirmWith();
    await screen.findByRole('list', { name: 'Kody odzyskiwania' });
    expect(api.calls(CODES_ROUTE)).toHaveLength(1);
    expect(api.calls(CODES_ROUTE)[0]?.headers.get('X-CSRF-Token')).toBe('csrf-rotated');
    expect(api.calls(STEP_UP)).toHaveLength(0);
  });

  it('EVM-023 AC4 "Kopiuj kody" puts the codes on the clipboard, one per line, and says so as a status; a refusal is an error with the way out', async () => {
    await toTotpStep();
    await confirmWith();
    await screen.findByRole('list', { name: 'Kody odzyskiwania' });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Kopiuj kody' }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(CODES.join('\n'));
    expect((await screen.findByText('Kody skopiowane do schowka.')).closest('[role="status"]')).not.toBeNull();
    writeText.mockRejectedValueOnce(new Error('denied'));
    await userEvent.click(screen.getByRole('button', { name: 'Kopiuj kody' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nie udało się skopiować kodów.');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('EVM-023 AC4 "Drukuj kody" opens the print dialog of the browser', async () => {
    await toTotpStep();
    await confirmWith();
    await screen.findByRole('list', { name: 'Kody odzyskiwania' });
    const print = vi.spyOn(globalThis, 'print').mockImplementation(() => undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Drukuj kody' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('EVM-023 AC4 "Zakończ konfigurację" needs the box: without it the error, with it the toast, the panel, and nothing of the codes stays', async () => {
    const queryClient = createQueryClient();
    const api = enrolmentApi(EDITOR);
    const { history } = await renderPanel('/mfa-setup', api, { queryClient });
    await userEvent.click(screen.getByRole('radio', { name: 'Kod z aplikacji uwierzytelniającej' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dalej' }));
    await confirmWith();
    await screen.findByRole('list', { name: 'Kody odzyskiwania' });
    await userEvent.click(screen.getByRole('button', { name: 'Zakończ konfigurację' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Potwierdź, że kody są zapisane.');
    expect(history.location.pathname).toBe('/mfa-setup');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Kody są zapisane w bezpiecznym miejscu' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Zakończ konfigurację' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zlecenia' })).toBeTruthy();
    expect(history.location.pathname).toBe('/work-orders');
    expect(screen.getByText('Drugi krok logowania jest skonfigurowany.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('ABCDE');
    expect(
      queryClient
        .getMutationCache()
        .getAll()
        .filter((mutation) => mutation.state.data !== undefined),
    ).toEqual([]);
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });

  it('EVM-023 AC4 an error of the generation gives the way out and a retry makes the codes', async () => {
    const { api } = await toTotpStep(EDITOR, { [CODES_ROUTE]: () => problem(500, 'internal_error') });
    await confirmWith();
    expect((await screen.findByRole('alert')).textContent).toContain('Nie udało się wygenerować kodów odzyskiwania. Spróbuj ponownie.');
    api.set(CODES_ROUTE, () => json(200, { codes: CODES }));
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('list', { name: 'Kody odzyskiwania' })).toBeTruthy();
  });

  it('EVM-023 AC4 codes that this session cannot make (recovery_codes_regeneration_unavailable): the message and no retry', async () => {
    await toTotpStep(EDITOR, { [CODES_ROUTE]: () => problem(403, 'recovery_codes_regeneration_unavailable') });
    await confirmWith();
    expect((await screen.findByRole('alert')).textContent).toContain('Nie możemy wygenerować kodów w tej sesji.');
    expect(screen.queryByRole('button', { name: 'Spróbuj ponownie' })).toBeNull();
  });

  it('EVM-023 AC4 while the codes are made there is a status and a skeleton', async () => {
    let finish: () => void = () => undefined;
    await toTotpStep(EDITOR, {
      [CODES_ROUTE]: () =>
        new Promise<Response>((resolve) => {
          finish = () => {
            resolve(json(200, { codes: CODES }));
          };
        }),
    });
    await confirmWith();
    expect((await screen.findByText('Generujemy kody odzyskiwania…')).closest('[aria-busy="true"]')).not.toBeNull();
    finish();
    await screen.findByRole('list', { name: 'Kody odzyskiwania' });
  });
});

describe('W-03 krok 3 po kluczu dostępu (EVM-023 AC4)', () => {
  function stubWebAuthn(get: () => Promise<unknown> = () => Promise.resolve(new FakePublicKeyCredential())) {
    vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
    Object.defineProperty(navigator, 'credentials', {
      value: { create: vi.fn(() => Promise.resolve(new FakePublicKeyCredential())), get: vi.fn(get) },
      configurable: true,
    });
  }

  async function toPasskeyCodes(overrides: Record<string, () => Response | Promise<Response>> = {}, role: CurrentSession = EDITOR) {
    const api = enrolmentApi(role, overrides);
    const rendered = await renderPanel('/mfa-setup', api);
    if (role !== ENROLLMENT_SESSION) await userEvent.click(screen.getByRole('button', { name: 'Dalej' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj klucz dostępu' }));
    return { ...rendered, api };
  }

  it('EVM-023 AC4 a passkey does not open the window: W-04 with the passkey only asks for the identity, then the codes are made again', async () => {
    stubWebAuthn();
    let first = true;
    const { api } = await toPasskeyCodes({
      [CODES_ROUTE]: () => {
        if (first) {
          first = false;
          return problem(403, 'step_up_required');
        }
        return json(200, { codes: CODES });
      },
      [STEP_UP_OPTIONS]: () => json(200, { challenge: 'Y2g', rpId: 'localhost', userVerification: 'required', allowCredentials: [] }),
      [STEP_UP]: () => json(200, { csrfToken: 'csrf-stepped' }),
    });
    expect(await screen.findByText('Potwierdź tożsamość, aby wygenerować kody odzyskiwania')).toBeTruthy();
    // After a passkey only the passkey is offered (the account has no code of the app yet).
    expect(screen.queryByLabelText('Kod z aplikacji uwierzytelniającej')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(await screen.findByRole('list', { name: 'Kody odzyskiwania' })).toBeTruthy();
    expect(api.calls(CODES_ROUTE)).toHaveLength(2);
    expect(api.calls(CODES_ROUTE)[1]?.headers.get('X-CSRF-Token')).toBe('csrf-stepped');
    expect(screen.getByText('Metody logowania: klucz dostępu · kod z aplikacji: nie')).toBeTruthy();
    // The Editor is told that the phone needs the code of the app, and where to add it later.
    expect(screen.getByText(/Aplikacja na telefonie będzie wymagać kodu z aplikacji uwierzytelniającej\./)).toBeTruthy();
  });

  it('EVM-023 AC4 cancelling W-04 leaves the step without codes, with the reason and a retry that asks again', async () => {
    stubWebAuthn();
    const { api } = await toPasskeyCodes({ [CODES_ROUTE]: () => problem(403, 'step_up_required') });
    await userEvent.click(await screen.findByRole('button', { name: 'Anuluj' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Kody odzyskiwania wymagają potwierdzenia tożsamości.');
    expect(screen.queryByRole('list', { name: 'Kody odzyskiwania' })).toBeNull();
    api.set(CODES_ROUTE, () => json(200, { codes: CODES }));
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('list', { name: 'Kody odzyskiwania' })).toBeTruthy();
  });

  it('EVM-023 AC4 the Administrator after the passkey is told that the phone needs the code of the app (Konto → Drugi krok logowania)', async () => {
    stubWebAuthn();
    await toPasskeyCodes({}, ENROLLMENT_SESSION);
    await screen.findByRole('list', { name: 'Kody odzyskiwania' });
    expect(screen.getByText(/Aplikacja na telefonie będzie wymagać kodu z aplikacji uwierzytelniającej\./)).toBeTruthy();
  });

  it('EVM-023 AC8 a Read-only user after the passkey gets no information about the phone', async () => {
    stubWebAuthn();
    await toPasskeyCodes({}, READ_ONLY);
    await screen.findByRole('list', { name: 'Kody odzyskiwania' });
    expect(screen.queryByText(/Aplikacja na telefonie/)).toBeNull();
  });
});

describe('Brama sesji i W-03 (EVM-023 AC4)', () => {
  it('EVM-023 AC4 a refresh in step 3 drops the memory of the tab: the active session opens the panel, the codes are not shown again', async () => {
    const api = enrolmentApi(EDITOR, { [SESSION_ROUTE]: () => json(200, { ...ACTIVE_SESSION, user: EDITOR.user }) });
    const { history } = await renderPanel('/mfa-setup', api);
    expect(history.location.pathname).toBe('/work-orders');
    expect(api.calls(CODES_ROUTE)).toHaveLength(0);
  });
});
