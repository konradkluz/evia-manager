import type { AuditEvent, AuditEventList, CurrentSession } from '@evia/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCsrfToken } from '../src/session/csrf.ts';
import { resetServerClock } from '../src/session/server-clock.ts';
import { lastStepUpAt, resetStepUp, runStepUp } from '../src/session/step-up.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, createFakeApi, json, parseBody, problem, SESSION_ROUTE } from './api-fake.ts';
import { renderPanel } from './render.tsx';

const EVENTS = 'GET /api/v1/audit/events';
const OPTIONS = 'POST /api/v1/auth/step-up/options';
const STEP_UP = 'POST /api/v1/auth/step-up';
const AUDIT_PATH = '/administration/audit';
const TITLE = 'Potwierdź tożsamość, aby przejrzeć dziennik audytu';
const MINUTE = 60_000;

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

function stubWebAuthn(get: () => Promise<unknown> = () => Promise.resolve(new FakePublicKeyCredential())) {
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
  const spy = vi.fn(get);
  Object.defineProperty(navigator, 'credentials', { value: { get: spy }, configurable: true });
  return spy;
}

const ANNA = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa' };
const JAN = { userId: '22222222-2222-4222-8222-222222222222', displayName: 'Jan Przykładowy' };

function event(index: number, overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    occurredAt: '2026-10-04T12:05:00.000Z',
    actor: ANNA,
    action: 'audit.read',
    outcome: 'success',
    reasonCode: null,
    objectType: 'audit',
    objectId: null,
    ipPrefix: '198.51.100.0/24',
    ...overrides,
  };
}

const page = (items: AuditEvent[], nextCursor: string | null = null): AuditEventList => ({ items, nextCursor });

const EDITOR_SESSION: CurrentSession = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'editor' } };

/** A fake server of the audit log; `events` answers one request after another (the last one repeats). */
function auditApi(events: Array<() => Response | Promise<Response>>, session: CurrentSession = ACTIVE_SESSION) {
  let call = 0;
  let rotated = false;
  return createFakeApi({
    // The server answers the session with the token of the current session: after the step-up it is the new one.
    [SESSION_ROUTE]: () => json(200, rotated ? { ...session, csrfToken: 'csrf-rotated' } : session),
    [EVENTS]: () => events[Math.min(call++, events.length - 1)]?.() ?? problem(500, 'internal_error'),
    [OPTIONS]: () => json(200, PASSKEY_OPTIONS),
    [STEP_UP]: () => {
      rotated = true;
      return json(200, { csrfToken: 'csrf-rotated' });
    },
  });
}

const ok =
  (items: AuditEvent[] = [event(1)], next: string | null = null) =>
  () =>
    json(200, page(items, next));
const stepUpRequired = () => problem(403, 'step_up_required');

function lastQuery(api: ReturnType<typeof auditApi>): URLSearchParams {
  const raw = api.fetch as unknown as { mock: { calls: Array<[Request]> } };
  const requests = raw.mock.calls.map(([input]) => input.url).filter((url) => url.includes('/api/v1/audit/events'));
  return new URL(requests.at(-1) ?? '').searchParams;
}

beforeEach(() => {
  stubWebAuthn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'credentials');
  FakePublicKeyCredential.parseRequestOptionsFromJSON.mockClear();
  resetStepUp();
  resetServerClock();
});

describe('W-18 / W-04: step-up (EVM-029 AC1, AC2, AC3)', () => {
  it('EVM-029 AC1 403 step_up_required opens W-04 with the title of the audit log, focus on the key; after the key the same request is sent again, once', async () => {
    const api = auditApi([stepUpRequired, ok([event(1, { action: 'login.succeeded' })])]);
    await renderPanel(AUDIT_PATH, api);
    const dialog = await screen.findByRole('alertdialog', { name: TITLE });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(api.calls(EVENTS)).toHaveLength(1);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Użyj klucza dostępu' }));

    expect(await screen.findByRole('table', { name: 'Dziennik audytu — zdarzenia od najnowszych' })).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls(OPTIONS)).toHaveLength(1);
    expect(parseBody(api.calls(STEP_UP)[0]?.body ?? '')).toEqual({ credential: CREDENTIAL });
    // The request is repeated automatically: two reads in all, no more.
    expect(api.calls(EVENTS)).toHaveLength(2);
  });

  it('EVM-029 AC1 a second 403 after the confirmation does not open W-04 again (no loop): the state "Potwierdź tożsamość" shows', async () => {
    const api = auditApi([stepUpRequired]);
    await renderPanel(AUDIT_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(await screen.findByRole('heading', { name: 'Potwierdź tożsamość, aby zobaczyć dziennik audytu.' })).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls(EVENTS)).toHaveLength(2);
    expect(api.calls(STEP_UP)).toHaveLength(1);
  });

  it('EVM-029 AC2 a read that the server allows shows the log with no W-04 and no request for the key', async () => {
    const api = auditApi([ok()]);
    await renderPanel(AUDIT_PATH, api);
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls(OPTIONS)).toHaveLength(0);
    expect(api.calls(STEP_UP)).toHaveLength(0);
  });

  it('EVM-029 AC3 the answer replaces the CSRF token of the tab (the session was rotated) and the session is read again', async () => {
    const api = auditApi([stepUpRequired, ok()]);
    await renderPanel(AUDIT_PATH, api);
    expect(getCsrfToken()).toBe('csrf-active');
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    await screen.findByRole('table');
    expect(getCsrfToken()).toBe('csrf-rotated');
    await waitFor(() => {
      expect(api.calls(SESSION_ROUTE).length).toBeGreaterThan(1);
    });
    expect(lastStepUpAt()).not.toBeNull();
  });
});

describe('W-04: methods and cancelling (EVM-029 AC4)', () => {
  it('EVM-029 AC4 the passkey is the only method: no recovery code, no password, one hint about the reset', async () => {
    await renderPanel(AUDIT_PATH, auditApi([stepUpRequired]));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByText(/kod odzyskiwania/i)).toBeNull();
    expect(within(dialog).queryByLabelText(/hasło|kod/i)).toBeNull();
    const key = within(dialog).getByRole('button', { name: 'Użyj klucza dostępu' });
    const hint = 'Nie masz klucza dostępu? Poproś innego administratora o reset drugiego kroku logowania.';
    expect(within(dialog).getByText(hint)).toBeTruthy();
    expect(document.getElementById(key.getAttribute('aria-describedby') ?? '')?.textContent).toBe(hint);
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('EVM-029 AC4 a key the server does not accept keeps the dialog with a message and does not touch the session', async () => {
    const api = auditApi([stepUpRequired]);
    api.set(STEP_UP, () => problem(401, 'passkey_failed'));
    await renderPanel(AUDIT_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Nie udało się użyć klucza dostępu. Spróbuj ponownie.');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    // 401 passkey_failed is not the end of the session: the token stays and the session is not read again.
    expect(getCsrfToken()).toBe('csrf-active');
    expect(api.calls(SESSION_ROUTE)).toHaveLength(1);
    expect(api.calls(EVENTS)).toHaveLength(1);
    const key = screen.getByRole('button', { name: 'Użyj klucza dostępu' });
    expect(document.getElementById(key.getAttribute('aria-describedby')?.split(' ')[0] ?? '')?.textContent).toContain(
      'Nie udało się użyć klucza dostępu',
    );
  });

  it('EVM-029 AC4 a cancelled or refused ceremony shows the same message and the dialog stays', async () => {
    stubWebAuthn(() => Promise.reject(new DOMException('cancelled', 'NotAllowedError')));
    const api = auditApi([stepUpRequired]);
    await renderPanel(AUDIT_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się użyć klucza dostępu. Spróbuj ponownie.');
    expect(api.calls(STEP_UP)).toHaveLength(0);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('EVM-029 AC4 "Anuluj" closes W-04 without the operation: the log is empty of data and the button opens the dialog again', async () => {
    const api = auditApi([stepUpRequired, ok()]);
    await renderPanel(AUDIT_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Anuluj' }));
    const heading = await screen.findByRole('heading', { name: 'Potwierdź tożsamość, aby zobaczyć dziennik audytu.' });
    expect(heading).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(api.calls(EVENTS)).toHaveLength(1);
    expect(api.calls(STEP_UP)).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź tożsamość' }));
    expect(await screen.findByRole('alertdialog', { name: TITLE })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(api.calls(EVENTS)).toHaveLength(2);
  });

  it('EVM-029 AC4 Esc is "Anuluj"', async () => {
    await renderPanel(AUDIT_PATH, auditApi([stepUpRequired]));
    await screen.findByRole('alertdialog');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('heading', { name: 'Potwierdź tożsamość, aby zobaczyć dziennik audytu.' })).toBeTruthy();
  });

  it('EVM-029 AC8 429 of the step-up says when to try again, from Retry-After, and the dialog stays', async () => {
    const api = auditApi([stepUpRequired]);
    api.set(OPTIONS, () => problem(429, 'rate_limited', {}, { 'Retry-After': '120' }));
    await renderPanel(AUDIT_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Zbyt wiele prób. Spróbuj ponownie za 2 min.');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('EVM-029 AC4 another failure of the step-up gives one message with a code for support, no details', async () => {
    const api = auditApi([stepUpRequired]);
    api.set(STEP_UP, () => problem(500, 'internal_error'));
    await renderPanel(AUDIT_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Nie udało się potwierdzić tożsamości. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: abcdef01).',
    );
  });

  it('EVM-029 AC8 offline: W-04 says that the confirmation needs the internet, the key is disabled and nothing is sent', async () => {
    const api = auditApi([stepUpRequired]);
    await renderPanel(AUDIT_PATH, api);
    const dialog = await screen.findByRole('alertdialog');
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(await within(dialog).findByText('Brak połączenia. Potwierdzenie wymaga połączenia z internetem.')).toBeTruthy();
    const key = within(dialog).getByRole('button', { name: 'Użyj klucza dostępu' });
    expect(key.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(key);
    expect(api.calls(OPTIONS)).toHaveLength(0);
    // "Anuluj" stays available.
    expect(within(dialog).getByRole('button', { name: 'Anuluj' }).getAttribute('aria-disabled')).toBeNull();
    online.mockReturnValue(true);
  });

  it('EVM-029 AC4 a session that ended during the confirmation closes the dialog (the gate takes the person to the login)', async () => {
    const api = auditApi([stepUpRequired]);
    api.set(STEP_UP, () => problem(401, 'session_expired'));
    await renderPanel(AUDIT_PATH, api, { heading: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });
});

describe('W-18: the log (EVM-029 AC5, AC6)', () => {
  const events = [
    event(1, { occurredAt: '2026-10-04T12:05:00.000Z', action: 'audit.read' }),
    event(2, {
      occurredAt: '2026-10-04T07:12:00.000Z',
      actor: null,
      action: 'login.failed',
      outcome: 'denied',
      reasonCode: 'bad_password',
      objectType: 'user',
      objectId: '33333333-3333-4333-8333-333333333333',
      ipPrefix: '2001:db8:1234::/48',
    }),
    event(3, { actor: JAN, action: 'session.revoked', objectType: 'session', objectId: '44444444-4444-4444-8444-444444444444' }),
    event(4, { actor: null, action: 'session.expired', outcome: 'failed', ipPrefix: null }),
    event(5, { actor: { userId: '55555555-5555-4555-8555-555555555555', displayName: null }, action: 'passkey.registered' }),
    event(6, { action: 'future.thing' as never, outcome: 'maybe' as never, objectType: 'thing' as never }),
  ];

  it('EVM-029 AC5 events are a table with the columns, time in Warsaw, the person by name, outcome as icon and word, the address as a prefix', async () => {
    await renderPanel(AUDIT_PATH, auditApi([ok(events)]));
    const table = await screen.findByRole('table', { name: 'Dziennik audytu — zdarzenia od najnowszych' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Czas', 'Osoba', 'Akcja', 'Wynik', 'Obiekt', 'Adres IP (prefiks)']);
    expect(screen.getByRole('heading', { level: 2, name: 'Zdarzenia od najnowszych · 25 na stronę' })).toBeTruthy();
    const first = within(table).getByRole('row', { name: 'Odczyt dziennika audytu, 04.10.2026, 14:05, Udane' });
    expect(
      within(first)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['04.10.2026, 14:05', 'Anna Testowa', 'Odczyt dziennika audytu', 'Udane', 'Dziennik audytu', '198.51.100.0/24']);
    const denied = within(table).getByRole('row', { name: 'Próba logowania, 04.10.2026, 09:12, Odmowa' });
    const cells = within(denied).getAllByRole('cell');
    expect(cells[1]?.textContent).toBe('Osoba niezalogowana');
    expect(cells[4]?.textContent).toBe('Konto33333333-3333-4333-8333-333333333333');
    expect(cells[5]?.textContent).toBe('2001:db8:1234::/48');
    expect(within(table).getAllByText('System').length).toBeGreaterThan(0);
    expect(within(table).getByText('Konto zanonimizowane')).toBeTruthy();
    // Icons are decorative: the outcome is a word.
    expect(table.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(events.length);
  });

  it('EVM-029 AC5 a value an older panel does not know is shown as "Nieznana …", never raw', async () => {
    await renderPanel(AUDIT_PATH, auditApi([ok(events)]));
    const table = await screen.findByRole('table');
    const row = within(table).getByRole('row', { name: 'Nieznana akcja, 04.10.2026, 14:05, Nieznany wynik' });
    expect(within(row).getByText('Nieznany obiekt')).toBeTruthy();
    expect(table.textContent).not.toContain('future.thing');
    expect(table.textContent).not.toContain('maybe');
  });

  it('EVM-029 AC5 no e-mail, session or trace identifier and no control that writes: the log is read-only', async () => {
    await renderPanel(AUDIT_PATH, auditApi([ok(events)]));
    const table = await screen.findByRole('table');
    expect(table.textContent).not.toMatch(/@|trace|session_id/i);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /eksport|usuń zdarzenie|drukuj|kopiuj/i })).toBeNull();
    expect(document.title).toBe('Dziennik audytu · EVia Manager');
  });

  it('EVM-029 AC5 the first read asks for 25 events from the newest, no filters, and nothing of the filters is in the address', async () => {
    const api = auditApi([ok(events)]);
    const { history } = await renderPanel(AUDIT_PATH, api);
    await screen.findByRole('table');
    expect(Object.fromEntries(lastQuery(api))).toEqual({ limit: '25' });
    expect(history.location.search).toBe('');
  });

  it('EVM-029 AC5 filters of action, outcome, person and period go to the API at once; chips show them and "Wyczyść filtry" removes all', async () => {
    const api = auditApi([ok([event(1), event(3, { actor: JAN })])]);
    const { history } = await renderPanel(AUDIT_PATH, api);
    await screen.findByRole('table');
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Akcja'), 'Logowanie');
    await waitFor(() => {
      expect(lastQuery(api).get('action')).toBe('login.succeeded');
    });
    await user.selectOptions(screen.getByLabelText('Wynik'), 'Odmowa');
    await waitFor(() => {
      expect(lastQuery(api).get('outcome')).toBe('denied');
    });
    await user.selectOptions(screen.getByLabelText('Osoba'), 'Jan Przykładowy');
    await waitFor(() => {
      expect(lastQuery(api).get('actorUserId')).toBe(JAN.userId);
    });
    // The days are Warsaw days: 01.10.2026 00:00 CEST = 2026-09-30T22:00Z; 04.10.2026 23:59:59.999 CEST = 21:59:59.999Z.
    await user.type(screen.getByLabelText('Okres od'), '2026-10-01');
    await user.type(screen.getByLabelText('Okres do'), '2026-10-04');
    await waitFor(() => {
      expect(lastQuery(api).get('to')).toBe('2026-10-04T21:59:59.999Z');
    });
    expect(lastQuery(api).get('from')).toBe('2026-09-30T22:00:00.000Z');

    const active = screen.getByRole('group', { name: 'Aktywne filtry' });
    expect(
      within(active)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Usuń filtr Akcja: Logowanie',
      'Usuń filtr Osoba: Jan Przykładowy',
      'Usuń filtr Wynik: Odmowa',
      'Usuń filtr Okres: 01.10.2026 – 04.10.2026',
      null,
    ]);
    expect(history.location.search).toBe('');
    expect(document.title).toBe('Dziennik audytu · EVia Manager');

    await user.click(within(active).getByRole('button', { name: 'Usuń filtr Wynik: Odmowa' }));
    await waitFor(() => {
      expect(lastQuery(api).get('outcome')).toBeNull();
    });
    expect(lastQuery(api).get('action')).toBe('login.succeeded');

    await user.click(screen.getByRole('button', { name: 'Wyczyść filtry' }));
    await waitFor(() => {
      expect(Object.fromEntries(lastQuery(api))).toEqual({ limit: '25' });
    });
    expect(screen.queryByRole('group', { name: 'Aktywne filtry' })).toBeNull();
  });

  it('EVM-029 AC5 quick ranges: "7 dni" sets the period (Warsaw days), "30 dni" is the server default and selected at first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T22:30:00.000Z'));
    const api = auditApi([ok()]);
    await renderPanel(AUDIT_PATH, api);
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: '30 dni' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: '7 dni' }));
    // 22:30Z on 04.10 is 00:30 on 05.10 in Warsaw: the 7 days are 29.09–05.10.
    await waitFor(() => {
      expect(lastQuery(api).get('from')).toBe('2026-09-28T22:00:00.000Z');
    });
    expect(lastQuery(api).get('to')).toBe('2026-10-05T21:59:59.999Z');
    expect(screen.getByRole('button', { name: '7 dni' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '30 dni' }).getAttribute('aria-pressed')).toBe('false');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Dziś' }));
    await waitFor(() => {
      expect(lastQuery(api).get('from')).toBe('2026-10-04T22:00:00.000Z');
    });
  });

  it('EVM-029 AC5 a period that ends before it starts or is longer than 2 years is not sent: the field says why', async () => {
    const api = auditApi([ok()]);
    await renderPanel(AUDIT_PATH, api);
    await screen.findByRole('table');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Okres od'), '2026-10-04');
    await user.type(screen.getByLabelText('Okres do'), '2026-10-01');
    expect((await screen.findByRole('alert')).textContent).toBe('Data początkowa nie może być późniejsza niż końcowa.');
    await user.clear(screen.getByLabelText('Okres od'));
    await user.type(screen.getByLabelText('Okres od'), '2020-01-01');
    expect((await screen.findByRole('alert')).textContent).toBe('Okres może obejmować najwyżej 2 lata.');
    expect(api.calls(EVENTS).every((call) => !new URL(`http://panel${call.path}`).search.includes('2019'))).toBe(true);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('EVM-029 AC5 persons seen on the pages feed the person filter, sorted, with "Wszystkie osoby" first', async () => {
    await renderPanel(AUDIT_PATH, auditApi([ok([event(1, { actor: JAN }), event(2), event(3, { actor: null })])]));
    await screen.findByRole('table');
    const options = within(screen.getByLabelText('Osoba')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Wszystkie osoby', 'Anna Testowa', 'Jan Przykładowy']);
  });

  it('EVM-029 AC5 pagination by cursor: next sends the cursor, previous goes back; focus moves to the heading of the table and the change is announced', async () => {
    const api = auditApi([ok([event(1)], 'CURSOR1'), ok([event(2, { action: 'login.succeeded' })], null), ok([event(1)], 'CURSOR1')]);
    await renderPanel(AUDIT_PATH, api);
    await screen.findByRole('table');
    const previous = screen.getByRole('button', { name: 'Poprzednia strona' });
    const next = screen.getByRole('button', { name: 'Następna strona' });
    expect(previous.getAttribute('aria-disabled')).toBe('true');
    expect(next.getAttribute('aria-disabled')).toBeNull();

    await userEvent.click(next);
    await screen.findByRole('row', { name: /Logowanie/ });
    expect(lastQuery(api).get('cursor')).toBe('CURSOR1');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 }));
    expect(screen.getByText('Wczytano następną stronę zdarzeń').getAttribute('role')).toBe('status');
    // The last page: no next page, no total count anywhere.
    expect(screen.getByRole('button', { name: 'Następna strona' }).getAttribute('aria-disabled')).toBe('true');
    expect(document.body.textContent).not.toMatch(/z \d+|łącznie|razem/i);

    await userEvent.click(screen.getByRole('button', { name: 'Poprzednia strona' }));
    await screen.findByRole('row', { name: /Odczyt dziennika audytu/ });
    expect(lastQuery(api).get('cursor')).toBeNull();
    expect(screen.getByText('Wczytano poprzednią stronę zdarzeń').getAttribute('role')).toBe('status');
  });

  it('EVM-029 AC5 a cursor the server no longer accepts goes back to the first page with a message, not an error', async () => {
    const api = auditApi([
      ok([event(1)], 'CURSOR1'),
      () => problem(400, 'validation_failed', { errors: [{ pointer: '/cursor', code: 'invalid' }] }),
      ok([event(1)], 'CURSOR1'),
    ]);
    await renderPanel(AUDIT_PATH, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByText('Lista została zaktualizowana — wróciliśmy na początek.')).toBeTruthy();
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(lastQuery(api).get('cursor')).toBeNull();
  });

  it('EVM-029 AC6 the panel offers no operation that changes or deletes events: only GET reads of the log are sent', async () => {
    const api = auditApi([ok([event(1)], 'CURSOR1'), ok()]);
    await renderPanel(AUDIT_PATH, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    await waitFor(() => {
      expect(api.calls(EVENTS)).toHaveLength(2);
    });
    expect(api.requests.filter((entry) => entry.path.startsWith('/api/v1/audit')).every((entry) => entry.method === 'GET')).toBe(true);
  });

  it('EVM-029 AC5 the screen passes the accessibility check (axe), with a caption, scoped headers and labelled filters', async () => {
    const { container } = await renderPanel(AUDIT_PATH, auditApi([ok(events)]));
    await screen.findByRole('table');
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('W-18: states (EVM-029 AC8)', () => {
  it('EVM-029 AC8 no events: "Brak zdarzeń w wybranym okresie." and, with filters, "Wyczyść filtry"', async () => {
    const api = auditApi([ok([]), ok([])]);
    await renderPanel(AUDIT_PATH, api);
    expect(await screen.findByRole('heading', { name: 'Brak zdarzeń w wybranym okresie.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Wyczyść filtry' })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Wynik'), 'Błąd');
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Wyczyść filtry' }).length).toBeGreaterThan(0);
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'Wyczyść filtry' })[0] as HTMLElement);
    await waitFor(() => {
      expect(Object.fromEntries(lastQuery(api))).toEqual({ limit: '25' });
    });
  });

  it('EVM-029 AC8 loading: a busy region with a text status and skeleton rows; the filters stay; after 10 s "Ładowanie trwa dłużej niż zwykle…"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const never = () => new Promise<Response>(() => undefined);
    await renderPanel(AUDIT_PATH, auditApi([never]), { heading: false });
    // The fake clock stops the waiting of Testing Library: the microtasks of the fake server are flushed by hand.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const busy = screen
      .getAllByText('Ładowanie…')
      .map((node) => node.closest('[aria-busy]'))
      .find((node) => node?.querySelector('[aria-hidden="true"]'));
    expect(busy?.textContent).toBe('Ładowanie…');
    expect(busy?.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByLabelText('Akcja')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(busy?.textContent).toBe('Ładowanie trwa dłużej niż zwykle…');
  });

  it('EVM-029 AC8 error: "Nie udało się wczytać dziennika." with "Spróbuj ponownie" that reads again', async () => {
    const api = auditApi([() => problem(500, 'internal_error'), ok()]);
    await renderPanel(AUDIT_PATH, api);
    expect(await screen.findByRole('heading', { name: 'Nie udało się wczytać dziennika.' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('EVM-029 AC8 429: the time to wait from Retry-After and the filters stay', async () => {
    const api = auditApi([ok(), () => problem(429, 'rate_limited', {}, { 'Retry-After': '60' })]);
    await renderPanel(AUDIT_PATH, api);
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('Wynik'), 'Udane');
    expect((await screen.findByRole('alert')).textContent).toContain('Zbyt wiele zapytań. Spróbuj ponownie za 1 min.');
    expect(screen.getByLabelText<HTMLSelectElement>('Wynik').value).toBe('success');
  });

  it('EVM-029 AC8 offline: the banner, filters and pages are disabled with a hint', async () => {
    const api = auditApi([ok([event(1)], 'CURSOR1')]);
    await renderPanel(AUDIT_PATH, api);
    await screen.findByRole('table');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect((await screen.findAllByText('Brak połączenia. Panel działa po jego powrocie.')).length).toBe(1);
    expect(screen.getByLabelText<HTMLSelectElement>('Akcja').disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Następna strona' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: '7 dni' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Brak połączenia — strony są niedostępne.')).toBeTruthy();
  });
});

describe('W-18: permissions (EVM-029 AC7)', () => {
  it('EVM-029 AC7 an Administrator sees "Administracja" in the menu, others do not', async () => {
    await renderPanel('/work-orders', auditApi([ok()]));
    expect(screen.getAllByRole('link', { name: 'Administracja' }).length).toBeGreaterThan(0);
  });

  it('EVM-029 AC7 Edytor does not see "Administracja" and the address gives "Brak dostępu" without data and without a request for the log', async () => {
    const api = auditApi([ok()], EDITOR_SESSION);
    await renderPanel(AUDIT_PATH, api, { heading: false });
    expect(await screen.findByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeTruthy();
    expect(screen.getByText('Ta część panelu jest dostępna tylko dla administratora.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Administracja' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.title).toBe('Brak dostępu · EVia Manager');
    expect(api.calls(EVENTS)).toHaveLength(0);
  });

  it('EVM-029 AC7 the way back from "Brak dostępu" leads to the list of work orders', async () => {
    const { history } = await renderPanel(AUDIT_PATH, auditApi([ok()], EDITOR_SESSION), { heading: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Przejdź do zleceń' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/work-orders');
    });
  });

  it('EVM-029 AC7 403 forbidden from the server (the role changed meanwhile) gives the same "Brak dostępu", never W-04', async () => {
    const api = auditApi([() => problem(403, 'forbidden')]);
    await renderPanel(AUDIT_PATH, api, { heading: false });
    expect(await screen.findByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('EVM-029 AC7 /administration leads to the log of an Administrator', async () => {
    const { history } = await renderPanel('/administration', auditApi([ok()]));
    await screen.findByRole('table');
    expect(history.location.pathname).toBe(AUDIT_PATH);
  });

  it('EVM-029 AC7 401 (no session) sends the person to the login and drops what was loaded', async () => {
    const api = auditApi([() => problem(401, 'unauthenticated')]);
    api.set(SESSION_ROUTE, () => problem(401, 'unauthenticated'));
    const { history } = await renderPanel(AUDIT_PATH, api, { heading: false });
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(api.calls(EVENTS)).toHaveLength(0);
  });
});

describe('Step-up in the tab: window, rotation, logout (EVM-029 AC1, AC3; security K9)', () => {
  it('EVM-029 AC1 15 minutes after the confirmation made in this tab the loaded page leaves the screen and "Potwierdź tożsamość" shows, announced as a status', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
    const api = auditApi([stepUpRequired, ok([event(1)]), ok([event(1)])]);
    await renderPanel(AUDIT_PATH, api);
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    await screen.findByRole('table');
    const reads = api.calls(EVENTS).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * MINUTE);
    });
    expect(screen.getByRole('table')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MINUTE + 30_000);
    });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Potwierdź tożsamość, aby zobaczyć dziennik audytu.' })).toBeTruthy();
    expect(screen.getAllByText('Czas potwierdzenia tożsamości minął — dane dziennika zostały ukryte.').length).toBeGreaterThan(0);
    expect(
      screen
        .getAllByText('Czas potwierdzenia tożsamości minął — dane dziennika zostały ukryte.')
        .some((node) => node.getAttribute('role') === 'status'),
    ).toBe(true);
    // The page asks nothing by itself; the dialog opens only on the button, and after the key the log is read again.
    expect(api.calls(EVENTS)).toHaveLength(reads);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Potwierdź tożsamość' }));
    expect(await screen.findByRole('alertdialog', { name: TITLE })).toBeTruthy();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(api.calls(EVENTS)).toHaveLength(reads + 1);
  });

  it('EVM-029 AC3 a request sent with the old cookie that fails with 401 session_revoked during the step-up is repeated once and does not log the person out', async () => {
    let call = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = auditApi([
      async () => {
        call += 1;
        await gate;
        return problem(401, 'session_revoked');
      },
      ok([event(1)]),
    ]);
    const { history } = await renderPanel(AUDIT_PATH, api, { heading: false });
    await waitFor(() => {
      expect(call).toBe(1);
    });
    // The step-up of the tab rotates the session while the request is in flight.
    const confirmation = runStepUp(() => Promise.resolve());
    release();
    await confirmation;
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(history.location.pathname).toBe(AUDIT_PATH);
    expect(api.calls(EVENTS)).toHaveLength(2);
    expect(getCsrfToken()).toBe('csrf-active');
  });

  it('EVM-029 AC3 without a step-up of the tab a real 401 session_revoked still ends the session (nothing is repeated)', async () => {
    const api = auditApi([() => problem(401, 'session_revoked')]);
    api.set(SESSION_ROUTE, () => problem(401, 'unauthenticated'));
    const { history } = await renderPanel(AUDIT_PATH, api, { heading: false });
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(api.calls(EVENTS).length).toBeLessThanOrEqual(1);
  });

  it('EVM-029 AC1 logout drops the confirmation and the CSRF token of the tab and leaves for the login', async () => {
    const api = auditApi([stepUpRequired, ok()]);
    api.set('POST /api/v1/auth/logout', () => new Response(null, { status: 204 }));
    const { history } = await renderPanel(AUDIT_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Użyj klucza dostępu' }));
    await screen.findByRole('table');
    expect(lastStepUpAt()).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Konto:/ }));
    api.set(SESSION_ROUTE, () => problem(401, 'unauthenticated'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Wyloguj' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(lastStepUpAt()).toBeNull();
    expect(getCsrfToken()).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
