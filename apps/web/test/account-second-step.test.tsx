import type { Account } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem, type Handler } from './api-fake.ts';
import {
  accountApi,
  ADMINISTRATOR_ACCOUNT,
  CODES_ROUTE,
  CREDENTIAL,
  EDITOR_ACCOUNT,
  goOffline,
  LAPTOP,
  NEW_CODES,
  PASSKEY_ID,
  PASSKEY_OPTIONS_ROUTE,
  PHONE,
  REAUTH,
  REGISTER_PASSKEY,
  REGISTRATION_OPTIONS,
  REMOVE_TOTP,
  resetAccountTest,
  SECOND_PASSKEY_ID,
  stubWebAuthn,
  TOTP_CONFIRM,
  TOTP_START,
} from './account-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';

afterEach(resetAccountTest);

const PASSWORD = 'obecne hasło do konta';
const REMOVE_PHONE = `DELETE /api/v1/account/passkeys/${SECOND_PASSKEY_ID}`;
const REMOVE_LAPTOP = `DELETE /api/v1/account/passkeys/${PASSKEY_ID}`;
const TWO_KEYS: Account = {
  ...EDITOR_ACCOUNT,
  secondStep: { ...EDITOR_ACCOUNT.secondStep, passkeys: [LAPTOP, PHONE] },
};

async function openCard(account: Account, routes: Record<string, Handler> = {}) {
  const api = accountApi(account, routes);
  await renderPanel('/account', api);
  await screen.findByRole('heading', { level: 2, name: 'Drugi krok logowania' });
  return api;
}

/** W-04, the full re-authentication: the password (step 1), then the code of the app (step 2). */
async function confirmIdentity(title: string, password = PASSWORD) {
  const dialog = await screen.findByRole('dialog', { name: title });
  await userEvent.type(within(dialog).getByLabelText('Hasło'), password);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
  await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
}

/** A server that wants the re-authentication once: the first call is refused, the mark (one-time) lets the next one through. */
function marked(done: () => Response) {
  let mark = false;
  const reauth: Handler = () => {
    mark = true;
    return new Response(null, { status: 204 });
  };
  const operation: Handler = () => {
    if (!mark) return problem(403, 'reauthentication_required');
    mark = false;
    return done();
  };
  return { reauth, operation };
}

describe('W-15 Drugi krok logowania — lista (EVM-028 AC3, AC4)', () => {
  it('EVM-028 AC3 the list shows the name and the date of every passkey, the code of the app and the recovery codes; the heading is the anchor of #drugi-krok', async () => {
    await openCard(TWO_KEYS);
    expect(screen.getByText('Laptop w biurze · dodano 03.10.2026')).toBeTruthy();
    expect(screen.getByText('Telefon · dodano 04.10.2026')).toBeTruthy();
    expect(screen.getByText('Dodano 03.10.2026')).toBeTruthy();
    expect(screen.getByText('Pozostało 7 kodów · wygenerowano 03.10.2026')).toBeTruthy();
    expect(screen.getByText('Każda zmiana wymaga hasła i drugiego kroku.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Usuń klucz dostępu Telefon' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText('To jedyna metoda — najpierw dodaj inną.')).toBeNull();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-028 AC3 the anchor #drugi-krok puts the focus on the heading of the card', async () => {
    const api = accountApi(TWO_KEYS);
    await renderPanel('/account#drugi-krok', api);
    const heading = await screen.findByRole('heading', { level: 2, name: 'Drugi krok logowania' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it('EVM-028 AC3 the name of a key is plain text: markup in it is shown as it is', async () => {
    await openCard({
      ...TWO_KEYS,
      secondStep: { ...TWO_KEYS.secondStep, passkeys: [{ ...LAPTOP, name: '<img src=x onerror=alert(1)>' }, PHONE] },
    });
    expect(screen.getByText('<img src=x onerror=alert(1)> · dodano 03.10.2026')).toBeTruthy();
    expect(document.querySelector('main img')).toBeNull();
  });

  it('EVM-028 AC4 the only method of an Editor cannot be removed: the button is off and the reason stands beside it', async () => {
    await openCard({ ...EDITOR_ACCOUNT, secondStep: { ...EDITOR_ACCOUNT.secondStep, totp: null } });
    const remove = screen.getByRole('button', { name: 'Usuń klucz dostępu Laptop w biurze' });
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    const reason = screen.getByText('To jedyna metoda — najpierw dodaj inną.');
    expect(remove.getAttribute('aria-describedby')).toBe(reason.id);
    await userEvent.click(remove);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('EVM-028 AC4 with a passkey and a code of the app an Editor may remove either; the code alone is the last method too', async () => {
    await openCard(EDITOR_ACCOUNT);
    expect(screen.getByRole('button', { name: 'Usuń kod z aplikacji uwierzytelniającej' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('button', { name: 'Usuń klucz dostępu Laptop w biurze' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('EVM-028 AC4 an Administrator with one passkey cannot remove it (the code of the app does not count), and is told to add a second one', async () => {
    await openCard({
      ...ADMINISTRATOR_ACCOUNT,
      secondStep: { ...ADMINISTRATOR_ACCOUNT.secondStep, passkeys: [LAPTOP], totp: { addedAt: '2026-10-03T11:00:00Z' } },
    });
    expect(screen.getByRole('button', { name: 'Usuń klucz dostępu Laptop w biurze' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Konto administratora musi mieć klucz dostępu — najpierw dodaj drugi.')).toBeTruthy();
    expect(screen.getByText('Dodaj drugi klucz dostępu, np. w telefonie — bez niego utrata komputera blokuje logowanie.')).toBeTruthy();
    // The code of the app of an Administrator is only for the phone: it may be removed and has no "add" in the panel.
    expect(screen.getByText('Służy tylko do logowania w aplikacji na telefonie.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Usuń kod z aplikacji uwierzytelniającej' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('EVM-028 AC3 an Administrator without a code of the app has no "Dodaj kod z aplikacji" (the API does not offer it in the panel)', async () => {
    await openCard(ADMINISTRATOR_ACCOUNT);
    expect(screen.getByText('Nie dodano.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dodaj kod z aplikacji' })).toBeNull();
  });

  it('EVM-028 AC5 the recovery codes: how many are left, a warning at 3 or fewer, none yet — a warning with "Wygeneruj kody"', async () => {
    await openCard({
      ...EDITOR_ACCOUNT,
      secondStep: { ...EDITOR_ACCOUNT.secondStep, recoveryCodes: { remaining: 3, generatedAt: '2026-10-03T12:00:00Z' } },
    });
    expect(screen.getByText('Pozostały 3 kody · wygenerowano 03.10.2026')).toBeTruthy();
    expect(screen.getByText('Zostały 3 kody odzyskiwania. Wygeneruj nowe, zanim się skończą.')).toBeTruthy();
  });

  it.each([
    [1, 'Pozostał 1 kod · wygenerowano 03.10.2026', 'Został 1 kod odzyskiwania. Wygeneruj nowe, zanim się skończą.'],
    [0, 'Pozostało 0 kodów · wygenerowano 03.10.2026', 'Nie zostały już żadne kody odzyskiwania. Wygeneruj nowe.'],
  ])('EVM-028 AC5 %i codes left are told with the right form and a warning', async (remaining, line, warning) => {
    await openCard({
      ...EDITOR_ACCOUNT,
      secondStep: { ...EDITOR_ACCOUNT.secondStep, recoveryCodes: { remaining, generatedAt: '2026-10-03T12:00:00Z' } },
    });
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText(warning)).toBeTruthy();
  });

  it('EVM-028 AC5 an account that never had recovery codes is told so and offered "Wygeneruj kody"', async () => {
    await openCard({ ...EDITOR_ACCOUNT, secondStep: { ...EDITOR_ACCOUNT.secondStep, recoveryCodes: null } });
    expect(screen.getByText('Konto nie ma kodów odzyskiwania. Bez nich utrata metody wymaga resetu przez administratora.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wygeneruj kody' })).toBeTruthy();
  });

  it('EVM-028 AC8 offline every change is off and says why', async () => {
    await openCard(TWO_KEYS);
    goOffline();
    for (const name of [
      'Dodaj klucz dostępu',
      'Usuń klucz dostępu Telefon',
      'Usuń kod z aplikacji uwierzytelniającej',
      'Wygeneruj nowe kody…',
    ]) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.getAllByText('Zmienisz po powrocie połączenia.').length).toBeGreaterThan(0);
  });
});

describe('W-15 usunięcie klucza dostępu i kodu z aplikacji (EVM-028 AC3, AC4)', () => {
  it('EVM-028 AC3 removing a key: the AlertDialog names it and has the focus on "Anuluj"; the server asks for the full re-authentication, W-04 stands alone, then the same delete goes again', async () => {
    const { reauth, operation } = marked(() => new Response(null, { status: 204 }));
    const api = await openCard(TWO_KEYS, { [REAUTH]: reauth, [REMOVE_PHONE]: operation });
    await userEvent.click(screen.getByRole('button', { name: 'Usuń klucz dostępu Telefon' }));
    const alert = await screen.findByRole('alertdialog', { name: 'Usunąć klucz dostępu „Telefon”?' });
    expect(within(alert).getByText('Tym kluczem nie zalogujesz się już do panelu.')).toBeTruthy();
    expect(document.activeElement).toBe(within(alert).getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(within(alert).getByRole('button', { name: 'Usuń klucz' }));
    const title = 'Potwierdź tożsamość, aby usunąć klucz dostępu';
    const dialog = await screen.findByRole('dialog', { name: title });
    // A dialog never stacks on a dialog: the AlertDialog stepped aside.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(dialog).getByText('Krok 1 z 2')).toBeTruthy();
    expect(within(dialog).getByText('Każda zmiana drugiego kroku wymaga hasła i drugiego kroku.')).toBeTruthy();
    expect(within(dialog).getByLabelText<HTMLInputElement>('E-mail').value).toBe('anna.testowa@example.com');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    await userEvent.type(within(dialog).getByLabelText('Hasło'), PASSWORD);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dalej' }));
    expect(within(dialog).getByText('Krok 2 z 2')).toBeTruthy();
    expect(within(dialog).queryByText(/kod odzyskiwania/i)).toBeNull();
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
    expect(await screen.findByText('Usunięto klucz dostępu.')).toBeTruthy();
    expect(parseBody(api.calls(REAUTH)[0]?.body ?? '')).toEqual({
      purpose: 'second_step_change',
      password: PASSWORD,
      method: 'totp',
      code: '123456',
    });
    expect(api.calls(REMOVE_PHONE)).toHaveLength(2);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // The list is read again, and the password is nowhere in the page.
    expect(api.calls('GET /api/v1/account').length).toBeGreaterThan(1);
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  it('EVM-028 AC3 "Anuluj" in W-04 changes nothing: the AlertDialog comes back and nothing is sent again', async () => {
    const { reauth, operation } = marked(() => new Response(null, { status: 204 }));
    const api = await openCard(TWO_KEYS, { [REAUTH]: reauth, [REMOVE_PHONE]: operation });
    await userEvent.click(screen.getByRole('button', { name: 'Usuń klucz dostępu Telefon' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Usuń klucz' }));
    const dialog = await screen.findByRole('dialog', { name: 'Potwierdź tożsamość, aby usunąć klucz dostępu' });
    await userEvent.type(within(dialog).getByLabelText('Hasło'), PASSWORD);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(await screen.findByRole('alertdialog', { name: 'Usunąć klucz dostępu „Telefon”?' })).toBeTruthy();
    expect(api.calls(REAUTH)).toHaveLength(0);
    expect(api.calls(REMOVE_PHONE)).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  it('EVM-028 AC4 the server refuses the last key of an Administrator: the AlertDialog says what to add first and stays', async () => {
    const { reauth, operation } = marked(() => new Response(null, { status: 204 }));
    await openCard(ADMINISTRATOR_ACCOUNT, {
      [REAUTH]: reauth,
      [REMOVE_PHONE]: () => problem(409, 'last_second_step_method', { errors: [{ pointer: '/passkeyId', code: 'passkey_required' }] }),
      [REMOVE_LAPTOP]: operation,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Usuń klucz dostępu Telefon' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Usuń klucz' }));
    const alert = await screen.findByRole('alertdialog');
    expect((await within(alert).findByRole('alert')).textContent).toBe(
      'Konto administratora musi mieć klucz dostępu — najpierw dodaj drugi.',
    );
  });

  it('EVM-028 AC4 the server refuses the last method of an Editor: the other text of the rule', async () => {
    await openCard(TWO_KEYS, {
      [REMOVE_PHONE]: () => problem(409, 'last_second_step_method', { errors: [{ pointer: '/passkeyId', code: 'method_required' }] }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Usuń klucz dostępu Telefon' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Usuń klucz' }));
    expect((await screen.findByRole('alert')).textContent).toBe('To jedyna metoda — najpierw dodaj inną.');
  });

  it("EVM-028 AC8 a key that is not there (a stranger's looks the same: 404) closes the dialog with a toast and a fresh list", async () => {
    const api = await openCard(TWO_KEYS, { [REMOVE_PHONE]: () => problem(404, 'not_found') });
    await userEvent.click(screen.getByRole('button', { name: 'Usuń klucz dostępu Telefon' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Usuń klucz' }));
    expect(await screen.findByText('Nie znaleziono klucza.')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls('GET /api/v1/account').length).toBeGreaterThan(1);
  });

  it('EVM-028 AC3 removing the code of the app: the text of the role, the re-authentication, the delete and the toast', async () => {
    const { reauth, operation } = marked(() => new Response(null, { status: 204 }));
    const api = await openCard(EDITOR_ACCOUNT, { [REAUTH]: reauth, [REMOVE_TOTP]: operation });
    await userEvent.click(screen.getByRole('button', { name: 'Usuń kod z aplikacji uwierzytelniającej' }));
    const alert = await screen.findByRole('alertdialog', { name: 'Usunąć kod z aplikacji uwierzytelniającej?' });
    expect(within(alert).getByText('Bez niego nie zalogujesz się w aplikacji na telefonie.')).toBeTruthy();
    await userEvent.click(within(alert).getByRole('button', { name: 'Usuń kod' }));
    await confirmIdentity('Potwierdź tożsamość, aby usunąć kod z aplikacji');
    expect(await screen.findByText('Usunięto kod z aplikacji.')).toBeTruthy();
    expect(api.calls(REMOVE_TOTP)).toHaveLength(2);
  });

  it('EVM-028 AC3 a Read-only user is told nothing about the phone (P6)', async () => {
    await openCard({ ...EDITOR_ACCOUNT, role: 'read_only' });
    await userEvent.click(screen.getByRole('button', { name: 'Usuń kod z aplikacji uwierzytelniającej' }));
    const alert = await screen.findByRole('alertdialog');
    expect(within(alert).getByText('Tym kodem nie zalogujesz się już do panelu.')).toBeTruthy();
    expect(within(alert).queryByText(/telefon/i)).toBeNull();
  });

  it('EVM-028 AC3 the mark that ran out (403 again after W-04) is told in the dialog', async () => {
    await openCard(TWO_KEYS, {
      [REAUTH]: () => new Response(null, { status: 204 }),
      [REMOVE_PHONE]: () => problem(403, 'reauthentication_required'),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Usuń klucz dostępu Telefon' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Usuń klucz' }));
    await confirmIdentity('Potwierdź tożsamość, aby usunąć klucz dostępu');
    expect(await screen.findByText('Potwierdzenie tożsamości wygasło. Spróbuj ponownie.')).toBeTruthy();
  });
});

describe('W-15 dodanie klucza dostępu (EVM-028 AC3)', () => {
  it('EVM-028 AC3 adding a key: the name, the options (the server asks for the re-authentication), W-04, the system ceremony, the registration with the name, the toast', async () => {
    const spies = stubWebAuthn();
    const { reauth, operation } = marked(() => json(200, REGISTRATION_OPTIONS));
    const api = await openCard(TWO_KEYS, {
      [REAUTH]: reauth,
      [PASSKEY_OPTIONS_ROUTE]: operation,
      [REGISTER_PASSKEY]: () => json(201, { ...PHONE, id: '66666666-6666-4666-8666-666666666666', name: 'Klucz w telefonie' }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj klucz dostępu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dodaj klucz dostępu' });
    expect(within(dialog).getByText('Pomoże odróżnić klucze, np. „Laptop w biurze”, „Telefon”.')).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText('Nazwa klucza'), '  Klucz w telefonie ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj klucz dostępu' }));
    await confirmIdentity('Potwierdź tożsamość, aby dodać klucz dostępu');
    expect(await screen.findByText('Dodano klucz dostępu.')).toBeTruthy();
    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(api.calls(PASSKEY_OPTIONS_ROUTE)).toHaveLength(2);
    expect(parseBody(api.calls(REGISTER_PASSKEY)[0]?.body ?? '')).toEqual({ credential: CREDENTIAL, name: 'Klucz w telefonie' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-028 AC3 without a name only the credential is sent (the server names it "Klucz dostępu")', async () => {
    stubWebAuthn();
    const api = await openCard(TWO_KEYS, {
      [PASSKEY_OPTIONS_ROUTE]: () => json(200, REGISTRATION_OPTIONS),
      [REGISTER_PASSKEY]: () => json(201, { ...PHONE, name: 'Klucz dostępu' }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj klucz dostępu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dodaj klucz dostępu' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj klucz dostępu' }));
    expect(await screen.findByText('Dodano klucz dostępu.')).toBeTruthy();
    expect(parseBody(api.calls(REGISTER_PASSKEY)[0]?.body ?? '')).toEqual({ credential: CREDENTIAL });
  });

  it('EVM-028 AC3 a name over 60 characters and a name with control characters are refused on the spot', async () => {
    stubWebAuthn();
    const api = await openCard(TWO_KEYS, { [PASSKEY_OPTIONS_ROUTE]: () => json(200, REGISTRATION_OPTIONS) });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj klucz dostępu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dodaj klucz dostępu' });
    const field = within(dialog).getByLabelText('Nazwa klucza');
    await userEvent.type(field, 'a'.repeat(61));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj klucz dostępu' }));
    expect(await within(dialog).findByText('Nazwa może mieć najwyżej 60 znaków.')).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.type(field, 'Tele‮fon');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj klucz dostępu' }));
    expect(await within(dialog).findByText('Nazwa zawiera niedozwolone znaki. Użyj zwykłego tekstu.')).toBeTruthy();
    expect(api.calls(PASSKEY_OPTIONS_ROUTE)).toHaveLength(0);
  });

  it('EVM-028 AC3 a cancelled ceremony keeps the dialog and the name and says it can be repeated', async () => {
    stubWebAuthn({ create: () => Promise.reject(new DOMException('cancelled', 'NotAllowedError')) });
    const api = await openCard(TWO_KEYS, { [PASSKEY_OPTIONS_ROUTE]: () => json(200, REGISTRATION_OPTIONS) });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj klucz dostępu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dodaj klucz dostępu' });
    await userEvent.type(within(dialog).getByLabelText('Nazwa klucza'), 'Telefon');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj klucz dostępu' }));
    expect(await within(dialog).findByText('Nie udało się dodać klucza dostępu. Spróbuj ponownie.')).toBeTruthy();
    expect(within(dialog).getByLabelText<HTMLInputElement>('Nazwa klucza').value).toBe('Telefon');
    expect(api.calls(REGISTER_PASSKEY)).toHaveLength(0);
  });

  it('EVM-028 AC3 a key the server refused (400) is the same message, and "Anuluj" closes the dialog', async () => {
    stubWebAuthn();
    await openCard(TWO_KEYS, {
      [PASSKEY_OPTIONS_ROUTE]: () => json(200, REGISTRATION_OPTIONS),
      [REGISTER_PASSKEY]: () => problem(400, 'passkey_verification_failed'),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj klucz dostępu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dodaj klucz dostępu' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj klucz dostępu' }));
    expect(await within(dialog).findByText('Nie udało się dodać klucza dostępu. Spróbuj ponownie.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-028 AC3 a server refusal of the name at the field (400 /name) is told there', async () => {
    stubWebAuthn();
    await openCard(TWO_KEYS, {
      [PASSKEY_OPTIONS_ROUTE]: () => json(200, REGISTRATION_OPTIONS),
      [REGISTER_PASSKEY]: () => problem(400, 'validation_failed', { errors: [{ pointer: '/name', code: 'too_long' }] }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj klucz dostępu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dodaj klucz dostępu' });
    await userEvent.type(within(dialog).getByLabelText('Nazwa klucza'), 'Telefon');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj klucz dostępu' }));
    expect(await within(dialog).findByText('Nazwa może mieć najwyżej 60 znaków.')).toBeTruthy();
  });
});

describe('W-15 dodanie kodu z aplikacji (EVM-028 AC3)', () => {
  const SETUP = {
    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    otpauthUri: 'otpauth://totp/EVia%20Manager:anna?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=EVia%20Manager',
  };
  const WITHOUT_TOTP: Account = { ...EDITOR_ACCOUNT, secondStep: { ...EDITOR_ACCOUNT.secondStep, totp: null } };

  it('EVM-028 AC3 W-04 comes first, then the dialog with the QR code and the key to type in, the code confirms the method', async () => {
    const { reauth, operation } = marked(() => json(200, SETUP));
    const api = await openCard(WITHOUT_TOTP, {
      [REAUTH]: reauth,
      [TOTP_START]: operation,
      [TOTP_CONFIRM]: () => json(200, { state: 'active', csrfToken: 'csrf-active' }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj kod z aplikacji' }));
    await confirmIdentity('Potwierdź tożsamość, aby dodać kod z aplikacji');
    const dialog = await screen.findByRole('dialog', { name: 'Dodaj kod z aplikacji' });
    expect(within(dialog).getByRole('img', { name: /kod QR/i })).toBeTruthy();
    expect(dialog.querySelector('h2:not([id])')).toBeNull();
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '654321');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź kod' }));
    expect(await screen.findByText('Dodano kod z aplikacji.')).toBeTruthy();
    expect(parseBody(api.calls(TOTP_CONFIRM)[0]?.body ?? '')).toEqual({ code: '654321' });
    expect(api.calls(TOTP_START)).toHaveLength(2);
    // The secret is not left in the page.
    expect(document.body.innerHTML).not.toContain(SETUP.secret);
  });

  it('EVM-028 AC3 a code the server refuses is told in the dialog; a mark that ran out says so', async () => {
    let status = 400;
    await openCard(WITHOUT_TOTP, {
      [TOTP_START]: () => json(200, SETUP),
      [TOTP_CONFIRM]: () => (status === 400 ? problem(400, 'totp_verification_failed') : problem(403, 'reauthentication_required')),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj kod z aplikacji' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dodaj kod z aplikacji' });
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '111111');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź kod' }));
    expect(await within(dialog).findByText(/Kod jest nieprawidłowy\. Sprawdź, czy czas w telefonie/)).toBeTruthy();
    status = 403;
    await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '222222');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź kod' }));
    expect(await within(dialog).findByText('Potwierdzenie tożsamości wygasło. Zamknij to okno i spróbuj ponownie.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-028 AC3 an account that already has the code of the app (409) is told so on the card', async () => {
    await openCard(WITHOUT_TOTP, { [TOTP_START]: () => problem(409, 'mfa_already_configured') });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj kod z aplikacji' }));
    expect(await screen.findByText('Kod z aplikacji jest już dodany.')).toBeTruthy();
  });

  it('EVM-028 AC3 "Anuluj" in W-04 before the secret changes nothing', async () => {
    const api = await openCard(WITHOUT_TOTP, { [TOTP_START]: () => problem(403, 'reauthentication_required') });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj kod z aplikacji' }));
    const dialog = await screen.findByRole('dialog', { name: 'Potwierdź tożsamość, aby dodać kod z aplikacji' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls(TOTP_START)).toHaveLength(1);
    expect(screen.queryByText(/Nie potwierdzono tożsamości/)).toBeNull();
  });
});

describe('W-15 nowe kody odzyskiwania (EVM-028 AC5)', () => {
  it('EVM-028 AC5 the AlertDialog warns, W-04 comes before the request, ten new codes are shown once and are gone after "Zakończ"', async () => {
    const { reauth, operation } = marked(() => json(200, { codes: NEW_CODES }, { 'Cache-Control': 'no-store' }));
    const api = await openCard(EDITOR_ACCOUNT, { [REAUTH]: reauth, [CODES_ROUTE]: operation });
    await userEvent.click(screen.getByRole('button', { name: 'Wygeneruj nowe kody…' }));
    const alert = await screen.findByRole('alertdialog', { name: 'Wygenerować nowe kody odzyskiwania?' });
    expect(within(alert).getByText('Dotychczasowe kody przestaną działać.')).toBeTruthy();
    expect(document.activeElement).toBe(within(alert).getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(within(alert).getByRole('button', { name: 'Wygeneruj nowe kody' }));
    await confirmIdentity('Potwierdź tożsamość, aby wygenerować nowe kody odzyskiwania');
    const dialog = await screen.findByRole('dialog', { name: 'Nowe kody odzyskiwania' });
    // The request went only after the confirmation.
    expect(api.calls(CODES_ROUTE)).toHaveLength(1);
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(10);
    expect(within(dialog).getByText('ABCDE FGHIJ KLMNO PQRST')).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    // Leaving before the codes are saved is refused with a reminder.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(await within(dialog).findByText(/Najpierw zapisz kody/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zakończ' }));
    expect(await within(dialog).findAllByText('Potwierdź, że kody są zapisane.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Kody są zapisane w bezpiecznym miejscu' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zakończ' }));
    expect(await screen.findByText('Wygenerowano nowe kody odzyskiwania.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.innerHTML).not.toContain('ABCDEFGHIJKLMNOPQRST');
    expect(api.calls('GET /api/v1/account').length).toBeGreaterThan(1);
  });

  it('EVM-028 AC5 an account without codes generates the first ones the same way', async () => {
    const { reauth, operation } = marked(() => json(200, { codes: NEW_CODES }));
    await openCard(
      { ...EDITOR_ACCOUNT, secondStep: { ...EDITOR_ACCOUNT.secondStep, recoveryCodes: null } },
      { [REAUTH]: reauth, [CODES_ROUTE]: operation },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Wygeneruj kody' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Wygeneruj nowe kody' }));
    await confirmIdentity('Potwierdź tożsamość, aby wygenerować nowe kody odzyskiwania');
    expect(await screen.findByRole('dialog', { name: 'Nowe kody odzyskiwania' })).toBeTruthy();
  });

  it('EVM-028 AC5 "Anuluj" in W-04 sends no request for codes; a failure of the server is told in the AlertDialog', async () => {
    const api = await openCard(EDITOR_ACCOUNT, { [CODES_ROUTE]: () => problem(500, 'internal_error') });
    await userEvent.click(screen.getByRole('button', { name: 'Wygeneruj nowe kody…' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Wygeneruj nowe kody' }));
    const dialog = await screen.findByRole('dialog', { name: 'Potwierdź tożsamość, aby wygenerować nowe kody odzyskiwania' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(await screen.findByRole('alertdialog', { name: 'Wygenerować nowe kody odzyskiwania?' })).toBeTruthy();
    expect(api.calls(CODES_ROUTE)).toHaveLength(0);
    expect(screen.queryByText(/Nie potwierdzono tożsamości/)).toBeNull();
  });

  it('EVM-028 AC5 offline the AlertDialog cannot generate', async () => {
    await openCard(EDITOR_ACCOUNT);
    await userEvent.click(screen.getByRole('button', { name: 'Wygeneruj nowe kody…' }));
    const alert = await screen.findByRole('alertdialog');
    goOffline();
    expect(within(alert).getByRole('button', { name: 'Wygeneruj nowe kody' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(within(alert).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
