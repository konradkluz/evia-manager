import type { CurrentSession, DeletedProcedureList, Procedure, ProcedureList, ProcedureStage } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER, ORDER_ID, workOrderRoutes } from './work-order-api.ts';

const PATH = `/work-orders/${ORDER_ID}`;
const BASE = `/api/v1/work-orders/${ORDER_ID}`;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TEMPLATES_ROUTE = 'GET /api/v1/catalog/procedure-templates';

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

const OSD_ID = '01968f3e-0000-7000-8000-0000000a0001';
const PPOZ_ID = '01968f3e-0000-7000-8000-0000000a0002';

const osd = (stages: ProcedureStage[]): Procedure => ({
  id: OSD_ID,
  code: 'osd',
  name: 'Uzgodnienia z OSD',
  position: 1,
  version: 3,
  progress: { done: 0, total: stages.length },
  stages,
});
const ppoz = (): Procedure => ({
  id: PPOZ_ID,
  code: 'ppoz',
  name: 'Opinia ppoż',
  position: 2,
  version: 5,
  progress: { done: 0, total: 1 },
  stages: [stage(9, { name: 'Zlecenie opinii' })],
});

const list = (items: Procedure[]): ProcedureList => ({ items, openStageCount: 3 });
const NONE: DeletedProcedureList = { procedures: [], stages: [], truncated: false };

const TEMPLATES = {
  items: [
    { code: 'osd', name: 'Uzgodnienia z OSD', stages: [{ code: 'a', name: 'A' }] },
    { code: 'ppoz', name: 'Opinia ppoż', stages: [{ code: 'b', name: 'B' }] },
    { code: 'expertise', name: 'Ekspertyza techniczna', stages: [1, 2].map((n) => ({ code: `e${String(n)}`, name: `E${String(n)}` })) },
  ],
  nextCursor: null,
};

interface Options {
  readonly procedures?: Handler;
  readonly deleted?: Handler;
  readonly session?: CurrentSession;
  readonly header?: Handler;
  readonly extra?: Record<string, Handler>;
}

function api({ procedures, deleted, session = ACTIVE_SESSION, header, extra = {} }: Options = {}) {
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    [TEMPLATES_ROUTE]: () => json(200, TEMPLATES),
    ...workOrderRoutes(ORDER_ID, {
      procedures: procedures ?? (() => json(200, list([osd([stage(1), stage(2), stage(3)]), ppoz()]))),
      deleted: deleted ?? (() => json(200, NONE)),
      ...(header === undefined ? {} : { header }),
    }),
    ...extra,
  });
}

const closedHeader: Handler = () => json(200, { ...HEADER, status: 'settled' }, { ETag: '"3"' });

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const section = () => within(screen.getByRole('region', { name: /^Procesy i etapy/ }));
const ready = () => screen.findByRole('heading', { level: 2, name: /^Procesy i etapy \(\d+\)$/ });

async function openAddProcedure() {
  await userEvent.click(await screen.findByRole('button', { name: 'Dodaj proces…' }));
  return within(await screen.findByRole('dialog', { name: 'Dodaj proces' }));
}

async function openProcessMenu(name: string, item: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Akcje procesu: ${name}` }));
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}

async function openStageMenu(name: string, item: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Akcje etapu: ${name}` }));
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}

describe('W-06 (d) "Dodaj proces" (EVM-042 AC1)', () => {
  it('EVM-042 AC1 the process comes from a template on the chosen place; the taken one is listed but cannot be chosen', async () => {
    let items = list([osd([stage(1)]), ppoz()]);
    const fake = api({
      procedures: () => json(200, items),
      extra: {
        [`POST ${BASE}/procedures`]: (request) => {
          const body = parseBody(request.body) as { id: string };
          const added: Procedure = {
            id: body.id,
            code: 'expertise',
            name: 'Ekspertyza techniczna',
            position: 2,
            version: 1,
            progress: { done: 0, total: 2 },
            stages: [stage(20), stage(21)],
          };
          items = list([items.items[0] as Procedure, added, { ...(items.items[1] as Procedure), position: 3 }]);
          return json(201, added, { ETag: '"1"' });
        },
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    const dialog = await openAddProcedure();
    expect(document.activeElement).toBe(dialog.getByRole('combobox', { name: 'Proces' }));
    const taken = await dialog.findByRole('option', { name: 'Uzgodnienia z OSD — już jest w zleceniu' });
    expect((taken as HTMLOptionElement).disabled).toBe(true);
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Proces' }), 'expertise');
    expect(dialog.getByText('Proces dostanie etapy z szablonu w stanie „Do zrobienia”: 2 etapy.')).toBeTruthy();
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Miejsce na liście' }), '2');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj proces' }));

    expect(await screen.findByText('Dodano proces „Ekspertyza techniczna”.')).toBeTruthy();
    const sent = fake.calls(`POST ${BASE}/procedures`)[0];
    expect(sent?.headers.get('Idempotency-Key')).toMatch(UUID_V7);
    expect(parseBody(sent?.body ?? '')).toEqual({
      id: expect.stringMatching(UUID_V7) as string,
      procedureTemplateCode: 'expertise',
      position: 2,
    });
    // the new process is open and has the focus on its header
    const header = await section().findByRole('button', { name: /^Ekspertyza techniczna/ });
    await waitFor(() => {
      expect(document.activeElement).toBe(header);
    });
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('EVM-042 AC1 "Na końcu" sends no position', async () => {
    const fake = api({
      extra: { [`POST ${BASE}/procedures`]: () => json(201, { ...osd([]), id: 'x' }, { ETag: '"1"' }) },
    });
    await renderPanel(PATH, fake);
    await ready();
    const dialog = await openAddProcedure();
    await userEvent.selectOptions(await dialog.findByRole('combobox', { name: 'Proces' }), 'expertise');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj proces' }));
    await waitFor(() => {
      expect(fake.calls(`POST ${BASE}/procedures`)).toHaveLength(1);
    });
    expect(parseBody(fake.calls(`POST ${BASE}/procedures`)[0]?.body ?? '')).not.toHaveProperty('position');
  });

  it('EVM-042 AC1 a race for a code that is active now is a 409 that names the process, the list is read again', async () => {
    let reads = 0;
    const fake = api({
      procedures: () => {
        reads += 1;
        return json(200, list([osd([stage(1)]), ppoz()]));
      },
      extra: { [`POST ${BASE}/procedures`]: () => problem(409, 'procedure_already_active') },
    });
    await renderPanel(PATH, fake);
    await ready();
    const dialog = await openAddProcedure();
    await userEvent.selectOptions(await dialog.findByRole('combobox', { name: 'Proces' }), 'expertise');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj proces' }));
    expect(await dialog.findByText('Nie dodano procesu — w zleceniu jest już aktywny proces „Ekspertyza techniczna”.')).toBeTruthy();
    await waitFor(() => {
      expect(reads).toBe(2);
    });
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([]);
  });

  it('EVM-042 AC1 a retired template is told in the field; nothing chosen is told before the request; a lost answer is retried with the same id and key', async () => {
    const answers = [problem(422, 'template_unavailable'), problem(500, 'internal_error'), problem(500, 'internal_error')];
    let call = 0;
    const fake = api({ extra: { [`POST ${BASE}/procedures`]: () => answers[call++] ?? problem(500, 'internal_error') } });
    await renderPanel(PATH, fake);
    await ready();
    const dialog = await openAddProcedure();
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj proces' }));
    expect(await dialog.findByText('Wybierz proces.')).toBeTruthy();
    expect(fake.calls(`POST ${BASE}/procedures`)).toHaveLength(0);
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Proces' }), 'expertise');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj proces' }));
    expect(await dialog.findByText('Ten szablon procesu nie jest już dostępny. Wybierz inny.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj proces' }));
    await dialog.findByText(/Nie udało się zapisać zmiany/);
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj proces' }));
    await waitFor(() => {
      expect(fake.calls(`POST ${BASE}/procedures`)).toHaveLength(3);
    });
    const [, first, second] = fake.calls(`POST ${BASE}/procedures`);
    expect(first?.headers.get('Idempotency-Key')).toBe(second?.headers.get('Idempotency-Key'));
    expect((parseBody(first?.body ?? '') as { id: string }).id).toBe((parseBody(second?.body ?? '') as { id: string }).id);
  });
});

describe('W-06 (d) "Dodaj etap" (EVM-042 AC2)', () => {
  it('EVM-042 AC2 the stage has a name, a place, a date and a person; it is added as a request with a fresh id and key and gets the focus', async () => {
    let items = list([osd([stage(1), stage(2), stage(3)]), ppoz()]);
    const fake = api({
      procedures: () => json(200, items),
      extra: {
        [`POST ${BASE}/procedures/${OSD_ID}/stages`]: (request) => {
          const body = parseBody(request.body) as { id: string; name: string };
          const added = stage(30, { id: body.id, name: body.name, position: 2 });
          items = list([osd([stage(1), added, stage(2, { position: 3 }), stage(3, { position: 4 })]), ppoz()]);
          return json(201, added, { ETag: '"1"' });
        },
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje procesu: Uzgodnienia z OSD' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Dodaj etap…' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Dodaj etap' }));
    expect(dialog.getByText('Uzgodnienia z OSD · ZL-2026-0042')).toBeTruthy();
    expect(document.activeElement).toBe(dialog.getByRole('textbox', { name: 'Nazwa etapu' }));
    expect(dialog.getByText(/Nie wpisuj danych osobowych/)).toBeTruthy();
    expect(dialog.getByText('Etap dostanie status „Do zrobienia” i wejdzie do postępu procesu.')).toBeTruthy();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa etapu' }), '  Korekta wniosku  ');
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Miejsce w procesie' }), '2');
    await userEvent.type(dialog.getByLabelText('Termin (opcjonalnie)'), '2026-12-01');
    await userEvent.selectOptions(
      await dialog.findByRole('combobox', { name: 'Osoba odpowiedzialna (opcjonalnie)' }),
      ACTIVE_SESSION.user.id,
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));

    expect(await screen.findByText('Dodano etap „Korekta wniosku”.')).toBeTruthy();
    const sent = fake.calls(`POST ${BASE}/procedures/${OSD_ID}/stages`)[0];
    expect(sent?.headers.get('Idempotency-Key')).toMatch(UUID_V7);
    expect(parseBody(sent?.body ?? '')).toEqual({
      id: expect.stringMatching(UUID_V7) as string,
      name: 'Korekta wniosku',
      position: 2,
      dueDate: '2026-12-01',
      responsibleUserId: ACTIVE_SESSION.user.id,
    });
    const row = await section().findByText('Korekta wniosku');
    expect(row).toBeTruthy();
    await waitFor(() => {
      const holder = row.closest('[data-stage-id]');
      expect(document.activeElement).toBe(holder?.querySelector('button'));
    });
  });

  it('EVM-042 AC2 the name is checked before the request: required, at most 120 characters, no control characters', async () => {
    const fake = api({});
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Uzgodnienia z OSD', 'Dodaj etap…');
    const dialog = within(await screen.findByRole('dialog', { name: 'Dodaj etap' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await dialog.findByText('Podaj nazwę etapu.')).toBeTruthy();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa etapu' }), 'a'.repeat(121));
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await dialog.findByText('Nazwa może mieć najwyżej 120 znaków.')).toBeTruthy();
    const field = dialog.getByRole('textbox', { name: 'Nazwa etapu' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Zły\u0007znak');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await dialog.findByText('Nazwa zawiera niedozwolone znaki.')).toBeTruthy();
    expect(fake.calls(`POST ${BASE}/procedures/${OSD_ID}/stages`)).toHaveLength(0);
  });

  it('EVM-042 AC2 a person who is not available and a date out of range are told at the fields (400)', async () => {
    const fake = api({
      extra: {
        [`POST ${BASE}/procedures/${OSD_ID}/stages`]: () =>
          problem(400, 'validation_failed', {
            errors: [
              { pointer: '/responsibleUserId', code: 'assignee_unavailable' },
              { pointer: '/dueDate', code: 'out_of_range' },
            ],
          }),
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Uzgodnienia z OSD', 'Dodaj etap…');
    const dialog = within(await screen.findByRole('dialog', { name: 'Dodaj etap' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa etapu' }), 'Etap pomocniczy');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await dialog.findByText('Ta osoba nie jest dostępna. Wybierz inną osobę.')).toBeTruthy();
    expect(dialog.getByText('Wybierz termin z lat 2000–2100.')).toBeTruthy();
    // what was typed stays
    expect(dialog.getByDisplayValue('Etap pomocniczy')).toBeTruthy();
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([]);
  });
});

describe('W-06 (d) limits and a closed order (EVM-042 AC4)', () => {
  it('EVM-042 AC4 at 30 processes "Dodaj proces…" is disabled with the reason; at 30 stages "Dodaj etap…" is', async () => {
    const stages = Array.from({ length: 30 }, (_, index) => stage(index + 1));
    const processes = Array.from({ length: 30 }, (_, index) => ({
      ...ppoz(),
      id: `01968f3e-0000-7000-8000-0000000b0${String(index).padStart(3, '0')}`,
      code: `p${String(index)}`,
      position: index + 1,
    }));
    processes[0] = osd(stages);
    await renderPanel(PATH, api({ procedures: () => json(200, list(processes)) }));
    await screen.findByRole('heading', { level: 2, name: 'Procesy i etapy (30)' });
    const add = screen.getByRole('button', { name: 'Dodaj proces…' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('title')).toBe('Zlecenie ma już 30 procesów — to limit.');
    await userEvent.click(screen.getByRole('button', { name: 'Akcje procesu: Uzgodnienia z OSD' }));
    const item = screen.getByRole('menuitem', { name: /^Dodaj etap…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe('Proces ma już 30 etapów — to limit.');
  });

  it('EVM-042 AC4 a race over the limit (422) is told in the dialog with the same words', async () => {
    const fake = api({
      extra: {
        [`POST ${BASE}/procedures`]: () => problem(422, 'limit_exceeded', { errors: [{ pointer: '', code: 'too_many_procedures' }] }),
        [`POST ${BASE}/procedures/${OSD_ID}/stages`]: () =>
          problem(422, 'limit_exceeded', { errors: [{ pointer: '', code: 'too_many_stages' }] }),
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    const add = await openAddProcedure();
    await userEvent.selectOptions(await add.findByRole('combobox', { name: 'Proces' }), 'expertise');
    await userEvent.click(add.getByRole('button', { name: 'Dodaj proces' }));
    expect(await add.findByText('Zlecenie ma już 30 procesów — to limit.')).toBeTruthy();
    await userEvent.click(add.getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Odrzuć zmiany' }));

    await openProcessMenu('Uzgodnienia z OSD', 'Dodaj etap…');
    const stageDialog = within(await screen.findByRole('dialog', { name: 'Dodaj etap' }));
    await userEvent.type(stageDialog.getByRole('textbox', { name: 'Nazwa etapu' }), 'Jeden za dużo');
    await userEvent.click(stageDialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await stageDialog.findByText('Proces ma już 30 etapów — to limit.')).toBeTruthy();
  });

  it.each(['Dodaj proces…', 'Akcje procesu: Uzgodnienia z OSD', 'Akcje etapu: Etap 1'])(
    'EVM-042 AC4 a settled order disables %s with the reason',
    async (name) => {
      await renderPanel(PATH, api({ header: closedHeader }));
      await ready();
      const control = await screen.findByRole('button', { name });
      if (name === 'Dodaj proces…') {
        expect(control.getAttribute('aria-disabled')).toBe('true');
        expect(control.getAttribute('title')).toBe('Zlecenie jest zamknięte — procesów i etapów nie można zmieniać.');
        return;
      }
      await userEvent.click(control);
      const items = screen.getAllByRole('menuitem');
      expect(items.every((item) => item.getAttribute('aria-disabled') === 'true')).toBe(true);
    },
  );

  it('EVM-042 AC4 a 409 work_order_closed in a dialog says so and blocks the button; the order is read again', async () => {
    let reads = 0;
    const fake = api({
      header: () => {
        reads += 1;
        return json(200, HEADER, { ETag: '"3"' });
      },
      extra: { [`DELETE ${BASE}/procedure-stages/${stage(1).id}`]: () => problem(409, 'work_order_closed') },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openStageMenu('Etap 1', 'Usuń etap…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć etap „Etap 1”?' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń etap' }));
    expect(await dialog.findByText(/Zlecenie jest już rozliczone/)).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Usuń etap' }).getAttribute('aria-disabled')).toBe('true');
    await waitFor(() => {
      expect(reads).toBe(2);
    });
  });
});

describe('W-06 (d) "Usuń etap" and "Usuń proces" (EVM-042 AC3, AC6, AC7)', () => {
  it('EVM-042 AC3 AC6 the Administrator removes a stage after the advice: If-Match of its version, "Cofnij" restores it, the focus goes to the next menu', async () => {
    let removed = false;
    const target = stage(1, { version: 4 });
    const fake = api({
      procedures: () => json(200, list([osd(removed ? [stage(2), stage(3)] : [target, stage(2), stage(3)]), ppoz()])),
      deleted: () =>
        json(200, {
          procedures: [],
          stages: removed
            ? [
                {
                  id: target.id,
                  procedureId: OSD_ID,
                  procedureName: 'Uzgodnienia z OSD',
                  name: 'Etap 1',
                  position: 1,
                  procedureDeleted: false,
                  version: 5,
                  deletedAt: '2026-10-14T10:00:00.000Z',
                },
              ]
            : [],
          truncated: false,
        }),
      extra: {
        [`DELETE ${BASE}/procedure-stages/${target.id}`]: () => {
          removed = true;
          return new Response(null, { status: 204 });
        },
        [`POST ${BASE}/procedure-stages/${target.id}/restore`]: () => {
          removed = false;
          return json(200, target, { ETag: '"6"' });
        },
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openStageMenu('Etap 1', 'Usuń etap…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć etap „Etap 1”?' }));
    expect(dialog.getByText('Uzgodnienia z OSD · ZL-2026-0042')).toBeTruthy();
    expect(dialog.getByText(/oznacz go jako „Nie dotyczy” — zostanie w historii zlecenia/)).toBeTruthy();
    expect(dialog.getByText('Usunięty etap zniknie z procesu.')).toBeTruthy();
    expect(dialog.getByText('Przywrócisz go w „Usunięte procesy i etapy”.')).toBeTruthy();
    expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń etap' }));

    expect(await screen.findByText('Usunięto etap „Etap 1”.')).toBeTruthy();
    const sent = fake.calls(`DELETE ${BASE}/procedure-stages/${target.id}`)[0];
    expect(sent?.headers.get('If-Match')).toBe('"4"');
    expect(sent?.headers.get('Idempotency-Key')).toMatch(UUID_V7);
    await waitFor(() => {
      expect(within(section().getByRole('list', { name: 'Uzgodnienia z OSD' })).queryByText('Etap 1')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje etapu: Etap 2' }));
    });
    // "Cofnij" is a restore with the version of the deleted stage
    await userEvent.click(screen.getByRole('button', { name: 'Cofnij' }));
    expect(await screen.findByText('Przywrócono etap „Etap 1”.')).toBeTruthy();
    expect(fake.calls(`POST ${BASE}/procedure-stages/${target.id}/restore`)[0]?.headers.get('If-Match')).toBe('"5"');
  });

  it('EVM-042 AC3 AC6 the Editor is told that only an administrator restores, gets no "Cofnij" and never asks for the deleted ones', async () => {
    const fake = api({
      session: roleSession('editor'),
      extra: { [`DELETE ${BASE}/procedure-stages/${stage(1).id}`]: () => new Response(null, { status: 204 }) },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openStageMenu('Etap 1', 'Usuń etap…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć etap „Etap 1”?' }));
    expect(dialog.getByText('Przywrócić go może tylko administrator.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń etap' }));
    expect(await screen.findByText('Usunięto etap „Etap 1”.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
    expect(fake.calls(`GET ${BASE}/deleted-procedures`)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Usunięte procesy i etapy/ })).toBeNull();
  });

  it('EVM-042 AC3 "Oznacz jako „Nie dotyczy”" is the transition of W-07 with "Cofnij"; "Zakończony" gets neither the advice nor the button; "Nie dotyczy" is told', async () => {
    const fake = api({
      procedures: () =>
        json(
          200,
          list([
            osd([
              stage(1, { version: 2 }),
              stage(2, { status: 'done', completedOn: '2026-10-01' }),
              stage(3, { status: 'not_applicable' }),
            ]),
            ppoz(),
          ]),
        ),
      extra: {
        [`POST ${BASE}/procedure-stages/${stage(1).id}/transitions`]: () =>
          json(200, stage(1, { status: 'not_applicable', version: 3 }), { ETag: '"3"' }),
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openStageMenu('Etap 2', 'Usuń etap…');
    let dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć etap „Etap 2”?' }));
    expect(dialog.queryByRole('button', { name: 'Oznacz jako „Nie dotyczy”' })).toBeNull();
    expect(dialog.queryByText(/oznacz go jako „Nie dotyczy”/)).toBeNull();
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));
    await openStageMenu('Etap 3', 'Usuń etap…');
    dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć etap „Etap 3”?' }));
    expect(dialog.getByText(/Etap ma już status „Nie dotyczy” i zostaje w historii/)).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));

    await openStageMenu('Etap 1', 'Usuń etap…');
    dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć etap „Etap 1”?' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Oznacz jako „Nie dotyczy”' }));
    expect(await screen.findByText('Oznaczono etap „Etap 1” jako „Nie dotyczy”.')).toBeTruthy();
    const sent = fake.calls(`POST ${BASE}/procedure-stages/${stage(1).id}/transitions`)[0];
    expect(parseBody(sent?.body ?? '')).toEqual({ to: 'not_applicable' });
    expect(sent?.headers.get('If-Match')).toBe('"2"');
    expect(screen.getByRole('button', { name: 'Cofnij' })).toBeTruthy();
    expect(fake.calls(`DELETE ${BASE}/procedure-stages/${stage(1).id}`)).toHaveLength(0);
  });

  it('EVM-042 AC3 the process is removed with its stages: the dialog counts them and the request carries the version', async () => {
    let removed = false;
    const fake = api({
      procedures: () => json(200, list(removed ? [ppoz()] : [osd([stage(1), stage(2)]), ppoz()])),
      extra: {
        [`DELETE ${BASE}/procedures/${OSD_ID}`]: () => {
          removed = true;
          return new Response(null, { status: 204 });
        },
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Uzgodnienia z OSD', 'Usuń proces…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć proces „Uzgodnienia z OSD”?' }));
    expect(dialog.getByText('Proces zniknie razem z etapami (2).')).toBeTruthy();
    expect(dialog.getByText(/możesz zamiast tego oznaczyć jego etapy jako „Nie dotyczy”/)).toBeTruthy();
    expect(dialog.queryByRole('button', { name: 'Oznacz jako „Nie dotyczy”' })).toBeNull();
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń proces' }));
    expect(await screen.findByText('Usunięto proces „Uzgodnienia z OSD”.')).toBeTruthy();
    expect(fake.calls(`DELETE ${BASE}/procedures/${OSD_ID}`)[0]?.headers.get('If-Match')).toBe('"3"');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje procesu: Opinia ppoż' }));
    });
  });

  it('EVM-042 AC7 412 is told in the dialog, which stays open with what was on screen; the processes are read again; 404 says to refresh', async () => {
    let reads = 0;
    const answers = [problem(412, 'version_conflict'), problem(404, 'not_found'), problem(403, 'forbidden')];
    let call = 0;
    const fake = api({
      procedures: () => {
        reads += 1;
        return json(200, list([osd([stage(1)]), ppoz()]));
      },
      extra: { [`DELETE ${BASE}/procedure-stages/${stage(1).id}`]: () => answers[call++] ?? problem(500, 'internal_error') },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openStageMenu('Etap 1', 'Usuń etap…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć etap „Etap 1”?' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń etap' }));
    expect(await dialog.findByText('Ten etap zmieniono w międzyczasie. Sprawdź jego aktualny stan i spróbuj ponownie.')).toBeTruthy();
    await waitFor(() => {
      expect(reads).toBe(2);
    });
    expect(screen.getByRole('alertdialog', { name: 'Usunąć etap „Etap 1”?' })).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń etap' }));
    expect(await dialog.findByText('Nie znaleziono etapu. Odśwież zlecenie.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń etap' }));
    expect(await dialog.findByText('Nie masz uprawnień do tej zmiany.')).toBeTruthy();
    expect(await axeViolations(screen.getByRole('alertdialog'))).toEqual([]);
  });

  it('EVM-042 AC7 offline the actions are disabled with the reason and an open dialog keeps its button disabled', async () => {
    const fake = api({});
    await renderPanel(PATH, fake);
    await ready();
    await openStageMenu('Etap 1', 'Usuń etap…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć etap „Etap 1”?' }));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    await waitFor(() => {
      expect(dialog.getByRole('button', { name: 'Usuń etap' }).getAttribute('aria-disabled')).toBe('true');
    });
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń etap' }));
    expect(fake.calls(`DELETE ${BASE}/procedure-stages/${stage(1).id}`)).toHaveLength(0);
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));

    const add = screen.getByRole('button', { name: 'Dodaj proces…' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('title')).toBe('Zmienisz po powrocie połączenia.');
    await userEvent.click(screen.getByRole('button', { name: 'Akcje procesu: Uzgodnienia z OSD' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.getAttribute('title'))).toEqual([
      'Zmienisz po powrocie połączenia.',
      'Zmienisz po powrocie połączenia.',
    ]);
  });
});

describe('W-06 (d) "Usunięte procesy i etapy" (EVM-042 AC3, AC6)', () => {
  const DELETED: DeletedProcedureList = {
    procedures: [
      { id: PPOZ_ID, code: 'ppoz', name: 'Opinia ppoż', position: 2, stageCount: 2, version: 6, deletedAt: '2026-10-14T10:00:00.000Z' },
    ],
    stages: [
      {
        id: stage(1).id,
        procedureId: OSD_ID,
        procedureName: 'Uzgodnienia z OSD',
        name: 'Korekta wniosku',
        position: 1,
        procedureDeleted: false,
        version: 4,
        deletedAt: '2026-10-14T09:00:00.000Z',
      },
      {
        id: stage(9).id,
        procedureId: PPOZ_ID,
        procedureName: 'Opinia ppoż',
        name: 'Zlecenie opinii',
        position: 1,
        procedureDeleted: true,
        version: 2,
        deletedAt: '2026-10-14T08:00:00.000Z',
      },
    ],
    truncated: true,
  };

  it('EVM-042 AC3 the Administrator sees the count, the rows with their kinds and the names of the buttons start with the visible label', async () => {
    await renderPanel(PATH, api({ deleted: () => json(200, DELETED), procedures: () => json(200, list([osd([stage(2)])])) }));
    await ready();
    const header = await screen.findByRole('button', { name: 'Usunięte procesy i etapy (3)' });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(header);
    const rows = within(screen.getByRole('list', { name: 'Usunięte procesy i etapy' }));
    expect(rows.getByText('proces, 2 etapy')).toBeTruthy();
    expect(rows.getByText('etap procesu Uzgodnienia z OSD')).toBeTruthy();
    expect(screen.getByText('Pokazujemy najnowsze usunięte pozycje — starsze są ukryte.')).toBeTruthy();
    for (const name of ['Przywróć proces: Opinia ppoż', 'Przywróć etap: Korekta wniosku, proces Uzgodnienia z OSD']) {
      expect(rows.getByRole('button', { name }).textContent).toBe('Przywróć');
    }
    const blocked = rows.getByRole('button', { name: 'Przywróć etap: Zlecenie opinii, proces Opinia ppoż' });
    expect(blocked.getAttribute('aria-disabled')).toBe('true');
    expect(blocked.getAttribute('title')).toBe('Najpierw przywróć proces „Opinia ppoż”.');
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-042 AC3 "Przywróć" restores with If-Match of the version of the list, tells it and moves the focus to the restored process', async () => {
    let restored = false;
    const fake = api({
      procedures: () => json(200, list(restored ? [osd([stage(2)]), ppoz()] : [osd([stage(2)])])),
      deleted: () => json(200, restored ? NONE : { procedures: DELETED.procedures, stages: [], truncated: false }),
      extra: {
        [`POST ${BASE}/procedures/${PPOZ_ID}/restore`]: () => {
          restored = true;
          return json(200, ppoz(), { ETag: '"7"' });
        },
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: 'Usunięte procesy i etapy (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Przywróć proces: Opinia ppoż' }));
    expect(await screen.findByText('Przywrócono proces „Opinia ppoż”.')).toBeTruthy();
    const sent = fake.calls(`POST ${BASE}/procedures/${PPOZ_ID}/restore`)[0];
    expect(sent?.headers.get('If-Match')).toBe('"6"');
    expect(sent?.headers.get('Idempotency-Key')).toMatch(UUID_V7);
    const header = await section().findByRole('button', { name: /^Opinia ppoż/ });
    await waitFor(() => {
      expect(document.activeElement).toBe(header);
    });
    // nothing is left to restore: the section is gone
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Usunięte procesy i etapy/ })).toBeNull();
    });
  });

  it('EVM-042 AC3 a stage comes back into its process and the focus goes to its badge', async () => {
    let restored = false;
    const fake = api({
      procedures: () => json(200, list([osd(restored ? [stage(1), stage(2)] : [stage(2)])])),
      deleted: () =>
        json(
          200,
          restored ? NONE : { procedures: [], stages: [DELETED.stages[0] as DeletedProcedureList['stages'][number]], truncated: false },
        ),
      extra: {
        [`POST ${BASE}/procedure-stages/${stage(1).id}/restore`]: () => {
          restored = true;
          return json(200, stage(1), { ETag: '"5"' });
        },
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: 'Usunięte procesy i etapy (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Przywróć etap: Korekta wniosku, proces Uzgodnienia z OSD' }));
    expect(await screen.findByText('Przywrócono etap „Korekta wniosku”.')).toBeTruthy();
    expect(fake.calls(`POST ${BASE}/procedure-stages/${stage(1).id}/restore`)[0]?.headers.get('If-Match')).toBe('"4"');
  });

  it('EVM-042 AC3 a process whose code is active again is a 409 that names it; the lists are read again', async () => {
    let reads = 0;
    const fake = api({
      deleted: () => {
        reads += 1;
        return json(200, { procedures: DELETED.procedures, stages: [], truncated: false });
      },
      extra: { [`POST ${BASE}/procedures/${PPOZ_ID}/restore`]: () => problem(409, 'procedure_already_active') },
    });
    await renderPanel(PATH, fake);
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: 'Usunięte procesy i etapy (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Przywróć proces: Opinia ppoż' }));
    expect(await screen.findByText('Nie przywrócono procesu — w zleceniu jest już aktywny proces „Opinia ppoż”.')).toBeTruthy();
    await waitFor(() => {
      expect(reads).toBe(2);
    });
  });

  it('EVM-042 AC4 a settled order and the connection disable "Przywróć" with the reason', async () => {
    await renderPanel(
      PATH,
      api({ header: closedHeader, deleted: () => json(200, { procedures: DELETED.procedures, stages: [], truncated: false }) }),
    );
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: 'Usunięte procesy i etapy (1)' }));
    const restore = screen.getByRole('button', { name: 'Przywróć proces: Opinia ppoż' });
    expect(restore.getAttribute('aria-disabled')).toBe('true');
    expect(restore.getAttribute('title')).toMatch(/Zlecenie jest już rozliczone/);
    // the reason is visible text under the heading, not only a tooltip
    expect(screen.getByText(/Zlecenie jest już rozliczone/).tagName).toBe('P');
  });

  it('EVM-042 AC6 a failed read of the deleted ones is told with a retry, only the Administrator sees the section', async () => {
    await renderPanel(PATH, api({ deleted: () => problem(500, 'internal_error') }));
    await ready();
    expect(await screen.findByText('Nie udało się wczytać usuniętych procesów i etapów.')).toBeTruthy();
  });
});

describe('W-06 (d) roles (EVM-042 AC6)', () => {
  it('EVM-042 AC6 Tylko odczyt has no "Dodaj proces…", no menus and never asks for the deleted ones', async () => {
    const fake = api({ session: roleSession('read_only') });
    await renderPanel(PATH, fake);
    await ready();
    expect(screen.queryByRole('button', { name: 'Dodaj proces…' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Akcje (procesu|etapu)/ })).toBeNull();
    expect(fake.calls(`GET ${BASE}/deleted-procedures`)).toHaveLength(0);
  });

  it('EVM-042 AC6 an empty order offers "Dodaj proces…" to the Editor and the Administrator', async () => {
    await renderPanel(PATH, api({ session: roleSession('editor'), procedures: () => json(200, list([])) }));
    await screen.findByRole('heading', { level: 2, name: 'Procesy i etapy (0)' });
    expect(section().getByText('Zlecenie nie ma jeszcze procesów.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dodaj proces…' })).toBeTruthy();
  });

  it('EVM-042 AC6 the page with the new dialogs has no accessibility violations', async () => {
    await renderPanel(PATH, api({}));
    await ready();
    expect(await axeViolations(document.body)).toEqual([]);
    const dialog = await openAddProcedure();
    await dialog.findByRole('option', { name: 'Ekspertyza techniczna' });
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([]);
  });
});

describe('W-06 (d) the remaining answers of the dialogs (EVM-042 AC1–AC7)', () => {
  it('EVM-042 AC3 AC6 the process: "Cofnij" of the Administrator asks for the version of the deleted process and a refusal is told', async () => {
    let removed = false;
    const fake = api({
      procedures: () => json(200, list(removed ? [ppoz()] : [osd([stage(1)]), ppoz()])),
      deleted: () =>
        json(200, {
          procedures: removed
            ? [
                {
                  id: OSD_ID,
                  code: 'osd',
                  name: 'Uzgodnienia z OSD',
                  position: 1,
                  stageCount: 1,
                  version: 4,
                  deletedAt: '2026-10-14T10:00:00.000Z',
                },
              ]
            : [],
          stages: [],
          truncated: false,
        }),
      extra: {
        [`DELETE ${BASE}/procedures/${OSD_ID}`]: () => {
          removed = true;
          return new Response(null, { status: 204 });
        },
        [`POST ${BASE}/procedures/${OSD_ID}/restore`]: () => problem(409, 'procedure_already_active'),
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Uzgodnienia z OSD', 'Usuń proces…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć proces „Uzgodnienia z OSD”?' }));
    expect(dialog.getByText('Przywrócisz go w „Usunięte procesy i etapy”.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń proces' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    expect(await screen.findByText('Ten wpis zmieniono w międzyczasie. Odświeżyliśmy listę — spróbuj ponownie.')).toBeTruthy();
    expect(fake.calls(`POST ${BASE}/procedures/${OSD_ID}/restore`)[0]?.headers.get('If-Match')).toBe('"4"');
  });

  it('EVM-042 AC3 AC6 the process: "Cofnij" of the Administrator restores it and tells it', async () => {
    const fake = api({
      deleted: () =>
        json(200, {
          procedures: [
            {
              id: PPOZ_ID,
              code: 'ppoz',
              name: 'Opinia ppoż',
              position: 2,
              stageCount: 1,
              version: 6,
              deletedAt: '2026-10-14T10:00:00.000Z',
            },
          ],
          stages: [],
          truncated: false,
        }),
      extra: {
        [`DELETE ${BASE}/procedures/${PPOZ_ID}`]: () => new Response(null, { status: 204 }),
        [`POST ${BASE}/procedures/${PPOZ_ID}/restore`]: () => json(200, ppoz(), { ETag: '"6"' }),
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Opinia ppoż', 'Usuń proces…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć proces „Opinia ppoż”?' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń proces' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    expect(await screen.findByText('Przywrócono proces „Opinia ppoż”.')).toBeTruthy();
    expect(fake.calls(`POST ${BASE}/procedures/${PPOZ_ID}/restore`)).toHaveLength(1);
  });

  it('EVM-042 AC7 AC6 the process: 412, 404 and a closed order are told in the dialog; the Editor sees who restores', async () => {
    const answers = [problem(412, 'version_conflict'), problem(404, 'not_found'), problem(409, 'work_order_closed')];
    let call = 0;
    const fake = api({
      session: roleSession('editor'),
      extra: { [`DELETE ${BASE}/procedures/${PPOZ_ID}`]: () => answers[call++] ?? problem(500, 'internal_error') },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Opinia ppoż', 'Usuń proces…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć proces „Opinia ppoż”?' }));
    expect(dialog.getByText('Przywrócić go może tylko administrator.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń proces' }));
    expect(await dialog.findByText('Ten proces zmieniono w międzyczasie. Sprawdź jego aktualny stan i spróbuj ponownie.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń proces' }));
    expect(await dialog.findByText('Nie znaleziono procesu. Odśwież zlecenie.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń proces' }));
    expect(await dialog.findByText(/przez administratora/)).toBeTruthy();
  });

  it('EVM-042 AC3 a process without a version on screen cannot be removed: "Usuń proces" is disabled and nothing is sent; an empty process says it only leaves the order', async () => {
    const unversioned: Procedure = { ...osd([]), name: 'Proces bez wersji' };
    delete unversioned.version;
    const fake = api({ procedures: () => json(200, list([unversioned])) });
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Proces bez wersji', 'Usuń proces…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć proces „Proces bez wersji”?' }));
    expect(dialog.getByText('Proces zniknie ze zlecenia.')).toBeTruthy();
    expect(dialog.queryByText(/możesz zamiast tego oznaczyć/)).toBeNull();
    const confirm = dialog.getByRole('button', { name: 'Usuń proces' });
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(confirm);
    expect(fake.calls(`DELETE ${BASE}/procedures/${OSD_ID}`)).toHaveLength(0);
  });

  it('EVM-042 AC1 the add dialog: a failed catalogue with a retry, a closed order, the discard of typed data and the offline banner', async () => {
    let templates = 0;
    const fake = api({
      extra: {
        [`POST ${BASE}/procedures`]: () => problem(409, 'work_order_closed'),
        [TEMPLATES_ROUTE]: () => {
          templates += 1;
          return templates === 1 ? problem(500, 'internal_error') : json(200, TEMPLATES);
        },
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    const dialog = await openAddProcedure();
    expect(await dialog.findByText('Nie udało się wczytać szablonów procesów.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Spróbuj ponownie' }));
    await userEvent.selectOptions(await dialog.findByRole('combobox', { name: 'Proces' }), 'expertise');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj proces' }));
    expect(await dialog.findByText(/Zlecenie jest już rozliczone/)).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Dodaj proces' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Wróć do edycji' }));
    expect(screen.getByRole('dialog', { name: 'Dodaj proces' })).toBeTruthy();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    expect((await screen.findAllByText('Zapiszesz po powrocie połączenia.')).length).toBeGreaterThan(0);
  });

  it('EVM-042 AC2 the stage dialog: 404, a rejected name (400), a closed order, the place "Po: …" and the discard', async () => {
    const answers = [
      problem(404, 'not_found'),
      problem(400, 'validation_failed', { errors: [{ pointer: '/name', code: 'invalid_characters' }] }),
      problem(409, 'work_order_closed'),
    ];
    let call = 0;
    const fake = api({ extra: { [`POST ${BASE}/procedures/${OSD_ID}/stages`]: () => answers[call++] ?? problem(500, 'internal_error') } });
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Uzgodnienia z OSD', 'Dodaj etap…');
    const dialog = within(await screen.findByRole('dialog', { name: 'Dodaj etap' }));
    expect(dialog.getByRole('option', { name: 'Po: 1 Etap 1' })).toBeTruthy();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa etapu' }), 'Nowy');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await dialog.findByText('Nie znaleziono etapu. Odśwież zlecenie.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await dialog.findByText('Nazwa zawiera niedozwolone znaki.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await dialog.findByText(/Zlecenie jest już rozliczone/)).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Odrzuć zmiany' }));
    expect(screen.queryByRole('dialog', { name: 'Dodaj etap' })).toBeNull();
  });

  it('EVM-042 AC3 "Nie dotyczy": a refused transition is told, "Cofnij" returns the stage to "Do zrobienia", a failed "Cofnij" says so', async () => {
    const answers = [
      problem(409, 'invalid_state_transition'),
      json(200, stage(1, { status: 'not_applicable', version: 3 }), { ETag: '"3"' }),
    ];
    let call = 0;
    const fake = api({
      extra: {
        [`POST ${BASE}/procedure-stages/${stage(1).id}/transitions`]: () => answers[call++] ?? problem(409, 'invalid_state_transition'),
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openStageMenu('Etap 1', 'Usuń etap…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć etap „Etap 1”?' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Oznacz jako „Nie dotyczy”' }));
    expect(await dialog.findByText('Ten etap zmieniono w międzyczasie. Sprawdź jego aktualny stan i spróbuj ponownie.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Oznacz jako „Nie dotyczy”' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    expect(await screen.findByText('Nie udało się cofnąć — ktoś zmienił etap w międzyczasie.')).toBeTruthy();
    expect(parseBody(fake.calls(`POST ${BASE}/procedure-stages/${stage(1).id}/transitions`)[2]?.body ?? '')).toEqual({ to: 'todo' });
  });

  it('EVM-042 AC3 a failed "Cofnij" after a deletion says the list changed', async () => {
    const fake = api({
      deleted: () => json(200, NONE),
      extra: { [`DELETE ${BASE}/procedure-stages/${stage(1).id}`]: () => new Response(null, { status: 204 }) },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openStageMenu('Etap 1', 'Usuń etap…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć etap „Etap 1”?' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń etap' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    expect(await screen.findByText('Ten wpis zmieniono w międzyczasie. Odświeżyliśmy listę — spróbuj ponownie.')).toBeTruthy();
  });

  it('EVM-042 AC3 AC4 the restore of a stage is refused or stale: 409 parent_deleted, 412, 404, 422 and 403 are told in the section', async () => {
    const entry = {
      id: stage(1).id,
      procedureId: OSD_ID,
      procedureName: 'Uzgodnienia z OSD',
      name: 'Korekta',
      position: 1,
      procedureDeleted: false,
      version: 4,
      deletedAt: '2026-10-14T09:00:00.000Z',
    };
    const answers = [
      problem(409, 'parent_deleted'),
      problem(412, 'version_conflict'),
      problem(404, 'not_found'),
      problem(422, 'limit_exceeded', { errors: [{ pointer: '', code: 'too_many_stages' }] }),
      problem(403, 'forbidden'),
    ];
    let call = 0;
    const fake = api({
      deleted: () => json(200, { procedures: [], stages: [entry], truncated: false }),
      extra: { [`POST ${BASE}/procedure-stages/${stage(1).id}/restore`]: () => answers[call++] ?? problem(500, 'internal_error') },
    });
    await renderPanel(PATH, fake);
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: 'Usunięte procesy i etapy (1)' }));
    const restore = () => screen.getByRole('button', { name: 'Przywróć etap: Korekta, proces Uzgodnienia z OSD' });
    for (const text of [
      'Nie przywrócono etapu — jego proces jest usunięty. Najpierw przywróć proces.',
      'Ten wpis zmieniono w międzyczasie. Odświeżyliśmy listę — spróbuj ponownie.',
      'Nie znaleziono tej pozycji. Odświeżyliśmy listę.',
      'Nie przywrócono — przekroczony limit procesów lub etapów.',
      'Nie masz uprawnień do tej zmiany.',
    ]) {
      await userEvent.click(restore());
      expect(await screen.findByText(text)).toBeTruthy();
    }
  });
});

describe('W-06 (d) the remaining branches of the process and stage dialogs (EVM-042 AC1–AC7)', () => {
  const full = (count: number): Procedure[] =>
    Array.from({ length: count }, (_, index) => ({
      ...ppoz(),
      id: `01968f3e-0000-7000-8000-0000000c0${String(index).padStart(3, '0')}`,
      code: `p${String(index)}`,
      name: `Proces ${String(index)}`,
      position: index + 1,
    }));

  const CATALOGUE = {
    items: [
      { code: 'solo', name: 'Proces jednoetapowy', stages: [{ code: 'a', name: 'A' }] },
      { code: 'big', name: 'Proces pięcioetapowy', stages: [1, 2, 3, 4, 5].map((n) => ({ code: `b${String(n)}`, name: `B${String(n)}` })) },
    ],
    nextCursor: null,
  };

  it('EVM-042 AC1 the add dialog: a clean cancel closes at once, the count of stages is told in the right form, a refused template, key and a full order are told', async () => {
    let procedures = list([osd([stage(1)])]);
    const answers = [problem(400, 'validation_failed'), problem(409, 'idempotency_mismatch'), problem(409, 'procedure_already_active')];
    let call = 0;
    const fake = api({
      procedures: () => json(200, procedures),
      extra: {
        [TEMPLATES_ROUTE]: () => json(200, CATALOGUE),
        [`POST ${BASE}/procedures`]: () => {
          const answer = answers[call++] ?? problem(500, 'internal_error');
          if (call === 3) procedures = list(full(30));
          return answer;
        },
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    let dialog = await openAddProcedure();
    await dialog.findByRole('option', { name: 'Proces jednoetapowy' });
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog', { name: 'Dodaj proces' })).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    dialog = await openAddProcedure();
    const choose = await dialog.findByRole('combobox', { name: 'Proces' });
    await userEvent.selectOptions(choose, 'big');
    expect(dialog.getByText('Proces dostanie etapy z szablonu w stanie „Do zrobienia”: 5 etapów.')).toBeTruthy();
    await userEvent.selectOptions(choose, 'solo');
    expect(dialog.getByText('Proces dostanie etapy z szablonu w stanie „Do zrobienia”: 1 etap.')).toBeTruthy();

    const submit = () => userEvent.click(dialog.getByRole('button', { name: 'Dodaj proces' }));
    await submit();
    expect(await dialog.findByText('Ten szablon procesu nie jest już dostępny. Wybierz inny.')).toBeTruthy();
    await submit();
    await dialog.findByText(/Nie udało się zapisać zmiany/);
    await submit();
    expect(await dialog.findByText('Nie dodano procesu — w zleceniu jest już aktywny proces „Proces jednoetapowy”.')).toBeTruthy();
    // the refused key is not sent again: the next attempt has a fresh one
    const keys = fake.calls(`POST ${BASE}/procedures`).map((entry) => entry.headers.get('Idempotency-Key'));
    expect(keys[2]).not.toBe(keys[1]);
    // the list was read again and holds the limit: the dialog says so and blocks the button
    await waitFor(() => {
      expect(dialog.getAllByText('Zlecenie ma już 30 procesów — to limit.').length).toBeGreaterThan(0);
    });
    expect(dialog.getByRole('button', { name: 'Dodaj proces' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('EVM-042 AC2 the stage dialog: a clean cancel closes at once; a name that is too long, a date out of range and a refused key are told', async () => {
    const answers = [problem(409, 'idempotency_mismatch'), problem(500, 'internal_error')];
    let call = 0;
    const fake = api({ extra: { [`POST ${BASE}/procedures/${OSD_ID}/stages`]: () => answers[call++] ?? problem(500, 'internal_error') } });
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Uzgodnienia z OSD', 'Dodaj etap…');
    let dialog = within(await screen.findByRole('dialog', { name: 'Dodaj etap' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog', { name: 'Dodaj etap' })).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await openProcessMenu('Uzgodnienia z OSD', 'Dodaj etap…');
    dialog = within(await screen.findByRole('dialog', { name: 'Dodaj etap' }));
    const name = dialog.getByRole('textbox', { name: 'Nazwa etapu' });
    await userEvent.click(name);
    await userEvent.paste('x'.repeat(121));
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await dialog.findByText('Nazwa może mieć najwyżej 120 znaków.')).toBeTruthy();
    await userEvent.clear(name);
    await userEvent.type(name, 'Krótka nazwa');
    await userEvent.type(dialog.getByLabelText('Termin (opcjonalnie)'), '2101-01-01');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await dialog.findByText('Wybierz termin z lat 2000–2100.')).toBeTruthy();
    expect(fake.calls(`POST ${BASE}/procedures/${OSD_ID}/stages`)).toHaveLength(0);

    await userEvent.clear(dialog.getByLabelText('Termin (opcjonalnie)'));
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    await dialog.findByText(/Nie udało się zapisać zmiany/);
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    await waitFor(() => {
      expect(fake.calls(`POST ${BASE}/procedures/${OSD_ID}/stages`)).toHaveLength(2);
    });
    const [first, second] = fake.calls(`POST ${BASE}/procedures/${OSD_ID}/stages`);
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
  });

  it('EVM-042 AC2 the stage dialog: the server points at the date and the person, an unknown field is the general failure', async () => {
    const answers = [
      problem(400, 'validation_failed', { errors: [{ pointer: '/dueDate', code: 'out_of_range' }] }),
      problem(400, 'validation_failed', { errors: [{ pointer: '/responsibleUserId', code: 'unavailable' }] }),
      problem(400, 'validation_failed', { errors: [{ pointer: '/other', code: 'invalid' }] }),
    ];
    let call = 0;
    const fake = api({ extra: { [`POST ${BASE}/procedures/${OSD_ID}/stages`]: () => answers[call++] ?? problem(500, 'internal_error') } });
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Uzgodnienia z OSD', 'Dodaj etap…');
    const dialog = within(await screen.findByRole('dialog', { name: 'Dodaj etap' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa etapu' }), 'Nowy etap');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await dialog.findByText('Wybierz termin z lat 2000–2100.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await dialog.findByText('Ta osoba nie jest dostępna. Wybierz inną osobę.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    expect(await dialog.findByText(/Nie udało się zapisać zmiany/)).toBeTruthy();
  });

  it('EVM-042 AC2 the stage dialog: a failed list of people has a retry; a process that filled up is told; offline the button is off with the reason', async () => {
    let people = 0;
    let stages = [stage(1)];
    const fake = api({
      procedures: () => json(200, list([osd(stages), ppoz()])),
      extra: {
        'GET /api/v1/users/assignable': () => {
          people += 1;
          return people === 1
            ? problem(500, 'internal_error')
            : json(200, { items: [{ id: ACTIVE_SESSION.user.id, displayName: 'Anna Testowa' }] });
        },
        [`POST ${BASE}/procedures/${OSD_ID}/stages`]: () => {
          stages = Array.from({ length: 30 }, (_, index) => stage(index + 1));
          return problem(422, 'limit_exceeded', { errors: [{ pointer: '', code: 'too_many_stages' }] });
        },
      },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Uzgodnienia z OSD', 'Dodaj etap…');
    const dialog = within(await screen.findByRole('dialog', { name: 'Dodaj etap' }));
    expect(await dialog.findByText('Nie udało się wczytać listy osób.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await dialog.findByRole('option', { name: 'Anna Testowa' })).toBeTruthy();

    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa etapu' }), 'Jeden za dużo');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj etap' }));
    await waitFor(() => {
      expect(dialog.getAllByText('Proces ma już 30 etapów — to limit.').length).toBeGreaterThan(1);
    });
    expect(dialog.getByRole('button', { name: 'Dodaj etap' }).getAttribute('aria-disabled')).toBe('true');

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    expect((await dialog.findAllByText('Zapiszesz po powrocie połączenia.')).length).toBeGreaterThan(0);
    expect(dialog.getByRole('button', { name: 'Dodaj etap' }).getAttribute('title')).toBe('Zapiszesz po powrocie połączenia.');
  });

  it('EVM-042 AC6 the Editor removes a process and is not offered "Cofnij"', async () => {
    const fake = api({
      session: roleSession('editor'),
      extra: { [`DELETE ${BASE}/procedures/${PPOZ_ID}`]: () => new Response(null, { status: 204 }) },
    });
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Opinia ppoż', 'Usuń proces…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć proces „Opinia ppoż”?' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń proces' }));
    expect(await screen.findByText('Usunięto proces „Opinia ppoż”.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
  });

  it('EVM-042 AC7 the process dialog: a refused key gets a fresh one; offline it shows the banner and the reason on the button and sends nothing', async () => {
    const answers = [problem(409, 'idempotency_mismatch'), new Response(null, { status: 204 })];
    let call = 0;
    const fake = api({ extra: { [`DELETE ${BASE}/procedures/${PPOZ_ID}`]: () => answers[call++] ?? problem(500, 'internal_error') } });
    await renderPanel(PATH, fake);
    await ready();
    await openProcessMenu('Opinia ppoż', 'Usuń proces…');
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Usunąć proces „Opinia ppoż”?' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń proces' }));
    await dialog.findByText(/Nie udało się zapisać zmiany/);
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń proces' }));
    expect(await screen.findByText('Usunięto proces „Opinia ppoż”.')).toBeTruthy();
    const [first, second] = fake.calls(`DELETE ${BASE}/procedures/${PPOZ_ID}`);
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));

    await openProcessMenu('Uzgodnienia z OSD', 'Usuń proces…');
    const again = within(await screen.findByRole('alertdialog', { name: 'Usunąć proces „Uzgodnienia z OSD”?' }));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    expect(await again.findByText('Zapiszesz po powrocie połączenia.')).toBeTruthy();
    const confirm = again.getByRole('button', { name: 'Usuń proces' });
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(confirm.getAttribute('title')).toBe('Zapiszesz po powrocie połączenia.');
    expect(fake.calls(`DELETE ${BASE}/procedures/${OSD_ID}`)).toHaveLength(0);
  });

  it('EVM-042 AC3 AC6 the restore of a process: many stages are counted, a refused key is renewed, 403, a failure of the server and a closed order are told', async () => {
    let headers = 0;
    const entry = {
      id: PPOZ_ID,
      code: 'ppoz',
      name: 'Opinia ppoż',
      position: 2,
      stageCount: 5,
      version: 6,
      deletedAt: '2026-10-14T10:00:00.000Z',
    };
    const answers = [
      problem(409, 'idempotency_mismatch'),
      problem(403, 'forbidden'),
      problem(500, 'internal_error'),
      problem(409, 'work_order_closed'),
    ];
    let call = 0;
    const fake = api({
      header: () => {
        headers += 1;
        return json(200, HEADER, { ETag: '"3"' });
      },
      deleted: () => json(200, { procedures: [entry], stages: [], truncated: false }),
      extra: { [`POST ${BASE}/procedures/${PPOZ_ID}/restore`]: () => answers[call++] ?? problem(500, 'internal_error') },
    });
    await renderPanel(PATH, fake);
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: 'Usunięte procesy i etapy (1)' }));
    expect(screen.getByText('proces, 5 etapów')).toBeTruthy();
    const restore = () => screen.getByRole('button', { name: 'Przywróć proces: Opinia ppoż' });
    await userEvent.click(restore());
    await screen.findByText(/Nie udało się zapisać zmiany/);
    await userEvent.click(restore());
    expect(await screen.findByText('Nie masz uprawnień do tej zmiany.')).toBeTruthy();
    await userEvent.click(restore());
    expect(await screen.findByText(/Nie udało się zapisać zmiany/)).toBeTruthy();
    await userEvent.click(restore());
    await waitFor(() => {
      expect(headers).toBe(2);
    });
    const keys = fake.calls(`POST ${BASE}/procedures/${PPOZ_ID}/restore`).map((sent) => sent.headers.get('Idempotency-Key'));
    expect(keys[1]).not.toBe(keys[0]);
  });
});
