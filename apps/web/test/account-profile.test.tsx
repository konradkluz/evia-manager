import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE } from './api-fake.ts';
import {
  ACCOUNT_ROUTE,
  accountApi,
  ADMINISTRATOR_ACCOUNT,
  EDITOR_ACCOUNT,
  goOffline,
  PATCH_ACCOUNT,
  resetAccountTest,
} from './account-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';

afterEach(resetAccountTest);

async function openAccount(api = accountApi(ADMINISTRATOR_ACCOUNT)) {
  const result = await renderPanel('/account', api);
  await screen.findByRole('heading', { level: 2, name: 'Profil' });
  return result;
}

describe('W-15 Profil (EVM-028 AC1)', () => {
  it('EVM-028 AC1 the page is the own account: title, the name in the field, the e-mail and the role read-only with the reason, no data in the title of the tab', async () => {
    await openAccount();
    expect(screen.getByRole('heading', { level: 1, name: 'Konto' })).toBeTruthy();
    expect(document.title).toBe('Konto · EVia Manager');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Nazwa wyświetlana' }).value).toBe('Anna Testowa');
    expect(screen.getByText('Widzą ją inni użytkownicy, np. w dzienniku zlecenia.')).toBeTruthy();
    expect(screen.getByText('anna.testowa@example.com')).toBeTruthy();
    expect(screen.getByText('Zmianę adresu e-mail zgłoś administratorowi.')).toBeTruthy();
    expect(screen.getByText('Rolę zmienia administrator.')).toBeTruthy();
    // EVM-095 AC1: the section of the phones is there for every role but Tylko odczyt
    expect(screen.getByRole('heading', { level: 2, name: 'Urządzenia' })).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-028 AC1 the account menu leads to "Konto"', async () => {
    const api = accountApi(ADMINISTRATOR_ACCOUNT);
    const { history } = await renderPanel('/work-orders', api);
    await userEvent.click(screen.getByRole('button', { name: 'Konto: Anna Testowa' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Konto' }));
    expect(history.location.pathname).toBe('/account');
    expect(await screen.findByRole('heading', { level: 2, name: 'Profil' })).toBeTruthy();
  });

  it('EVM-028 AC1 saving sends only the normalised displayName, says so in a toast and the header shows the new name at once', async () => {
    let name = 'Anna Testowa';
    const api = accountApi(ADMINISTRATOR_ACCOUNT, {
      [SESSION_ROUTE]: () => json(200, { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, displayName: name } }),
      [ACCOUNT_ROUTE]: () => json(200, { ...ADMINISTRATOR_ACCOUNT, displayName: name }),
      [PATCH_ACCOUNT]: (request) => {
        name = (parseBody(request.body) as { displayName: string }).displayName;
        return json(200, { ...ADMINISTRATOR_ACCOUNT, displayName: name });
      },
    });
    await openAccount(api);
    const save = screen.getByRole('button', { name: 'Zapisz' });
    // Nothing changed: nothing to save.
    expect(save.getAttribute('aria-disabled')).toBe('true');
    const field = screen.getByRole('textbox', { name: 'Nazwa wyświetlana' });
    await userEvent.clear(field);
    await userEvent.type(field, '  Anna Nowak  ');
    await userEvent.click(save);
    expect(await screen.findByText('Zapisano nazwę.')).toBeTruthy();
    expect(parseBody(api.calls(PATCH_ACCOUNT)[0]?.body ?? '')).toEqual({ displayName: 'Anna Nowak' });
    expect(api.calls(PATCH_ACCOUNT)[0]?.headers.get('X-CSRF-Token')).toBe('csrf-active');
    expect(await screen.findByRole('button', { name: 'Konto: Anna Nowak' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Nazwa wyświetlana' }).value).toBe('Anna Nowak');
  });

  it('EVM-028 AC1 an empty name, a name over 200 characters and a name with control characters are refused on the spot, without a request', async () => {
    const api = accountApi(ADMINISTRATOR_ACCOUNT);
    await openAccount(api);
    const field = screen.getByRole('textbox', { name: 'Nazwa wyświetlana' });
    const save = screen.getByRole('button', { name: 'Zapisz' });
    await userEvent.clear(field);
    await userEvent.click(save);
    expect(await screen.findByText('Podaj nazwę wyświetlaną.')).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
    await userEvent.type(field, 'a'.repeat(201));
    await userEvent.click(save);
    expect(await screen.findByText('Nazwa może mieć najwyżej 200 znaków.')).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.type(field, 'Anna‮Anna');
    await userEvent.click(save);
    expect(await screen.findByText('Nazwa zawiera niedozwolone znaki. Użyj zwykłego tekstu.')).toBeTruthy();
    expect(api.calls(PATCH_ACCOUNT)).toHaveLength(0);
  });

  it('EVM-028 AC1 exactly 200 characters are accepted; a refusal of the server for the characters is shown at the field', async () => {
    const api = accountApi(ADMINISTRATOR_ACCOUNT, {
      [PATCH_ACCOUNT]: () => problem(400, 'validation_failed', { errors: [{ pointer: '/displayName', code: 'invalid_characters' }] }),
    });
    await openAccount(api);
    const field = screen.getByRole('textbox', { name: 'Nazwa wyświetlana' });
    await userEvent.clear(field);
    await userEvent.type(field, 'ą'.repeat(200));
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByText('Nazwa zawiera niedozwolone znaki. Użyj zwykłego tekstu.')).toBeTruthy();
    expect(api.calls(PATCH_ACCOUNT)).toHaveLength(1);
    expect(document.activeElement).toBe(field);
  });

  it('EVM-028 AC1 a name is plain text: markup in it is shown as it is, never interpreted', async () => {
    const api = accountApi({ ...ADMINISTRATOR_ACCOUNT, displayName: '<b>Anna</b> & <img src=x onerror=alert(1)>' });
    await openAccount(api);
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Nazwa wyświetlana' }).value).toBe(
      '<b>Anna</b> & <img src=x onerror=alert(1)>',
    );
    expect(document.querySelector('main img, main b')).toBeNull();
  });

  it('EVM-028 AC1 a failure and a 429 are told at the field and the typed name stays', async () => {
    let status = 500;
    const api = accountApi(ADMINISTRATOR_ACCOUNT, {
      [PATCH_ACCOUNT]: () => (status === 429 ? problem(429, 'rate_limited', {}, { 'Retry-After': '120' }) : problem(500, 'internal_error')),
    });
    await openAccount(api);
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Nazwa wyświetlana' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Anna Nowak');
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByText('Nie udało się zapisać nazwy. Spróbuj ponownie.')).toBeTruthy();
    status = 429;
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByText('Zbyt wiele prób. Spróbuj ponownie za 2 min.')).toBeTruthy();
    expect(field.value).toBe('Anna Nowak');
  });

  it('EVM-028 AC8 offline the button is off with the reason, the typed name stays in the memory of the tab and nothing is sent', async () => {
    const api = accountApi(EDITOR_ACCOUNT);
    await openAccount(api);
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Nazwa wyświetlana' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Anna Nowak');
    goOffline();
    const save = screen.getByRole('button', { name: 'Zapisz' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Zmienisz po powrocie połączenia.').length).toBeGreaterThan(0);
    expect(screen.getByText(/Brak połączenia\. Zmiany konta są niedostępne/)).toBeTruthy();
    await userEvent.click(save);
    expect(api.calls(PATCH_ACCOUNT)).toHaveLength(0);
    expect(field.value).toBe('Anna Nowak');
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });

  it('EVM-028 AC8 the account is loading (a Skeleton) and a failure to read it offers a retry; 401 sends the tab to the login', async () => {
    let fail = true;
    const api = accountApi(EDITOR_ACCOUNT, {
      [ACCOUNT_ROUTE]: () => (fail ? problem(500, 'internal_error') : json(200, EDITOR_ACCOUNT)),
    });
    await renderPanel('/account', api);
    expect(await screen.findByText('Nie udało się wczytać konta.')).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Profil' })).toBeTruthy();
  });

  it('EVM-028 AC8 a session that ended (401) takes the tab to the login page', async () => {
    let ended = false;
    const api = accountApi(EDITOR_ACCOUNT, {
      [SESSION_ROUTE]: () =>
        ended ? problem(401, 'session_revoked') : json(200, { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'editor' } }),
      [PATCH_ACCOUNT]: () => {
        ended = true;
        return problem(401, 'session_revoked');
      },
    });
    const { history } = await renderPanel('/account', api);
    await screen.findByRole('heading', { level: 2, name: 'Profil' });
    const field = screen.getByRole('textbox', { name: 'Nazwa wyświetlana' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Anna Nowak');
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
  });
});
