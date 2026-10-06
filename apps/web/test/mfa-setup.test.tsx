import { act, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, ENROLLMENT_SESSION, createFakeApi, json, problem, SESSION_ROUTE } from './api-fake.ts';
import { renderPanel } from './render.tsx';

const OPTIONS_ROUTE = 'POST /api/v1/account/passkeys/registration-options';
const REGISTER_ROUTE = 'POST /api/v1/account/passkeys';
const LOGOUT_ROUTE = 'POST /api/v1/auth/logout';

const OPTIONS = {
  rp: { id: 'localhost', name: 'EVia Manager' },
  user: { id: 'dXNlci1oYW5kbGU', name: 'anna.testowa@example.com', displayName: 'Anna Testowa' },
  challenge: 'Y2hhbGxlbmdl',
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  authenticatorSelection: { userVerification: 'required' },
  attestation: 'none',
};
const CREDENTIAL = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'Y2xpZW50', attestationObject: 'YXR0ZXN0' },
};
const PASSKEY = {
  id: '22222222-2222-4222-8222-222222222222',
  createdAt: '2026-10-06T10:00:00Z',
  deviceType: 'multi_device',
  backedUp: true,
};

class FakePublicKeyCredential {
  static readonly parseCreationOptionsFromJSON = vi.fn((options: object) => ({ ...options, parsed: true }));
  toJSON() {
    return CREDENTIAL;
  }
}

function stubWebAuthn(create: () => Promise<unknown> = () => Promise.resolve(new FakePublicKeyCredential())) {
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
  const spy = vi.fn(create);
  Object.defineProperty(navigator, 'credentials', { value: { create: spy }, configurable: true });
  return spy;
}

/** The fake server: an `mfa_enrollment` session that turns `active` once the key is registered. */
function enrollmentApi(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  let registered = false;
  return createFakeApi({
    [SESSION_ROUTE]: () => json(200, registered ? { ...ACTIVE_SESSION, csrfToken: 'csrf-rotated' } : ENROLLMENT_SESSION),
    [OPTIONS_ROUTE]: () => json(200, OPTIONS),
    [REGISTER_ROUTE]: () => {
      registered = true;
      return json(201, PASSKEY);
    },
    [LOGOUT_ROUTE]: () => new Response(null, { status: 204 }),
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'credentials');
  FakePublicKeyCredential.parseCreationOptionsFromJSON.mockClear();
});

describe('W-03 Skonfiguruj drugi krok logowania (EVM-016 AC4; flows/01)', () => {
  it('EVM-016 AC4 a session in mfa_enrollment lands every address on W-03: only the passkey, no navigation, no data, "Wyloguj" on top', async () => {
    const api = enrollmentApi();
    const { history } = await renderPanel('/work-orders', api);
    expect(history.location.pathname).toBe('/mfa-setup');
    const title = screen.getByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' });
    expect(document.activeElement).toBe(title);
    expect(document.title).toBe('Konfiguracja logowania · EVia Manager');
    expect(screen.getByText(/klucza dostępu: Windows Hello, klucza bezpieczeństwa albo klucza dostępu w telefonie/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dodaj klucz dostępu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wyloguj' })).toBeTruthy();
    // No choice of method, no TOTP block, no recovery codes (variant "przed EVM-023").
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(/kod z aplikacji|Krok 1 z 3|kody odzyskiwania/i)).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText('Zlecenia')).toBeNull();
    expect(api.requests.map((request) => request.path)).toEqual(['/api/v1/auth/session']);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-016 AC4 a refresh of W-03 reads the session again (and with it the CSRF token) — nothing is kept in storage', async () => {
    await renderPanel('/mfa-setup', enrollmentApi());
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('EVM-016 AC4 registering the key: native WebAuthn JSON helpers, CSRF header on both calls, then the new session, a toast and the panel', async () => {
    const create = stubWebAuthn();
    const api = enrollmentApi();
    const { history } = await renderPanel('/mfa-setup', api);
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj klucz dostępu' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Zlecenia' })).toBeTruthy();
    expect(history.location.pathname).toBe('/work-orders');
    expect(FakePublicKeyCredential.parseCreationOptionsFromJSON).toHaveBeenCalledExactlyOnceWith(OPTIONS);
    expect(create).toHaveBeenCalledExactlyOnceWith({ publicKey: { ...OPTIONS, parsed: true } });
    const [options] = api.calls(OPTIONS_ROUTE);
    const [register] = api.calls(REGISTER_ROUTE);
    expect(options?.headers.get('X-CSRF-Token')).toBe('csrf-enrollment');
    expect(register?.headers.get('X-CSRF-Token')).toBe('csrf-enrollment');
    expect(JSON.parse(register?.body ?? '')).toEqual({ credential: CREDENTIAL });
    // The registration answer has no session: the panel reads it, so the token of the new session is in use.
    expect(api.calls(SESSION_ROUTE)).toHaveLength(2);
    expect(screen.getByText('Drugi krok logowania jest skonfigurowany.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Konto: Anna Testowa' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Brak zleceń' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dodaj klucz dostępu' })).toBeNull();
    // After the new session, mutations use the rotated token.
    await userEvent.click(screen.getByRole('button', { name: 'Konto: Anna Testowa' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Wyloguj' }));
    await waitFor(() => {
      expect(api.calls(LOGOUT_ROUTE)[0]?.headers.get('X-CSRF-Token')).toBe('csrf-rotated');
    });
  });

  it('EVM-016 AC4 during the ceremony the button shows "Postępuj zgodnie z instrukcją systemu." and cannot be pressed again', async () => {
    let finish: () => void = () => undefined;
    const create = stubWebAuthn(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(new FakePublicKeyCredential());
          };
        }),
    );
    await renderPanel('/mfa-setup', enrollmentApi());
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj klucz dostępu' }));
    const busy = await screen.findByRole('button', { name: 'Postępuj zgodnie z instrukcją systemu.' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    await waitFor(() => {
      expect(create).toHaveBeenCalled();
    });
    await userEvent.click(busy);
    expect(create).toHaveBeenCalledTimes(1);
    finish();
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
  });

  it.each([
    ['the user cancels the ceremony', () => stubWebAuthn(() => Promise.reject(new DOMException('cancelled', 'NotAllowedError'))), {}],
    ['the server rejects the verification', () => stubWebAuthn(), { [REGISTER_ROUTE]: () => problem(400, 'passkey_verification_failed') }],
    ['the browser has no WebAuthn JSON helpers', () => undefined, {}],
    ['the ceremony returns no public-key credential', () => stubWebAuthn(() => Promise.resolve(null)), {}],
    ['the server cannot give options (rate limit)', () => stubWebAuthn(), { [OPTIONS_ROUTE]: () => problem(429, 'rate_limited') }],
  ])('EVM-016 AC4 %s: one error with an exit, W-03 stays, a new attempt is possible', async (_name, setup, overrides) => {
    setup();
    const api = enrollmentApi(overrides);
    const { history } = await renderPanel('/mfa-setup', api);
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj klucz dostępu' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nie udało się dodać klucza dostępu. Spróbuj ponownie.');
    expect(history.location.pathname).toBe('/mfa-setup');
    expect(screen.getByRole('button', { name: 'Dodaj klucz dostępu' })).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-016 AC4 the toast can be closed; the key is registered even when the new session cannot be read at once', async () => {
    stubWebAuthn();
    let registered = false;
    const api = enrollmentApi({
      [SESSION_ROUTE]: () => (registered ? json(200, ACTIVE_SESSION) : json(200, ENROLLMENT_SESSION)),
      [REGISTER_ROUTE]: () => {
        registered = true;
        api.set(SESSION_ROUTE, () => problem(500, 'internal_error'));
        return json(201, PASSKEY);
      },
    });
    const { history } = await renderPanel('/mfa-setup', api);
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj klucz dostępu' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/work-orders');
    });
    const toast = await screen.findByText('Drugi krok logowania jest skonfigurowany.');
    await userEvent.click(screen.getByRole('button', { name: 'Zamknij powiadomienie' }));
    expect(toast.isConnected).toBe(false);
    // The gate then reports the failed read of the session instead of guessing.
    expect(await screen.findByRole('heading', { level: 1, name: 'Coś poszło nie tak' })).toBeTruthy();
  });

  it('EVM-016 AC4 an active session does not stay on W-03: the address leads to the panel', async () => {
    const { history } = await renderPanel('/mfa-setup');
    expect(history.location.pathname).toBe('/work-orders');
    expect(screen.queryByRole('button', { name: 'Dodaj klucz dostępu' })).toBeNull();
  });
});

describe('W-03 offline (EVM-016 AC4; flows/01, § 4.10)', () => {
  it('EVM-016 AC4 offline: the banner, the key and logout are unavailable with the reason, back online they work again', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const api = enrollmentApi();
    await renderPanel('/mfa-setup', api);
    expect(
      screen.getByText('Brak połączenia. Dodanie klucza dostępu wymaga połączenia z internetem.').closest('[role="status"]'),
    ).not.toBeNull();
    expect(screen.getByText('Dodasz klucz po powrocie połączenia.')).toBeTruthy();
    const add = screen.getByRole('button', { name: 'Dodaj klucz dostępu' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Wyloguj' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(add);
    await userEvent.click(screen.getByRole('button', { name: 'Wyloguj' }));
    expect(api.requests.map((request) => request.path)).toEqual(['/api/v1/auth/session']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    onLine.mockReturnValue(true);
    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText('Dodasz klucz po powrocie połączenia.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Dodaj klucz dostępu' }).getAttribute('aria-disabled')).not.toBe('true');
  });
});

describe('W-03 Wyloguj (EVM-016 AC6; SR-SESS-05)', () => {
  it('EVM-016 AC6 "Wyloguj" on W-03 ends the session with the CSRF header and leaves for the login page', async () => {
    const api = enrollmentApi();
    const { history } = await renderPanel('/mfa-setup', api);
    await userEvent.click(screen.getByRole('button', { name: 'Wyloguj' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Logowanie nie jest jeszcze dostępne' })).toBeTruthy();
    expect(history.location.pathname).toBe('/login');
    expect(api.calls(LOGOUT_ROUTE)[0]?.headers.get('X-CSRF-Token')).toBe('csrf-enrollment');
  });

  it('EVM-016 AC6 when logging out fails the tab stays on W-03 and says so', async () => {
    const api = enrollmentApi({ [LOGOUT_ROUTE]: () => problem(500, 'internal_error') });
    const { history } = await renderPanel('/mfa-setup', api);
    await userEvent.click(screen.getByRole('button', { name: 'Wyloguj' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się wylogować. Spróbuj ponownie.');
    expect(history.location.pathname).toBe('/mfa-setup');
  });
});
