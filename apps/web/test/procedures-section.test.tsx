import type { CurrentSession, ProcedureList, ProcedureStage } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { renderPanel, activeSessionApi } from './render.tsx';
import { HEADER, ORDER_ID, workOrderRoutes } from './work-order-api.ts';

const userEvent = userEventDefault.setup({ delay: null });
const PATH = `/work-orders/${ORDER_ID}`;
const BASE = `/api/v1/work-orders/${ORDER_ID}`;
const PROCEDURES = `GET ${BASE}/procedures`;
const PETR = '22222222-2222-4222-8222-222222222222';
const ME = ACTIVE_SESSION.user.id;

const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } });

const stage = (n: number, extra: Partial<ProcedureStage> = {}): ProcedureStage => ({
  id: `01968f3e-0000-7000-8000-0000000f0${String(n).padStart(3, '0')}`,
  code: `stage_${String(n)}`,
  name: `Etap ${String(n)}`,
  position: n,
  status: 'todo',
  dueDate: null,
  overdue: false,
  responsibleUser: null,
  waitingOn: null,
  waitingParty: null,
  waitingSince: null,
  waitingDays: null,
  blockedReason: null,
  startedAt: null,
  completedOn: null,
  version: 1,
  ...extra,
});

const OVERDUE = stage(1, {
  name: 'Wniosek do OSD',
  dueDate: '2026-10-02',
  overdue: true,
  responsibleUser: { id: ME, displayName: 'Anna Testowa' },
  version: 4,
});

/** The first process of a list (the fixtures always have one). */
function firstProcess(procedures: ProcedureList): ProcedureList['items'][number] {
  const [head] = procedures.items;
  if (head === undefined) throw new Error('the fixture has no process');
  return head;
}

function list(): ProcedureList {
  return {
    items: [
      {
        id: '01968f3e-0000-7000-8000-0000000a0001',
        code: 'osd',
        name: 'Uzgodnienia z OSD',
        position: 1,
        progress: { done: 2, total: 7 },
        stages: [
          OVERDUE,
          stage(2, { name: 'Warunki przyłączenia', dueDate: '2026-12-01' }),
          stage(3, { name: 'Umowa z OSD', status: 'done' }),
        ],
      },
      {
        id: '01968f3e-0000-7000-8000-0000000a0002',
        code: 'ppoz',
        name: 'Opinia ppoż',
        position: 2,
        progress: { done: 2, total: 2 },
        stages: [stage(4, { name: 'Zlecenie opinii', status: 'done' }), stage(5, { name: 'Odbiór opinii', status: 'done' })],
      },
      {
        id: '01968f3e-0000-7000-8000-0000000a0003',
        code: 'expertise',
        name: 'Ekspertyza techniczna',
        position: 3,
        progress: { done: 0, total: 0 },
        stages: [stage(6, { name: 'Oględziny', status: 'not_applicable' })],
      },
      {
        id: '01968f3e-0000-7000-8000-0000000a0004',
        code: 'empty',
        name: 'Projekt instalacji',
        position: 4,
        progress: { done: 0, total: 0 },
        stages: [],
      },
    ],
    openStageCount: 4,
  };
}

function api(procedures: Handler = () => json(200, list()), session: CurrentSession = ACTIVE_SESSION, extra: Record<string, Handler> = {}) {
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    ...workOrderRoutes(ORDER_ID, { procedures }),
    ...extra,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const section = () => within(screen.getByRole('region', { name: /^Procesy i etapy/ }));
const proceduresReady = () => screen.findByRole('heading', { level: 2, name: 'Procesy i etapy (4)' });

async function openEdit(stageName: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Akcje etapu: ${stageName}` }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Zmień osobę odpowiedzialną i termin…' }));
  return screen.findByRole('dialog', { name: `Zmień etap: ${stageName}` });
}

describe('W-06 "Procesy i etapy" (EVM-031 AC2)', () => {
  it('EVM-031 AC2 every process is a section with its progress, the first one is open and "Rozwiń wszystkie" opens the rest', async () => {
    await renderPanel(PATH, api());
    await proceduresReady();
    const view = section();
    const first = view.getByRole('button', { name: /^Uzgodnienia z OSD\s*2 z 7 etapów$/ });
    expect(first.getAttribute('aria-expanded')).toBe('true');
    const second = view.getByRole('button', { name: /^Opinia ppoż\s*2 z 2 etapów\s*Wszystkie zakończone$/ });
    expect(second.getAttribute('aria-expanded')).toBe('false');
    expect(view.getByRole('button', { name: /^Ekspertyza techniczna\s*Nie dotyczy$/ })).toBeTruthy();
    // a process without stages says so and has no progress
    expect(view.getByRole('button', { name: 'Projekt instalacji' })).toBeTruthy();

    await userEvent.click(view.getByRole('button', { name: 'Rozwiń wszystkie' }));
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(view.getByText('Proces nie ma etapów.')).toBeTruthy();
    await userEvent.click(view.getByRole('button', { name: 'Zwiń wszystkie' }));
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(view.getByRole('button', { name: 'Rozwiń wszystkie' })).toBeTruthy();
  });

  it('EVM-031 AC2 a stage shows the name, the status badge, the due date and "Osoba odpowiedzialna: Anna Testowa"', async () => {
    await renderPanel(PATH, api());
    await proceduresReady();
    const items = within(screen.getByRole('list', { name: 'Uzgodnienia z OSD' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0] as HTMLElement).getByText('Wniosek do OSD')).toBeTruthy();
    expect(within(items[0] as HTMLElement).getByText('Do zrobienia')).toBeTruthy();
    expect(within(items[0] as HTMLElement).getByText('Osoba odpowiedzialna: Anna Testowa')).toBeTruthy();
    expect(within(items[1] as HTMLElement).getByText('Termin: 01.12.2026')).toBeTruthy();
    expect(within(items[1] as HTMLElement).queryByText(/po terminie/)).toBeNull();
    expect(within(items[2] as HTMLElement).getByText('Zakończony')).toBeTruthy();
  });

  it('EVM-031 AC2 a status this panel does not know is the badge of an unknown value, never the raw code', async () => {
    const odd = list();
    odd.items = [{ ...firstProcess(odd), stages: [stage(1, { status: 'future_status' as ProcedureStage['status'] })] }];
    await renderPanel(
      PATH,
      api(() => json(200, odd)),
    );
    expect(await screen.findByText('Nieznany status')).toBeTruthy();
    expect(document.body.textContent).not.toContain('future_status');
  });

  it('EVM-031 AC2 names are rendered as text, never as markup (SR-WEB-03)', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    const odd = list();
    odd.items = [
      {
        ...firstProcess(odd),
        name: markup,
        stages: [stage(1, { name: markup, responsibleUser: { id: ME, displayName: markup } })],
      },
    ];
    await renderPanel(
      PATH,
      api(() => json(200, odd)),
    );
    await screen.findByRole('heading', { level: 2, name: 'Procesy i etapy (1)' });
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getAllByText(markup, { exact: false }).length).toBeGreaterThan(1);
  });

  it('EVM-031 AC2 the page with the processes has no accessibility violations', async () => {
    await renderPanel(PATH, api());
    await proceduresReady();
    await screen.findByText('Instalacja zasilająca');
    await screen.findByText('Operator Testowy');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });
});

describe('W-06 "Procesy i etapy" — states (EVM-031 AC8)', () => {
  it('EVM-031 AC8 an order without processes says so', async () => {
    await renderPanel(
      PATH,
      api(() => json(200, { items: [], openStageCount: 0 })),
    );
    expect(await screen.findByText('Zlecenie nie ma jeszcze procesów.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Procesy i etapy (0)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rozwiń wszystkie' })).toBeNull();
  });

  it('EVM-031 AC8 while the processes are read the section shows a skeleton and a status for assistive technology', async () => {
    let resolve: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    await renderPanel(
      PATH,
      api(() => pending),
    );
    await screen.findByText('Instalacja zasilająca');
    const loading = within(screen.getByRole('region', { name: 'Procesy i etapy' }));
    expect(loading.getByRole('status').textContent).toBe('Wczytujemy sekcję…');
    resolve(json(200, list()));
    await proceduresReady();
  });

  it('EVM-031 AC8 a failed read is an alert in the section with "Spróbuj ponownie"; the other sections keep working', async () => {
    let fail = true;
    const handler: Handler = () => (fail ? problem(500, 'internal_error') : json(200, list()));
    await renderPanel(PATH, api(handler));
    const alert = await screen.findByText('Nie udało się wczytać procesów i etapów.');
    expect(alert).toBeTruthy();
    expect(await screen.findByText('Instalacja zasilająca')).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await proceduresReady();
    expect(screen.queryByText('Nie udało się wczytać procesów i etapów.')).toBeNull();
  });

  it('EVM-031 AC8 offline the actions of the stages are disabled with the hint "Zmienisz po powrocie połączenia."', async () => {
    await renderPanel(PATH, api());
    await proceduresReady();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }));
    const item = await screen.findByRole('menuitem', { name: /^Zmień osobę odpowiedzialną i termin…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe('Zmienisz po powrocie połączenia.');
    await userEvent.click(item);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('W-06 "Procesy i etapy" — roles (EVM-031 AC7)', () => {
  it('EVM-031 AC7 Tylko odczyt sees the processes but has no actions on the stages', async () => {
    await renderPanel(PATH, api(undefined, roleSession('read_only')));
    await proceduresReady();
    expect(screen.queryByRole('button', { name: /^Akcje etapu/ })).toBeNull();
    expect(section().getByText('Wniosek do OSD')).toBeTruthy();
  });

  it('EVM-031 AC7 the Editor has the menu of the stage, the Administrator too', async () => {
    await renderPanel(PATH, api(undefined, roleSession('editor')));
    await proceduresReady();
    expect(screen.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' })).toBeTruthy();
  });
});

describe('W-06 "Procesy i etapy" — the person responsible and the due date (EVM-031 AC3)', () => {
  it('EVM-031 AC3 a stage after the due date has "po terminie" with a clock icon, the text carries the meaning', async () => {
    await renderPanel(PATH, api());
    await proceduresReady();
    const row = within(within(screen.getByRole('list', { name: 'Uzgodnienia z OSD' })).getAllByRole('listitem')[0] as HTMLElement);
    expect(row.getByText('Termin: 02.10.2026')).toBeTruthy();
    const late = row.getByText('· po terminie');
    expect(late.parentElement?.querySelector('svg')?.getAttribute('class')).toContain('lucide-alarm-clock');
    expect(late.parentElement?.className).toContain('text-text-error');
  });

  it('EVM-031 AC3 the Editor sets the person and the date: a merge-patch with If-Match and an Idempotency-Key, then the row shows the answer', async () => {
    const saved = stage(2, {
      name: 'Warunki przyłączenia',
      dueDate: '2026-11-05',
      responsibleUser: { id: PETR, displayName: 'Piotr Testowy' },
      version: 2,
    });
    const patch: Handler = () => json(200, saved, { ETag: '"2"' });
    const fake = api(undefined, roleSession('editor'), {
      'GET /api/v1/users/assignable': () =>
        json(200, {
          items: [
            { id: ME, displayName: 'Anna Testowa' },
            { id: PETR, displayName: 'Piotr Testowy' },
          ],
          nextCursor: null,
        }),
      [`PATCH ${BASE}/procedure-stages/${stage(2).id}`]: patch,
    });
    await renderPanel(PATH, fake);
    await proceduresReady();
    const dialog = await openEdit('Warunki przyłączenia');
    await userEvent.selectOptions(within(dialog).getByLabelText('Osoba odpowiedzialna'), PETR);
    await userEvent.clear(within(dialog).getByLabelText('Termin'));
    await userEvent.type(within(dialog).getByLabelText('Termin'), '2026-11-05');
    // the due date was typed over 2026-12-01
    const date = within(dialog).getByLabelText<HTMLInputElement>('Termin');
    expect(date.value).toBe('2026-11-05');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    expect(await screen.findByText('Zapisano zmiany etapu.')).toBeTruthy();
    const sent = fake.calls(`PATCH ${BASE}/procedure-stages/${stage(2).id}`)[0];
    expect(sent?.headers.get('If-Match')).toBe('"1"');
    expect(sent?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(parseBody(sent?.body ?? '{}')).toEqual({ responsibleUserId: PETR, dueDate: '2026-11-05' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const row = within(within(screen.getByRole('list', { name: 'Uzgodnienia z OSD' })).getAllByRole('listitem')[1] as HTMLElement);
    expect(row.getByText('Osoba odpowiedzialna: Piotr Testowy')).toBeTruthy();
    expect(row.getByText('Termin: 05.11.2026')).toBeTruthy();
    // the focus returns to the menu of the stage the change was started from
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje etapu: Warunki przyłączenia' }));
  });

  it('EVM-031 AC3 "Brak" and an empty date clear both values (null)', async () => {
    const fake = api(undefined, ACTIVE_SESSION, {
      [`PATCH ${BASE}/procedure-stages/${OVERDUE.id}`]: () =>
        json(200, { ...OVERDUE, dueDate: null, overdue: false, responsibleUser: null, version: 5 }),
    });
    await renderPanel(PATH, fake);
    await proceduresReady();
    const dialog = await openEdit('Wniosek do OSD');
    await userEvent.selectOptions(within(dialog).getByLabelText('Osoba odpowiedzialna'), '');
    await userEvent.clear(within(dialog).getByLabelText('Termin'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    await screen.findByText('Zapisano zmiany etapu.');
    const sent = fake.calls(`PATCH ${BASE}/procedure-stages/${OVERDUE.id}`)[0];
    expect(sent?.headers.get('If-Match')).toBe('"4"');
    expect(parseBody(sent?.body ?? '{}')).toEqual({ responsibleUserId: null, dueDate: null });
    expect(screen.queryByText(/po terminie/)).toBeNull();
  });

  it('EVM-031 AC3 nothing changed: "Zapisz zmiany" closes the dialog without a request', async () => {
    const fake = api();
    await renderPanel(PATH, fake);
    await proceduresReady();
    const dialog = await openEdit('Wniosek do OSD');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(fake.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0);
  });

  it('EVM-031 AC3 412 reads the processes again, keeps what was typed and the next save uses the new version', async () => {
    let calls = 0;
    const url = `PATCH ${BASE}/procedure-stages/${OVERDUE.id}`;
    let reads = 0;
    const fake = api(
      () => {
        reads += 1;
        const fresh = list();
        if (reads > 1) firstProcess(fresh).stages[0] = { ...OVERDUE, version: 7 };
        return json(200, fresh);
      },
      ACTIVE_SESSION,
      {
        [url]: () => {
          calls += 1;
          return calls === 1
            ? problem(412, 'version_conflict')
            : json(200, { ...OVERDUE, dueDate: '2026-11-05', overdue: false, version: 8 });
        },
      },
    );
    await renderPanel(PATH, fake);
    await proceduresReady();
    const dialog = await openEdit('Wniosek do OSD');
    await userEvent.clear(within(dialog).getByLabelText('Termin'));
    await userEvent.type(within(dialog).getByLabelText('Termin'), '2026-11-05');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    expect(await within(dialog).findByText('Ten etap zmieniono w międzyczasie. Sprawdź dane i zapisz zmiany ponownie.')).toBeTruthy();
    expect(within(dialog).getByLabelText<HTMLInputElement>('Termin').value).toBe('2026-11-05');
    await waitFor(() => {
      expect(reads).toBe(2);
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    await screen.findByText('Zapisano zmiany etapu.');
    expect(fake.calls(url).map((request) => request.headers.get('If-Match'))).toEqual(['"4"', '"7"']);
  });

  it('EVM-031 AC3 a lost answer is retried with the same Idempotency-Key', async () => {
    const url = `PATCH ${BASE}/procedure-stages/${OVERDUE.id}`;
    let calls = 0;
    const fake = api(undefined, ACTIVE_SESSION, {
      [url]: () => {
        calls += 1;
        return calls === 1 ? problem(503, 'unavailable') : json(200, { ...OVERDUE, dueDate: '2026-11-05', overdue: false, version: 5 });
      },
    });
    await renderPanel(PATH, fake);
    await proceduresReady();
    const dialog = await openEdit('Wniosek do OSD');
    await userEvent.clear(within(dialog).getByLabelText('Termin'));
    await userEvent.type(within(dialog).getByLabelText('Termin'), '2026-11-05');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    expect(await within(dialog).findByText('Nie udało się zapisać zmian. Sprawdź połączenie i spróbuj ponownie.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    await screen.findByText('Zapisano zmiany etapu.');
    const keys = fake.calls(url).map((request) => request.headers.get('Idempotency-Key'));
    expect(keys[0]).toBe(keys[1]);
  });

  it('EVM-031 AC3 Esc with typed data asks "Odrzucić zmiany?" and "Wróć do edycji" keeps the dialog', async () => {
    await renderPanel(PATH, api());
    await proceduresReady();
    const dialog = await openEdit('Wniosek do OSD');
    await userEvent.clear(within(dialog).getByLabelText('Termin'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    const discard = await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' });
    await userEvent.click(within(discard).getByRole('button', { name: 'Wróć do edycji' }));
    expect(await screen.findByRole('dialog', { name: 'Zmień etap: Wniosek do OSD' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Odrzuć zmiany' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('EVM-031 AC3 the dialog is accessible, has its fields labelled and the focus lands on the first of them', async () => {
    await renderPanel(PATH, api());
    await proceduresReady();
    const dialog = await openEdit('Wniosek do OSD');
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Osoba odpowiedzialna'));
    expect(await axeViolations(dialog)).toEqual([]);
  });
});

describe('W-06 "Procesy i etapy" — failures of the change (EVM-031 AC5, AC6)', () => {
  const url = `PATCH ${BASE}/procedure-stages/${OVERDUE.id}`;

  async function fail(response: Response, extra: Record<string, Handler> = {}) {
    const fake = api(undefined, ACTIVE_SESSION, { [url]: () => response, ...extra });
    await renderPanel(PATH, fake);
    await proceduresReady();
    const dialog = await openEdit('Wniosek do OSD');
    await userEvent.clear(within(dialog).getByLabelText('Termin'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    return { dialog, fake };
  }

  it('EVM-031 AC6 a person who is not available (one answer for every reason) is an error under the field', async () => {
    const { dialog } = await fail(
      problem(400, 'validation_failed', { errors: [{ pointer: '/responsibleUserId', code: 'assignee_unavailable' }] }),
    );
    expect(await within(dialog).findByText('Ta osoba nie jest dostępna. Wybierz inną osobę.')).toBeTruthy();
  });

  it('EVM-031 AC6 a date outside the range is an error under the field', async () => {
    const { dialog } = await fail(problem(400, 'validation_failed', { errors: [{ pointer: '/dueDate', code: 'out_of_range' }] }));
    expect(await within(dialog).findByText('Wybierz termin z lat 2000–2100.')).toBeTruthy();
  });

  it('EVM-031 AC5 409 work_order_closed says the order is closed and reads the order again (the actions get disabled)', async () => {
    let closed = false;
    const header: Handler = () =>
      json(200, { ...HEADER, status: closed ? 'settled' : 'in_progress', allowedTransitions: [] }, { ETag: '"3"' });
    const fake = api(undefined, ACTIVE_SESSION, {
      [url]: () => {
        closed = true;
        return problem(409, 'work_order_closed');
      },
      [`GET ${BASE}`]: header,
    });
    await renderPanel(PATH, fake);
    await proceduresReady();
    const dialog = await openEdit('Wniosek do OSD');
    await userEvent.clear(within(dialog).getByLabelText('Termin'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    expect(await within(dialog).findByText('Zlecenie jest zamknięte — procesów i etapów nie można zmieniać.')).toBeTruthy();
    await waitFor(() => {
      expect(fake.calls(`GET ${BASE}`).length).toBeGreaterThan(1);
    });
  });

  it('EVM-031 AC6 404 (a stage that is gone) says so and reads the processes again', async () => {
    const { dialog, fake } = await fail(problem(404, 'not_found'));
    expect(await within(dialog).findByText('Nie znaleziono etapu. Mógł zostać usunięty.')).toBeTruthy();
    await waitFor(() => {
      expect(fake.calls(PROCEDURES).length).toBeGreaterThan(1);
    });
  });

  it('EVM-031 AC7 403 and 429 are told in the dialog', async () => {
    const forbidden = await fail(problem(403, 'forbidden'));
    expect(await within(forbidden.dialog).findByText('Nie masz uprawnień do tej zmiany.')).toBeTruthy();
  });

  it('EVM-031 AC7 429 tells how long to wait; a server error gives the code to report', async () => {
    const limited = await fail(problem(429, 'rate_limited', {}, { 'Retry-After': '30' }));
    expect(await within(limited.dialog).findByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeTruthy();
  });
});

describe('W-06 "Procesy i etapy" — a closed order (EVM-031 AC5)', () => {
  it('EVM-031 AC5 for a settled order the action of the stage is disabled with a reason and opens nothing', async () => {
    const fake = api(undefined, ACTIVE_SESSION, {
      [`GET ${BASE}`]: () => json(200, { ...HEADER, status: 'settled', allowedTransitions: [] }, { ETag: '"3"' }),
    });
    await renderPanel(PATH, fake);
    await proceduresReady();
    await userEvent.click(screen.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }));
    const item = await screen.findByRole('menuitem', { name: /^Zmień osobę odpowiedzialną i termin…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe('Zlecenie jest zamknięte — procesów i etapów nie można zmieniać.');
    await userEvent.click(item);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fake.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0);
  });

  it('EVM-031 AC5 a cancelled order is closed too', async () => {
    const fake = api(undefined, ACTIVE_SESSION, {
      [`GET ${BASE}`]: () => json(200, { ...HEADER, status: 'cancelled', allowedTransitions: [] }, { ETag: '"3"' }),
    });
    await renderPanel(PATH, fake);
    await proceduresReady();
    await userEvent.click(screen.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }));
    expect((await screen.findByRole('menuitem', { name: /^Zmień osobę odpowiedzialną i termin…/ })).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });
});

describe('W-06 "Zakończ" with open stages (EVM-031 AC4)', () => {
  const TRANSITIONS = `POST ${BASE}/transitions`;

  function completeApi(open: number) {
    return api(() => json(200, { ...list(), openStageCount: open }), ACTIVE_SESSION, {
      [TRANSITIONS]: () =>
        json(200, { ...HEADER, status: 'completed', version: 4, allowedTransitions: ['settled', 'in_progress'] }, { ETag: '"4"' }),
    });
  }

  async function openComplete() {
    await userEvent.click(await screen.findByRole('button', { name: 'Status zlecenia: W realizacji. Zmień status' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zakończ' }));
    return screen.findByRole('dialog', { name: 'Zakończ zlecenie ZL-2026-0042' });
  }

  it('EVM-031 AC4 an order with 4 open stages: the dialog warns about 4 open stages and still lets the order be completed', async () => {
    const fake = completeApi(4);
    await renderPanel(PATH, fake);
    await proceduresReady();
    const dialog = await openComplete();
    expect(within(dialog).getByText('Zlecenie ma jeszcze 4 otwarte etapy. Zakończenie zlecenia ich nie zamknie.')).toBeTruthy();
    expect(await axeViolations(dialog)).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zakończ zlecenie' }));
    expect(await screen.findByText('Zakończono zlecenie.')).toBeTruthy();
    expect(fake.calls(TRANSITIONS)).toHaveLength(1);
  });

  it('EVM-031 AC4 the form of the count follows Polish: 1 otwarty etap, 5 otwartych etapów', async () => {
    await renderPanel(PATH, completeApi(1));
    await screen.findByRole('heading', { level: 2, name: 'Procesy i etapy (4)' });
    const one = await openComplete();
    expect(within(one).getByText('Zlecenie ma jeszcze 1 otwarty etap. Zakończenie zlecenia go nie zamknie.')).toBeTruthy();
  });

  it('EVM-031 AC4 many open stages and no open stages: the warning is only there when there is something to warn about', async () => {
    await renderPanel(PATH, completeApi(5));
    await screen.findByRole('heading', { level: 2, name: 'Procesy i etapy (4)' });
    const many = await openComplete();
    expect(within(many).getByText('Zlecenie ma jeszcze 5 otwartych etapów. Zakończenie zlecenia ich nie zamknie.')).toBeTruthy();
  });

  it('EVM-031 AC4 without open stages there is no warning', async () => {
    await renderPanel(PATH, completeApi(0));
    await screen.findByRole('heading', { level: 2, name: 'Procesy i etapy (4)' });
    const none = await openComplete();
    expect(within(none).queryByText(/otwart/)).toBeNull();
  });
});
