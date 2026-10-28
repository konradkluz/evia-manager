import type { CurrentSession, Customer } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { StepUpCancelled } from '../src/administration/use-guarded-call.ts';
import { describeEraseFailure, eraseFailureText } from '../src/customers/customer-erase.ts';
import { resetStepUp } from '../src/session/step-up.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { userEvent } from './user.ts';

const ID = '01968f3e-0000-7000-8000-00000000aaa1';
const PATH = `/customers/${ID}`;
const ONE = `/api/v1/customers/${ID}`;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STEP_UP_TITLE = 'Potwierdź tożsamość, aby zanonimizować klienta';
const CANARY_PHONE = '+48600000001';

const JAN: Customer = {
  id: ID,
  kind: 'person',
  firstName: 'Jan',
  lastName: 'Przykładowy',
  phone: CANARY_PHONE,
  email: 'jan.przykladowy@example.com',
  displayName: 'Jan Przykładowy',
  version: 3,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
  deletedAt: null,
  anonymizedAt: null,
};
const DELETED_AT = '2026-10-28T09:00:00.000Z';
const DELETED: Customer = { ...JAN, version: 4, deletedAt: DELETED_AT };
const ANONYMIZED: Customer = {
  id: ID,
  kind: 'person',
  firstName: 'Klient',
  lastName: 'zanonimizowany',
  phone: '+48000000000',
  displayName: 'Klient zanonimizowany',
  version: 5,
  createdAt: JAN.createdAt,
  updatedAt: DELETED_AT,
  deletedAt: null,
  anonymizedAt: DELETED_AT,
};

const roleSession = (role: 'administrator' | 'editor' | 'read_only'): CurrentSession => ({
  ...ACTIVE_SESSION,
  user: { ...ACTIVE_SESSION.user, role },
});

const STEP_UP_ROUTES: Record<string, Handler> = {
  'POST /api/v1/auth/step-up/options': () =>
    json(200, {
      challenge: 'Y2hhbGxlbmdl',
      rpId: 'localhost',
      userVerification: 'required',
      allowCredentials: [{ id: 'Y3JlZA', type: 'public-key' }],
    }),
  'POST /api/v1/auth/step-up': () => json(200, { csrfToken: 'csrf-rotated' }),
};

function stubWebAuthn() {
  const credential = {
    id: 'Y3JlZA',
    rawId: 'Y3JlZA',
    type: 'public-key',
    response: { clientDataJSON: 'Y2xpZW50', authenticatorData: 'YXV0aA', signature: 'c2ln' },
  };
  class Fake {
    static readonly parseRequestOptionsFromJSON = vi.fn((options: object) => ({ ...options, parsed: true }));
    toJSON() {
      return credential;
    }
  }
  vi.stubGlobal('PublicKeyCredential', Fake);
  Object.defineProperty(navigator, 'credentials', { value: { get: vi.fn(() => Promise.resolve(new Fake())) }, configurable: true });
}

beforeEach(() => {
  stubWebAuthn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'credentials');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  resetStepUp();
});

const inTurn = (...answers: Array<() => Response>): Handler => {
  let index = 0;
  return () => {
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (answer === undefined) throw new Error('no answer');
    return answer();
  };
};

/** The customer behind the page: a read that answers with the current state (`ETag` = its version). */
function erasePage(
  start: Customer,
  role: 'administrator' | 'editor' | 'read_only' = 'administrator',
  routes: Record<string, Handler> = {},
) {
  let current = start;
  const set = (next: Customer) => {
    current = next;
  };
  const api = activeSessionApi({
    [SESSION_ROUTE]: () => json(200, roleSession(role)),
    [`GET ${ONE}`]: () => json(200, current, { ETag: `"${String(current.version)}"` }),
    ...STEP_UP_ROUTES,
    ...routes,
  });
  return { api, set };
}

// A disabled item names its reason too (aria-describedby is not part of the name here: the hint is inside the item).
const menuItem = (name: string) => screen.getByRole('menuitem', { name: (accessible) => accessible.startsWith(name) });
const trigger = () => screen.findByRole('button', { name: /^Akcje klienta/ });
async function choose(item: string) {
  await userEvent.click(await trigger());
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}
const open = (page: ReturnType<typeof erasePage>) => renderPanel(PATH, page.api);
const failure = (status: number, code: string, extra: Record<string, unknown> = {}, retry?: number) =>
  new ApiError(status, { code, traceId: 'abcdef0123456789', ...extra }, retry);

describe('W-14 failures of the erase operations (EVM-041 AC2, AC5, AC8)', () => {
  it('EVM-041 AC8 maps the answers of the server to what the person can do about them', () => {
    expect(describeEraseFailure(new StepUpCancelled())).toEqual({ kind: 'notConfirmed' });
    expect(describeEraseFailure(new ApiError(0, undefined))).toEqual({ kind: 'network' });
    expect(describeEraseFailure(new Error('x'))).toEqual({ kind: 'network' });
    expect(describeEraseFailure(failure(412, 'version_conflict'))).toEqual({ kind: 'conflict' });
    expect(describeEraseFailure(failure(428, 'precondition_required'))).toEqual({ kind: 'conflict' });
    expect(describeEraseFailure(failure(404, 'not_found'))).toEqual({ kind: 'gone' });
    expect(describeEraseFailure(failure(403, 'forbidden'))).toEqual({ kind: 'forbidden' });
    expect(describeEraseFailure(failure(409, 'has_active_dependents', { openWorkOrders: 2 }))).toEqual({ kind: 'dependents', count: 2 });
    expect(describeEraseFailure(failure(409, 'already_anonymized'))).toEqual({ kind: 'alreadyAnonymized' });
    expect(describeEraseFailure(failure(409, 'customer_anonymized'))).toEqual({ kind: 'alreadyAnonymized' });
    expect(describeEraseFailure(failure(429, 'rate_limited', {}, 90))).toEqual({ kind: 'rateLimited', minutes: 2 });
    expect(describeEraseFailure(failure(429, 'rate_limited'))).toEqual({ kind: 'rateLimited', minutes: 1 });
    expect(describeEraseFailure(failure(503, 'deletion_register_unavailable'))).toEqual({ kind: 'registerDown', code: 'abcdef01' });
    expect(describeEraseFailure(failure(503, 'service_unavailable'))).toEqual({ kind: 'busy' });
    expect(describeEraseFailure(failure(500, 'internal_error'))).toEqual({ kind: 'server', code: 'abcdef01' });
    expect(describeEraseFailure(new ApiError(500, { code: 'internal_error' }))).toEqual({ kind: 'server', code: 'internal_error' });
  });

  it('EVM-041 AC2 the words carry the count and the code, never a value of the customer', () => {
    const t = ((key: string, values?: Record<string, unknown>) => `${key}|${JSON.stringify(values ?? {})}`) as never;
    expect(eraseFailureText(t, 'delete', { kind: 'dependents', count: 3 })).toBe('customerErase.failure.dependents.delete|{"count":3}');
    expect(eraseFailureText(t, 'anonymize', { kind: 'dependents', count: undefined })).toBe(
      'customerErase.failure.dependents.anonymize|{"count":0}',
    );
    for (const kind of ['conflict', 'gone', 'alreadyAnonymized', 'busy', 'notConfirmed', 'forbidden', 'network'] as const) {
      expect(eraseFailureText(t, 'restore', { kind })).toBe(`customerErase.failure.${kind}|{}`);
    }
    expect(eraseFailureText(t, 'anonymize', { kind: 'rateLimited', minutes: 2 })).toContain('"minutes":2');
    expect(eraseFailureText(t, 'anonymize', { kind: 'registerDown', code: 'abcdef01' })).toContain('abcdef01');
    expect(eraseFailureText(t, 'delete', { kind: 'server', code: 'abcdef01' })).toContain('abcdef01');
  });
});

describe('W-14 usunięcie i przywrócenie klienta (EVM-041 AC1, AC3)', () => {
  it('EVM-041 AC1 "Usuń klienta" has no dialog, sends the version on screen with a key, shows the toast with "Cofnij" and the banner', async () => {
    const page = erasePage(JAN, 'administrator', {
      [`DELETE ${ONE}`]: () => {
        page.set(DELETED);
        return new Response(null, { status: 204 });
      },
    });
    await open(page);
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    await choose('Usuń klienta');

    expect(await screen.findByText('Usunięto klienta. Widzi go tylko administrator.')).toBeTruthy();
    const [call] = page.api.calls(`DELETE ${ONE}`);
    expect(call?.headers.get('If-Match')).toBe('"3"');
    expect(call?.headers.get('Idempotency-Key') ?? '').toMatch(UUID_V7);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const banner = await screen.findByText('Klient jest usunięty — widzi go tylko administrator.');
    await waitFor(() => {
      expect(document.activeElement).toBe(banner.closest('[tabindex="-1"]'));
    });
    // the delete is not offered again; "Anonimizuj klienta…" stays, the edit is off
    await userEvent.click(await trigger());
    expect(screen.queryByRole('menuitem', { name: /^Usuń klienta/ })).toBeNull();
    expect(menuItem('Anonimizuj klienta…').getAttribute('aria-disabled')).toBeNull();
    expect(menuItem('Edytuj dane klienta…').getAttribute('aria-disabled')).toBe('true');
  });

  it('EVM-041 AC3 the toast "Cofnij" reads the version just before and restores; the banner goes and the focus is on the heading', async () => {
    const page = erasePage(JAN, 'administrator', {
      [`DELETE ${ONE}`]: () => {
        page.set(DELETED);
        return new Response(null, { status: 204 });
      },
      [`POST ${ONE}/restore`]: () => {
        page.set({ ...JAN, version: 5 });
        return json(200, { ...JAN, version: 5 }, { ETag: '"5"' });
      },
    });
    await open(page);
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    await choose('Usuń klienta');
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));

    expect(await screen.findByText('Przywrócono klienta. Widzą go wszystkie role.')).toBeTruthy();
    const [call] = page.api.calls(`POST ${ONE}/restore`);
    expect(call?.headers.get('If-Match')).toBe('"4"');
    expect(call?.headers.get('Idempotency-Key') ?? '').toMatch(UUID_V7);
    await waitFor(() => {
      expect(screen.queryByText('Klient jest usunięty — widzi go tylko administrator.')).toBeNull();
    });
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('EVM-041 AC3 a deleted customer opens with the banner and "Przywróć klienta" restores it', async () => {
    const page = erasePage(DELETED, 'administrator', {
      [`POST ${ONE}/restore`]: () => {
        page.set({ ...JAN, version: 5 });
        return json(200, { ...JAN, version: 5 }, { ETag: '"5"' });
      },
    });
    await open(page);
    expect(await screen.findByText('Klient jest usunięty — widzi go tylko administrator.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Przywróć klienta' }));
    expect(await screen.findByText('Przywrócono klienta. Widzą go wszystkie role.')).toBeTruthy();
    expect(page.api.calls(`POST ${ONE}/restore`)[0]?.headers.get('If-Match')).toBe('"4"');
  });

  it('EVM-041 AC2 a delete refused for open orders is an alert with the count; the menu then says why both operations are off', async () => {
    const page = erasePage(JAN, 'administrator', {
      [`DELETE ${ONE}`]: () => problem(409, 'has_active_dependents', { openWorkOrders: 1 }),
    });
    await open(page);
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    await choose('Usuń klienta');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Nie usunięto klienta — ma niezamknięte zlecenia (1). Usuniesz go, gdy wszystkie będą rozliczone albo anulowane.',
    );
    expect(screen.queryByText('Usunięto klienta. Widzi go tylko administrator.')).toBeNull();
    await userEvent.click(await trigger());
    expect(menuItem('Usuń klienta').getAttribute('aria-disabled')).toBe('true');
    expect(menuItem('Anonimizuj klienta…').getAttribute('aria-disabled')).toBe('true');
    expect(document.body.textContent).toContain('Zanonimizujesz go, gdy wszystkie będą rozliczone albo anulowane.');
  });

  it('EVM-041 AC8 a delete on an old version (412) tells to refresh and "Odśwież dane klienta" reads the customer again', async () => {
    const page = erasePage(JAN, 'administrator', { [`DELETE ${ONE}`]: () => problem(412, 'version_conflict') });
    await open(page);
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    const reads = () => page.api.calls(`GET ${ONE}`).length;
    const before = reads();
    await choose('Usuń klienta');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Dane klienta zmieniono w międzyczasie.');
    await waitFor(() => {
      expect(reads()).toBeGreaterThan(before);
    });
    const afterAlert = reads();
    await userEvent.click(within(alert).getByRole('button', { name: 'Odśwież dane klienta' }));
    await waitFor(() => {
      expect(reads()).toBeGreaterThan(afterAlert);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('EVM-041 AC8 a 5xx gives the code to report and no success toast', async () => {
    const page = erasePage(JAN, 'administrator', { [`DELETE ${ONE}`]: () => problem(500, 'internal_error') });
    await open(page);
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    await choose('Usuń klienta');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('(kod: abcdef01)');
    expect(screen.queryByText('Usunięto klienta. Widzi go tylko administrator.')).toBeNull();
  });

  it('EVM-041 AC8 a customer that is gone (404) becomes the screen "Nie znaleziono klienta."', async () => {
    const page = erasePage(JAN, 'administrator', { [`DELETE ${ONE}`]: () => problem(404, 'not_found') });
    await open(page);
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    await choose('Usuń klienta');
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie znaleziono klienta.' })).toBeTruthy();
  });

  it('EVM-041 AC8 offline "Przywróć klienta" is off with the hint and sends nothing', async () => {
    const page = erasePage(DELETED);
    await open(page);
    await screen.findByText('Klient jest usunięty — widzi go tylko administrator.');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    globalThis.dispatchEvent(new Event('offline'));
    const restore = await screen.findByRole('button', { name: 'Przywróć klienta' });
    await waitFor(() => {
      expect(restore.getAttribute('aria-disabled')).toBe('true');
    });
    expect(restore.getAttribute('title')).toBe('Zmienisz po powrocie połączenia.');
    await userEvent.click(restore);
    expect(page.api.calls(`POST ${ONE}/restore`)).toHaveLength(0);
  });
});

describe('W-14 uprawnienia do usunięcia i anonimizacji (EVM-041 AC7)', () => {
  it('EVM-041 AC7 the Editor has the operations off with the hint of the role and no call is made', async () => {
    const page = erasePage(JAN, 'editor');
    await open(page);
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    await userEvent.click(await trigger());
    const del = menuItem('Usuń klienta');
    const anonymize = menuItem('Anonimizuj klienta…');
    expect(del.getAttribute('aria-disabled')).toBe('true');
    expect(anonymize.getAttribute('aria-disabled')).toBe('true');
    expect(document.body.textContent).toContain('Usunąć klienta może tylko administrator.');
    expect(document.body.textContent).toContain('Zanonimizować klienta może tylko administrator.');
    await userEvent.click(del);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(page.api.calls(`DELETE ${ONE}`)).toHaveLength(0);
  });

  it('EVM-041 AC7 Tylko odczyt has no trigger of the menu', async () => {
    const page = erasePage(JAN, 'read_only');
    await open(page);
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    expect(screen.queryByRole('button', { name: /^Akcje klienta/ })).toBeNull();
  });
});

describe('W-14 anonimizacja klienta (EVM-041 AC4, AC5, AC7, AC8)', () => {
  async function openDialog(page: ReturnType<typeof erasePage>) {
    await open(page);
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    await choose('Anonimizuj klienta…');
    return screen.findByRole('alertdialog', { name: 'Zanonimizować klienta „Jan Przykładowy”?' });
  }
  async function confirm(dialog: HTMLElement) {
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anonimizuj klienta' }));
  }

  it('EVM-041 AC4 the dialog names fields, not values; it needs the tick; confirmed, the answer replaces the page and shows no old data', async () => {
    const page = erasePage(JAN, 'administrator', {
      [`POST ${ONE}/anonymize`]: () => {
        page.set(ANONYMIZED);
        return json(200, ANONYMIZED, { ETag: '"5"' });
      },
    });
    const dialog = await openDialog(page);
    const view = within(dialog);
    expect(view.getAllByText('Tej operacji nie można cofnąć.', { exact: false }).length).toBeGreaterThan(0);
    expect(dialog.textContent).not.toContain(CANARY_PHONE);
    expect(dialog.textContent).not.toContain('jan.przykladowy@example.com');
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Anuluj' }));
    expect(view.getByRole('button', { name: 'Anonimizuj klienta' }).className).toContain('bg-action-danger-bg');
    expect(await axeViolations(dialog)).toEqual([]);

    // without the tick nothing is sent and the focus goes to the field
    await userEvent.click(view.getByRole('button', { name: 'Anonimizuj klienta' }));
    expect((await view.findByRole('alert')).textContent).toBe('Potwierdź, że rozumiesz skutek operacji.');
    expect(document.activeElement).toBe(view.getByRole('checkbox', { name: 'Rozumiem, że tej operacji nie można cofnąć.' }));
    expect(page.api.calls(`POST ${ONE}/anonymize`)).toHaveLength(0);

    await userEvent.click(view.getByRole('checkbox'));
    await userEvent.click(view.getByRole('button', { name: 'Anonimizuj klienta' }));

    expect(await screen.findByText('Zanonimizowano klienta.')).toBeTruthy();
    const [call] = page.api.calls(`POST ${ONE}/anonymize`);
    expect(call?.headers.get('If-Match')).toBe('"3"');
    expect(call?.headers.has('Idempotency-Key')).toBe(false);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'Klient zanonimizowany' })).toBeTruthy();
    expect(screen.getByText('Klient jest zanonimizowany — jego danych nie można już zmienić.', { exact: false })).toBeTruthy();
    expect(document.body.textContent).not.toContain('Przykładowy');
    expect(document.body.textContent).not.toContain('jan.przykladowy');
    // the neutral placeholder is not a number: "—" and no tel: link
    const data = within(screen.getByRole('region', { name: 'Dane klienta' }));
    expect(data.getByText('Telefon').nextElementSibling?.textContent).toBe('—');
    expect(data.queryByRole('link')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    });
    // the edit and a second anonymization are off with their hints
    await userEvent.click(await trigger());
    expect(menuItem('Edytuj dane klienta…').getAttribute('aria-disabled')).toBe('true');
    expect(menuItem('Anonimizuj klienta…').getAttribute('aria-disabled')).toBe('true');
    expect(document.body.textContent).toContain('Klient jest już zanonimizowany.');
  });

  it('EVM-041 AC7 W-04 follows 403 step_up_required and the same call is sent again', async () => {
    const page = erasePage(JAN, 'administrator', {
      [`POST ${ONE}/anonymize`]: inTurn(
        () => problem(403, 'step_up_required'),
        () => json(200, ANONYMIZED, { ETag: '"5"' }),
      ),
    });
    const dialog = await openDialog(page);
    await confirm(dialog);
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    expect(screen.queryByRole('alertdialog', { name: /^Zanonimizować klienta/ })).toBeNull();
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Użyj klucza dostępu' }));

    expect(await screen.findByText('Zanonimizowano klienta.')).toBeTruthy();
    const calls = page.api.calls(`POST ${ONE}/anonymize`);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.headers.get('If-Match')).toBe('"3"');
  });

  it('EVM-041 AC8 cancelling W-04 says "Nie wykonano operacji." with the focus on the button and changes nothing', async () => {
    const page = erasePage(JAN, 'administrator', { [`POST ${ONE}/anonymize`]: () => problem(403, 'step_up_required') });
    const dialog = await openDialog(page);
    await confirm(dialog);
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Anuluj' }));

    const back = await screen.findByRole('alertdialog', { name: /^Zanonimizować klienta/ });
    expect(within(back).getByRole('alert').textContent).toBe('Nie wykonano operacji.');
    await waitFor(() => {
      expect(document.activeElement).toBe(within(back).getByRole('button', { name: 'Anonimizuj klienta' }));
    });
    expect(page.api.calls('POST /api/v1/auth/step-up')).toHaveLength(0);
    expect(screen.queryByText('Zanonimizowano klienta.')).toBeNull();
  });

  it('EVM-041 AC5 a refused register (503) says the data is untouched and gives the code; the dialog stays and nothing is announced as done', async () => {
    const page = erasePage(JAN, 'administrator', { [`POST ${ONE}/anonymize`]: () => problem(503, 'deletion_register_unavailable') });
    const dialog = await openDialog(page);
    await confirm(dialog);

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe('Nie zanonimizowano klienta. Dane są bez zmian. Spróbuj ponownie za chwilę (kod: abcdef01).');
    expect(screen.queryByText('Zanonimizowano klienta.')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeTruthy();
  });

  it('EVM-041 AC2 open orders (409) in the dialog: the count, and both operations are off afterwards', async () => {
    const page = erasePage(JAN, 'administrator', {
      [`POST ${ONE}/anonymize`]: () => problem(409, 'has_active_dependents', { openWorkOrders: 2 }),
    });
    const dialog = await openDialog(page);
    await confirm(dialog);
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Nie zanonimizowano klienta — ma niezamknięte zlecenia (2). Zanonimizujesz go, gdy wszystkie będą rozliczone albo anulowane.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(await trigger());
    expect(menuItem('Anonimizuj klienta…').getAttribute('aria-disabled')).toBe('true');
    expect(document.body.textContent).toContain('Klient ma niezamknięte zlecenia (2).');
  });

  it('EVM-041 AC8 a stale version (412) in the dialog tells to check the data and reads the customer again', async () => {
    const page = erasePage(JAN, 'administrator', { [`POST ${ONE}/anonymize`]: () => problem(412, 'version_conflict') });
    const dialog = await openDialog(page);
    const before = page.api.calls(`GET ${ONE}`).length;
    await confirm(dialog);
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Dane klienta zmieniono w międzyczasie.');
    await waitFor(() => {
      expect(page.api.calls(`GET ${ONE}`).length).toBeGreaterThan(before);
    });
  });

  it('EVM-041 AC5 a repeat after a lost answer (409 already_anonymized) is "already done": the dialog closes and the state is shown, not an error', async () => {
    const page = erasePage(JAN, 'administrator', {
      [`POST ${ONE}/anonymize`]: () => {
        page.set(ANONYMIZED);
        return problem(409, 'already_anonymized');
      },
    });
    const dialog = await openDialog(page);
    await confirm(dialog);

    expect(await screen.findByRole('heading', { level: 1, name: 'Klient zanonimizowany' })).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('EVM-041 AC8 "Anuluj" closes the dialog without a call; Esc does nothing while the request runs, so the success is not lost', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const page = erasePage(JAN, 'administrator', {
      [`POST ${ONE}/anonymize`]: async () => {
        await gate;
        page.set(ANONYMIZED);
        return json(200, ANONYMIZED, { ETag: '"5"' });
      },
    });
    const first = await openDialog(page);
    await userEvent.click(within(first).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(page.api.calls(`POST ${ONE}/anonymize`)).toHaveLength(0);

    await choose('Anonimizuj klienta…');
    const dialog = await screen.findByRole('alertdialog');
    await confirm(dialog);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    release();
    expect(await screen.findByText('Zanonimizowano klienta.')).toBeTruthy();
  });

  it('EVM-041 AC8 offline the confirmation is off with the hint', async () => {
    const page = erasePage(JAN);
    const dialog = await openDialog(page);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    globalThis.dispatchEvent(new Event('offline'));
    const button = within(dialog).getByRole('button', { name: 'Anonimizuj klienta' });
    await waitFor(() => {
      expect(button.getAttribute('aria-disabled')).toBe('true');
    });
    expect(button.getAttribute('title')).toBe('Brak połączenia. Zanonimizujesz klienta po powrocie połączenia.');
  });

  it('EVM-041 AC4 a deleted and anonymized customer is read-only with the banner and "Przywróć klienta"', async () => {
    const page = erasePage({ ...ANONYMIZED, deletedAt: DELETED_AT });
    await open(page);
    expect(await screen.findByText('Klient jest usunięty i zanonimizowany — widzi go tylko administrator.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Przywróć klienta' })).toBeTruthy();
    await userEvent.click(await trigger());
    expect(menuItem('Edytuj dane klienta…').getAttribute('aria-disabled')).toBe('true');
    expect(menuItem('Anonimizuj klienta…').getAttribute('aria-disabled')).toBe('true');
    expect(document.body.textContent).toContain('Dane zanonimizowanego klienta są tylko do odczytu.');
  });

  it('EVM-041 AC3 the deleted customer view passes axe', async () => {
    const page = erasePage(DELETED);
    await open(page);
    await screen.findByText('Klient jest usunięty — widzi go tylko administrator.');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });
});
