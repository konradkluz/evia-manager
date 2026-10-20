import type { CurrentSession, User } from '@evia/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetServerClock } from '../src/session/server-clock.ts';
import { resetStepUp } from '../src/session/step-up.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, createFakeApi, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { renderPanel } from './render.tsx';

const LIST = 'GET /api/v1/users';
const INVITE = 'POST /api/v1/users';
const OPTIONS = 'POST /api/v1/auth/step-up/options';
const STEP_UP = 'POST /api/v1/auth/step-up';
const PATH = '/administration/users';
const BIURO_ID = '33333333-3333-4333-8333-333333333333';
const JAN_ID = '22222222-2222-4222-8222-222222222222';
const RESEND = `POST /api/v1/users/${BIURO_ID}/invitations`;

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

const ANNA: User = {
  id: ACTIVE_SESSION.user.id,
  email: 'anna.testowa@example.com',
  displayName: 'Anna Testowa',
  role: 'administrator',
  status: 'active',
  invitation: null,
  version: 1,
  activatedAt: '2026-09-01T08:00:00.000Z',
  secondStepMethods: ['passkey'],
};
const JAN: User = {
  id: JAN_ID,
  email: 'jan.przykladowy@example.com',
  displayName: 'Jan Przykładowy',
  role: 'editor',
  status: 'deactivated',
  invitation: null,
  version: 3,
  activatedAt: '2026-09-01T08:00:00.000Z',
  secondStepMethods: ['passkey'],
};
const biuro = (invitation: User['invitation'], role: User['role'] = 'read_only'): User => ({
  id: BIURO_ID,
  email: 'biuro@example.com',
  displayName: 'Biuro Testowe',
  role,
  status: 'invited',
  invitation,
  version: 1,
  activatedAt: null,
  secondStepMethods: [],
});
const SENT = { state: 'sent', sentAt: '2026-10-03T08:00:00.000Z', expiresAt: '2026-10-06T08:00:00.000Z' } as const;

const page = (items: User[], nextCursor: string | null = null) => ({ items, nextCursor });
const ok =
  (items: User[], next: string | null = null): Handler =>
  () =>
    json(200, page(items, next));
const stepUpRequired = () => problem(403, 'step_up_required');

/** A fake server of the users and of W-04; `list` answers one read after another (the last one repeats). */
function usersApi(list: Handler | Handler[], session: CurrentSession = ACTIVE_SESSION, extra: Record<string, Handler> = {}) {
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

const scrollIntoView = vi.fn();

beforeEach(() => {
  // jsdom has no layout: "Pokaż konto" scrolls the row into view and the test only asks that it did.
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
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

/** The button of the page header (with only the own account the empty state repeats it). */
const firstInvite = async () => (await screen.findAllByRole('button', { name: 'Zaproś użytkownika' }))[0] as HTMLElement;

const typeInvitation = async (email = 'anna.nowak@example.com', name = 'Anna Nowak') => {
  await userEvent.type(screen.getByRole('textbox', { name: 'E-mail' }), email);
  await userEvent.type(screen.getByRole('textbox', { name: 'Nazwa wyświetlana' }), name);
};

describe('W-16 the list (EVM-024 AC5, AC7, AC8)', () => {
  it('EVM-024 AC5 the table shows name with "(Ty)", role, status with icon and word, the state of the invitation, and a menu on every row but the own one', async () => {
    const api = usersApi(ok([ANNA, JAN, biuro(SENT)]));
    await renderPanel(PATH, api);
    const table = await screen.findByRole('table', { name: 'Użytkownicy' });
    expect(screen.getByRole('heading', { level: 1, name: 'Użytkownicy' })).toBeTruthy();
    expect(document.title).toBe('Użytkownicy · EVia Manager');
    expect(screen.getByRole('tab', { name: 'Użytkownicy', selected: true })).toBeTruthy();
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1]?.getAttribute('aria-label')).toBe('Anna Testowa (Ty), Administrator, Aktywne');
    expect(within(rows[1] as HTMLElement).getByText('Anna Testowa (Ty)')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Dezaktywowane')).toBeTruthy();
    expect(within(rows[3] as HTMLElement).getByText('Oczekuje na aktywację')).toBeTruthy();
    expect(within(rows[3] as HTMLElement).getByText('Wysłano 03.10.2026 · ważne do 06.10.2026, 10:00')).toBeTruthy();
    // The own row has no menu (EVM-027: nothing is allowed on the own account); the others have the menu named with the e-mail.
    expect(within(table).getAllByRole('button', { name: /^Akcje konta/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Akcje konta: Biuro Testowe, biuro@example.com' })).toBeTruthy();
    expect(api.calls(LIST)[0]?.query.get('limit')).toBe('25');
    // No link and no token anywhere on the page.
    expect(document.body.textContent).not.toMatch(/#|token|link:/i);
  });

  it('EVM-024 AC5 the states of the invitation: Wysyłanie…, Nie wysłano and Wygasło with "Wyślij ponownie" named with the object', async () => {
    const rows = [
      { ...biuro({ state: 'sending', sentAt: null, expiresAt: null }), id: '44444444-4444-4444-8444-444444444441', displayName: 'Jedna' },
      { ...biuro({ state: 'failed', sentAt: null, expiresAt: null }) },
      {
        ...biuro({ state: 'expired', sentAt: '2026-10-01T08:00:00.000Z', expiresAt: '2026-10-04T08:00:00.000Z' }),
        id: '44444444-4444-4444-8444-444444444443',
        displayName: 'Trzecia',
      },
    ];
    await renderPanel(PATH, usersApi(ok([ANNA, ...rows])));
    const table = await screen.findByRole('table', { name: 'Użytkownicy' });
    expect(within(table).getByText('Wysyłanie…')).toBeTruthy();
    expect(within(table).getByText('Nie wysłano')).toBeTruthy();
    expect(within(table).getByText('Wygasło 04.10.2026')).toBeTruthy();
    // "Wysyłanie…" has no action; the other two have one, and its name begins with the visible label (WCAG 2.5.3).
    expect(within(table).getAllByRole('button', { name: /^Wyślij ponownie zaproszenie: / })).toHaveLength(2);
    expect(within(table).getByRole('button', { name: 'Wyślij ponownie zaproszenie: Biuro Testowe, biuro@example.com' })).toBeTruthy();
  });

  it('EVM-024 AC5 a link that ran out since the list was read is shown as expired', async () => {
    vi.setSystemTime(new Date('2026-10-07T10:00:00.000Z'));
    await renderPanel(PATH, usersApi(ok([ANNA, biuro(SENT)])));
    const table = await screen.findByRole('table', { name: 'Użytkownicy' });
    expect(within(table).getByText('Wygasło 06.10.2026')).toBeTruthy();
    expect(within(table).getByRole('button', { name: /^Wyślij ponownie zaproszenie/ })).toBeTruthy();
  });

  it('EVM-024 AC8 an Edytor sees "Brak dostępu", the panel does not even ask the API for the list, and the menu has no "Administracja"', async () => {
    const editor: CurrentSession = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'editor' } };
    const api = usersApi(ok([ANNA]), editor);
    await renderPanel(PATH, api);
    expect(await screen.findByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeTruthy();
    expect(document.title).toBe('Brak dostępu · EVia Manager');
    expect(api.calls(LIST)).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Administracja' })).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('anna.testowa@example.com')).toBeNull();
  });

  it('EVM-024 AC8 403 forbidden from the server (the role changed meanwhile) gives the same "Brak dostępu", never W-04', async () => {
    await renderPanel(
      PATH,
      usersApi(() => problem(403, 'forbidden')),
    );
    expect(await screen.findByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('EVM-024 AC8 Tylko odczyt gets the same answer as Edytor', async () => {
    const readOnly: CurrentSession = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'read_only' } };
    const api = usersApi(ok([ANNA]), readOnly);
    await renderPanel(PATH, api);
    expect(await screen.findByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeTruthy();
    expect(api.calls(LIST)).toHaveLength(0);
  });

  it('EVM-024 AC1 the empty list (only the own account) says so, offers the invitation and warns that the Administrator is the only one', async () => {
    await renderPanel(PATH, usersApi(ok([ANNA])));
    expect(await screen.findByRole('heading', { name: 'Na liście jest tylko Twoje konto.' })).toBeTruthy();
    expect(screen.getByText(/Jesteś jedynym aktywnym administratorem/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Zaproś użytkownika' })).toHaveLength(2);
  });

  it('EVM-024 AC1 with a second active Administrator there is no warning and no empty state', async () => {
    await renderPanel(PATH, usersApi(ok([ANNA, { ...JAN, role: 'administrator', status: 'active' }])));
    await screen.findByRole('table', { name: 'Użytkownicy' });
    expect(screen.queryByText(/Jesteś jedynym aktywnym administratorem/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Na liście jest tylko Twoje konto.' })).toBeNull();
  });

  it('EVM-024 AC5 loading shows a skeleton with a status; a failed read shows the error with "Spróbuj ponownie"; 429 says when to try again', async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const api = usersApi([() => pending, () => problem(429, 'rate_limited', {}, { 'Retry-After': '120' }), ok([ANNA, JAN])]);
    await renderPanel(PATH, api);
    expect(screen.getByText('Ładowanie…').closest('[role="status"]')).not.toBeNull();
    release(problem(500, 'internal_error'));
    expect(await screen.findByRole('heading', { name: 'Nie udało się wczytać użytkowników.' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Zbyt wiele zapytań. Spróbuj ponownie za 2 min.');
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('table', { name: 'Użytkownicy' })).toBeTruthy();
  });

  it('EVM-024 AC5 offline the last page stays under "Dane mogą być nieaktualne", and the invitation, the resend and the menu are disabled with their reason', async () => {
    const api = usersApi(ok([ANNA, biuro({ state: 'failed', sentAt: null, expiresAt: null })]));
    await renderPanel(PATH, api);
    await screen.findByRole('table', { name: 'Użytkownicy' });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    const invite = screen.getByRole('button', { name: 'Zaproś użytkownika' });
    expect(invite.getAttribute('aria-disabled')).toBe('true');
    expect(invite.getAttribute('title')).toBe('Zmienisz po powrocie połączenia.');
    const resend = screen.getByRole('button', { name: /^Wyślij ponownie zaproszenie/ });
    expect(resend.getAttribute('aria-disabled')).toBe('true');
    const menu = screen.getByRole('button', { name: /^Akcje konta/ });
    expect(menu.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(menu);
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(invite);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Brak połączenia — strony są niedostępne.')).toBeTruthy();
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });

  it('EVM-024 AC5 pages: the next page uses the cursor, the focus goes to the heading with an announcement, and the previous page comes back', async () => {
    const api = usersApi([ok([ANNA], 'cursor-2'), ok([JAN], null), ok([ANNA], 'cursor-2')]);
    await renderPanel(PATH, api);
    await screen.findByRole('table', { name: 'Użytkownicy' });
    expect(screen.getByRole('button', { name: 'Poprzednia strona' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    await screen.findByText('Jan Przykładowy');
    expect(api.calls(LIST)[1]?.query.get('cursor')).toBe('cursor-2');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: /Konta użytkowników/ }));
    });
    expect(screen.getByText('Wczytano następną stronę użytkowników').closest('[role="status"]')).not.toBeNull();
    // The last page: no soleness is claimed from a part of the list, and "Następna strona" is off.
    expect(screen.getByRole('button', { name: 'Następna strona' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Poprzednia strona' }));
    await screen.findByText('Anna Testowa (Ty)');
    expect(screen.getByText('Wczytano poprzednią stronę użytkowników')).toBeTruthy();
  });

  it('EVM-024 AC5 a cursor the server refuses (400 invalid_cursor) returns to the first page with a message', async () => {
    const api = usersApi([ok([ANNA], 'cursor-2'), () => problem(400, 'invalid_cursor'), ok([ANNA, JAN], null)]);
    await renderPanel(PATH, api);
    await screen.findByRole('table', { name: 'Użytkownicy' });
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByText('Lista została zaktualizowana — wróciliśmy na początek.')).toBeTruthy();
    expect(await screen.findByText('Jan Przykładowy')).toBeTruthy();
  });

  it('EVM-024 AC5 the list is not kept in the memory of the tab once the page is left (gcTime 0)', async () => {
    const { history } = await renderPanel(PATH, usersApi(ok([ANNA, JAN])));
    await screen.findByRole('table', { name: 'Użytkownicy' });
    act(() => {
      history.push('/work-orders');
    });
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    expect(screen.queryByText('jan.przykladowy@example.com')).toBeNull();
  });

  it('EVM-024 AC8 the page passes axe: the list, the menu and the dialog of the invitation', async () => {
    await renderPanel(PATH, usersApi(ok([ANNA, JAN, biuro({ state: 'failed', sentAt: null, expiresAt: null })])));
    const table = await screen.findByRole('table', { name: 'Użytkownicy' });
    expect(await axeViolations(table.closest('[role="tabpanel"]') ?? table, { bestPractice: false })).toEqual([]);
    await userEvent.click(await firstInvite());
    expect(await axeViolations(await screen.findByRole('dialog'))).toEqual([]);
  });
});

describe('W-16 Zaproś użytkownika (EVM-024 AC1, AC2, AC7)', () => {
  it('EVM-024 AC1 the dialog has e-mail, name, the role with Edytor by default and the summary; the focus is on the e-mail and returns to the button', async () => {
    await renderPanel(PATH, usersApi(ok([ANNA, JAN])));
    await userEvent.click(await firstInvite());
    const dialog = await screen.findByRole('dialog', { name: 'Zaproś użytkownika' });
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'E-mail' }));
    expect(within(dialog).getByRole('textbox', { name: 'Nazwa wyświetlana' })).toBeTruthy();
    expect(within(dialog).getByText('Widzą ją inni użytkownicy. Osoba może ją potem zmienić.')).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'Edytor — zlecenia, klienci, płatności i media' })).toHaveProperty('checked', true);
    expect(within(dialog).getByText(/Wyślemy e-mail z linkiem ważnym 72 godziny/)).toBeTruthy();
    expect(within(dialog).queryByText('Wszyscy administratorzy dostaną alert bezpieczeństwa.')).toBeNull();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Administrator/ }));
    expect(within(dialog).getByText('Wszyscy administratorzy dostaną alert bezpieczeństwa.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zaproś użytkownika' }));
  });

  it('EVM-024 AC1 403 step_up_required opens W-04 "Potwierdź tożsamość, aby zaprosić użytkownika", the dialog steps aside with its data; after the key the SAME request (same id and key) is sent once and the list is read again', async () => {
    const posts: Handler[] = [
      stepUpRequired,
      () =>
        json(
          201,
          {
            ...biuro({ state: 'sending', sentAt: null, expiresAt: null }),
            displayName: 'Anna Nowak',
            email: 'anna.nowak@example.com',
            role: 'editor',
          },
          { Location: '/api/v1/users/x' },
        ),
    ];
    let call = 0;
    const api = usersApi(ok([ANNA]), ACTIVE_SESSION, {
      [INVITE]: (request) => posts[Math.min(call++, 1)]?.(request) ?? problem(500, 'internal_error'),
    });
    await renderPanel(PATH, api);
    await userEvent.click(await firstInvite());
    await typeInvitation();
    await userEvent.click(screen.getByRole('button', { name: 'Zaproś' }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zaprosić użytkownika' });
    expect(screen.queryByRole('dialog', { name: 'Zaproś użytkownika' })).toBeNull();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Użyj klucza dostępu' }));

    await waitFor(() => {
      expect(api.calls(INVITE)).toHaveLength(2);
    });
    const [first, second] = api.calls(INVITE);
    expect(first?.body).toBe(second?.body);
    expect(first?.headers.get('Idempotency-Key')).toBe(second?.headers.get('Idempotency-Key'));
    const body = parseBody(second?.body ?? '') as { id: string; email: string; displayName: string; role: string };
    expect(Object.keys(body).sort()).toEqual(['displayName', 'email', 'id', 'role']);
    expect(body).toMatchObject({ email: 'anna.nowak@example.com', displayName: 'Anna Nowak', role: 'editor' });
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(api.calls(STEP_UP)).toHaveLength(1);
    expect((await screen.findByText('Wysłano zaproszenie.')).closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(api.calls(LIST)).toHaveLength(2);
    });
    // The typed data is gone with the dialog: opening it again gives an empty form.
    await userEvent.click(await firstInvite());
    expect(await screen.findByRole('textbox', { name: 'E-mail' })).toHaveProperty('value', '');
  });

  it('EVM-024 AC1 "Anuluj" in W-04 sends nothing again, the dialog comes back with its data and says that the identity was not confirmed', async () => {
    const api = usersApi(ok([ANNA]), ACTIVE_SESSION, { [INVITE]: stepUpRequired });
    await renderPanel(PATH, api);
    await userEvent.click(await firstInvite());
    await typeInvitation();
    await userEvent.click(screen.getByRole('button', { name: 'Zaproś' }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Anuluj' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zaproś użytkownika' });
    expect(within(dialog).getByRole('alert').textContent).toBe('Nie wysłano zaproszenia — tożsamość nie została potwierdzona.');
    expect(within(dialog).getByRole('textbox', { name: 'E-mail' })).toHaveProperty('value', 'anna.nowak@example.com');
    expect(api.calls(INVITE)).toHaveLength(1);
    expect(document.activeElement).toBe(within(dialog).getByRole('alert'));
  });

  it('EVM-024 AC1 a second step_up_required after the confirmation is an error of the dialog, not a loop', async () => {
    const api = usersApi(ok([ANNA]), ACTIVE_SESSION, { [INVITE]: stepUpRequired });
    await renderPanel(PATH, api);
    await userEvent.click(await firstInvite());
    await typeInvitation();
    await userEvent.click(screen.getByRole('button', { name: 'Zaproś' }));
    await userEvent.click(await within(await screen.findByRole('alertdialog')).findByRole('button', { name: 'Użyj klucza dostępu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zaproś użytkownika' });
    await waitFor(() => {
      expect(api.calls(INVITE)).toHaveLength(2);
    });
    expect(within(dialog).getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls(STEP_UP)).toHaveLength(1);
  });

  it('EVM-024 AC2 an address with CR/LF, quotes or two @ is stopped before it is sent, with the sentence of the story under the field and the focus on it', async () => {
    const api = usersApi(ok([ANNA]), ACTIVE_SESSION, { [INVITE]: () => json(201, biuro(null)) });
    await renderPanel(PATH, api);
    await userEvent.click(await firstInvite());
    const email = screen.getByRole('textbox', { name: 'E-mail' });
    for (const bad of ['"a@b"@example.com', 'a@b@example.test', 'brak-malpy', 'a@b.test,c@d.test']) {
      await userEvent.clear(email);
      await userEvent.type(email, bad);
      await userEvent.type(screen.getByRole('textbox', { name: 'Nazwa wyświetlana' }), 'x');
      await userEvent.click(screen.getByRole('button', { name: 'Zaproś' }));
      expect((await screen.findAllByText('Podaj adres e-mail, np. jan.przykladowy@example.com.')).length).toBeGreaterThan(0);
      expect(document.activeElement).toBe(email);
    }
    expect(api.calls(INVITE)).toHaveLength(0);
    // The name is required too.
    await userEvent.clear(email);
    await userEvent.type(email, 'anna.nowak@example.com');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Nazwa wyświetlana' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zaproś' }));
    expect(await screen.findByText('Podaj nazwę wyświetlaną.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Nazwa wyświetlana' }));
  });

  it('EVM-024 AC2 a 400 validation_failed of the server (CR/LF in the address, a long name) shows the text under the field and keeps the data', async () => {
    const api = usersApi(ok([ANNA]), ACTIVE_SESSION, {
      [INVITE]: () =>
        problem(400, 'validation_failed', {
          errors: [
            { pointer: '/email', code: 'invalid_email' },
            { pointer: '/displayName', code: 'too_long' },
          ],
        }),
    });
    await renderPanel(PATH, api);
    await userEvent.click(await firstInvite());
    await typeInvitation();
    await userEvent.click(screen.getByRole('button', { name: 'Zaproś' }));
    expect(await screen.findByText('Podaj adres e-mail, np. jan.przykladowy@example.com.')).toBeTruthy();
    expect(screen.getByText('Nazwa może mieć najwyżej 200 znaków.')).toBeTruthy();
    expect(screen.getByText('Popraw zaznaczone pola.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'E-mail' })).toHaveProperty('value', 'anna.nowak@example.com');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'E-mail' }));
  });

  it('EVM-024 AC7 409 email_conflict names the account of the list with its status and "Pokaż konto" closes the dialog and focuses the row', async () => {
    const api = usersApi(ok([ANNA, JAN]), ACTIVE_SESSION, {
      [INVITE]: () => problem(409, 'email_conflict', { existingUserId: JAN_ID }),
    });
    await renderPanel(PATH, api);
    await userEvent.click(await firstInvite());
    await typeInvitation('jan.przykladowy@example.com', 'Jan');
    await userEvent.click(screen.getByRole('button', { name: 'Zaproś' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zaproś użytkownika' });
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Konto z tym adresem już istnieje: Jan Przykładowy · Dezaktywowane.',
    );
    // The answer carries no address and no name; neither does the panel put them in the alert but from its own list.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pokaż konto' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement?.textContent).toBe('Jan Przykładowy');
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('EVM-024 AC7 409 email_conflict of a deleted account or of one that is not on the page says it without a name and without "Pokaż konto"', async () => {
    const api = usersApi(ok([ANNA]), ACTIVE_SESSION, { [INVITE]: () => problem(409, 'email_conflict') });
    await renderPanel(PATH, api);
    await userEvent.click(await firstInvite());
    await typeInvitation();
    await userEvent.click(screen.getByRole('button', { name: 'Zaproś' }));
    const dialog = await screen.findByRole('dialog');
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Konto z tym adresem już istnieje.');
    expect(within(dialog).queryByRole('button', { name: 'Pokaż konto' })).toBeNull();
  });

  it('EVM-024 AC1 failures of the invitation: a network error keeps the same id and key for the retry; 403, 429, 409 in progress and 500 each have a sentence; a refused id starts anew', async () => {
    const answers: Handler[] = [
      () => json(500, { code: 'internal_error' }),
      () => problem(403, 'forbidden'),
      () => problem(429, 'rate_limited', {}, { 'Retry-After': '60' }),
      () => problem(409, 'idempotency_in_progress'),
      () => problem(409, 'id_conflict'),
      () => json(201, biuro(null)),
    ];
    let call = 0;
    const api = usersApi(ok([ANNA]), ACTIVE_SESSION, {
      [INVITE]: (request) => answers[call++]?.(request) ?? problem(500, 'internal_error'),
    });
    await renderPanel(PATH, api);
    await userEvent.click(await firstInvite());
    await typeInvitation();
    const submit = screen.getByRole('button', { name: 'Zaproś' });
    const alert = async () => (await screen.findByRole('alert')).textContent;
    await userEvent.click(submit);
    expect(await alert()).toContain('Nie udało się wysłać zaproszenia.');
    await userEvent.click(submit);
    expect(await screen.findByText('Nie masz uprawnień do tej operacji.')).toBeTruthy();
    await userEvent.click(submit);
    expect(await screen.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 1 min.')).toBeTruthy();
    await userEvent.click(submit);
    expect(await screen.findByText(/Poprzednie żądanie jest jeszcze w toku/)).toBeTruthy();
    await userEvent.click(submit);
    await waitFor(() => {
      expect(api.calls(INVITE)).toHaveLength(5);
    });
    const requests = api.calls(INVITE);
    // The first four sent the same pair (nothing is created twice); after `id_conflict` the next one is named anew.
    expect(new Set(requests.slice(0, 5).map((request) => request.headers.get('Idempotency-Key'))).size).toBe(1);
    await userEvent.click(submit);
    await waitFor(() => {
      expect(api.calls(INVITE)).toHaveLength(6);
    });
    expect(api.calls(INVITE)[5]?.headers.get('Idempotency-Key')).not.toBe(api.calls(INVITE)[0]?.headers.get('Idempotency-Key'));
    expect(await screen.findByText('Wysłano zaproszenie.')).toBeTruthy();
  });

  it('EVM-024 AC1 offline the dialog says so, keeps the data and does not send', async () => {
    const api = usersApi(ok([ANNA]), ACTIVE_SESSION, { [INVITE]: () => json(201, biuro(null)) });
    await renderPanel(PATH, api);
    await userEvent.click(await firstInvite());
    await typeInvitation();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Brak połączenia\. Zaproszenie wymaga połączenia z internetem/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zaproś' }));
    expect(api.calls(INVITE)).toHaveLength(0);
    expect(within(dialog).getByRole('textbox', { name: 'E-mail' })).toHaveProperty('value', 'anna.nowak@example.com');
  });
});

describe('W-16 Wyślij zaproszenie ponownie (EVM-024 AC4, AC5)', () => {
  const open = async (api: ReturnType<typeof usersApi>) => {
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje konta: Biuro Testowe, biuro@example.com' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Wyślij zaproszenie ponownie…' }));
    return screen.findByRole('alertdialog', { name: 'Wysłać zaproszenie ponownie?' });
  };

  it('EVM-024 AC4 the dialog names the address, says that the previous link stops working (while it is valid) and has the focus on "Anuluj"', async () => {
    const dialog = await open(usersApi(ok([ANNA, biuro(SENT)])));
    expect(within(dialog).getByText('Wyślemy nowy link ważny 72 godziny na adres biuro@example.com.')).toBeTruthy();
    expect(within(dialog).getByText('Poprzedni link przestanie działać.')).toBeTruthy();
    expect(within(dialog).queryByText('Wszyscy administratorzy dostaną alert bezpieczeństwa.')).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje konta: Biuro Testowe, biuro@example.com' }));
  });

  it('EVM-024 AC4 a failed invitation has no previous link to speak of; the role Administrator adds the alert for Administrators (AC1)', async () => {
    const dialog = await open(usersApi(ok([ANNA, biuro({ state: 'failed', sentAt: null, expiresAt: null }, 'administrator')])));
    expect(within(dialog).queryByText('Poprzedni link przestanie działać.')).toBeNull();
    expect(within(dialog).getByText('Wszyscy administratorzy dostaną alert bezpieczeństwa.')).toBeTruthy();
  });

  it('EVM-024 AC4 the button sends once, W-04 asks "…, aby ponownie wysłać zaproszenie" and the same request follows; the list is read again and a toast says it', async () => {
    const answers: Handler[] = [stepUpRequired, () => json(200, biuro({ state: 'sending', sentAt: null, expiresAt: null }))];
    let call = 0;
    const api = usersApi(ok([ANNA, biuro(SENT)]), ACTIVE_SESSION, {
      [RESEND]: (request) => answers[Math.min(call++, 1)]?.(request) ?? problem(500, 'internal_error'),
    });
    const dialog = await open(api);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyślij ponownie' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby ponownie wysłać zaproszenie' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Użyj klucza dostępu' }));
    await waitFor(() => {
      expect(api.calls(RESEND)).toHaveLength(2);
    });
    expect(api.calls(RESEND)[0]?.body).toBe('');
    expect(await screen.findByText('Wysłano zaproszenie ponownie.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    await waitFor(() => {
      expect(api.calls(LIST)).toHaveLength(2);
    });
  });

  it('EVM-024 AC4 "Wyślij ponownie" in the cell of a failed invitation opens the same dialog, and after "Anuluj" of W-04 the dialog says nothing was sent', async () => {
    const api = usersApi(ok([ANNA, biuro({ state: 'failed', sentAt: null, expiresAt: null })]), ACTIVE_SESSION, {
      [RESEND]: stepUpRequired,
    });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Wyślij ponownie zaproszenie: Biuro Testowe, biuro@example.com' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Wysłać zaproszenie ponownie?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyślij ponownie' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby ponownie wysłać zaproszenie' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Anuluj' }));
    const back = await screen.findByRole('alertdialog', { name: 'Wysłać zaproszenie ponownie?' });
    expect(within(back).getByRole('alert').textContent).toContain('tożsamość nie została potwierdzona');
    expect(api.calls(RESEND)).toHaveLength(1);
  });

  it('EVM-024 AC4 an account that no longer waits (409) or is gone (404) says so with "Odśwież listę", which reads the list again', async () => {
    const answers: Handler[] = [() => problem(409, 'invalid_state_transition'), () => problem(404, 'not_found')];
    let call = 0;
    const api = usersApi(ok([ANNA, biuro(SENT)]), ACTIVE_SESSION, {
      [RESEND]: (request) => answers[call++]?.(request) ?? problem(500, 'internal_error'),
    });
    const dialog = await open(api);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyślij ponownie' }));
    expect(await within(dialog).findByText('To konto już nie oczekuje na aktywację. Odśwież listę.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyślij ponownie' }));
    expect(await within(dialog).findByText('Nie znaleziono konta. Odśwież listę.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Odśwież listę' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    await waitFor(() => {
      expect(api.calls(LIST)).toHaveLength(2);
    });
  });

  it('EVM-024 AC5 other failures of the resend: 500 and 429 each say it; the data is not lost', async () => {
    const answers: Handler[] = [() => json(500, {}), () => problem(429, 'rate_limited', {}, { 'Retry-After': '300' })];
    let call = 0;
    const api = usersApi(ok([ANNA, biuro(SENT)]), ACTIVE_SESSION, {
      [RESEND]: (request) => answers[call++]?.(request) ?? problem(500, 'internal_error'),
    });
    const dialog = await open(api);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyślij ponownie' }));
    expect(await within(dialog).findByText(/Nie udało się wysłać zaproszenia\./)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyślij ponownie' }));
    expect(await within(dialog).findByText('Zbyt wiele zapytań. Spróbuj ponownie za 5 min.')).toBeTruthy();
    expect(within(dialog).getByText('Wyślemy nowy link ważny 72 godziny na adres biuro@example.com.')).toBeTruthy();
  });

  it('EVM-024 AC4 the dialog passes axe', async () => {
    const dialog = await open(usersApi(ok([ANNA, biuro(SENT, 'administrator')])));
    expect(await axeViolations(dialog)).toEqual([]);
  });
});
