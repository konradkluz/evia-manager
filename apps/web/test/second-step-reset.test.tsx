import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLoginFlow, setLoginFlow } from '../src/session/login-flow.ts';
import { axeViolations } from './a11y.ts';
import { createFakeApi, problem, SESSION_ROUTE } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';

const OPTIONS_ROUTE = 'POST /api/v1/auth/login/passkey/options';
const LOGIN_TOKEN = 'L'.repeat(43);
const CHANGED = 'Hasło zostało zmienione. Zakończyliśmy wszystkie sesje tego konta. Potwierdź logowanie drugim krokiem.';

function api(routes: Parameters<typeof createFakeApi>[0] = {}) {
  return createFakeApi({ [SESSION_ROUTE]: () => problem(401, 'unauthenticated'), ...routes });
}

afterEach(() => {
  vi.restoreAllMocks();
  setLoginFlow(null);
});

describe('W-02 after a password reset (EVM-025 AC4; flows/01 "Po resecie hasła")', () => {
  it('EVM-025 AC4 the success message comes from the memory of the tab, is a polite status with an icon and the heading has the focus', async () => {
    setLoginFlow({ loginToken: LOGIN_TOKEN, returnTo: '/work-orders', passwordChanged: true });
    await renderPanel('/login/second-step', api(), { heading: false });
    const title = await screen.findByRole('heading', { level: 1, name: 'Potwierdź logowanie' });
    expect(screen.getByText(CHANGED).closest('[role="status"]')).toBeTruthy();
    expect(document.activeElement).toBe(title);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-025 AC4 a plain login has no such message and the focus starts on the key button', async () => {
    setLoginFlow({ loginToken: LOGIN_TOKEN, returnTo: '/work-orders' });
    await renderPanel('/login/second-step', api(), { heading: false });
    const button = await screen.findByRole('button', { name: 'Użyj klucza dostępu' });
    expect(screen.queryByText(CHANGED)).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('EVM-025 AC4 a message put in the address (query or fragment) never shows: only the state in memory does (CWE-451)', async () => {
    await renderPanel(`/login/second-step?message=${encodeURIComponent(CHANGED)}#${encodeURIComponent(CHANGED)}`, api(), {
      heading: false,
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeTruthy();
    expect(screen.queryByText(CHANGED)).toBeNull();
  });

  it('EVM-025 AC4 a refresh (no memory) leads to W-01 without the message', async () => {
    const { history } = await renderPanel('/login/second-step', api(), { heading: false });
    await screen.findByRole('heading', { level: 1, name: 'Zaloguj się' });
    expect(history.location.pathname).toBe('/login');
    expect(screen.queryByText(CHANGED)).toBeNull();
  });

  it('EVM-025 AC4 the second step that took too long says the new password already works and leads back to W-01', async () => {
    setLoginFlow({ loginToken: LOGIN_TOKEN, returnTo: '/work-orders', passwordChanged: true });
    const { history } = await renderPanel('/login/second-step', api({ [OPTIONS_ROUTE]: () => problem(401, 'login_expired') }), {
      heading: false,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Logowanie trwało zbyt długo. Zaloguj się ponownie — nowe hasło już działa.',
    );
    expect(screen.queryByText(CHANGED)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Wróć do logowania' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeTruthy();
    expect(history.location.pathname).toBe('/login');
    expect(getLoginFlow()).toBeNull();
  });

  it('EVM-025 AC4 the ordinary expiry keeps its own text', async () => {
    setLoginFlow({ loginToken: LOGIN_TOKEN, returnTo: '/work-orders' });
    await renderPanel('/login/second-step', api({ [OPTIONS_ROUTE]: () => problem(401, 'login_expired') }), { heading: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Logowanie trwało zbyt długo. Zaloguj się ponownie.');
  });
});
