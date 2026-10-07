import { act, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, createFakeApi, json, problem, SESSION_ROUTE } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';

const LOGOUT_ROUTE = 'POST /api/v1/auth/logout';

async function openAccountMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Konto: Anna Testowa' }));
  return user;
}

describe('session gate (EVM-016 AC4, AC6; SR-AUTH-06)', () => {
  it('EVM-016 AC4 without a session every address leads to the login page and shows no data', async () => {
    const api = createFakeApi({ [SESSION_ROUTE]: () => problem(401, 'unauthenticated') });
    const { history } = await renderPanel('/work-orders', api);
    expect(history.location.pathname).toBe('/login');
    expect(screen.getByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText('Zlecenia')).toBeNull();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-016 AC4 an unknown address behind the gate also ends on the login page when there is no session', async () => {
    const api = createFakeApi({ [SESSION_ROUTE]: () => problem(401, 'session_revoked') });
    const { history } = await renderPanel('/nie-ma-takiej-strony', api);
    expect(history.location.pathname).toBe('/login');
  });

  it('EVM-016 AC4 while the session is read the screen shows a loading status and a skeleton, no data', async () => {
    let answer: (response: Response) => void = () => undefined;
    const api = createFakeApi({ [SESSION_ROUTE]: () => new Promise<Response>((resolve) => (answer = resolve)) });
    await renderPanel('/work-orders', api, { heading: false });
    const status = await screen.findByText('Ładowanie…');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.parentElement?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('Zlecenia')).toBeNull();
    await act(async () => {
      answer(json(200, ACTIVE_SESSION));
      await Promise.resolve();
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Zlecenia' })).toBeTruthy();
  });

  it('EVM-016 AC4 a server error while reading the session shows the error state, not the login page', async () => {
    const api = createFakeApi({ [SESSION_ROUTE]: () => problem(500, 'internal_error') });
    const { history } = await renderPanel('/work-orders', api);
    expect(screen.getByRole('heading', { level: 1, name: 'Coś poszło nie tak' })).toBeTruthy();
    expect(history.location.pathname).toBe('/work-orders');
  });
});

describe('account menu and logout (EVM-016 AC6; SR-SESS-05)', () => {
  it('EVM-016 AC6 the account menu is in the TopBar of the panel and offers "Wyloguj"', async () => {
    await renderPanel('/work-orders');
    const trigger = screen.getByRole('button', { name: 'Konto: Anna Testowa' });
    expect(trigger.textContent).toBe('Anna Testowa');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    await openAccountMenu();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Wyloguj']);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-016 AC6 "Wyloguj" by keyboard: CSRF header, then login page; the cache is dropped, so a return asks the server again', async () => {
    const api = activeSessionApi({
      [LOGOUT_ROUTE]: () => new Response(null, { status: 204, headers: { 'Clear-Site-Data': '"cache", "storage"' } }),
    });
    const { history } = await renderPanel('/work-orders', api);
    expect(api.calls(SESSION_ROUTE)).toHaveLength(1);
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Konto: Anna Testowa' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeTruthy();
    expect(history.location.pathname).toBe('/login');
    const [request] = api.calls(LOGOUT_ROUTE);
    expect(request?.headers.get('X-CSRF-Token')).toBe('csrf-active');
    expect(request?.method).toBe('POST');

    // The old cookie is dead on the server; going back must not show the old data from the tab's cache.
    api.set(SESSION_ROUTE, () => problem(401, 'session_revoked'));
    act(() => {
      history.push('/work-orders');
    });
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(api.calls(SESSION_ROUTE)).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'Zlecenia' })).toBeNull();
  });

  it('EVM-016 AC6 a session that is already gone (401 session_revoked) counts as logged out', async () => {
    const api = activeSessionApi({ [LOGOUT_ROUTE]: () => problem(401, 'session_revoked') });
    const { history } = await renderPanel('/work-orders', api);
    await openAccountMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Wyloguj' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('EVM-016 AC6 when logging out fails the panel stays and shows one error — it never pretends', async () => {
    const api = activeSessionApi({ [LOGOUT_ROUTE]: () => problem(500, 'internal_error') });
    const { history } = await renderPanel('/work-orders', api);
    await openAccountMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Wyloguj' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się wylogować. Spróbuj ponownie.');
    expect(history.location.pathname).toBe('/work-orders');
    expect(screen.getByRole('heading', { level: 2, name: 'Nie masz jeszcze zleceń.' })).toBeTruthy();
  });

  it('EVM-016 AC6 the account menu is on every screen of the panel, also on the redirect from an unknown address', async () => {
    const { history } = await renderPanel('/nie-ma-takiej-strony');
    await waitFor(() => {
      expect(history.location.pathname).toBe('/work-orders');
    });
    expect(screen.getByRole('button', { name: 'Konto: Anna Testowa' })).toBeTruthy();
  });
});
