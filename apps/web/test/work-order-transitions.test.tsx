import type { CurrentSession, WorkOrderDetails, WorkOrderStatus } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todayWarsaw } from '../src/work-orders/transition-actions.ts';
import { resetStepUp } from '../src/session/step-up.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler, type Recorded } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER, ORDER_ID, workOrderRoutes } from './work-order-api.ts';

const userEvent = userEventDefault.setup({ delay: null });
const PATH = `/work-orders/${ORDER_ID}`;
const TRANSITIONS = `POST /api/v1/work-orders/${ORDER_ID}/transitions`;
const READ = `GET /api/v1/work-orders/${ORDER_ID}`;

const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } });

const MENU: Readonly<Partial<Record<WorkOrderStatus, WorkOrderStatus[]>>> = {
  new: ['quoting', 'accepted', 'on_hold', 'cancelled'],
  quoting: ['accepted', 'on_hold', 'cancelled'],
  accepted: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['completed', 'on_hold', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  completed: ['settled', 'in_progress'],
};

function orderWith(status: WorkOrderStatus, version = 3, extra: Partial<WorkOrderDetails> = {}, restore = false): WorkOrderDetails {
  const restoreTarget: Partial<Record<WorkOrderStatus, WorkOrderStatus[]>> = restore
    ? { settled: ['completed'], cancelled: ['on_hold'] }
    : {};
  return { ...HEADER, status, version, allowedTransitions: restoreTarget[status] ?? MENU[status] ?? [], ...extra };
}

interface Setup {
  readonly session?: CurrentSession;
  readonly order: WorkOrderDetails;
  /** Answers of the POST, one after another (the last repeats). */
  readonly posts?: Handler[];
}

function transitionApi({ session = ACTIVE_SESSION, order, posts = [] }: Setup) {
  const current = order;
  let call = 0;
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    ...workOrderRoutes(ORDER_ID),
    [READ]: () => json(200, current, { ETag: `"${String(current.version)}"` }),
    [TRANSITIONS]: (request) => {
      const handler = posts[Math.min(call++, posts.length - 1)];
      return handler?.(request) ?? problem(500, 'internal_error');
    },
  });
}

/** An accepted transition: the answer is the order in the new status (version + 1). */
const accepted =
  (status: WorkOrderStatus, extra: Partial<WorkOrderDetails> = {}, version = 4): Handler =>
  () =>
    json(200, orderWith(status, version, extra), { ETag: `"${String(version)}"` });

const body = (request: Recorded | undefined): unknown => parseBody(request?.body ?? '{}');
const badge = (name: string) => screen.findByRole('button', { name });
const status = (label: string) => `Status zlecenia: ${label}. Zmień status`;

async function choose(trigger: string, item: string | RegExp) {
  await userEvent.click(await badge(trigger));
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}

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

describe('W-06 menu przejść odznaki (EVM-030 AC1)', () => {
  it('EVM-030 AC1 the badge of "Nowe" is the button of the menu with only the allowed transitions, in the order of the table', async () => {
    await renderPanel(PATH, transitionApi({ order: orderWith('new') }));
    const trigger = await badge(status('Nowe'));
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    await userEvent.click(trigger);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Rozpocznij wycenę',
      'Zaakceptuj bez wyceny',
      'Wstrzymaj…',
      'Anuluj zlecenie…',
    ]);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-030 AC1 "Zaakceptuj bez wyceny" runs at once with If-Match and an Idempotency-Key, the badge shows the answer and the toast has no "Cofnij"', async () => {
    const api = transitionApi({ order: orderWith('new'), posts: [accepted('accepted')] });
    await renderPanel(PATH, api);
    await choose(status('Nowe'), 'Zaakceptuj bez wyceny');
    expect(await badge(status('Zaakceptowane'))).toBeTruthy();
    const sent = api.calls(TRANSITIONS)[0];
    expect(sent?.headers.get('If-Match')).toBe('"3"');
    expect(sent?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(body(sent)).toEqual({ to: 'accepted' });
    expect(screen.getByText('Zaakceptowano zlecenie.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
    // the focus stays on the badge, which now shows the new status
    expect(document.activeElement).toBe(screen.getByRole('button', { name: status('Zaakceptowane') }));
  });

  it('EVM-030 AC1 the path "Rozpocznij wycenę", "Zaakceptuj", "Rozpocznij realizację" sends the next version each time', async () => {
    const api = transitionApi({
      order: orderWith('new'),
      posts: [accepted('quoting', {}, 4), accepted('accepted', {}, 5), accepted('in_progress', {}, 6)],
    });
    await renderPanel(PATH, api);
    await choose(status('Nowe'), 'Rozpocznij wycenę');
    await choose(status('Wycena'), 'Zaakceptuj');
    await choose(status('Zaakceptowane'), 'Rozpocznij realizację');
    expect(await badge(status('W realizacji'))).toBeTruthy();
    expect(api.calls(TRANSITIONS).map((request) => request.headers.get('If-Match'))).toEqual(['"3"', '"4"', '"5"']);
    expect(api.calls(TRANSITIONS).map((request) => (body(request) as { to: string }).to)).toEqual(['quoting', 'accepted', 'in_progress']);
  });

  it('EVM-030 AC1 "Zakończ" asks for the date (today by default), sends it, and "Cofnij" in the toast reopens with the new version', async () => {
    const api = transitionApi({
      order: orderWith('in_progress'),
      posts: [accepted('completed', { completedOn: todayWarsaw(Date.now()) }, 4), accepted('in_progress', {}, 5)],
    });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Zakończ');
    const dialog = await screen.findByRole('dialog', { name: 'Zakończ zlecenie ZL-2026-0042' });
    const date = within(dialog).getByLabelText<HTMLInputElement>('Data zakończenia');
    expect(date.value).toBe(todayWarsaw(Date.now()));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zakończ zlecenie' }));
    expect(await badge(status('Zakończone'))).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[0])).toEqual({ to: 'completed', completedOn: todayWarsaw(Date.now()) });
    expect(screen.getByText('Zakończono zlecenie.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Cofnij' }));
    expect(await badge(status('W realizacji'))).toBeTruthy();
    const undo = api.calls(TRANSITIONS)[1];
    expect(undo?.headers.get('If-Match')).toBe('"4"');
    expect(body(undo)).toEqual({ to: 'in_progress' });
    expect(screen.getByText('Cofnięto zmianę statusu zlecenia.')).toBeTruthy();
  });

  it('EVM-030 AC1 a date from the future is refused in the dialog without a request', async () => {
    const api = transitionApi({ order: orderWith('in_progress'), posts: [accepted('completed')] });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Zakończ');
    const dialog = await screen.findByRole('dialog', { name: /Zakończ zlecenie/ });
    const date = within(dialog).getByLabelText('Data zakończenia');
    await userEvent.clear(date);
    await userEvent.type(date, '2099-01-01');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zakończ zlecenie' }));
    expect(await within(dialog).findByText('Data nie może być późniejsza niż dziś.')).toBeTruthy();
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
  });

  it('EVM-030 AC1 "Rozlicz…" asks first (the focus on "Anuluj"), says only an administrator can undo it, and settles on confirmation', async () => {
    const api = transitionApi({ order: orderWith('completed'), posts: [accepted('settled', { closedAt: '2026-10-08T10:00:00.000Z' })] });
    await renderPanel(PATH, api);
    await choose(status('Zakończone'), 'Rozlicz…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Rozliczyć zlecenie ZL-2026-0042?' });
    expect(within(dialog).getByText(/Cofnąć rozliczenie może tylko administrator\./)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(await axeViolations(dialog)).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rozlicz zlecenie' }));
    expect(await badge(status('Rozliczone'))).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[0])).toEqual({ to: 'settled' });
    expect(screen.getByText('Rozliczono zlecenie.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
  });

  it('EVM-030 AC1 "Anuluj" in the dialog sends nothing and the focus returns to the badge', async () => {
    const api = transitionApi({ order: orderWith('completed'), posts: [accepted('settled')] });
    await renderPanel(PATH, api);
    await choose(status('Zakończone'), 'Rozlicz…');
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: status('Zakończone') }));
    });
  });
});

describe('Wstrzymanie i wznowienie (EVM-030 AC2)', () => {
  it('EVM-030 AC2 "Wstrzymaj…" needs the reason (one error, no request), then holds; "Cofnij" resumes', async () => {
    const api = transitionApi({
      order: orderWith('in_progress'),
      posts: [accepted('on_hold', { resumeStatus: 'in_progress' }, 4), accepted('in_progress', {}, 5)],
    });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Wstrzymaj…');
    const dialog = await screen.findByRole('dialog', { name: 'Wstrzymaj zlecenie ZL-2026-0042' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wstrzymaj zlecenie' }));
    expect(await within(dialog).findByText('Wpisz powód.')).toBeTruthy();
    expect(api.calls(TRANSITIONS)).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText('Powód wstrzymania'), '  Czekamy na decyzję klienta  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wstrzymaj zlecenie' }));
    expect(await badge(status('Wstrzymane'))).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[0])).toEqual({ to: 'on_hold', reason: 'Czekamy na decyzję klienta' });
    expect(screen.getByText('Wstrzymano zlecenie.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Cofnij' }));
    expect(await badge(status('W realizacji'))).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[1])).toEqual({ to: 'in_progress' });
  });

  it('EVM-030 AC2 a reason of 501 characters is refused in the dialog, 500 goes through', async () => {
    const api = transitionApi({ order: orderWith('in_progress'), posts: [accepted('on_hold', { resumeStatus: 'in_progress' })] });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Wstrzymaj…');
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Powód wstrzymania');
    await userEvent.click(field);
    await userEvent.paste('a'.repeat(501));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wstrzymaj zlecenie' }));
    expect(await within(dialog).findByText('Powód może mieć najwyżej 500 znaków.')).toBeTruthy();
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
    await userEvent.clear(field);
    await userEvent.click(field);
    await userEvent.paste('a'.repeat(500));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wstrzymaj zlecenie' }));
    expect(await badge(status('Wstrzymane'))).toBeTruthy();
  });

  it('EVM-030 AC2 "Wznów" returns to the status before the hold; "Cofnij" holds again with the same reason, which stayed in the memory of the tab', async () => {
    const api = transitionApi({
      order: orderWith('in_progress'),
      posts: [
        accepted('on_hold', { resumeStatus: 'in_progress' }, 4),
        accepted('in_progress', {}, 5),
        accepted('on_hold', { resumeStatus: 'in_progress' }, 6),
      ],
    });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Wstrzymaj…');
    await userEvent.type(await screen.findByLabelText('Powód wstrzymania'), 'Brak materiału');
    await userEvent.click(screen.getByRole('button', { name: 'Wstrzymaj zlecenie' }));
    await choose(status('Wstrzymane'), 'Wznów');
    expect(await badge(status('W realizacji'))).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[1])).toEqual({ to: 'in_progress' });
    expect(screen.getByText('Wznowiono zlecenie.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cofnij' }));
    expect(await badge(status('Wstrzymane'))).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[2])).toEqual({ to: 'on_hold', reason: 'Brak materiału' });
    // the reason is in no store of the browser and not in the address
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('EVM-030 AC2 "Wznów" of an order held before this visit has no "Cofnij" (the API does not return the reason)', async () => {
    const api = transitionApi({ order: orderWith('on_hold', 3, { resumeStatus: 'in_progress' }), posts: [accepted('in_progress')] });
    await renderPanel(PATH, api);
    await choose(status('Wstrzymane'), 'Wznów');
    expect(await badge(status('W realizacji'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
  });

  it('EVM-030 AC1 "Otwórz ponownie" can be undone with the previous date of completion', async () => {
    const api = transitionApi({
      order: orderWith('completed', 3, { completedOn: '2026-10-05' }),
      posts: [accepted('in_progress', {}, 4), accepted('completed', { completedOn: '2026-10-05' }, 5)],
    });
    await renderPanel(PATH, api);
    await choose(status('Zakończone'), 'Otwórz ponownie');
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    expect(await badge(status('Zakończone'))).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[1])).toEqual({ to: 'completed', completedOn: '2026-10-05' });
  });
});

describe('Anulowanie i zlecenie zamknięte (EVM-030 AC3, AC6)', () => {
  it('EVM-030 AC3 "Anuluj zlecenie…" warns that only an administrator restores, needs the reason and closes the order', async () => {
    const api = transitionApi({
      order: orderWith('in_progress'),
      posts: [accepted('cancelled', { closedAt: '2026-10-08T10:00:00.000Z' })],
    });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Anuluj zlecenie…');
    const dialog = await screen.findByRole('dialog', { name: 'Anuluj zlecenie ZL-2026-0042' });
    expect(within(dialog).getByText(/Przywrócić zlecenie może tylko administrator\./)).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText('Powód anulowania'), 'Klient zrezygnował');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj zlecenie' }));
    expect(await badge(status('Anulowane'))).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[0])).toEqual({ to: 'cancelled', reason: 'Klient zrezygnował' });
    expect(screen.getByText('Anulowano zlecenie.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
    // the closed order shows its banner at once
    expect(screen.getByRole('region', { name: 'Stan zlecenia' }).textContent).toContain('Zlecenie jest anulowane');
  });

  it('EVM-030 AC6 the banner of a settled order differs by role: Administrator (the way back), Editor (only an administrator), Tylko odczyt (no part about adding)', async () => {
    const first = 'Zlecenie jest rozliczone — dane zlecenia, zakres, procesy i płatności są tylko do odczytu.';
    const adding = 'Wpisy, zdjęcia, filmy i dokumenty nadal możesz dodawać.';
    const settled = orderWith('settled', 3, { closedAt: '2026-10-08T10:00:00.000Z' }, true);
    const admin = await renderPanel(PATH, transitionApi({ order: settled }));
    const region = await screen.findByRole('region', { name: 'Stan zlecenia' });
    expect(region.textContent).toContain(`${first} ${adding}`);
    expect(region.textContent).toContain('Zmienisz je po przywróceniu zlecenia — menu statusu zlecenia.');
    expect(await axeViolations(region)).toEqual([]);
    admin.unmount();

    const editor = await renderPanel(PATH, transitionApi({ order: orderWith('settled', 3), session: roleSession('editor') }));
    expect((await screen.findByRole('region', { name: 'Stan zlecenia' })).textContent).toContain(
      'Przywrócić zlecenie może tylko administrator.',
    );
    editor.unmount();

    await renderPanel(PATH, transitionApi({ order: orderWith('settled', 3), session: roleSession('read_only') }));
    const readOnly = await screen.findByRole('region', { name: 'Stan zlecenia' });
    expect(readOnly.textContent).toBe(first);
  });

  it('EVM-030 AC6 an open order has no banner of closing', async () => {
    await renderPanel(PATH, transitionApi({ order: orderWith('in_progress') }));
    await badge(status('W realizacji'));
    expect(screen.queryByRole('region', { name: 'Stan zlecenia' })).toBeNull();
  });
});

describe('Przywrócenie (EVM-030 AC4)', () => {
  it('EVM-030 AC4 the Administrator restores a settled order after W-04: 403 step_up_required opens the dialog once, then the same request is sent again', async () => {
    const api = transitionApi({
      order: orderWith('settled', 3, { closedAt: '2026-10-08T10:00:00.000Z' }, true),
      posts: [() => problem(403, 'step_up_required'), accepted('completed')],
    });
    api.set('POST /api/v1/auth/step-up/options', () =>
      json(200, {
        challenge: 'Y2hhbGxlbmdl',
        rpId: 'localhost',
        userVerification: 'required',
        allowCredentials: [{ id: 'Y3JlZA', type: 'public-key' }],
      }),
    );
    api.set('POST /api/v1/auth/step-up', () => json(200, { csrfToken: 'csrf-rotated' }));
    await renderPanel(PATH, api);
    await choose(status('Rozliczone'), 'Przywróć zlecenie…');
    const confirm = await screen.findByRole('alertdialog', { name: 'Przywrócić zlecenie ZL-2026-0042?' });
    expect(within(confirm).getByText(/Zlecenie wróci do statusu „Zakończone”/)).toBeTruthy();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Przywróć zlecenie' }));

    const stepUp = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby przywrócić zlecenie' });
    expect(api.calls(TRANSITIONS)).toHaveLength(1);
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(await badge(status('Zakończone'))).toBeTruthy();
    expect(api.calls(TRANSITIONS)).toHaveLength(2);
    expect(body(api.calls(TRANSITIONS)[1])).toEqual({ to: 'completed' });
    expect(screen.getByText('Przywrócono zlecenie.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Stan zlecenia' })).toBeNull();
  });

  it('EVM-030 AC4 a cancelled order is restored to "Wstrzymane"', async () => {
    const api = transitionApi({
      order: orderWith('cancelled', 3, {}, true),
      posts: [accepted('on_hold', { resumeStatus: 'in_progress' })],
    });
    await renderPanel(PATH, api);
    await choose(status('Anulowane'), 'Przywróć zlecenie…');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Zlecenie wróci do statusu „Wstrzymane”/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Przywróć zlecenie' }));
    expect(await badge(status('Wstrzymane'))).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[0])).toEqual({ to: 'on_hold' });
  });

  it('EVM-030 AC4 cancelling W-04 ends with an alert and no loop (one request, no second W-04)', async () => {
    const api = transitionApi({
      order: orderWith('settled', 3, {}, true),
      posts: [() => problem(403, 'step_up_required')],
    });
    await renderPanel(PATH, api);
    await choose(status('Rozliczone'), 'Przywróć zlecenie…');
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Przywróć zlecenie' }));
    const stepUp = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby przywrócić zlecenie' });
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Anuluj' }));
    expect(await screen.findByText('Przywrócenie wymaga potwierdzenia tożsamości. Spróbuj ponownie i potwierdź tożsamość.')).toBeTruthy();
    expect(api.calls(TRANSITIONS)).toHaveLength(1);
  });

  it('EVM-030 AC4 for the Editor "Przywróć zlecenie…" is disabled with the reason, reachable by keyboard, and sends nothing', async () => {
    const api = transitionApi({
      order: orderWith('cancelled', 3),
      session: roleSession('editor'),
      posts: [() => problem(403, 'forbidden')],
    });
    await renderPanel(PATH, api);
    await userEvent.click(await badge(status('Anulowane')));
    const item = screen.getByRole('menuitem', { name: /Przywróć zlecenie…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Przywrócić zlecenie może tylko administrator.');
    expect(document.activeElement).toBe(item);
    await userEvent.keyboard('{Enter}');
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('EVM-030 AC7 Tylko odczyt gets a static badge: no button, no menu', async () => {
    await renderPanel(
      PATH,
      transitionApi({ order: orderWith('in_progress', 3, { allowedTransitions: [] }), session: roleSession('read_only') }),
    );
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    await waitFor(() => {
      expect(screen.getByText('W realizacji')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /Zmień status/ })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('EVM-030 AC7 a 403 forbidden from the server (the role changed meanwhile) is an alert under the badge', async () => {
    const api = transitionApi({
      order: orderWith('in_progress'),
      session: roleSession('editor'),
      posts: [() => problem(403, 'forbidden')],
    });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Zakończ');
    await userEvent.click(await screen.findByRole('button', { name: 'Zakończ zlecenie' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nie masz uprawnień do tej operacji.');
  });
});

describe('Błędy przejścia (EVM-030 AC5, AC8)', () => {
  it('EVM-030 AC5 412 under the badge shows the conflict with "Odśwież zlecenie", which reads the order again and returns the focus to the badge', async () => {
    const api = transitionApi({ order: orderWith('new'), posts: [() => problem(412, 'version_conflict')] });
    await renderPanel(PATH, api);
    await choose(status('Nowe'), 'Zaakceptuj bez wyceny');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('To zlecenie zmieniono w międzyczasie. Sprawdź jego aktualny stan i wybierz operację ponownie.');
    const readsBefore = api.calls(READ).length;
    api.set(READ, () => json(200, orderWith('accepted', 4), { ETag: '"4"' }));
    await userEvent.click(within(alert).getByRole('button', { name: 'Odśwież zlecenie' }));
    expect(await badge(status('Zaakceptowane'))).toBeTruthy();
    expect(api.calls(READ).length).toBeGreaterThan(readsBefore);
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: status('Zaakceptowane') }));
    });
  });

  it('EVM-030 AC5 412 in a dialog is shown above its content, the order is read again and the reason stays', async () => {
    const api = transitionApi({ order: orderWith('in_progress'), posts: [() => problem(412, 'version_conflict')] });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Wstrzymaj…');
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Powód wstrzymania'), 'Powód do zachowania');
    const reads = api.calls(READ).length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wstrzymaj zlecenie' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('To zlecenie zmieniono w międzyczasie.');
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Powód wstrzymania').value).toBe('Powód do zachowania');
    expect(within(dialog).queryByRole('button', { name: 'Odśwież zlecenie' })).toBeNull();
    await waitFor(() => {
      expect(api.calls(READ).length).toBeGreaterThan(reads);
    });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Wstrzymaj zlecenie' }));
  });

  it('EVM-030 AC5 409 invalid_state_transition is the same conflict', async () => {
    const api = transitionApi({ order: orderWith('new'), posts: [() => problem(409, 'invalid_state_transition')] });
    await renderPanel(PATH, api);
    await choose(status('Nowe'), 'Zaakceptuj bez wyceny');
    expect((await screen.findByRole('alert')).textContent).toContain('To zlecenie zmieniono w międzyczasie.');
  });

  it('EVM-030 AC5 a failed "Cofnij" says so with the refresh, not as a toast', async () => {
    const api = transitionApi({
      order: orderWith('in_progress'),
      posts: [accepted('completed', {}, 4), () => problem(412, 'version_conflict')],
    });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Zakończ');
    await userEvent.click(await screen.findByRole('button', { name: 'Zakończ zlecenie' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nie udało się cofnąć — ktoś zmienił zlecenie w międzyczasie.');
    expect(within(alert).getByRole('button', { name: 'Odśwież zlecenie' })).toBeTruthy();
  });

  it('EVM-030 AC8 a 422 from a module and a server error are alerts in the dialog; the retry sends the same Idempotency-Key', async () => {
    const api = transitionApi({
      order: orderWith('completed'),
      posts: [
        () => problem(422, 'transition_condition_not_met', { errors: [{ pointer: '/to', code: 'unpaid' }] }),
        () => problem(500, 'internal_error'),
        accepted('settled'),
      ],
    });
    await renderPanel(PATH, api);
    await choose(status('Zakończone'), 'Rozlicz…');
    const dialog = await screen.findByRole('alertdialog');
    const submit = within(dialog).getByRole('button', { name: 'Rozlicz zlecenie' });
    await userEvent.click(submit);
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Nie można wykonać tej operacji — nie są spełnione warunki.');
    await userEvent.click(submit);
    await waitFor(() => {
      expect(within(dialog).getByRole('alert').textContent).toContain('Nie udało się zmienić statusu zlecenia.');
    });
    await userEvent.click(submit);
    expect(await badge(status('Rozliczone'))).toBeTruthy();
    const keys = api.calls(TRANSITIONS).map((request) => request.headers.get('Idempotency-Key'));
    expect(new Set(keys).size).toBe(1);
  });

  it('EVM-030 AC5 400 with a reason code from the server is shown under the field by the code, never with the value', async () => {
    const api = transitionApi({
      order: orderWith('in_progress'),
      posts: [
        () => problem(400, 'validation_failed', { errors: [{ pointer: '/reason', code: 'invalid_characters' }] }),
        () => problem(400, 'validation_failed', { errors: [{ pointer: '/reason', code: 'too_long' }] }),
      ],
    });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Wstrzymaj…');
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Powód wstrzymania'), 'Tekst');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wstrzymaj zlecenie' }));
    expect(await within(dialog).findByText('Powód zawiera niedozwolone znaki.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wstrzymaj zlecenie' }));
    expect(await within(dialog).findByText('Powód może mieć najwyżej 500 znaków.')).toBeTruthy();
  });

  it('EVM-030 AC1 a status the panel does not know stays a static badge (P-12) with no menu', async () => {
    await renderPanel(PATH, transitionApi({ order: { ...orderWith('new'), status: 'archived' as WorkOrderStatus } }));
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    await screen.findByText('Nieznany status');
    expect(screen.queryByRole('button', { name: /Zmień status/ })).toBeNull();
  });

  it('EVM-030 AC8 429 shows the wait and keeps the reason in the dialog', async () => {
    const api = transitionApi({
      order: orderWith('in_progress'),
      posts: [() => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }), accepted('on_hold', { resumeStatus: 'in_progress' })],
    });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Anuluj zlecenie…');
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Powód anulowania'), 'Powód po 429');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj zlecenie' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.');
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Powód anulowania').value).toBe('Powód po 429');
  });

  it('EVM-030 AC8 offline the badge is disabled with the hint "Zmienisz po powrocie połączenia." and nothing is sent', async () => {
    const api = transitionApi({ order: orderWith('in_progress'), posts: [accepted('completed')] });
    await renderPanel(PATH, api);
    await badge(status('W realizacji'));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    const trigger = await screen.findByRole('button', { name: 'Status zlecenia: W realizacji. Zmień status' });
    await waitFor(() => {
      expect(trigger.getAttribute('aria-disabled')).toBe('true');
    });
    expect(trigger.getAttribute('title')).toBe('Zmienisz po powrocie połączenia.');
    await userEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
  });

  it('EVM-030 AC8 an open dialog that goes offline keeps the reason and blocks the sending with the hint', async () => {
    const api = transitionApi({ order: orderWith('in_progress'), posts: [accepted('on_hold')] });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Wstrzymaj…');
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Powód wstrzymania'), 'Zostaje');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    expect(await within(dialog).findByText('Zmienisz po powrocie połączenia.')).toBeTruthy();
    const submit = within(dialog).getByRole('button', { name: 'Wstrzymaj zlecenie' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(submit);
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Powód wstrzymania').value).toBe('Zostaje');
  });

  it('EVM-030 AC8 the dialog is accessible and the focus lands on the reason; Esc closes it and drops the reason', async () => {
    const api = transitionApi({ order: orderWith('in_progress'), posts: [accepted('on_hold')] });
    await renderPanel(PATH, api);
    await choose(status('W realizacji'), 'Wstrzymaj…');
    const dialog = await screen.findByRole('dialog');
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Powód wstrzymania'));
    expect(await axeViolations(dialog)).toEqual([]);
    await userEvent.type(document.activeElement as HTMLElement, 'Nie zapisuj mnie');
    // jsdom does not turn Esc into the `cancel` event of a modal <dialog>; the browser does.
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
    await choose(status('W realizacji'), 'Wstrzymaj…');
    expect((await screen.findByLabelText<HTMLTextAreaElement>('Powód wstrzymania')).value).toBe('');
  });
});
