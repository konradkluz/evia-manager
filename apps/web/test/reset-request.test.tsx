import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLoginFlow } from '../src/session/login-flow.ts';
import { axeViolations } from './a11y.ts';
import { createFakeApi, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import { setupUser, userEvent } from './user.ts';

const REQUEST = 'POST /api/v1/auth/password-reset/request';
const SENT = 'Jeśli konto o tym adresie istnieje, wyślemy na nie link do ustawienia nowego hasła. Link jest ważny 30 minut.';
const EMAIL = 'anna.testowa@example.com';

function requestApi(routes: Record<string, Handler> = {}) {
  return createFakeApi({
    [SESSION_ROUTE]: () => problem(401, 'unauthenticated'),
    [REQUEST]: () => json(202, {}),
    ...routes,
  });
}

async function openForm(api = requestApi()) {
  const view = await renderPanel('/login/reset', api, { heading: false });
  await screen.findByRole('heading', { level: 1, name: 'Zresetuj hasło' });
  return view;
}

async function send(address = EMAIL) {
  const user = setupUser();
  await user.type(screen.getByLabelText('E-mail'), address);
  await user.click(screen.getByRole('button', { name: 'Wyślij link' }));
  return user;
}

afterEach(() => {
  vi.restoreAllMocks();
  setLoginFlow(null);
});

describe('W-01 "Zresetuj hasło": the request for a link (EVM-025 AC1; flows/01)', () => {
  it('EVM-025 AC1 W-01 offers "Nie pamiętasz hasła?" that opens the reset form in the card; the field is empty and in focus', async () => {
    const api = requestApi();
    const { history } = await renderPanel('/login', api, { heading: false });
    await userEvent.click(await screen.findByRole('link', { name: 'Nie pamiętasz hasła?' }));
    await screen.findByRole('heading', { level: 1, name: 'Zresetuj hasło' });
    expect(history.location.pathname).toBe('/login/reset');
    const field = screen.getByLabelText<HTMLInputElement>('E-mail');
    expect(field.value).toBe('');
    expect(field.getAttribute('autocomplete')).toBe('username');
    expect(document.activeElement).toBe(field);
    expect(document.title).toBe('Zresetuj hasło · EVia Manager');
    expect(screen.getByRole('navigation', { name: 'Prywatność i pomoc' })).toBeTruthy();
    expect(api.calls(REQUEST)).toHaveLength(0);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-025 AC1 sending: the address goes only in the POST body; the same message appears, gets the focus, and the e-mail stays', async () => {
    const api = requestApi();
    await openForm(api);
    await send();
    const message = await screen.findByText(SENT);
    expect(document.activeElement).toBe(message.closest('div[tabindex="-1"]'));
    expect(screen.getByLabelText<HTMLInputElement>('E-mail').value).toBe(EMAIL);
    const [call] = api.calls(REQUEST);
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/api/v1/auth/password-reset/request');
    expect(call?.path).not.toContain(EMAIL);
    expect(call?.query.size).toBe(0);
    expect(parseBody(call?.body ?? '')).toEqual({ email: EMAIL });
    expect(globalThis.location.href).not.toContain(EMAIL);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-025 AC1 the page is identical whatever the address: an existing, an unknown, a deactivated account all end on the same text', async () => {
    const pages: string[] = [];
    for (const address of ['istnieje@example.com', 'nie.ma@example.com', 'dezaktywowane@example.com']) {
      const { unmount, container } = await openForm();
      const user = setupUser();
      await user.type(screen.getByLabelText('E-mail'), 'x@example.com');
      await user.clear(screen.getByLabelText('E-mail'));
      await user.type(screen.getByLabelText('E-mail'), address);
      await user.click(screen.getByRole('button', { name: 'Wyślij link' }));
      await screen.findByText(SENT);
      pages.push(container.textContent);
      unmount();
    }
    expect(new Set(pages).size).toBe(1);
  });

  it('EVM-025 AC1 an empty field gets the message under the field and sends nothing', async () => {
    const api = requestApi();
    await openForm(api);
    await userEvent.click(screen.getByRole('button', { name: 'Wyślij link' }));
    expect(screen.getByRole('alert').textContent).toBe('Wpisz poprawny adres e-mail.');
    expect(screen.getByLabelText('E-mail').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('E-mail'));
    expect(api.calls(REQUEST)).toHaveLength(0);
    expect(screen.queryByText(SENT)).toBeNull();
  });

  it('EVM-025 AC1 a shape the server refuses (400 validation_failed) is the one message under the field, never about the account', async () => {
    const api = requestApi({ [REQUEST]: () => problem(400, 'validation_failed', { errors: [{ pointer: '/email', code: 'invalid' }] }) });
    await openForm(api);
    await send('to nie jest adres');
    expect((await screen.findByRole('alert')).textContent).toBe('Wpisz poprawny adres e-mail.');
    expect(screen.queryByText(SENT)).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('E-mail').value).toBe('to nie jest adres');
  });

  it('EVM-025 AC1 while the request runs the button is busy; a second send replaces the message', async () => {
    let release: (response: Response) => void = () => undefined;
    const api = requestApi({ [REQUEST]: () => new Promise<Response>((resolve) => (release = resolve)) });
    await openForm(api);
    await send();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Wyślij link' }).getAttribute('aria-busy')).toBe('true');
    });
    expect(screen.getByLabelText<HTMLInputElement>('E-mail').value).toBe(EMAIL);
    release(json(202, {}));
    await screen.findByText(SENT);
  });

  it('EVM-025 AC6 too many requests: the same message for every address, the time from Retry-After, the e-mail stays', async () => {
    const texts: string[] = [];
    for (const address of ['istnieje@example.com', 'nie.ma@example.com']) {
      const api = requestApi({ [REQUEST]: () => problem(429, 'rate_limited', {}, { 'Retry-After': '90' }) });
      const { unmount } = await openForm(api);
      await send(address);
      const alert = await screen.findByRole('alert');
      texts.push(alert.textContent.replace(address, ''));
      expect(screen.getByLabelText<HTMLInputElement>('E-mail').value).toBe(address);
      unmount();
    }
    expect(texts).toEqual(['Zbyt wiele prób. Spróbuj ponownie za 2 min.', 'Zbyt wiele prób. Spróbuj ponownie za 2 min.']);
  });

  it('EVM-025 AC7 a server error shows the help code, a lost connection says so; the e-mail stays', async () => {
    const api = requestApi({ [REQUEST]: () => problem(500, 'internal_error') });
    await openForm(api);
    await send();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nie udało się wysłać prośby.');
    expect(alert.textContent).toContain('(kod: abcdef01)');
    expect(document.activeElement).toBe(alert);
    api.set(REQUEST, () => {
      throw new TypeError('Failed to fetch');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Wyślij link' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Nie udało się połączyć z serwerem.');
    });
    expect(screen.getByLabelText<HTMLInputElement>('E-mail').value).toBe(EMAIL);
  });

  it('EVM-025 AC7 a request rejected for the origin names the supported address', async () => {
    const api = requestApi({ [REQUEST]: () => problem(403, 'csrf_failed') });
    await openForm(api);
    await send();
    expect((await screen.findByRole('alert')).textContent).toContain('nieobsługiwanym adresem');
  });

  it('EVM-025 AC7 offline: the banner, the button unavailable with its hint, the typed e-mail stays and no request is sent', async () => {
    let online = true;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    const api = requestApi();
    await openForm(api);
    const user = setupUser();
    await user.type(screen.getByLabelText('E-mail'), EMAIL);
    act(() => {
      online = false;
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(await screen.findByText('Brak połączenia. Wysłanie linku wymaga połączenia z internetem.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wyślij link' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Wyślesz link po powrocie połączenia.')).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(api.calls(REQUEST)).toHaveLength(0);
    expect(screen.getByLabelText<HTMLInputElement>('E-mail').value).toBe(EMAIL);
  });

  it('EVM-025 AC1 "Wróć do logowania" opens W-01 with an empty form (the typed address does not travel)', async () => {
    const { history } = await openForm();
    await userEvent.type(screen.getByLabelText('E-mail'), EMAIL);
    await userEvent.click(screen.getByRole('button', { name: 'Wróć do logowania' }));
    await screen.findByRole('heading', { level: 1, name: 'Zaloguj się' });
    expect(history.location.pathname).toBe('/login');
    expect(screen.getByLabelText<HTMLInputElement>('E-mail').value).toBe('');
  });

  it('EVM-025 AC1 the reset form is reachable without a session: it does not even read one', async () => {
    const api = requestApi();
    await openForm(api);
    expect(api.calls(SESSION_ROUTE)).toHaveLength(0);
  });
});
