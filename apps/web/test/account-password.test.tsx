import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE } from './api-fake.ts';
import {
  accountApi,
  ADMINISTRATOR_ACCOUNT,
  ASSERTION,
  ASSERTION_OPTIONS,
  CHANGE_PASSWORD,
  EDITOR_ACCOUNT,
  END_OTHERS,
  goOffline,
  REAUTH,
  resetAccountTest,
  STEP_UP_OPTIONS,
  stubWebAuthn,
} from './account-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';

afterEach(resetAccountTest);

const NEW_PASSWORD = 'zupełnie nowe hasło do konta';
const CURRENT = 'obecne hasło do konta';

async function openForm(api = accountApi(EDITOR_ACCOUNT)) {
  const result = await renderPanel('/account', api);
  await screen.findByRole('heading', { level: 2, name: 'Hasło' });
  await userEvent.click(screen.getByRole('button', { name: 'Zmień hasło' }));
  return result;
}

async function fill(current = CURRENT, fresh = NEW_PASSWORD) {
  await userEvent.type(screen.getByLabelText('Bieżące hasło'), current);
  await userEvent.type(screen.getByLabelText('Nowe hasło'), fresh);
}

/** A password change that the server first answers with "re-authenticate" and then accepts (the mark is one-time). */
function changeApi(others = 2, extra: Parameters<typeof accountApi>[1] = {}) {
  let marked = false;
  return accountApi(EDITOR_ACCOUNT, {
    [REAUTH]: () => {
      marked = true;
      return new Response(null, { status: 204 });
    },
    [CHANGE_PASSWORD]: () => {
      if (!marked) return problem(403, 'reauthentication_required');
      marked = false;
      return json(200, { otherActiveSessions: others });
    },
    ...extra,
  });
}

describe('W-15 Hasło (EVM-028 AC2)', () => {
  it('EVM-028 AC2 "Zmień hasło" opens the form in its own place (the button leaves), the focus is on "Bieżące hasło", the e-mail is read-only for the password manager', async () => {
    await openForm();
    expect(screen.queryByRole('button', { name: 'Zmień hasło' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Bieżące hasło'));
    const email = screen.getByLabelText<HTMLInputElement>('E-mail', { selector: 'input[autocomplete="username"]' });
    expect(email.readOnly).toBe(true);
    expect(email.value).toBe('anna.testowa@example.com');
    expect(screen.getByLabelText('Bieżące hasło').getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByLabelText('Nowe hasło').getAttribute('autocomplete')).toBe('new-password');
    expect(
      screen.getByText(/Co najmniej 15 znaków — może to być zdanie ze spacjami\. Potem potwierdzisz zmianę drugim krokiem\./),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zapisz nowe hasło' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Anuluj' })).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-028 AC2 "Anuluj" closes the form, clears both passwords and gives the focus back to "Zmień hasło"', async () => {
    await openForm();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    const open = screen.getByRole('button', { name: 'Zmień hasło' });
    expect(document.activeElement).toBe(open);
    await userEvent.click(open);
    expect(screen.getByLabelText<HTMLInputElement>('Bieżące hasło').value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>('Nowe hasło').value).toBe('');
  });

  it('EVM-028 AC2 a missing current password and a new one under 15 characters are refused on the spot, without a request', async () => {
    const api = changeApi();
    await openForm(api);
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz nowe hasło' }));
    expect(await screen.findByText('Podaj bieżące hasło.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Bieżące hasło'));
    await userEvent.type(screen.getByLabelText('Bieżące hasło'), CURRENT);
    await userEvent.type(screen.getByLabelText('Nowe hasło'), 'krótkie');
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz nowe hasło' }));
    expect(await screen.findByText('Hasło musi mieć co najmniej 15 znaków.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Nowe hasło'));
    expect(api.calls(CHANGE_PASSWORD)).toHaveLength(0);
  });

  it('EVM-028 AC2 the password is changed after the second step only: W-04 asks for the second step without the password, the request is sent again, the notice counts the other sessions and offers to end them', async () => {
    const api = changeApi(2, { 'DELETE /api/v1/account/sessions': () => json(200, { ended: 2 }) });
    await openForm(api);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz nowe hasło' }));
    const dialog = await screen.findByRole('dialog', { name: 'Potwierdź tożsamość, aby zmienić hasło' });
    // Only the second step: no password field, no "Krok 1 z 2", no recovery code.
    expect(within(dialog).queryByLabelText('Hasło')).toBeNull();
    expect(within(dialog).queryByText(/Krok \d z 2/)).toBeNull();
    expect(within(dialog).queryByText(/kod odzyskiwania/i)).toBeNull();
    expect(within(dialog).getByText('Zmiana hasła wymaga potwierdzenia drugim krokiem.')).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123 456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
    const notice = await screen.findByText(
      'Hasło zostało zmienione. Wysłaliśmy e-mail z informacją. Konto ma jeszcze 2 inne aktywne sesje.',
    );
    expect(notice.closest('[role="status"]')).toBeTruthy();
    expect(parseBody(api.calls(REAUTH)[0]?.body ?? '')).toEqual({ purpose: 'password_change', method: 'totp', code: '123456' });
    const sent = api.calls(CHANGE_PASSWORD);
    expect(sent).toHaveLength(2);
    expect(parseBody(sent[1]?.body ?? '')).toEqual({ currentPassword: CURRENT, newPassword: NEW_PASSWORD });
    // The form is closed and empty; the focus is on the notice; "Zmień hasło" is back.
    expect(screen.queryByLabelText('Bieżące hasło')).toBeNull();
    expect(document.activeElement).toBe(notice.closest('[role="status"]'));
    expect(screen.getByRole('button', { name: 'Zmień hasło' })).toBeTruthy();
    // The password is nowhere in the page or its storage.
    expect(document.body.innerHTML).not.toContain(NEW_PASSWORD);
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
    // "Zakończ pozostałe sesje" ends the others and says so.
    await userEvent.click(screen.getAllByRole('button', { name: 'Zakończ pozostałe sesje' })[0] as HTMLElement);
    expect(await screen.findByText('Zakończono 2 sesje.')).toBeTruthy();
    expect(api.calls(END_OTHERS)).toHaveLength(1);
  });

  it('EVM-028 AC2 an account without other sessions gets the short notice and no "Zakończ pozostałe sesje"', async () => {
    const api = changeApi(0);
    await openForm(api);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz nowe hasło' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
    expect(await screen.findByText('Hasło zostało zmienione. Wysłaliśmy e-mail z informacją.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Zakończ pozostałe sesje' })).toBeNull();
  });

  it('EVM-028 AC2 an Administrator confirms the change with the passkey only', async () => {
    stubWebAuthn();
    let marked = false;
    const api = accountApi(ADMINISTRATOR_ACCOUNT, {
      [STEP_UP_OPTIONS]: () => json(200, ASSERTION_OPTIONS),
      [REAUTH]: () => {
        marked = true;
        return new Response(null, { status: 204 });
      },
      [CHANGE_PASSWORD]: () => (marked ? json(200, { otherActiveSessions: 1 }) : problem(403, 'reauthentication_required')),
    });
    await openForm(api);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz nowe hasło' }));
    const dialog = await screen.findByRole('dialog', { name: 'Potwierdź tożsamość, aby zmienić hasło' });
    expect(within(dialog).queryByLabelText('Kod z aplikacji uwierzytelniającej')).toBeNull();
    expect(
      within(dialog).getByText('Nie masz klucza dostępu? Poproś innego administratora o reset drugiego kroku logowania.'),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(await screen.findByText(/Konto ma jeszcze 1 inną aktywną sesję\./)).toBeTruthy();
    expect(parseBody(api.calls(REAUTH)[0]?.body ?? '')).toEqual({ purpose: 'password_change', credential: ASSERTION });
  });

  it('EVM-028 AC2 a wrong current password is told at the field, cleared and focused; the second step is not asked', async () => {
    const api = changeApi(2, { [CHANGE_PASSWORD]: () => problem(401, 'invalid_credentials') });
    await openForm(api);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz nowe hasło' }));
    expect(await screen.findByText('Bieżące hasło jest nieprawidłowe.')).toBeTruthy();
    const field = screen.getByLabelText<HTMLInputElement>('Bieżące hasło');
    expect(field.value).toBe('');
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // The tab stays: a refused current password is not a lost session.
    expect(screen.getByLabelText('Nowe hasło')).toBeTruthy();
  });

  it.each([
    ['too_weak', 'To hasło jest zbyt łatwe do odgadnięcia albo pojawiło się w wycieku danych. Wybierz inne — np. zdanie z kilku słów.'],
    ['too_short', 'Hasło musi mieć co najmniej 15 znaków.'],
    ['same_as_current', 'Nowe hasło musi się różnić od bieżącego.'],
  ])('EVM-028 AC2 the rule of the server for the new password (%s) is told at the field before the second step', async (code, text) => {
    const api = changeApi(2, {
      [CHANGE_PASSWORD]: () => problem(400, 'validation_failed', { errors: [{ pointer: '/newPassword', code }] }),
    });
    await openForm(api);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz nowe hasło' }));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls(REAUTH)).toHaveLength(0);
    expect(screen.getByLabelText<HTMLInputElement>('Nowe hasło').value).toBe('');
  });

  it('EVM-028 AC2 "Anuluj" in W-04 keeps the form and its data and gives the focus to "Zapisz nowe hasło"; nothing is sent again', async () => {
    const api = changeApi();
    await openForm(api);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz nowe hasło' }));
    const dialog = await screen.findByRole('dialog', { name: 'Potwierdź tożsamość, aby zmienić hasło' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByLabelText<HTMLInputElement>('Bieżące hasło').value).toBe(CURRENT);
    expect(screen.getByLabelText<HTMLInputElement>('Nowe hasło').value).toBe(NEW_PASSWORD);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zapisz nowe hasło' }));
    });
    expect(api.calls(CHANGE_PASSWORD)).toHaveLength(1);
    expect(api.calls(REAUTH)).toHaveLength(0);
  });

  it('EVM-028 AC2 a lock after too many tries (429) is told with the time and the tab goes to the login with the notice once the server ended the session', async () => {
    let ended = false;
    const api = changeApi(2, {
      [SESSION_ROUTE]: () =>
        ended ? problem(401, 'session_revoked') : json(200, { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'editor' } }),
      [CHANGE_PASSWORD]: () => {
        ended = true;
        return problem(429, 'rate_limited', {}, { 'Retry-After': '900' });
      },
    });
    const { history } = await openForm(api);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz nowe hasło' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(
      await screen.findByText('Zbyt wiele prób potwierdzenia tożsamości. Ze względów bezpieczeństwa zakończyliśmy sesję.'),
    ).toBeTruthy();
  });

  it('EVM-028 AC2 a 429 that does not end the session (the limit per minute) is told at the form with the time', async () => {
    const api = changeApi(2, { [CHANGE_PASSWORD]: () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }) });
    await openForm(api);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz nowe hasło' }));
    expect(await screen.findByText('Zbyt wiele prób. Spróbuj ponownie za 1 min.')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Bieżące hasło').value).toBe(CURRENT);
  });

  it('EVM-028 AC8 offline "Zmień hasło" is off with the reason; an open form keeps its data and "Zapisz nowe hasło" is off', async () => {
    await openForm();
    await fill();
    goOffline();
    expect(screen.getByRole('button', { name: 'Zapisz nowe hasło' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByLabelText<HTMLInputElement>('Nowe hasło').value).toBe(NEW_PASSWORD);
  });

  it('EVM-028 AC8 offline "Zmień hasło" cannot be opened and says why', async () => {
    const api = accountApi(EDITOR_ACCOUNT);
    await renderPanel('/account', api);
    await screen.findByRole('heading', { level: 2, name: 'Hasło' });
    goOffline();
    expect(screen.getByRole('button', { name: 'Zmień hasło' }).getAttribute('aria-disabled')).toBe('true');
  });
});
