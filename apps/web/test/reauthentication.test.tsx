import type { CurrentSession, ReauthenticationPurpose } from '@evia/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiProvider } from '../src/api/api-context.tsx';
import { createApiClient } from '../src/api/client.ts';
import { createQueryClient } from '../src/app.tsx';
import { createI18n } from '../src/i18n/i18n.ts';
import { getLoginNotice, setLoginNotice } from '../src/session/login-flow.ts';
import { StepUpProvider, useReauthentication } from '../src/session/step-up-context.tsx';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, createFakeApi, json, parseBody, problem, SESSION_ROUTE } from './api-fake.ts';
import { ASSERTION, ASSERTION_OPTIONS, goOffline, REAUTH, resetAccountTest, STEP_UP_OPTIONS, stubWebAuthn } from './account-api.ts';
import { userEvent } from './user.ts';

afterEach(() => {
  setLoginNotice(null);
  resetAccountTest();
});

const TITLE = 'Potwierdź tożsamość, aby dodać klucz dostępu';
const EDITOR: CurrentSession = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'editor' } };
const REJECTED = 'Nie udało się potwierdzić tożsamości. Sprawdź hasło i drugi krok, a potem spróbuj ponownie.';

function Trigger({ purpose, email }: { readonly purpose: ReauthenticationPurpose; readonly email?: string }) {
  const request = useReauthentication();
  const [result, setResult] = useState('none');
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void request({ purpose, title: TITLE, ...(email === undefined ? {} : { email }) }).then((confirmed) => {
            setResult(confirmed ? 'confirmed' : 'cancelled');
          });
        }}
      >
        Otwórz
      </button>
      <p data-testid="result">{result}</p>
    </>
  );
}

async function open(
  session: CurrentSession,
  routes: Parameters<typeof createFakeApi>[0] = {},
  purpose: ReauthenticationPurpose = 'second_step_change',
  email: string | null = 'anna.testowa@example.com',
) {
  const fake = createFakeApi({ [SESSION_ROUTE]: () => json(200, session), [REAUTH]: () => new Response(null, { status: 204 }), ...routes });
  const queryClient = createQueryClient();
  const client = createApiClient(fake.fetch);
  render(
    <I18nextProvider i18n={createI18n()}>
      <ApiProvider client={client}>
        <QueryClientProvider client={queryClient}>
          <StepUpProvider>
            <Trigger purpose={purpose} {...(email === null ? {} : { email })} />
          </StepUpProvider>
        </QueryClientProvider>
      </ApiProvider>
    </I18nextProvider>,
  );
  await queryClient.query({ queryKey: ['session'], queryFn: () => Promise.resolve(session) });
  await userEvent.click(screen.getByRole('button', { name: 'Otwórz' }));
  return { fake, dialog: await screen.findByRole('dialog', { name: TITLE }) };
}

const result = () => screen.getByTestId('result').textContent;

describe('W-04 pełne ponowne uwierzytelnienie (EVM-028 AC2, AC3, AC5)', () => {
  it('EVM-028 AC3 step 1 is the password: the e-mail read-only, no recovery code, "Dalej" and "Anuluj"; the focus is on the password', async () => {
    const { dialog } = await open(EDITOR);
    expect(within(dialog).getByText('Krok 1 z 2')).toBeTruthy();
    expect(within(dialog).getByText('Każda zmiana drugiego kroku wymaga hasła i drugiego kroku.')).toBeTruthy();
    const email = within(dialog).getByLabelText<HTMLInputElement>('E-mail');
    expect(email.readOnly).toBe(true);
    expect(email.getAttribute('autocomplete')).toBe('username');
    const password = within(dialog).getByLabelText('Hasło');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(password.getAttribute('type')).toBe('password');
    expect(document.activeElement).toBe(password);
    expect(within(dialog).queryByText(/kod odzyskiwania/i)).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Dalej' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Anuluj' })).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-028 AC3 "Dalej" without a password asks for it and sends nothing', async () => {
    const { fake, dialog } = await open(EDITOR);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
    expect(await within(dialog).findByText('Podaj hasło.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Hasło'));
    expect(fake.calls(REAUTH)).toHaveLength(0);
  });

  it('EVM-028 AC3 step 2 for an Editor: the passkey or the code of the app; the code goes with the password and the purpose in ONE request; success settles the request', async () => {
    const { fake, dialog } = await open(EDITOR);
    await userEvent.type(within(dialog).getByLabelText('Hasło'), 'obecne hasło do konta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
    expect(within(dialog).getByText('Krok 2 z 2')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Użyj klucza dostępu' })).toBeTruthy();
    expect(within(dialog).queryByLabelText('Hasło')).toBeNull();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123 456');
    expect(fake.calls(REAUTH)).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
    await waitFor(() => {
      expect(result()).toBe('confirmed');
    });
    expect(parseBody(fake.calls(REAUTH)[0]?.body ?? '')).toEqual({
      purpose: 'second_step_change',
      password: 'obecne hasło do konta',
      method: 'totp',
      code: '123456',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-028 AC3 an Administrator has the passkey only; the key is checked against the challenge of the step-up and sent with the password', async () => {
    const spies = stubWebAuthn();
    const { fake, dialog } = await open(ACTIVE_SESSION, { [STEP_UP_OPTIONS]: () => json(200, ASSERTION_OPTIONS) });
    await userEvent.type(within(dialog).getByLabelText('Hasło'), 'obecne hasło do konta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
    expect(within(dialog).queryByLabelText('Kod z aplikacji uwierzytelniającej')).toBeNull();
    expect(
      within(dialog).getByText('Nie masz klucza dostępu? Poproś innego administratora o reset drugiego kroku logowania.'),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Użyj klucza dostępu' }));
    await waitFor(() => {
      expect(result()).toBe('confirmed');
    });
    expect(spies.get).toHaveBeenCalledTimes(1);
    expect(parseBody(fake.calls(REAUTH)[0]?.body ?? '')).toEqual({
      purpose: 'second_step_change',
      password: 'obecne hasło do konta',
      credential: ASSERTION,
    });
  });

  it('EVM-028 AC3 ONE answer for a wrong password or a wrong second step: back to step 1, the password cleared and focused, no word about which factor', async () => {
    const { fake, dialog } = await open(EDITOR, { [REAUTH]: () => problem(401, 'reauthentication_failed') });
    await userEvent.type(within(dialog).getByLabelText('Hasło'), 'zle hasło');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(REJECTED);
    const password = within(dialog).getByLabelText<HTMLInputElement>('Hasło');
    expect(password.value).toBe('');
    await waitFor(() => {
      expect(document.activeElement).toBe(password);
    });
    expect(within(dialog).getByText('Krok 1 z 2')).toBeTruthy();
    expect(result()).toBe('none');
    expect(fake.calls(REAUTH)).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain('zle hasło');
  });

  it('EVM-028 AC3 a code that is not six digits is not sent (it would only use up an attempt); the field is cleared and focused', async () => {
    const { fake, dialog } = await open(EDITOR);
    await userEvent.type(within(dialog).getByLabelText('Hasło'), 'obecne hasło do konta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
    const field = within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej');
    await userEvent.type(field, '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
    expect(await within(dialog).findByText(/Kod jest nieprawidłowy lub wygasł/)).toBeTruthy();
    expect(document.activeElement).toBe(field);
    expect(fake.calls(REAUTH)).toHaveLength(0);
  });

  it('EVM-028 AC2 for a change of the password there is NO password step: only the second step, and the request has no password', async () => {
    const { fake, dialog } = await open(EDITOR, {}, 'password_change');
    expect(within(dialog).queryByLabelText('Hasło')).toBeNull();
    expect(within(dialog).queryByText(/Krok \d z 2/)).toBeNull();
    expect(within(dialog).getByText('Zmiana hasła wymaga potwierdzenia drugim krokiem.')).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
    await waitFor(() => {
      expect(result()).toBe('confirmed');
    });
    expect(parseBody(fake.calls(REAUTH)[0]?.body ?? '')).toEqual({ purpose: 'password_change', method: 'totp', code: '123456' });
  });

  it('EVM-028 AC2 a wrong second step in the change of the password stays at step 2 with the message of the code', async () => {
    const { dialog } = await open(EDITOR, { [REAUTH]: () => problem(401, 'reauthentication_failed') }, 'password_change');
    const field = within(dialog).getByLabelText<HTMLInputElement>('Kod z aplikacji uwierzytelniającej');
    await userEvent.type(field, '123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
    expect(await within(dialog).findByText('Kod jest nieprawidłowy lub wygasł. Wpisz nowy kod z aplikacji.')).toBeTruthy();
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
  });

  it('EVM-028 AC3 a cancelled ceremony of the system keeps step 2 and the password, and says the key was not used', async () => {
    stubWebAuthn({ get: () => Promise.reject(new DOMException('cancelled', 'NotAllowedError')) });
    const { fake, dialog } = await open(ACTIVE_SESSION, { [STEP_UP_OPTIONS]: () => json(200, ASSERTION_OPTIONS) });
    await userEvent.type(within(dialog).getByLabelText('Hasło'), 'obecne hasło do konta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(await within(dialog).findByText('Nie udało się użyć klucza dostępu. Spróbuj ponownie.')).toBeTruthy();
    expect(within(dialog).getByText('Krok 2 z 2')).toBeTruthy();
    expect(fake.calls(REAUTH)).toHaveLength(0);
  });

  it('EVM-028 AC3 a lock (429) is told with the time; the session the tries came from is read, and when the server ended it the login page gets its notice', async () => {
    let ended = false;
    const { dialog } = await open(EDITOR, {
      [SESSION_ROUTE]: () => (ended ? problem(401, 'session_revoked') : json(200, EDITOR)),
      [REAUTH]: () => {
        ended = true;
        return problem(429, 'rate_limited', {}, { 'Retry-After': '900' });
      },
    });
    await userEvent.type(within(dialog).getByLabelText('Hasło'), 'obecne hasło do konta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
    expect(await within(dialog).findByText('Zbyt wiele prób. Spróbuj ponownie za 15 min.')).toBeTruthy();
    await waitFor(() => {
      expect(getLoginNotice()).toBe('attempts');
    });
  });

  it('EVM-028 AC3 a 429 that leaves the session alive (the limit per minute) sets no notice for the login page', async () => {
    const { dialog } = await open(EDITOR, { [REAUTH]: () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }) });
    await userEvent.type(within(dialog).getByLabelText('Hasło'), 'obecne hasło do konta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
    expect(await within(dialog).findByText('Zbyt wiele prób. Spróbuj ponownie za 1 min.')).toBeTruthy();
    expect(getLoginNotice()).toBeNull();
  });

  it('EVM-028 AC3 a session that is gone (401 session_revoked, the fifth wrong code) closes the dialog without a confirmation', async () => {
    const { dialog } = await open(EDITOR, { [REAUTH]: () => problem(401, 'session_revoked') });
    await userEvent.type(within(dialog).getByLabelText('Hasło'), 'obecne hasło do konta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
    await waitFor(() => {
      expect(result()).toBe('cancelled');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-028 AC3 a failure of the server is told with the trace code to report; the dialog stays', async () => {
    const { dialog } = await open(EDITOR, { [REAUTH]: () => problem(500, 'internal_error') });
    await userEvent.type(within(dialog).getByLabelText('Hasło'), 'obecne hasło do konta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
    expect(await within(dialog).findByText(/Nie udało się potwierdzić tożsamości\. Spróbuj ponownie za chwilę\..*abcdef01/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('EVM-028 AC3 "Anuluj" and Escape settle the request with "no" and leave no password behind', async () => {
    const { fake, dialog } = await open(EDITOR);
    await userEvent.type(within(dialog).getByLabelText('Hasło'), 'obecne hasło do konta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(result()).toBe('cancelled');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.innerHTML).not.toContain('obecne hasło do konta');
    expect(fake.calls(REAUTH)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Otwórz' }));
    const second = await screen.findByRole('dialog', { name: TITLE });
    act(() => {
      second.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(result()).toBe('cancelled');
  });

  it('EVM-028 AC3 without the e-mail the read-only field is left out; offline the dialog says so and sends nothing', async () => {
    const { fake, dialog } = await open(EDITOR, {}, 'second_step_change', null);
    expect(within(dialog).queryByLabelText('E-mail')).toBeNull();
    await userEvent.type(within(dialog).getByLabelText('Hasło'), 'obecne hasło do konta');
    goOffline();
    expect(within(dialog).getByText('Brak połączenia. Potwierdzenie wymaga połączenia z internetem.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
    expect(within(dialog).getByText('Krok 1 z 2')).toBeTruthy();
    expect(fake.calls(REAUTH)).toHaveLength(0);
  });
});
