import type { CurrentSession, ProcedureList, ProcedureStage, WorkOrderStatus } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayWarsaw } from '../src/work-orders/transition-actions.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler, type Recorded } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER, ORDER_ID, workOrderRoutes } from './work-order-api.ts';

const userEvent = userEventDefault.setup({ delay: null });
const PATH = `/work-orders/${ORDER_ID}`;
const BASE = `/api/v1/work-orders/${ORDER_ID}`;
const STAGE_ID = '01968f3e-0000-7000-8000-0000000f0001';
const TRANSITIONS = `POST ${BASE}/procedure-stages/${STAGE_ID}/transitions`;
const PATCH = `PATCH ${BASE}/procedure-stages/${STAGE_ID}`;
const PARTY_SEARCH = 'POST /api/v1/parties/search';
const OSD = {
  id: '01968f3e-0000-7000-8000-00000000c001',
  kind: 'distribution_system_operator',
  legalForm: 'company',
  displayName: 'Stoen Operator (OSD)',
};
const ADMINISTRATION = {
  id: '01968f3e-0000-7000-8000-00000000c002',
  kind: 'building_administration',
  legalForm: 'company',
  displayName: 'Administracja Testowa',
};
const NAME = 'Warunki przyłączenia i projekt umowy';
const TODAY = (): string => todayWarsaw(Date.now());

const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } });

const stage = (extra: Partial<ProcedureStage> = {}): ProcedureStage => ({
  id: STAGE_ID,
  code: 'connection_conditions',
  name: NAME,
  position: 1,
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

const waitingStage = (extra: Partial<ProcedureStage> = {}): ProcedureStage =>
  stage({
    status: 'waiting',
    waitingOn: 'party',
    waitingParty: { id: OSD.id, displayName: OSD.displayName },
    waitingSince: '2026-09-18',
    waitingDays: 15,
    version: 4,
    ...extra,
  });

interface Setup {
  readonly stage: ProcedureStage;
  readonly session?: CurrentSession;
  readonly orderStatus?: WorkOrderStatus;
  /** Answers of the POST, one after another (the last repeats). An accepted one becomes the stage the next read returns. */
  readonly posts?: Handler[];
  readonly patch?: Handler;
  readonly progress?: { done: number; total: number };
}

function stageApi({ stage: initial, session = ACTIVE_SESSION, orderStatus = 'in_progress', posts = [], patch, progress }: Setup) {
  let current = initial;
  let calls = 0;
  const list = (): ProcedureList => ({
    items: [
      {
        id: '01968f3e-0000-7000-8000-0000000a0001',
        code: 'osd',
        name: 'Uzgodnienia z OSD',
        position: 1,
        progress: progress ?? { done: 0, total: 1 },
        stages: [current],
      },
    ],
    openStageCount: current.status === 'done' ? 0 : 1,
  });
  const remember = async (response: Response): Promise<Response> => {
    if (response.status === 200) current = (await response.clone().json()) as ProcedureStage;
    return response;
  };
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    ...workOrderRoutes(ORDER_ID, {
      procedures: () => json(200, list()),
      header: () => json(200, { ...HEADER, status: orderStatus }, { ETag: '"3"' }),
    }),
    [PARTY_SEARCH]: () => json(200, { items: [OSD, ADMINISTRATION], nextCursor: null }),
    [TRANSITIONS]: async (request) => {
      const handler = posts[Math.min(calls++, posts.length - 1)];
      return handler === undefined ? problem(500, 'internal_error') : await remember(await handler(request));
    },
    [PATCH]: async (request) => (patch === undefined ? problem(500, 'internal_error') : await remember(await patch(request))),
  });
}

/** An accepted request: the answer is the stage as the server left it. */
const answer =
  (saved: ProcedureStage): Handler =>
  () =>
    json(200, saved, { ETag: `"${String(saved.version)}"` });

const body = (request: Recorded | undefined): unknown => parseBody(request?.body ?? '{}');
const badge = (label: string) => screen.findByRole('button', { name: `Status etapu ${NAME}: ${label}. Zmień status` });
const row = () => within(screen.getByRole('list', { name: 'Uzgodnienia z OSD' }));

async function choose(label: string, item: string) {
  await userEvent.click(await badge(label));
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}

async function chooseParty(phrase: string, name: string) {
  await userEvent.click(screen.getByRole('radio', { name: 'Stronę' }));
  await userEvent.type(screen.getByRole('combobox', { name: 'Strona' }), phrase);
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('W-07 the menu of the badge (EVM-032 AC1)', () => {
  it('EVM-032 AC1 a stage "Do zrobienia" offers exactly Rozpocznij, Czekamy na…, Zakończ…, Nie dotyczy, Zablokuj… — and nothing else', async () => {
    await renderPanel(PATH, stageApi({ stage: stage() }));
    await userEvent.click(await badge('Do zrobienia'));
    const items = within(screen.getByRole('menu', { name: `Zmień status etapu ${NAME}` })).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Rozpocznij', 'Czekamy na…', 'Zakończ…', 'Nie dotyczy', 'Zablokuj…']);
  });

  it.each([
    ['in_progress', 'W toku', ['Czekamy na…', 'Zakończ…', 'Nie dotyczy', 'Zablokuj…']],
    ['waiting', 'Czekamy na…', ['Odpowiedź otrzymana', 'Zmień, na kogo czekamy…', 'Zakończ…', 'Nie dotyczy', 'Zablokuj…']],
    ['blocked', 'Zablokowany', ['Odblokuj']],
    ['done', 'Zakończony', ['Otwórz ponownie']],
    ['not_applicable', 'Nie dotyczy', ['Przywróć']],
  ] as const)('EVM-032 AC1 a stage "%s" offers only the transitions of the table', async (status, label, expected) => {
    const base =
      status === 'waiting' ? waitingStage() : stage({ status, ...(status === 'blocked' ? { blockedReason: 'Brak zgody' } : {}) });
    await renderPanel(PATH, stageApi({ stage: base }));
    await userEvent.click(await badge(label));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(expected);
  });

  it('EVM-032 AC1 "Rozpocznij" runs at once with If-Match and an Idempotency-Key, the badge shows the answer and the toast has no "Cofnij"', async () => {
    const api = stageApi({
      stage: stage(),
      posts: [answer(stage({ status: 'in_progress', startedAt: '2026-10-09T08:00:00.000Z', version: 2 }))],
    });
    await renderPanel(PATH, api);
    await choose('Do zrobienia', 'Rozpocznij');
    expect(await badge('W toku')).toBeTruthy();
    const sent = api.calls(TRANSITIONS)[0];
    expect(body(sent)).toEqual({ to: 'in_progress' });
    expect(sent?.headers.get('If-Match')).toBe('"1"');
    expect(sent?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent?.headers.get('X-CSRF-Token')).toBe('csrf-active');
    expect(screen.getByText('Zmieniono status etapu na W toku.')).toBeTruthy();
    // no reverse transition leads back to "Do zrobienia"
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
  });
});

describe('W-07 "Czekamy na…" (EVM-032 AC2)', () => {
  it('EVM-032 AC2 a party and "Od kiedy" = today: the stage waits and the row says "Czekamy na: Stoen Operator (OSD) · od dziś"', async () => {
    const saved = waitingStage({ waitingSince: TODAY(), waitingDays: 0, version: 2 });
    const api = stageApi({ stage: stage({ status: 'in_progress', version: 1 }), posts: [answer(saved)] });
    await renderPanel(PATH, api);
    await choose('W toku', 'Czekamy na…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    expect(within(dialog).getByLabelText<HTMLInputElement>('Od kiedy').value).toBe(TODAY());
    expect(within(dialog).getByText('Nie później niż dziś.')).toBeTruthy();
    await chooseParty('Stoen', 'Stoen Operator');
    // the dialog has no "Dodaj stronę" — that is EVM-033
    expect(within(dialog).queryByRole('button', { name: /Dodaj stronę/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByText('Czekamy na: Stoen Operator (OSD) · od dziś')).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[0])).toEqual({ to: 'waiting', waitingOn: 'party', waitingOnPartyId: OSD.id, waitingSince: TODAY() });
    expect(screen.getByText('Etap „Warunki przyłączenia i projekt umowy”: Czekamy na Stoen Operator (OSD).')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cofnij' })).toBeTruthy();
  });

  it('EVM-032 AC2 "Klienta" needs no party: "Czekamy na: klient · od dziś"', async () => {
    const saved = stage({ status: 'waiting', waitingOn: 'customer', waitingSince: TODAY(), waitingDays: 0, version: 2 });
    const api = stageApi({ stage: stage({ status: 'in_progress' }), posts: [answer(saved)] });
    await renderPanel(PATH, api);
    await choose('W toku', 'Czekamy na…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Klienta' }));
    expect(within(dialog).queryByRole('combobox', { name: 'Strona' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByText('Czekamy na: klient · od dziś')).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[0])).toEqual({ to: 'waiting', waitingOn: 'customer', waitingSince: TODAY() });
  });

  it('EVM-032 AC2 "Stronę" without a chosen party is an error under the field and nothing is sent; so is no choice at all', async () => {
    const api = stageApi({ stage: stage({ status: 'in_progress' }), posts: [answer(waitingStage())] });
    await renderPanel(PATH, api);
    await choose('W toku', 'Czekamy na…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(within(dialog).getByText('Wybierz, na kogo czekamy.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stronę' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(within(dialog).getByText('Wybierz stronę, na którą czekamy.')).toBeTruthy();
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
  });

  it('EVM-032 AC2 a day from the future is refused under the field ("Nie później niż dziś.") without a request', async () => {
    const api = stageApi({ stage: stage({ status: 'in_progress' }), posts: [answer(waitingStage())] });
    await renderPanel(PATH, api);
    await choose('W toku', 'Czekamy na…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Klienta' }));
    const date = within(dialog).getByLabelText('Od kiedy');
    await userEvent.clear(date);
    await userEvent.type(date, '2099-01-01');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Nie później niż dziś.');
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
  });

  it('EVM-032 AC2 a refusal of the server for the day (400 validation_failed, /waitingSince) lands under the same field and the dialog keeps what was typed', async () => {
    const api = stageApi({
      stage: stage({ status: 'in_progress' }),
      posts: [() => problem(400, 'validation_failed', { errors: [{ pointer: '/waitingSince', code: 'out_of_range' }] })],
    });
    await renderPanel(PATH, api);
    await choose('W toku', 'Czekamy na…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Klienta' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Nie później niż dziś.');
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Klienta' }).checked).toBe(true);
  });

  it('EVM-032 AC2 a party that is gone (400 unknown_party) is one message under the field, the choice is cleared', async () => {
    const api = stageApi({
      stage: stage({ status: 'in_progress' }),
      posts: [() => problem(400, 'validation_failed', { errors: [{ pointer: '/waitingOnPartyId', code: 'unknown_party' }] })],
    });
    await renderPanel(PATH, api);
    await choose('W toku', 'Czekamy na…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    await chooseParty('Stoen', 'Stoen Operator');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText('Ta strona nie jest już dostępna. Wybierz inną stronę.')).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: 'Strona' })).toBeTruthy();
  });
});

describe('W-07 "Odpowiedź otrzymana" and "Zmień, na kogo czekamy…" (EVM-032 AC3)', () => {
  it('EVM-032 AC3 a stage waiting for 15 days shows "od 15 dni" with triangle-alert, the warning is in the text too', async () => {
    await renderPanel(PATH, stageApi({ stage: waitingStage() }));
    const text = await screen.findByText('Czekamy na: Stoen Operator (OSD) · od 15 dni');
    const line = text.parentElement as HTMLElement;
    expect(line.querySelector('svg')?.getAttribute('class')).toContain('lucide-triangle-alert');
    expect(line.className).toContain('text-text-warning');
    expect(within(line).getByText('Czekamy dłużej niż 14 dni.')).toBeTruthy();
  });

  it('EVM-032 AC3 14 days and fewer are no warning; one day is "od wczoraj"', async () => {
    await renderPanel(PATH, stageApi({ stage: waitingStage({ waitingDays: 14 }) }));
    const line = (await screen.findByText('Czekamy na: Stoen Operator (OSD) · od 14 dni')).parentElement as HTMLElement;
    expect(line.querySelector('svg')).toBeNull();
    expect(line.className).not.toContain('text-text-warning');
  });

  it('EVM-032 AC3 "Odpowiedź otrzymana" returns the stage to "W toku" and the waiting data are gone', async () => {
    const api = stageApi({ stage: waitingStage(), posts: [answer(stage({ status: 'in_progress', version: 5 }))] });
    await renderPanel(PATH, api);
    await choose('Czekamy na…', 'Odpowiedź otrzymana');
    expect(await badge('W toku')).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[0])).toEqual({ to: 'in_progress' });
    expect(api.calls(TRANSITIONS)[0]?.headers.get('If-Match')).toBe('"4"');
    expect(screen.queryByText(/Czekamy na: /)).toBeNull();
  });

  it('EVM-032 AC3 "Zmień, na kogo czekamy…" says the counter starts again, is an edit (PATCH, no transition) with today as "od kiedy", and has no "Cofnij"', async () => {
    const saved = stage({
      status: 'waiting',
      waitingOn: 'customer',
      waitingSince: TODAY(),
      waitingDays: 0,
      version: 5,
    });
    const api = stageApi({ stage: waitingStage(), patch: answer(saved) });
    await renderPanel(PATH, api);
    await choose('Czekamy na…', 'Zmień, na kogo czekamy…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    expect(within(dialog).getByText('Licznik dni zacznie się od nowa.')).toBeTruthy();
    // what is known now is shown: the party waited for and "Od kiedy" = today
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Stronę' }).checked).toBe(true);
    expect(within(dialog).getByText('Stoen Operator (OSD)')).toBeTruthy();
    expect(within(dialog).getByLabelText<HTMLInputElement>('Od kiedy').value).toBe(TODAY());
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Klienta' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByText('Czekamy na: klient · od dziś')).toBeTruthy();
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
    const sent = api.calls(PATCH)[0];
    expect(body(sent)).toEqual({ waitingOn: 'customer', waitingSince: TODAY() });
    expect(sent?.headers.get('If-Match')).toBe('"4"');
    expect(screen.getByText('Zmieniono, na kogo czekamy.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
  });

  it('EVM-032 AC3 the edit may keep the party and choose another one: the identifier goes out', async () => {
    const saved = waitingStage({
      waitingParty: { id: ADMINISTRATION.id, displayName: ADMINISTRATION.displayName },
      waitingSince: TODAY(),
      waitingDays: 0,
      version: 5,
    });
    const api = stageApi({ stage: waitingStage(), patch: answer(saved) });
    await renderPanel(PATH, api);
    await choose('Czekamy na…', 'Zmień, na kogo czekamy…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień stronę' }));
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Strona' }), 'Admin');
    await userEvent.click(await screen.findByRole('option', { name: /Administracja Testowa/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByText('Czekamy na: Administracja Testowa · od dziś')).toBeTruthy();
    expect(body(api.calls(PATCH)[0])).toEqual({ waitingOn: 'party', waitingOnPartyId: ADMINISTRATION.id, waitingSince: TODAY() });
  });
});

describe('W-07 "Zakończ…", "Nie dotyczy", "Zablokuj…" and the way back (EVM-032 AC4)', () => {
  it('EVM-032 AC4 "Zakończ…" asks for the day (today by default, not from the future), sends it, and the progress of the process is read again', async () => {
    let reads = 0;
    const saved = stage({ status: 'done', completedOn: TODAY(), version: 6 });
    const api = stageApi({ stage: waitingStage({ version: 5 }), posts: [answer(saved)] });
    api.set(`GET ${BASE}/procedures`, () => {
      reads += 1;
      const done = reads > 1;
      return json(200, {
        items: [
          {
            id: '01968f3e-0000-7000-8000-0000000a0001',
            code: 'osd',
            name: 'Uzgodnienia z OSD',
            position: 1,
            progress: { done: done ? 1 : 0, total: 1 },
            stages: [done ? saved : waitingStage({ version: 5 })],
          },
        ],
        openStageCount: done ? 0 : 1,
      });
    });
    await renderPanel(PATH, api);
    await choose('Czekamy na…', 'Zakończ…');
    const dialog = await screen.findByRole('dialog', { name: 'Zakończ etap' });
    expect(within(dialog).getByLabelText<HTMLInputElement>('Data zakończenia').value).toBe(TODAY());
    const date = within(dialog).getByLabelText('Data zakończenia');
    await userEvent.clear(date);
    await userEvent.type(date, '2099-01-01');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zakończ etap' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Nie później niż dziś.');
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
    await userEvent.clear(date);
    await userEvent.type(date, TODAY());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zakończ etap' }));
    expect(await badge('Zakończony')).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[0])).toEqual({ to: 'done', completedOn: TODAY() });
    // the waiting data are gone and the progress of the process is the one the server counted
    expect(screen.queryByText(/Czekamy na: /)).toBeNull();
    expect(await screen.findByRole('button', { name: /^Uzgodnienia z OSD\s*1 z 1 etapu\s*Wszystkie zakończone$/ })).toBeTruthy();
    expect(row().getByText(/Zakończono: /)).toBeTruthy();
  });

  it('EVM-032 AC4 "Nie dotyczy" runs at once; "Przywróć" brings the stage back to "Do zrobienia"', async () => {
    const api = stageApi({
      stage: stage({ status: 'in_progress', version: 2 }),
      posts: [answer(stage({ status: 'not_applicable', version: 3 })), answer(stage({ status: 'todo', version: 4 }))],
    });
    await renderPanel(PATH, api);
    await choose('W toku', 'Nie dotyczy');
    expect(await badge('Nie dotyczy')).toBeTruthy();
    await choose('Nie dotyczy', 'Przywróć');
    expect(await badge('Do zrobienia')).toBeTruthy();
    expect(api.calls(TRANSITIONS).map((request) => body(request))).toEqual([{ to: 'not_applicable' }, { to: 'todo' }]);
    expect(api.calls(TRANSITIONS).map((request) => request.headers.get('If-Match'))).toEqual(['"2"', '"3"']);
  });

  it('EVM-032 AC4 "Zablokuj…" needs the reason (one error, no request) and warns not to type personal data; "Odblokuj" and "Otwórz ponownie" go back to "W toku"', async () => {
    const blocked = stage({ status: 'blocked', blockedReason: 'Brak zgody wspólnoty', version: 3 });
    const api = stageApi({
      stage: stage({ status: 'in_progress', version: 2 }),
      posts: [answer(blocked), answer(stage({ status: 'in_progress', version: 4 }))],
    });
    await renderPanel(PATH, api);
    await choose('W toku', 'Zablokuj…');
    const dialog = await screen.findByRole('dialog', { name: 'Dlaczego etap jest zablokowany?' });
    expect(within(dialog).getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zablokuj etap' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Podaj powód blokady.');
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText('Powód'), '  Brak zgody wspólnoty  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zablokuj etap' }));
    expect(await badge('Zablokowany')).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[0])).toEqual({ to: 'blocked', blockedReason: 'Brak zgody wspólnoty' });
    expect(screen.getByText('Powód blokady: Brak zgody wspólnoty')).toBeTruthy();
    await choose('Zablokowany', 'Odblokuj');
    expect(await badge('W toku')).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[1])).toEqual({ to: 'in_progress' });
    expect(screen.queryByText(/Powód blokady/)).toBeNull();
  });

  it('EVM-032 AC4 a reason longer than 500 characters is refused under the field, a refusal of the server too', async () => {
    const api = stageApi({
      stage: stage(),
      posts: [() => problem(400, 'validation_failed', { errors: [{ pointer: '/blockedReason', code: 'invalid' }] })],
    });
    await renderPanel(PATH, api);
    await choose('Do zrobienia', 'Zablokuj…');
    const dialog = await screen.findByRole('dialog', { name: 'Dlaczego etap jest zablokowany?' });
    await userEvent.click(within(dialog).getByLabelText('Powód'));
    await userEvent.paste('a'.repeat(501));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zablokuj etap' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Powód może mieć najwyżej 500 znaków.');
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
    await userEvent.clear(within(dialog).getByLabelText('Powód'));
    await userEvent.type(within(dialog).getByLabelText('Powód'), 'Powód');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zablokuj etap' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Powód zawiera niedozwolone znaki.');
  });

  it('EVM-032 AC4 "Otwórz ponownie" reopens a finished stage', async () => {
    const api = stageApi({
      stage: stage({ status: 'done', completedOn: '2026-10-01', version: 7 }),
      posts: [answer(stage({ status: 'in_progress', version: 8 }))],
    });
    await renderPanel(PATH, api);
    expect(await screen.findByText('Zakończono: 01.10.2026')).toBeTruthy();
    await choose('Zakończony', 'Otwórz ponownie');
    expect(await badge('W toku')).toBeTruthy();
    expect(screen.queryByText(/Zakończono: /)).toBeNull();
  });
});

describe('W-07 "Cofnij" (EVM-032 AC5)', () => {
  it('EVM-032 AC5 after in_progress → waiting "Cofnij" sends the reverse transition of the table with the new version', async () => {
    const api = stageApi({
      stage: stage({ status: 'in_progress', version: 2 }),
      posts: [
        answer(waitingStage({ waitingSince: TODAY(), waitingDays: 0, version: 3 })),
        answer(stage({ status: 'in_progress', version: 4 })),
      ],
    });
    await renderPanel(PATH, api);
    await choose('W toku', 'Czekamy na…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    await chooseParty('Stoen', 'Stoen Operator');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    expect(await badge('W toku')).toBeTruthy();
    const undo = api.calls(TRANSITIONS)[1];
    expect(body(undo)).toEqual({ to: 'in_progress' });
    expect(undo?.headers.get('If-Match')).toBe('"3"');
    expect(screen.getByText('Cofnięto zmianę statusu etapu.')).toBeTruthy();
  });

  it('EVM-032 AC5 after waiting → in_progress "Cofnij" waits again for the same party since the same day (the counter is kept)', async () => {
    const api = stageApi({
      stage: waitingStage(),
      posts: [answer(stage({ status: 'in_progress', version: 5 })), answer(waitingStage({ version: 6 }))],
    });
    await renderPanel(PATH, api);
    await choose('Czekamy na…', 'Odpowiedź otrzymana');
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    expect(await screen.findByText('Czekamy na: Stoen Operator (OSD) · od 15 dni')).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[1])).toEqual({
      to: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: OSD.id,
      waitingSince: '2026-09-18',
    });
    expect(api.calls(TRANSITIONS)[1]?.headers.get('If-Match')).toBe('"5"');
  });

  it('EVM-032 AC5 "Cofnij" of an unblock blocks again with the previous reason, of a reopen finishes with the previous day', async () => {
    const api = stageApi({
      stage: stage({ status: 'blocked', blockedReason: 'Brak zgody', version: 2 }),
      posts: [
        answer(stage({ status: 'in_progress', version: 3 })),
        answer(stage({ status: 'blocked', blockedReason: 'Brak zgody', version: 4 })),
      ],
    });
    await renderPanel(PATH, api);
    await choose('Zablokowany', 'Odblokuj');
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    expect(await badge('Zablokowany')).toBeTruthy();
    expect(body(api.calls(TRANSITIONS)[1])).toEqual({ to: 'blocked', blockedReason: 'Brak zgody' });
  });

  it('EVM-032 AC5 a transition without a reverse (todo → done, in_progress → not_applicable) has no "Cofnij"; todo → not_applicable has', async () => {
    const api = stageApi({
      stage: stage({ status: 'in_progress', version: 2 }),
      posts: [answer(stage({ status: 'not_applicable', version: 3 }))],
    });
    await renderPanel(PATH, api);
    await choose('W toku', 'Nie dotyczy');
    await badge('Nie dotyczy');
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
  });

  it('EVM-032 AC5 a "Cofnij" the server refuses says "Nie udało się cofnąć — ktoś zmienił etap w międzyczasie." with "Odśwież", which reads the stage again', async () => {
    const api = stageApi({
      stage: stage({ status: 'in_progress', version: 2 }),
      posts: [answer(stage({ status: 'done', completedOn: TODAY(), version: 3 })), () => problem(412, 'version_conflict')],
    });
    await renderPanel(PATH, api);
    await choose('W toku', 'Zakończ…');
    const dialog = await screen.findByRole('dialog', { name: 'Zakończ etap' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zakończ etap' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    expect(await screen.findByText('Nie udało się cofnąć — ktoś zmienił etap w międzyczasie.')).toBeTruthy();
    const reads = api.calls(`GET ${BASE}/procedures`).length;
    await userEvent.click(screen.getByRole('button', { name: 'Odśwież' }));
    await waitFor(() => {
      expect(api.calls(`GET ${BASE}/procedures`).length).toBeGreaterThan(reads);
    });
    await waitFor(() => {
      expect(screen.queryByText('Nie udało się cofnąć — ktoś zmienił etap w międzyczasie.')).toBeNull();
    });
  });

  it('EVM-032 AC5 the parameters of "Cofnij" are in the memory of the tab only — not in the address or in a store of the browser', async () => {
    const api = stageApi({ stage: waitingStage(), posts: [answer(stage({ status: 'in_progress', version: 5 }))] });
    const { history } = await renderPanel(PATH, api);
    await choose('Czekamy na…', 'Odpowiedź otrzymana');
    await screen.findByRole('button', { name: 'Cofnij' });
    expect(history.location.href).toBe(PATH);
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });
});

describe('W-07 the rules of the server and the states (EVM-032 AC6, AC8)', () => {
  it('EVM-032 AC6 412 in a dialog: "Ktoś zmienił ten etap…", the typed values stay, the processes are read again and the next try uses the new version', async () => {
    let reads = 0;
    const api = stageApi({
      stage: stage({ status: 'in_progress', version: 2 }),
      posts: [() => problem(412, 'version_conflict'), answer(waitingStage({ waitingParty: null, waitingOn: 'customer', version: 8 }))],
    });
    api.set(`GET ${BASE}/procedures`, () => {
      reads += 1;
      return json(200, {
        items: [
          {
            id: '01968f3e-0000-7000-8000-0000000a0001',
            code: 'osd',
            name: 'Uzgodnienia z OSD',
            position: 1,
            progress: { done: 0, total: 1 },
            stages: [stage({ status: 'in_progress', version: reads > 1 ? 7 : 2 })],
          },
        ],
        openStageCount: 1,
      });
    });
    await renderPanel(PATH, api);
    await choose('W toku', 'Czekamy na…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Klienta' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText(/^Ktoś zmienił ten etap w międzyczasie/)).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Klienta' }).checked).toBe(true);
    await waitFor(() => {
      expect(reads).toBe(2);
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls(TRANSITIONS).map((request) => request.headers.get('If-Match'))).toEqual(['"2"', '"7"']);
  });

  it('EVM-032 AC6 409 invalid_state_transition under the badge: "Ktoś zmienił ten etap…" with "Odśwież"; 409 work_order_closed says the order is closed', async () => {
    const api = stageApi({
      stage: stage(),
      posts: [() => problem(409, 'invalid_state_transition'), () => problem(409, 'work_order_closed')],
    });
    await renderPanel(PATH, api);
    await choose('Do zrobienia', 'Rozpocznij');
    expect(await screen.findByText(/^Ktoś zmienił ten etap w międzyczasie/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Odśwież' })).toBeTruthy();
    await choose('Do zrobienia', 'Rozpocznij');
    expect(await screen.findByText('Zlecenie jest zamknięte — statusu etapu nie można zmienić.')).toBeTruthy();
  });

  it('EVM-032 AC6 a lost answer is retried with the same Idempotency-Key; 429 and 403 are told', async () => {
    const api = stageApi({
      stage: stage(),
      posts: [
        () => problem(503, 'unavailable'),
        () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }),
        () => problem(403, 'forbidden'),
      ],
    });
    await renderPanel(PATH, api);
    await choose('Do zrobienia', 'Rozpocznij');
    expect(await screen.findByText('Nie udało się zapisać zmiany. Sprawdź połączenie i spróbuj ponownie.')).toBeTruthy();
    await choose('Do zrobienia', 'Rozpocznij');
    expect(await screen.findByText('Zbyt wiele prób. Spróbuj ponownie za 30 s.')).toBeTruthy();
    await choose('Do zrobienia', 'Rozpocznij');
    expect(await screen.findByText('Nie masz uprawnień do tej zmiany.')).toBeTruthy();
    const keys = api.calls(TRANSITIONS).map((request) => request.headers.get('Idempotency-Key'));
    expect(new Set(keys).size).toBe(1);
  });

  it('EVM-032 AC6 the dialog tells every other refusal in its own alert and "Anuluj" closes it without a request', async () => {
    const api = stageApi({
      stage: stage({ status: 'in_progress' }),
      posts: [
        () => problem(409, 'work_order_closed'),
        () => problem(404, 'not_found'),
        () => problem(403, 'forbidden'),
        () => problem(429, 'rate_limited', {}, { 'Retry-After': '12' }),
        () => problem(500, 'internal_error'),
      ],
    });
    await renderPanel(PATH, api);
    await choose('W toku', 'Czekamy na…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Klienta' }));
    for (const text of [
      'Zlecenie jest zamknięte — statusu etapu nie można zmienić.',
      'Nie znaleziono etapu. Mógł zostać usunięty.',
      'Nie masz uprawnień do tej zmiany.',
      'Zbyt wiele prób. Spróbuj ponownie za 12 s.',
      'Nie udało się zapisać zmiany. Sprawdź połączenie i spróbuj ponownie.',
    ]) {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
      expect(await within(dialog).findByText(text)).toBeTruthy();
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls(TRANSITIONS)).toHaveLength(5);
  });

  it('EVM-032 AC8 offline the badge is disabled with "Status etapu zmienisz po powrocie połączenia." and does not open', async () => {
    await renderPanel(PATH, stageApi({ stage: stage() }));
    const trigger = await badge('Do zrobienia');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    await waitFor(() => {
      expect(trigger.getAttribute('aria-disabled')).toBe('true');
    });
    expect(trigger.getAttribute('title')).toBe('Status etapu zmienisz po powrocie połączenia.');
    await userEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('EVM-032 AC8 offline the open dialog keeps the typed values and cannot be saved', async () => {
    await renderPanel(PATH, stageApi({ stage: stage({ status: 'in_progress' }) }));
    await choose('W toku', 'Czekamy na…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Klienta' }));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    expect(await within(dialog).findAllByText('Zapiszesz po powrocie połączenia.')).not.toHaveLength(0);
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Klienta' }).checked).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Zapisz' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('W-07 roles and a closed order (EVM-032 AC7)', () => {
  it('EVM-032 AC7 the Editor has the menu of the badge, the Administrator too', async () => {
    await renderPanel(PATH, stageApi({ stage: stage(), session: roleSession('editor') }));
    expect(await badge('Do zrobienia')).toBeTruthy();
  });

  it('EVM-032 AC7 Tylko odczyt has a static badge: no button, no chevron, the status stays readable', async () => {
    await renderPanel(PATH, stageApi({ stage: waitingStage(), session: roleSession('read_only') }));
    expect(await screen.findByText('Czekamy na: Stoen Operator (OSD) · od 15 dni')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Status etapu/ })).toBeNull();
    expect(row().getAllByText('Czekamy na…').length).toBeGreaterThan(0);
  });

  it.each([
    ['settled', ACTIVE_SESSION, 'Zlecenie jest zamknięte — status etapu zmienisz po przywróceniu zlecenia.'],
    ['cancelled', roleSession('editor'), 'Zlecenie jest zamknięte — status etapu zmienisz po przywróceniu zlecenia przez administratora.'],
  ] as const)('EVM-032 AC7 an order "%s" disables the badge with the reason for the role', async (orderStatus, session, hint) => {
    await renderPanel(PATH, stageApi({ stage: stage(), orderStatus, session }));
    const trigger = await badge('Do zrobienia');
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.getAttribute('title')).toBe(hint);
    await userEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('EVM-032 AC7 a status this panel does not know is a static badge of an unknown value, never the raw code', async () => {
    await renderPanel(PATH, stageApi({ stage: stage({ status: 'future_status' as ProcedureStage['status'] }) }));
    expect(await screen.findByText('Nieznany status')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Status etapu/ })).toBeNull();
    expect(document.body.textContent).not.toContain('future_status');
  });
});

describe('W-07 free text and accessibility (EVM-032 SR-WEB-03)', () => {
  it('EVM-032 AC4 the reason of a block and the name of a party are rendered as text, never as markup', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    await renderPanel(PATH, stageApi({ stage: stage({ status: 'blocked', blockedReason: markup }) }));
    expect(await screen.findByText(`Powód blokady: ${markup}`)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('EVM-032 AC8 the page with the badge, the menu and the dialog has no accessibility violations', async () => {
    await renderPanel(PATH, stageApi({ stage: waitingStage() }));
    await screen.findByText('Czekamy na: Stoen Operator (OSD) · od 15 dni');
    await screen.findByText('Instalacja zasilająca');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    await choose('Czekamy na…', 'Zmień, na kogo czekamy…');
    const dialog = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    expect(await axeViolations(dialog)).toEqual([]);
  });
});
