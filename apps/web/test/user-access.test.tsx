import type { CurrentSession, User } from '@evia/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetServerClock } from '../src/session/server-clock.ts';
import { resetStepUp } from '../src/session/step-up.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, createFakeApi, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { renderPanel } from './render.tsx';

// W-16 operations on an account (EVM-027): role, deactivation, reactivation, end of sessions, reset of the second step.
const LIST = 'GET /api/v1/users';
const OPTIONS = 'POST /api/v1/auth/step-up/options';
const STEP_UP = 'POST /api/v1/auth/step-up';
const PATH = '/administration/users';
const JAN_ID = '22222222-2222-4222-8222-222222222222';
const BIURO_ID = '33333333-3333-4333-8333-333333333333';
const MAREK_ID = '44444444-4444-4444-8444-444444444444';
const ROLE = `PUT /api/v1/users/${JAN_ID}/role`;
const DEACTIVATE = `POST /api/v1/users/${JAN_ID}/deactivation`;
const REACTIVATE = `POST /api/v1/users/${MAREK_ID}/reactivation`;
const SESSIONS = `DELETE /api/v1/users/${JAN_ID}/sessions`;
const RESET = `POST /api/v1/users/${JAN_ID}/second-step-reset`;

const PASSKEY_OPTIONS = {
  challenge: 'Y2hhbGxlbmdl',
  rpId: 'localhost',
  userVerification: 'required',
  allowCredentials: [{ id: 'Y3JlZA', type: 'public-key' }],
};
const CREDENTIAL = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'Y2xpZW50', authenticatorData: 'YXV0aA', signature: 'c2ln' },
};

class FakePublicKeyCredential {
  static readonly parseRequestOptionsFromJSON = vi.fn((options: object) => ({ ...options, parsed: true }));
  toJSON() {
    return CREDENTIAL;
  }
}

const base = { invitation: null, activatedAt: '2026-09-01T08:00:00.000Z' } as const;
const ANNA: User = {
  ...base,
  id: ACTIVE_SESSION.user.id,
  email: 'anna.testowa@example.com',
  displayName: 'Anna Testowa',
  role: 'administrator',
  status: 'active',
  version: 1,
  secondStepMethods: ['passkey'],
};
const JAN: User = {
  ...base,
  id: JAN_ID,
  email: 'jan.przykladowy@example.com',
  displayName: 'Jan Przykładowy',
  role: 'editor',
  status: 'active',
  version: 3,
  secondStepMethods: ['passkey'],
};
const MAREK: User = {
  ...JAN,
  id: MAREK_ID,
  email: 'marek.testowy@example.com',
  displayName: 'Marek Testowy',
  status: 'deactivated',
  version: 5,
};
const BIURO: User = {
  id: BIURO_ID,
  email: 'biuro@example.com',
  displayName: 'Biuro Testowe',
  role: 'read_only',
  status: 'invited',
  invitation: { state: 'sent', sentAt: '2026-10-03T08:00:00.000Z', expiresAt: '2026-10-06T08:00:00.000Z' },
  version: 1,
  activatedAt: null,
  secondStepMethods: [],
};

const ok =
  (items: User[]): Handler =>
  () =>
    json(200, { items, nextCursor: null });
const stepUpRequired = () => problem(403, 'step_up_required');
const MENU = (user: User) => `Akcje konta: ${user.displayName}, ${user.email}`;

/** A fake server of the users and of W-04; `list` answers one read after another (the last one repeats). */
function accessApi(list: Handler | Handler[], extra: Record<string, Handler> = {}, session: CurrentSession = ACTIVE_SESSION) {
  const lists = Array.isArray(list) ? list : [list];
  let reads = 0;
  return createFakeApi({
    [SESSION_ROUTE]: () => json(200, session),
    [LIST]: (request) => lists[Math.min(reads++, lists.length - 1)]?.(request) ?? problem(500, 'internal_error'),
    [OPTIONS]: () => json(200, PASSKEY_OPTIONS),
    [STEP_UP]: () => json(200, { csrfToken: 'csrf-rotated' }),
    ...extra,
  });
}

const NOW = new Date('2026-10-04T10:00:00.000Z');

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
  Object.defineProperty(navigator, 'credentials', {
    value: { get: vi.fn(() => Promise.resolve(new FakePublicKeyCredential())) },
    configurable: true,
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'credentials');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  resetStepUp();
  resetServerClock();
});

/** Opens the menu of the row of `user` and chooses the item; returns when the item was clicked. */
async function choose(user: User, item: string): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: MENU(user) }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
}

const goOffline = () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  act(() => {
    globalThis.dispatchEvent(new Event('offline'));
  });
};

describe('W-16 the menu of a row (EVM-027 AC8)', () => {
  it('EVM-027 AC8 an active account offers role, sessions, then reset and deactivation in a separate group; the own row has no menu', async () => {
    await renderPanel(PATH, accessApi(ok([ANNA, JAN, BIURO, MAREK])));
    await userEvent.click(await screen.findByRole('button', { name: MENU(JAN) }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Zmień rolę…',
      'Wyloguj ze wszystkich sesji…',
      'Zresetuj drugi krok logowania…',
      'Dezaktywuj konto…',
    ]);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(items[2]?.className).toContain('text-action-danger-text-subtle');
    expect(items[3]?.className).toContain('text-action-danger-text-subtle');
    expect(screen.queryByRole('button', { name: MENU(ANNA) })).toBeNull();
  });

  it('EVM-027 AC8 an account that waits offers the resend, the role and the deactivation; a deactivated one only the reactivation', async () => {
    await renderPanel(PATH, accessApi(ok([ANNA, BIURO, MAREK])));
    await userEvent.click(await screen.findByRole('button', { name: MENU(BIURO) }));
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Wyślij zaproszenie ponownie…', 'Zmień rolę…', 'Dezaktywuj konto…']);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: MENU(MAREK) }));
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Reaktywuj konto…']);
  });
});

describe('W-16 Zmień rolę (EVM-027 AC1, AC5, AC7)', () => {
  const open = async (api: ReturnType<typeof accessApi>, user: User = JAN) => {
    await renderPanel(PATH, api);
    await choose(user, 'Zmień rolę…');
    return screen.findByRole('dialog', { name: `Zmienić rolę konta „${user.displayName}”?` });
  };

  it('EVM-027 AC1 the dialog marks the present role, says what happens to the sessions and has the focus on "Anuluj"', async () => {
    const dialog = await open(accessApi(ok([ANNA, JAN])));
    expect(within(dialog).getByRole('radio', { name: /^Edytor.*\(obecna\)$/, checked: true })).toBeTruthy();
    expect(within(dialog).getByText('Sesje tego konta zakończą się — nowa rola zadziała po ponownym zalogowaniu.')).toBeTruthy();
    expect(within(dialog).queryByText('Wszyscy administratorzy dostaną alert bezpieczeństwa.')).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Anuluj' }));
  });

  it('EVM-027 AC1 the choice goes with the version of the account as If-Match, W-04 opens on step_up_required and the same call is sent once more', async () => {
    const answers: Handler[] = [stepUpRequired, () => json(200, { ...JAN, role: 'read_only', version: 4 }, { ETag: '"4"' })];
    let call = 0;
    const api = accessApi(ok([ANNA, JAN]), {
      [ROLE]: (request) => answers[Math.min(call++, 1)]?.(request) ?? problem(500, 'internal_error'),
    });
    const dialog = await open(api);
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Tylko odczyt/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień rolę' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zmienić rolę użytkownika' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Użyj klucza dostępu' }));
    await waitFor(() => {
      expect(api.calls(ROLE)).toHaveLength(2);
    });
    expect(api.calls(ROLE)[1]?.headers.get('If-Match')).toBe('"3"');
    expect(parseBody(api.calls(ROLE)[1]?.body ?? '')).toEqual({ role: 'read_only' });
    expect(await screen.findByText('Zmieniono rolę.')).toBeTruthy();
    await waitFor(() => {
      expect(api.calls(LIST)).toHaveLength(2);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-027 AC1 the same role is not sent: the message stands under the roles', async () => {
    const api = accessApi(ok([ANNA, JAN]));
    const dialog = await open(api);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień rolę' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Wybierz rolę inną niż obecna.');
    expect(api.calls(ROLE)).toHaveLength(0);
  });

  it('EVM-027 AC7 the role Administrator adds the alert for all Administrators, an account with a passkey goes on to the server', async () => {
    const api = accessApi(ok([ANNA, JAN]), { [ROLE]: () => json(200, { ...JAN, role: 'administrator', version: 4 }) });
    const dialog = await open(api);
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Administrator/ }));
    expect(within(dialog).getByText('Wszyscy administratorzy dostaną alert bezpieczeństwa.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień rolę' }));
    await waitFor(() => {
      expect(api.calls(ROLE)).toHaveLength(1);
    });
  });

  it('EVM-027 AC7 taking away the role Administrator adds the alert (no alert while the role stays), Edytor to Tylko odczyt does not', async () => {
    const alert = 'Wszyscy administratorzy dostaną alert bezpieczeństwa.';
    const jan = { ...JAN, role: 'administrator' } as const;
    const dialog = await open(accessApi(ok([ANNA, jan])), jan);
    expect(within(dialog).queryByText(alert)).toBeNull();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Edytor/ }));
    expect(within(dialog).getByText(alert)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Tylko odczyt/ }));
    expect(within(dialog).getByText(alert)).toBeTruthy();
  });

  it('EVM-027 AC7 a change between Edytor and Tylko odczyt sends no alert', async () => {
    const dialog = await open(accessApi(ok([ANNA, JAN])));
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Tylko odczyt/ }));
    expect(within(dialog).queryByText('Wszyscy administratorzy dostaną alert bezpieczeństwa.')).toBeNull();
  });

  it('EVM-027 AC1 an account without a passkey is told to add one first and nothing is sent (a code from the app is not enough)', async () => {
    const jan = { ...JAN, secondStepMethods: ['totp'] } satisfies User;
    const api = accessApi(ok([ANNA, jan]));
    const dialog = await open(api, jan);
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Administrator/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień rolę' }));
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'To konto musi najpierw dodać klucz dostępu (Konto → Drugi krok logowania).',
    );
    expect(api.calls(ROLE)).toHaveLength(0);
    // The message goes with the next choice.
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Tylko odczyt/ }));
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('EVM-027 AC1 when the server refuses with administrator_passkey_required the dialog says the same and keeps the choice', async () => {
    const api = accessApi(ok([ANNA, JAN]), { [ROLE]: () => problem(409, 'administrator_passkey_required') });
    const dialog = await open(api);
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Administrator/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień rolę' }));
    expect(await within(dialog).findByText('To konto musi najpierw dodać klucz dostępu (Konto → Drugi krok logowania).')).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: /^Administrator/, checked: true })).toBeTruthy();
  });
});

describe('W-16 Dezaktywuj, Reaktywuj, Wyloguj (EVM-027 AC2, AC3, AC7)', () => {
  it('EVM-027 AC2 the deactivation names the effect, is a danger button, sends If-Match and ends with the toast', async () => {
    const api = accessApi(ok([ANNA, JAN]), { [DEACTIVATE]: () => json(200, { ...JAN, status: 'deactivated', version: 4 }) });
    await renderPanel(PATH, api);
    await choose(JAN, 'Dezaktywuj konto…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Dezaktywować konto „Jan Przykładowy”?' });
    expect(within(dialog).getByText(/^Wszystkie sesje tego konta zakończą się od razu/)).toBeTruthy();
    expect(within(dialog).queryByText('Link z zaproszenia przestanie działać.')).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dezaktywuj konto' }));
    expect(await screen.findByText('Dezaktywowano konto.')).toBeTruthy();
    expect(api.calls(DEACTIVATE)[0]?.headers.get('If-Match')).toBe('"3"');
    expect(api.calls(DEACTIVATE)[0]?.body).toBe('');
    await waitFor(() => {
      expect(api.calls(LIST)).toHaveLength(2);
    });
  });

  it('EVM-027 AC2 an account that waits also loses the link of the invitation; an Administrator adds the alert', async () => {
    await renderPanel(PATH, accessApi(ok([ANNA, { ...BIURO, role: 'administrator' }])));
    await choose(BIURO, 'Dezaktywuj konto…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Dezaktywować konto „Biuro Testowe”?' });
    expect(within(dialog).getByText('Link z zaproszenia przestanie działać.')).toBeTruthy();
    // An account that waits is not an active Administrator: nobody is alerted.
    expect(within(dialog).queryByText('Wszyscy administratorzy dostaną alert bezpieczeństwa.')).toBeNull();
  });

  it('EVM-027 AC7 the deactivation of an active Administrator adds the alert for Administrators', async () => {
    const jan = { ...JAN, role: 'administrator' } as const;
    await renderPanel(PATH, accessApi(ok([ANNA, jan])));
    await choose(jan, 'Dezaktywuj konto…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Dezaktywować konto „Jan Przykładowy”?' });
    expect(within(dialog).getByText('Wszyscy administratorzy dostaną alert bezpieczeństwa.')).toBeTruthy();
  });

  it('EVM-027 AC2 the reactivation of an account that was active keeps the role and the second step; it sends If-Match', async () => {
    const api = accessApi(ok([ANNA, MAREK]), { [REACTIVATE]: () => json(200, { ...MAREK, status: 'active', version: 6 }) });
    await renderPanel(PATH, api);
    await choose(MAREK, 'Reaktywuj konto…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Reaktywować konto „Marek Testowy”?' });
    expect(within(dialog).getByText('Konto odzyska dostęp z rolą Edytor i dotychczasowymi metodami drugiego kroku.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reaktywuj konto' }));
    expect(await screen.findByText('Reaktywowano konto.')).toBeTruthy();
    expect(api.calls(REACTIVATE)[0]?.headers.get('If-Match')).toBe('"5"');
  });

  it('EVM-027 AC2 the reactivation of an account that was never activated says it needs a new invitation; an Administrator adds the alert (AC7)', async () => {
    const marek = { ...MAREK, role: 'administrator', activatedAt: null } as const;
    await renderPanel(PATH, accessApi(ok([ANNA, marek])));
    await choose(marek, 'Reaktywuj konto…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Reaktywować konto „Marek Testowy”?' });
    expect(within(dialog).getByText(/^Konto wróci do stanu „Oczekuje na aktywację”\./)).toBeTruthy();
    expect(within(dialog).getByText('Wszyscy administratorzy dostaną alert bezpieczeństwa.')).toBeTruthy();
  });

  it('EVM-027 AC3 "Wyloguj ze wszystkich sesji" sends no If-Match and ends with the toast', async () => {
    const api = accessApi(ok([ANNA, JAN]), { [SESSIONS]: () => new Response(null, { status: 204 }) });
    await renderPanel(PATH, api);
    await choose(JAN, 'Wyloguj ze wszystkich sesji…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Wylogować konto „Jan Przykładowy” ze wszystkich sesji?' });
    expect(within(dialog).getByText('Wszystkie sesje tego konta w panelu zakończą się od razu. Logowanie nadal działa.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyloguj ze wszystkich sesji' }));
    expect(await screen.findByText('Zakończono sesje konta.')).toBeTruthy();
    expect(api.calls(SESSIONS)[0]?.headers.get('If-Match')).toBeNull();
  });

  it('EVM-027 AC3 W-04 for the end of sessions is titled for it and "Anuluj" says nothing was done', async () => {
    const api = accessApi(ok([ANNA, JAN]), { [SESSIONS]: stepUpRequired });
    await renderPanel(PATH, api);
    await choose(JAN, 'Wyloguj ze wszystkich sesji…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Wylogować konto „Jan Przykładowy” ze wszystkich sesji?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyloguj ze wszystkich sesji' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zakończyć sesje użytkownika' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Anuluj' }));
    const back = await screen.findByRole('alertdialog', { name: 'Wylogować konto „Jan Przykładowy” ze wszystkich sesji?' });
    expect(within(back).getByRole('alert').textContent).toBe('Operacji nie wykonano — tożsamość nie została potwierdzona.');
    expect(api.calls(SESSIONS)).toHaveLength(1);
  });

  it('EVM-027 AC2 W-04 titles of the deactivation and of the reactivation', async () => {
    const api = accessApi(ok([ANNA, JAN, MAREK]), { [DEACTIVATE]: stepUpRequired, [REACTIVATE]: stepUpRequired });
    await renderPanel(PATH, api);
    await choose(JAN, 'Dezaktywuj konto…');
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Dezaktywuj konto' }));
    expect(await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby dezaktywować konto' })).toBeTruthy();
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    await choose(MAREK, 'Reaktywuj konto…');
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reaktywuj konto' }));
    expect(await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby reaktywować konto' })).toBeTruthy();
  });
});

describe('W-16 Zresetuj drugi krok logowania (EVM-027 AC4, AC7)', () => {
  const open = async (api: ReturnType<typeof accessApi>, user: User = JAN) => {
    await renderPanel(PATH, api);
    await choose(user, 'Zresetuj drugi krok logowania…');
    return screen.findByRole('dialog', { name: `Zresetować drugi krok logowania konta „${user.displayName}”?` });
  };

  it('EVM-027 AC4 the dialog asks how the identity was confirmed (no default, no free text) and says what is removed, the 24 hours and the password advice', async () => {
    const dialog = await open(accessApi(ok([ANNA, JAN])));
    const group = within(dialog).getByRole('group', { name: 'Jak potwierdzono tożsamość?' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).checked),
    ).toEqual([false, false]);
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(within(dialog).getByText(/^Usuniemy wszystkie metody drugiego kroku i kody odzyskiwania tego konta/)).toBeTruthy();
    expect(within(dialog).getByText(/^Drugi krok trzeba skonfigurować w ciągu 24 godzin/)).toBeTruthy();
    expect(within(dialog).getByText(/niech najpierw ustawi nowe hasło z innego urządzenia/)).toBeTruthy();
    expect(within(dialog).queryByText('Konto administratora skonfiguruje wyłącznie klucz dostępu.')).toBeNull();
    expect(within(dialog).queryByText('Wszyscy administratorzy dostaną alert bezpieczeństwa.')).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Anuluj' }));
  });

  it('EVM-027 AC4 without the choice nothing is sent and the message stands under the group', async () => {
    const api = accessApi(ok([ANNA, JAN]));
    const dialog = await open(api);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zresetuj drugi krok' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Wybierz, jak potwierdzono tożsamość.');
    expect(api.calls(RESET)).toHaveLength(0);
  });

  it('EVM-027 AC4 the choice goes as a code with If-Match, after W-04, and the toast says it is done', async () => {
    const answers: Handler[] = [stepUpRequired, () => json(200, { ...JAN, secondStepMethods: [], version: 4 })];
    let call = 0;
    const api = accessApi(ok([ANNA, JAN]), {
      [RESET]: (request) => answers[Math.min(call++, 1)]?.(request) ?? problem(500, 'internal_error'),
    });
    const dialog = await open(api);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'W rozmowie wideo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zresetuj drugi krok' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zresetować drugi krok logowania' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Użyj klucza dostępu' }));
    await waitFor(() => {
      expect(api.calls(RESET)).toHaveLength(2);
    });
    expect(parseBody(api.calls(RESET)[1]?.body ?? '')).toEqual({ identityVerification: 'video_call' });
    expect(api.calls(RESET)[1]?.headers.get('If-Match')).toBe('"3"');
    expect(await screen.findByText('Zresetowano drugi krok logowania.')).toBeTruthy();
  });

  it('EVM-027 AC4 "Osobiście" is sent as in_person', async () => {
    const api = accessApi(ok([ANNA, JAN]), { [RESET]: () => json(200, { ...JAN, secondStepMethods: [], version: 4 }) });
    const dialog = await open(api);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Osobiście' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zresetuj drugi krok' }));
    await waitFor(() => {
      expect(api.calls(RESET)).toHaveLength(1);
    });
    expect(parseBody(api.calls(RESET)[0]?.body ?? '')).toEqual({ identityVerification: 'in_person' });
  });

  it('EVM-027 AC7 for an Administrator the dialog says that only a key can be set up and that all Administrators are alerted', async () => {
    const jan = { ...JAN, role: 'administrator' } as const;
    const dialog = await open(accessApi(ok([ANNA, jan])), jan);
    expect(within(dialog).getByText('Konto administratora skonfiguruje wyłącznie klucz dostępu.')).toBeTruthy();
    expect(within(dialog).getByText('Wszyscy administratorzy dostaną alert bezpieczeństwa.')).toBeTruthy();
  });
});

describe('W-16 failures of the operations (EVM-027 AC5, AC8)', () => {
  const sessions = async (answer: Handler, list: Handler | Handler[] = ok([ANNA, JAN])) => {
    const api = accessApi(list, { [SESSIONS]: answer });
    await renderPanel(PATH, api);
    await choose(JAN, 'Wyloguj ze wszystkich sesji…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Wylogować konto „Jan Przykładowy” ze wszystkich sesji?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyloguj ze wszystkich sesji' }));
    return { api, dialog };
  };

  it('EVM-027 AC5 409 last_active_administrator says the system needs an Administrator; "Odśwież listę" closes the dialog and reads the list again', async () => {
    const { api, dialog } = await sessions(() => problem(409, 'last_active_administrator'));
    expect(
      await within(dialog).findByText('Nie zapisano zmiany — system musi mieć co najmniej jednego aktywnego administratora.'),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Odśwież listę' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    await waitFor(() => {
      expect(api.calls(LIST)).toHaveLength(2);
    });
  });

  it('EVM-027 AC5 409 own_account_not_allowed and 409 invalid_state_transition each say so', async () => {
    const answers: Handler[] = [() => problem(409, 'own_account_not_allowed'), () => problem(409, 'invalid_state_transition')];
    let call = 0;
    const { dialog } = await sessions((request) => answers[call++]?.(request) ?? problem(500, 'internal_error'));
    expect(await within(dialog).findByText('Tej operacji nie można wykonać na własnym koncie.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyloguj ze wszystkich sesji' }));
    expect(await within(dialog).findByText('Stan konta zmienił się i ta operacja nie jest już możliwa. Odśwież listę.')).toBeTruthy();
  });

  it('EVM-027 AC8 412 says the account changed meanwhile; "Odśwież dane konta" reads it again and the dialog keeps the choice and sends the new version', async () => {
    const answers: Handler[] = [() => problem(412, 'version_conflict'), () => json(200, { ...JAN, role: 'read_only', version: 5 })];
    let call = 0;
    const fresh = { ...JAN, version: 4, displayName: 'Jan Przykładowy' } satisfies User;
    const api = accessApi([ok([ANNA, JAN]), ok([ANNA, fresh])], {
      [ROLE]: (request) => answers[call++]?.(request) ?? problem(500, 'internal_error'),
    });
    await renderPanel(PATH, api);
    await choose(JAN, 'Zmień rolę…');
    const dialog = await screen.findByRole('dialog', { name: 'Zmienić rolę konta „Jan Przykładowy”?' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Tylko odczyt/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień rolę' }));
    expect(
      await within(dialog).findByText('To konto zmieniono w międzyczasie. Sprawdź jego aktualny stan i wybierz operację ponownie.'),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Odśwież dane konta' }));
    await waitFor(() => {
      expect(api.calls(LIST)).toHaveLength(2);
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: /^Tylko odczyt/, checked: true })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień rolę' }));
    await waitFor(() => {
      expect(api.calls(ROLE)).toHaveLength(2);
    });
    expect(api.calls(ROLE)[0]?.headers.get('If-Match')).toBe('"3"');
    expect(api.calls(ROLE)[1]?.headers.get('If-Match')).toBe('"4"');
  });

  it('EVM-027 AC8 404, 429, 500 and 403 each say it and keep the dialog', async () => {
    const answers: Handler[] = [
      () => problem(404, 'not_found'),
      () => problem(429, 'rate_limited', {}, { 'Retry-After': '300' }),
      () => json(500, {}),
      () => problem(403, 'forbidden'),
    ];
    let call = 0;
    const { dialog } = await sessions((request) => answers[call++]?.(request) ?? problem(500, 'internal_error'));
    expect(await within(dialog).findByText('Nie znaleziono konta. Odśwież listę.')).toBeTruthy();
    const press = () => userEvent.click(within(dialog).getByRole('button', { name: 'Wyloguj ze wszystkich sesji' }));
    await press();
    expect(await within(dialog).findByText('Zbyt wiele zapytań. Spróbuj ponownie za 5 min.')).toBeTruthy();
    await press();
    expect(await within(dialog).findByText(/^Nie udało się wykonać operacji\. Sprawdź połączenie/)).toBeTruthy();
    await press();
    expect(await within(dialog).findByText('Nie masz uprawnień do tej operacji.')).toBeTruthy();
  });

  it('EVM-027 AC8 offline the items of the menu stay disabled and an open dialog does not send', async () => {
    const api = accessApi(ok([ANNA, JAN]), { [SESSIONS]: () => new Response(null, { status: 204 }) });
    await renderPanel(PATH, api);
    await choose(JAN, 'Wyloguj ze wszystkich sesji…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Wylogować konto „Jan Przykładowy” ze wszystkich sesji?' });
    goOffline();
    const submit = within(dialog).getByRole('button', { name: 'Wyloguj ze wszystkich sesji' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(submit);
    expect(api.calls(SESSIONS)).toHaveLength(0);
  });

  it('EVM-027 AC8 offline the role dialog and the reset dialog say so and do not send', async () => {
    const api = accessApi(ok([ANNA, JAN]));
    await renderPanel(PATH, api);
    await choose(JAN, 'Zmień rolę…');
    const role = await screen.findByRole('dialog', { name: 'Zmienić rolę konta „Jan Przykładowy”?' });
    goOffline();
    expect(within(role).getByText(/^Brak połączenia\. Operacja wymaga połączenia z internetem/)).toBeTruthy();
    expect(within(role).getByRole('button', { name: 'Zmień rolę' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('W-16 operations pass axe (EVM-027 AC8)', () => {
  it('EVM-027 AC8 the role dialog, the reset dialog with an error and the confirmations have no violations', async () => {
    const jan = { ...JAN, role: 'administrator' } as const;
    await renderPanel(PATH, accessApi(ok([ANNA, jan, MAREK])));
    await choose(jan, 'Zmień rolę…');
    const role = await screen.findByRole('dialog', { name: 'Zmienić rolę konta „Jan Przykładowy”?' });
    expect(await axeViolations(role)).toEqual([]);
    await userEvent.click(within(role).getByRole('button', { name: 'Zmień rolę' }));
    expect(await axeViolations(role)).toEqual([]);
    await userEvent.click(within(role).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await choose(jan, 'Zresetuj drugi krok logowania…');
    const reset = await screen.findByRole('dialog', { name: 'Zresetować drugi krok logowania konta „Jan Przykładowy”?' });
    await userEvent.click(within(reset).getByRole('button', { name: 'Zresetuj drugi krok' }));
    expect(await axeViolations(reset)).toEqual([]);
    await userEvent.click(within(reset).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await choose(jan, 'Dezaktywuj konto…');
    expect(await axeViolations(await screen.findByRole('alertdialog'))).toEqual([]);
  });
});
