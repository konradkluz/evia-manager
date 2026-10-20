import type { CurrentSession } from '@evia/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/api-context.tsx';
import { createQueryClient } from '../src/app.tsx';
import { createApiClient } from '../src/api/client.ts';
import { createI18n } from '../src/i18n/i18n.ts';
import { resetStepUp } from '../src/session/step-up.ts';
import { StepUpProvider, useStepUp } from '../src/session/step-up-context.tsx';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, createFakeApi, json, parseBody, problem, SESSION_ROUTE } from './api-fake.ts';
import { userEvent } from './user.ts';

const STEP_UP = 'POST /api/v1/auth/step-up';
const STEP_UP_OPTIONS = 'POST /api/v1/auth/step-up/options';
const TITLE = 'Potwierdź tożsamość, aby zmienić rolę użytkownika';
const WRONG = 'Kod jest nieprawidłowy lub wygasł. Wpisz nowy kod z aplikacji.';
const EDITOR: CurrentSession = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'editor' } };
const READ_ONLY: CurrentSession = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'read_only' } };
const CODE_LABEL = 'Kod z aplikacji uwierzytelniającej';

function Trigger({ methods }: { readonly methods?: readonly ('passkey' | 'totp')[] }) {
  const request = useStepUp();
  const [result, setResult] = useState('none');
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void request(TITLE, [], methods).then((confirmed) => {
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

function api(session: CurrentSession, routes: Parameters<typeof createFakeApi>[0] = {}) {
  return createFakeApi({
    [SESSION_ROUTE]: () => json(200, session),
    [STEP_UP]: () => json(200, { csrfToken: 'csrf-stepped' }),
    ...routes,
  });
}

async function open(fake: ReturnType<typeof api>, methods?: readonly ('passkey' | 'totp')[]) {
  const queryClient = createQueryClient();
  render(
    <I18nextProvider i18n={createI18n()}>
      <ApiProvider client={createApiClient(fake.fetch)}>
        <QueryClientProvider client={queryClient}>
          <StepUpProvider>
            <Trigger {...(methods === undefined ? {} : { methods })} />
          </StepUpProvider>
        </QueryClientProvider>
      </ApiProvider>
    </I18nextProvider>,
  );
  // The dialog reads the role from the session of the tab.
  await queryClient.query({ queryKey: ['session'], queryFn: () => session(fake) });
  await userEvent.click(screen.getByRole('button', { name: 'Otwórz' }));
  return screen.findByRole('alertdialog');
}

async function session(fake: ReturnType<typeof api>): Promise<unknown> {
  const response = await fake.fetch('http://localhost/api/v1/auth/session');
  return response.json();
}

afterEach(() => {
  vi.restoreAllMocks();
  resetStepUp();
});

describe('W-04 kod z aplikacji (EVM-023 AC7)', () => {
  it('EVM-023 AC7 an Editor can confirm with the passkey or with the code of the app; the hint is for a member of the office, not for an Administrator', async () => {
    const dialog = await open(api(EDITOR));
    expect(dialog.textContent).toContain(TITLE);
    expect(screen.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeTruthy();
    const field = screen.getByLabelText(CODE_LABEL);
    expect(field.getAttribute('autocomplete')).toBe('one-time-code');
    expect(field.getAttribute('inputmode')).toBe('numeric');
    expect(field.getAttribute('spellcheck')).toBe('false');
    expect(screen.getByText('Nie masz dostępu do metody? Poproś administratora o reset drugiego kroku logowania.')).toBeTruthy();
    expect(screen.queryByText(/Poproś innego administratora/)).toBeNull();
    // No recovery code in any application of the dialog (decision 16).
    expect(screen.queryByText(/kod odzyskiwania/i)).toBeNull();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-023 AC7 a Read-only user has the code as well', async () => {
    await open(api(READ_ONLY));
    expect(screen.getByLabelText(CODE_LABEL)).toBeTruthy();
  });

  it('EVM-023 AC7 an Administrator is offered the passkey only, with the hint about another administrator', async () => {
    await open(api(ACTIVE_SESSION));
    expect(screen.getByRole('button', { name: 'Użyj klucza dostępu' })).toBeTruthy();
    expect(screen.queryByLabelText(CODE_LABEL)).toBeNull();
    expect(screen.getByText('Nie masz klucza dostępu? Poproś innego administratora o reset drugiego kroku logowania.')).toBeTruthy();
  });

  it('EVM-023 AC7 a caller can limit the methods (after a passkey only the passkey)', async () => {
    await open(api(EDITOR), ['passkey']);
    expect(screen.queryByLabelText(CODE_LABEL)).toBeNull();
  });

  it('EVM-023 AC7 the code is sent only on "Potwierdź" (six digits do not send it), as { method: totp, code }, the new token replaces the old one, the request is confirmed', async () => {
    const fake = api(EDITOR);
    await open(fake);
    await userEvent.type(screen.getByLabelText(CODE_LABEL), '123 456');
    expect(fake.calls(STEP_UP)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    await waitFor(() => {
      expect(screen.getByTestId('result').textContent).toBe('confirmed');
    });
    expect(parseBody(fake.calls(STEP_UP)[0]?.body ?? '')).toEqual({ method: 'totp', code: '123456' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('EVM-023 AC7 a wrong code (totp_failed) keeps the dialog and the session: one message, the field cleared and focused', async () => {
    const fake = api(EDITOR, { [STEP_UP]: () => problem(401, 'totp_failed') });
    await open(fake);
    const field = screen.getByLabelText<HTMLInputElement>(CODE_LABEL);
    await userEvent.type(field, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect((await screen.findByRole('alert')).textContent).toContain(WRONG);
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByTestId('result').textContent).toBe('none');
    // A rejected code is not a lost session: the session is not read again.
    expect(fake.calls(SESSION_ROUTE).length).toBe(1);
  });

  it.each(['12345', 'abcdef', ''])('EVM-023 AC7 the input "%s" is not a code: no request, the same message', async (input) => {
    const fake = api(EDITOR);
    await open(fake);
    if (input !== '') await userEvent.type(screen.getByLabelText(CODE_LABEL), input);
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect((await screen.findByRole('alert')).textContent).toContain(WRONG);
    expect(fake.calls(STEP_UP)).toHaveLength(0);
  });

  it('EVM-023 AC7 the fifth wrong code ends the session (401 session_revoked): the dialog closes and the gate takes over', async () => {
    const fake = api(EDITOR, { [STEP_UP]: () => problem(401, 'session_revoked') });
    await open(fake);
    await userEvent.type(screen.getByLabelText(CODE_LABEL), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    await waitFor(() => {
      expect(screen.getByTestId('result').textContent).toBe('cancelled');
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('EVM-023 AC8 429 says when to try again, from Retry-After, and keeps the typed code', async () => {
    const fake = api(EDITOR, { [STEP_UP]: () => problem(429, 'rate_limited', {}, { 'Retry-After': '120' }) });
    await open(fake);
    await userEvent.type(screen.getByLabelText(CODE_LABEL), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Zbyt wiele prób. Spróbuj ponownie za 2 min.');
    expect(screen.getByLabelText<HTMLInputElement>(CODE_LABEL).value).toBe('123456');
  });

  it('EVM-023 AC7 a network error keeps the code and gives the message with a code for support', async () => {
    const fake = api(EDITOR, { [STEP_UP]: () => problem(500, 'internal_error') });
    await open(fake);
    await userEvent.type(screen.getByLabelText(CODE_LABEL), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nie udało się potwierdzić tożsamości.');
    expect(screen.getByLabelText<HTMLInputElement>(CODE_LABEL).value).toBe('123456');
  });

  it('EVM-023 AC7 "Anuluj" drops the typed code and closes without sending anything', async () => {
    const fake = api(EDITOR);
    await open(fake);
    await userEvent.type(screen.getByLabelText(CODE_LABEL), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(screen.getByTestId('result').textContent).toBe('cancelled');
    expect(fake.calls(STEP_UP)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Otwórz' }));
    expect(screen.getByLabelText<HTMLInputElement>(CODE_LABEL).value).toBe('');
  });

  it('EVM-023 AC7 Esc (the event "cancel" of the native dialog) is "Anuluj"', async () => {
    const fake = api(EDITOR);
    await open(fake);
    fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }));
    await waitFor(() => {
      expect(screen.getByTestId('result').textContent).toBe('cancelled');
    });
    expect(fake.calls(STEP_UP)).toHaveLength(0);
  });

  it('EVM-023 AC8 offline: the dialog says so, both methods are unavailable and the typed code stays', async () => {
    const fake = api(EDITOR);
    await open(fake);
    await userEvent.type(screen.getByLabelText(CODE_LABEL), '123456');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(await screen.findByText('Brak połączenia. Potwierdzenie wymaga połączenia z internetem.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Potwierdź' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Użyj klucza dostępu' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect(fake.calls(STEP_UP)).toHaveLength(0);
    expect(screen.getByLabelText<HTMLInputElement>(CODE_LABEL).value).toBe('123456');
  });

  it('EVM-023 AC7 the passkey still works for an Editor: options, then the step-up with the credential', async () => {
    class FakeCredential {
      static readonly parseRequestOptionsFromJSON = vi.fn((options: object) => options);
      toJSON() {
        return {
          id: 'Y3JlZA',
          rawId: 'Y3JlZA',
          type: 'public-key',
          response: { clientDataJSON: 'a', authenticatorData: 'b', signature: 'c' },
        };
      }
    }
    vi.stubGlobal('PublicKeyCredential', FakeCredential);
    Object.defineProperty(navigator, 'credentials', {
      value: { get: vi.fn(() => Promise.resolve(new FakeCredential())) },
      configurable: true,
    });
    const fake = api(EDITOR, { [STEP_UP_OPTIONS]: () => json(200, { challenge: 'Y2g', rpId: 'localhost', userVerification: 'required' }) });
    await open(fake);
    await userEvent.click(screen.getByRole('button', { name: 'Użyj klucza dostępu' }));
    await waitFor(() => {
      expect(screen.getByTestId('result').textContent).toBe('confirmed');
    });
    expect(parseBody(fake.calls(STEP_UP)[0]?.body ?? '')).toHaveProperty('credential');
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'credentials');
  });
});
