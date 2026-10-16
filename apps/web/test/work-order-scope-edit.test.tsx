import type { CurrentSession, ProcedureList, ScopeItem, ServiceItem } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER, ORDER_ID, scopeItem, workOrderRoutes } from './work-order-api.ts';

const PATH = `/work-orders/${ORDER_ID}`;
const BASE = `/api/v1/work-orders/${ORDER_ID}`;
const SCOPE = `${BASE}/scope-items`;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } });

const CATALOG: ServiceItem[] = [
  {
    code: 'charger_supply',
    name: 'Ładowarka klienta',
    category: 'equipment',
    parameterSetCode: 'charger_spec',
    procedureTemplateCodes: [],
  },
  {
    code: 'supply_installation',
    name: 'Instalacja zasilająca',
    category: 'installation',
    parameterSetCode: 'supply_circuit',
    procedureTemplateCodes: ['electrical_installation', 'osd'],
  },
  { code: 'measurements', name: 'Pomiary i odbiór', category: 'acceptance', parameterSetCode: null, procedureTemplateCodes: [] },
  { code: 'custom_service', name: 'Inna usługa (opis w zleceniu)', category: 'other', parameterSetCode: null, procedureTemplateCodes: [] },
];

const TEMPLATES = [
  {
    code: 'electrical_installation',
    name: 'Instalacja zasilająca',
    stages: [1, 2, 3].map((n) => ({ code: `s${String(n)}`, name: `Etap ${String(n)}` })),
  },
  { code: 'osd', name: 'Uzgodnienia z OSD', stages: [1, 2].map((n) => ({ code: `o${String(n)}`, name: `Krok ${String(n)}` })) },
];

const CHARGER = scopeItem(1, { name: 'Ładowarka klienta' });
const MEASUREMENTS = scopeItem(3, { name: 'Pomiary i odbiór' });

const stage = (n: number): ProcedureList['items'][number]['stages'][number] => ({
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
});

const procedure = (code: string, name: string, sourceScopeItemId?: string, stages = 2): ProcedureList['items'][number] => ({
  id: `01968f3e-0000-7000-8000-0000000a0${String(code.length)}${String(name.length)}`,
  code,
  name,
  position: 1,
  progress: { done: 0, total: stages },
  stages: Array.from({ length: stages }, (_, index) => stage(index + 1)),
  ...(sourceScopeItemId === undefined ? {} : { sourceScopeItemId }),
});

interface Options {
  readonly items?: ScopeItem[];
  readonly session?: CurrentSession;
  readonly status?: string;
  readonly procedures?: ProcedureList;
  readonly extra?: Record<string, Handler>;
}

function api(options: Options = {}) {
  const items = options.items ?? [CHARGER, MEASUREMENTS];
  const header = {
    ...HEADER,
    status: options.status ?? 'in_progress',
    ...(options.status === 'settled' ? { allowedTransitions: [] } : {}),
  };
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, options.session ?? ACTIVE_SESSION),
    ...workOrderRoutes(ORDER_ID, {
      header: () => json(200, header, { ETag: '"3"' }),
      scope: () => json(200, { items }),
      procedures: () => json(200, options.procedures ?? { items: [], openStageCount: 0 }),
    }),
    'GET /api/v1/catalog/service-items': () => json(200, { items: CATALOG, nextCursor: null }),
    'GET /api/v1/catalog/procedure-templates': () => json(200, { items: TEMPLATES, nextCursor: null }),
    ...options.extra,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const scopeRegion = () => within(screen.getByRole('region', { name: /^Zakres/ }));

async function startEditing() {
  await userEvent.click(await screen.findByRole('button', { name: 'Edytuj zakres' }));
  return screen.findByRole('heading', { level: 2, name: /^Zakres — edycja/ });
}

async function openAdd() {
  await startEditing();
  await userEvent.click(scopeRegion().getByRole('button', { name: /Dodaj pozycję…/ }));
  return within(await screen.findByRole('dialog', { name: 'Dodaj pozycję zakresu' }));
}

describe('W-06 (c) "Edytuj zakres" — the mode and the rights (EVM-035 AC6, AC8)', () => {
  it('EVM-035 AC8 Tylko odczyt does not see "Edytuj zakres"; Administrator and Editor switch the section into the mode of editing', async () => {
    await renderPanel(PATH, api({ session: roleSession('read_only') }));
    await screen.findByRole('heading', { level: 2, name: 'Zakres (2 pozycje)' });
    expect(screen.queryByRole('button', { name: 'Edytuj zakres' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Akcje pozycji/ })).toBeNull();
  });

  it('EVM-035 AC8 the mode moves the focus to its heading, lists the items with their menus and "Zakończ edycję" gives the focus back', async () => {
    await renderPanel(PATH, api({ session: roleSession('editor') }));
    const heading = await startEditing();
    expect(heading.textContent).toBe('Zakres — edycja (2 pozycje)');
    expect(document.activeElement).toBe(heading);
    expect(scopeRegion().getByText('Każda zmiana zapisuje się od razu.')).toBeTruthy();
    expect(scopeRegion().getByRole('button', { name: 'Akcje pozycji: Ładowarka klienta' })).toBeTruthy();
    await userEvent.click(scopeRegion().getByRole('button', { name: 'Zakończ edycję' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edytuj zakres' }));
    expect(screen.queryByRole('button', { name: /^Akcje pozycji/ })).toBeNull();
  });

  it('EVM-035 AC6 a closed order has "Edytuj zakres" disabled with the reason', async () => {
    await renderPanel(PATH, api({ status: 'settled' }));
    const button = await screen.findByRole('button', { name: 'Edytuj zakres' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe('Zlecenie jest rozliczone — zakres zmienisz po przywróceniu zlecenia.');
    await userEvent.click(button);
    expect(screen.queryByRole('heading', { name: /^Zakres — edycja/ })).toBeNull();
  });

  it('EVM-035 AC1 offline "Edytuj zakres" is disabled with the reason; the empty scope offers the button', async () => {
    await renderPanel(PATH, api({ items: [] }));
    expect(await screen.findByText('Zlecenie nie ma jeszcze pozycji zakresu.')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Edytuj zakres' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    await waitFor(() => {
      expect(button.getAttribute('aria-disabled')).toBe('true');
    });
    expect(button.getAttribute('title')).toBe('Zmienisz po powrocie połączenia.');
  });
});

describe('W-06 (c) "Dodaj pozycję zakresu" (EVM-035 AC2, AC4, AC5)', () => {
  it('EVM-035 AC2 the item and the processes it brings are sent in one request; a process already in the order is told, not offered', async () => {
    let scopeReads = 0;
    const created: ScopeItem = { ...scopeItem(3, { code: 'supply_installation', name: 'Instalacja zasilająca' }), id: 'x' };
    const fake = api({
      procedures: { items: [procedure('osd', 'Uzgodnienia z OSD')], openStageCount: 2 },
      extra: {
        [`POST ${SCOPE}`]: (request) => {
          const body = parseBody(request.body) as { id: string };
          return json(201, { item: { ...created, id: body.id }, addedProcedureCodes: ['electrical_installation'] }, { ETag: '"1"' });
        },
      },
    });
    fake.set(`GET ${SCOPE}`, () => {
      scopeReads += 1;
      return json(200, { items: scopeReads === 1 ? [CHARGER] : [CHARGER, created] });
    });
    await renderPanel(PATH, fake);
    const dialog = await openAdd();
    // the catalogue is grouped by category (Select with optgroups)
    await waitFor(() => {
      expect(dialog.getByRole('group', { name: 'Instalacja i montaż' })).toBeTruthy();
    });
    await userEvent.selectOptions(dialog.getByLabelText('Pozycja z katalogu'), 'supply_installation');
    // the typed controls of the set, with the hint of the technical parameters
    expect(dialog.getByText('Parametry to dane techniczne — nie wpisuj PPE, numerów liczników ani nazwisk.')).toBeTruthy();
    await userEvent.click(within(dialog.getByRole('group', { name: 'Obwód dedykowany' })).getByRole('radio', { name: 'Tak' }));
    // processes: one to add (with the number of stages), one already there
    const group = within(dialog.getByRole('group', { name: 'Procesy z tą pozycją' }));
    expect(group.getByRole('checkbox', { name: /Instalacja zasilająca/ })).toHaveProperty('checked', true);
    expect(group.getByText('3 etapy „Do zrobienia”')).toBeTruthy();
    expect(group.getByText('Uzgodnienia z OSD — już jest w zleceniu, nie dodamy drugiego.')).toBeTruthy();
    expect(group.queryByRole('checkbox', { name: /Uzgodnienia z OSD/ })).toBeNull();
    // SR-DATA-02: the notes carry the hint of the shared rule
    expect(dialog.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeTruthy();

    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    await waitFor(() => {
      expect(fake.calls(`POST ${SCOPE}`)).toHaveLength(1);
    });
    const sent = fake.calls(`POST ${SCOPE}`)[0];
    const body = parseBody(sent?.body ?? '') as Record<string, unknown>;
    expect(body).toEqual({
      id: expect.stringMatching(UUID_V7) as string,
      catalogItemCode: 'supply_installation',
      parameters: { dedicatedCircuit: true },
      procedureCodes: ['electrical_installation'],
    });
    expect(sent?.headers.get('Idempotency-Key')).toMatch(UUID_V7);
    expect(sent?.headers.get('If-Match')).toBeNull();
    expect(await screen.findByText('Dodano pozycję „Instalacja zasilająca” i proces „Instalacja zasilająca”.')).toBeTruthy();
    // the list is read again and shows the new item at the end
    expect(await scopeRegion().findByText('Instalacja zasilająca')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Dodaj pozycję…');
  });

  it('EVM-035 AC2 an unchecked process is not sent; a retry of the same content keeps the id and the key', async () => {
    let calls = 0;
    const fake = api({
      extra: {
        [`POST ${SCOPE}`]: () => {
          calls += 1;
          return calls === 1 ? problem(500, 'internal_error') : json(201, { item: MEASUREMENTS, addedProcedureCodes: [] }, { ETag: '"1"' });
        },
      },
    });
    await renderPanel(PATH, fake);
    const dialog = await openAdd();
    await waitFor(() => {
      expect(dialog.getByRole('option', { name: 'Instalacja zasilająca' })).toBeTruthy();
    });
    await userEvent.selectOptions(dialog.getByLabelText('Pozycja z katalogu'), 'supply_installation');
    await userEvent.click(within(dialog.getByRole('group', { name: 'Obwód dedykowany' })).getByRole('radio', { name: 'Tak' }));
    await userEvent.click(dialog.getByRole('checkbox', { name: /Instalacja zasilająca/ }));
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    expect((await dialog.findByRole('alert')).textContent).toContain('Nie udało się dodać pozycji.');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    await waitFor(() => {
      expect(fake.calls(`POST ${SCOPE}`)).toHaveLength(2);
    });
    const [first, second] = fake.calls(`POST ${SCOPE}`);
    expect(parseBody(first?.body ?? '')).toMatchObject({ procedureCodes: ['osd'] });
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect((parseBody(second?.body ?? '') as { id: string }).id).toBe((parseBody(first?.body ?? '') as { id: string }).id);
    expect(await screen.findByText('Dodano pozycję „Instalacja zasilająca”.')).toBeTruthy();
  });

  it('EVM-035 AC4 a value out of the range and a missing required field are told under the field and nothing is sent', async () => {
    const fake = api();
    await renderPanel(PATH, fake);
    const dialog = await openAdd();
    await waitFor(() => {
      expect(dialog.getByRole('option', { name: 'Ładowarka klienta' })).toBeTruthy();
    });
    await userEvent.selectOptions(dialog.getByLabelText('Pozycja z katalogu'), 'charger_supply');
    await userEvent.type(dialog.getByLabelText('Producent (opcjonalnie)'), 'Firma Testowa');
    await userEvent.type(dialog.getByLabelText('Moc ładowarki'), '1500');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    expect(await dialog.findByText('Wartość spoza zakresu — dozwolone większe od 0 i nie więcej niż 1000.')).toBeTruthy();
    expect(dialog.getByText('Wybierz wartość.')).toBeTruthy();
    expect(fake.calls(`POST ${SCOPE}`)).toHaveLength(0);
    // "abc" is not a number
    await userEvent.clear(dialog.getByLabelText('Moc ładowarki'));
    await userEvent.type(dialog.getByLabelText('Moc ładowarki'), 'abc');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    expect(await dialog.findByText('Podaj liczbę, np. 18.')).toBeTruthy();
  });

  it('EVM-035 AC4 AC for charger_spec needs the phases; DC must not have them; numbers accept a comma', async () => {
    const fake = api({ extra: { [`POST ${SCOPE}`]: () => json(201, { item: CHARGER, addedProcedureCodes: [] }, { ETag: '"1"' }) } });
    await renderPanel(PATH, fake);
    const dialog = await openAdd();
    await waitFor(() => {
      expect(dialog.getByRole('option', { name: 'Ładowarka klienta' })).toBeTruthy();
    });
    await userEvent.selectOptions(dialog.getByLabelText('Pozycja z katalogu'), 'charger_supply');
    await userEvent.selectOptions(dialog.getByLabelText('Prąd'), 'ac');
    await userEvent.type(dialog.getByLabelText('Moc ładowarki'), '7,4');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    expect(await dialog.findByText('Dla prądu AC podaj liczbę faz.')).toBeTruthy();
    await userEvent.selectOptions(dialog.getByLabelText('Prąd'), 'dc');
    await userEvent.selectOptions(dialog.getByLabelText('Liczba faz (opcjonalnie)'), '3');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    expect(await dialog.findByText('Dla prądu DC nie podajemy liczby faz.')).toBeTruthy();
    await userEvent.selectOptions(dialog.getByLabelText('Prąd'), 'ac');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    await waitFor(() => {
      expect(parseBody(fake.calls(`POST ${SCOPE}`)[0]?.body ?? '')).toMatchObject({
        parameters: { currentType: 'ac', powerKw: 7.4, phases: 3 },
      });
    });
  });

  it('EVM-035 AC4 "Inna usługa" asks for the description (required), sends it as the notes and has no parameters and no processes', async () => {
    const fake = api({ extra: { [`POST ${SCOPE}`]: () => json(201, { item: MEASUREMENTS, addedProcedureCodes: [] }, { ETag: '"1"' }) } });
    await renderPanel(PATH, fake);
    const dialog = await openAdd();
    await waitFor(() => {
      expect(dialog.getByRole('option', { name: 'Inna usługa (opis w zleceniu)' })).toBeTruthy();
    });
    await userEvent.selectOptions(dialog.getByLabelText('Pozycja z katalogu'), 'custom_service');
    expect(dialog.queryByText('Parametry techniczne')).toBeNull();
    expect(dialog.getByText('Ta pozycja nie wnosi procesów.')).toBeTruthy();
    expect(dialog.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    expect(await dialog.findByText('Opisz usługę.')).toBeTruthy();
    expect(fake.calls(`POST ${SCOPE}`)).toHaveLength(0);
    await userEvent.type(dialog.getByLabelText('Opis usługi'), 'Wymiana zabezpieczenia w rozdzielnicy garażowej');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    await waitFor(() => {
      expect(parseBody(fake.calls(`POST ${SCOPE}`)[0]?.body ?? '')).toMatchObject({
        catalogItemCode: 'custom_service',
        notes: 'Wymiana zabezpieczenia w rozdzielnicy garażowej',
        procedureCodes: [],
      });
    });
    expect(parseBody(fake.calls(`POST ${SCOPE}`)[0]?.body ?? '')).not.toHaveProperty('parameters');
  });

  it('EVM-035 AC4 400 validation_failed of the set is told as a mismatch and the typed data stays', async () => {
    const fake = api({
      extra: {
        [`POST ${SCOPE}`]: () => problem(400, 'validation_failed', { errors: [{ pointer: '/parameters/cableLengthM', code: 'too_big' }] }),
      },
    });
    await renderPanel(PATH, fake);
    const dialog = await openAdd();
    await waitFor(() => {
      expect(dialog.getByRole('option', { name: 'Instalacja zasilająca' })).toBeTruthy();
    });
    await userEvent.selectOptions(dialog.getByLabelText('Pozycja z katalogu'), 'supply_installation');
    await userEvent.click(within(dialog.getByRole('group', { name: 'Obwód dedykowany' })).getByRole('radio', { name: 'Tak' }));
    await userEvent.type(dialog.getByLabelText('Długość kabla (opcjonalnie)'), '18');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    expect((await dialog.findByRole('alert')).textContent).toBe(
      'Nie dodano pozycji — dane nie pasują do zestawu. Odśwież zlecenie i spróbuj ponownie.',
    );
    expect(dialog.getByLabelText<HTMLInputElement>('Długość kabla (opcjonalnie)').value).toBe('18');
  });

  it('EVM-035 AC5 at 50 items "Dodaj pozycję…" is disabled with the limit; a race ends in 422 limit_exceeded with the message', async () => {
    const fifty = Array.from({ length: 50 }, (_, index) => scopeItem(index + 1, { name: `Pozycja ${String(index + 1)}` }));
    await renderPanel(PATH, api({ items: fifty }));
    await startEditing();
    const add = scopeRegion().getByRole('button', { name: /Dodaj pozycję…/ });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('title')).toBe('Zlecenie ma już 50 pozycji zakresu — to limit.');
  });

  it('EVM-035 AC5 422 limit_exceeded from a race is told in the dialog', async () => {
    const fake = api({
      extra: {
        [`POST ${SCOPE}`]: () => problem(422, 'limit_exceeded', { errors: [{ pointer: '', code: 'too_many_scope_items' }] }),
      },
    });
    await renderPanel(PATH, fake);
    const dialog = await openAdd();
    await waitFor(() => {
      expect(dialog.getByRole('option', { name: 'Pomiary i odbiór' })).toBeTruthy();
    });
    await userEvent.selectOptions(dialog.getByLabelText('Pozycja z katalogu'), 'measurements');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    expect((await dialog.findByRole('alert')).textContent).toBe(
      'Nie dodano pozycji — zlecenie ma już 50 pozycji zakresu. Usuń zbędną pozycję albo opisz zakres w notatkach istniejącej.',
    );
  });

  it('EVM-035 AC6 409 work_order_closed from another tab is told in the dialog and the save is disabled', async () => {
    const fake = api({ extra: { [`POST ${SCOPE}`]: () => problem(409, 'work_order_closed') } });
    await renderPanel(PATH, fake);
    const dialog = await openAdd();
    await waitFor(() => {
      expect(dialog.getByRole('option', { name: 'Pomiary i odbiór' })).toBeTruthy();
    });
    await userEvent.selectOptions(dialog.getByLabelText('Pozycja z katalogu'), 'measurements');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    expect((await dialog.findByRole('alert')).textContent).toContain('Zlecenie jest już rozliczone');
    expect(dialog.getByRole('button', { name: 'Dodaj pozycję' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('EVM-035 AC2 a failure of the catalogue is told with "Spróbuj ponownie"; the dialog has no accessibility violations', async () => {
    let catalog = 0;
    const fake = api();
    fake.set('GET /api/v1/catalog/service-items', () => {
      catalog += 1;
      return catalog === 1 ? problem(500, 'internal_error') : json(200, { items: CATALOG, nextCursor: null });
    });
    await renderPanel(PATH, fake);
    const dialog = await openAdd();
    expect(await dialog.findByText('Nie udało się wczytać katalogu usług.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Spróbuj ponownie' }));
    await waitFor(() => {
      expect(dialog.getByRole('option', { name: 'Pomiary i odbiór' })).toBeTruthy();
    });
    await userEvent.selectOptions(dialog.getByLabelText('Pozycja z katalogu'), 'supply_installation');
    expect(await axeViolations(screen.getByRole('dialog', { name: 'Dodaj pozycję zakresu' }))).toEqual([]);
  });
});

describe('W-06 (c) "Edytuj parametry" (EVM-035 AC4, AC8)', () => {
  const SUPPLY = scopeItem(2, { name: 'Instalacja zasilająca', version: 4 });

  async function openEdit(name: string, entry: string) {
    await startEditing();
    await userEvent.click(scopeRegion().getByRole('button', { name: `Akcje pozycji: ${name}` }));
    await userEvent.click(screen.getByRole('menuitem', { name: entry }));
  }

  it('EVM-035 AC4 the menu names the edit by the item; the dialog is filled and sends the changed parameters with If-Match of the item', async () => {
    const saved: ScopeItem = { ...SUPPLY, parameters: { dedicatedCircuit: true, internalSupplyLine: true, cableLengthM: 18 }, version: 5 };
    const fake = api({
      items: [CHARGER, SUPPLY, MEASUREMENTS],
      extra: { [`PATCH ${SCOPE}/${SUPPLY.id}`]: () => json(200, saved, { ETag: '"5"' }) },
    });
    await renderPanel(PATH, fake);
    await openEdit('Instalacja zasilająca', 'Edytuj parametry…');
    const dialog = within(await screen.findByRole('dialog', { name: 'Edytuj parametry: Instalacja zasilająca' }));
    expect(within(dialog.getByRole('group', { name: 'Obwód dedykowany' })).getByRole('radio', { name: 'Tak', checked: true })).toBeTruthy();
    await userEvent.type(dialog.getByLabelText('Długość kabla (opcjonalnie)'), '18');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz parametry' }));
    await waitFor(() => {
      expect(fake.calls(`PATCH ${SCOPE}/${SUPPLY.id}`)).toHaveLength(1);
    });
    const sent = fake.calls(`PATCH ${SCOPE}/${SUPPLY.id}`)[0];
    expect(parseBody(sent?.body ?? '')).toEqual({ parameters: { dedicatedCircuit: true, internalSupplyLine: true, cableLengthM: 18 } });
    expect(sent?.headers.get('If-Match')).toBe('"4"');
    expect(sent?.headers.get('Idempotency-Key')).toMatch(UUID_V7);
    expect(await screen.findByText('Zapisano parametry pozycji „Instalacja zasilająca”.')).toBeTruthy();
    expect(await scopeRegion().findByText(/kabel 18 m/)).toBeTruthy();
  });

  it('EVM-035 AC4 an item without a set has "Edytuj notatki…"; "Inna usługa" has "Edytuj opis…" with the description required', async () => {
    const custom = scopeItem(4, {
      code: 'custom_service',
      name: 'Inna usługa (opis w zleceniu)',
      notes: 'Wymiana zabezpieczenia',
      version: 2,
    });
    const fake = api({
      items: [MEASUREMENTS, custom],
      extra: { [`PATCH ${SCOPE}/${custom.id}`]: () => json(200, { ...custom, notes: 'Nowy opis', version: 3 }, { ETag: '"3"' }) },
    });
    await renderPanel(PATH, fake);
    await startEditing();
    await userEvent.click(scopeRegion().getByRole('button', { name: 'Akcje pozycji: Pomiary i odbiór' }));
    expect(screen.getByRole('menuitem', { name: 'Edytuj notatki…' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(scopeRegion().getByRole('button', { name: 'Akcje pozycji: Inna usługa (opis w zleceniu)' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj opis…' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edytuj opis: Inna usługa (opis w zleceniu)' }));
    expect(dialog.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeTruthy();
    await userEvent.clear(dialog.getByLabelText('Opis usługi'));
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz opis' }));
    expect(await dialog.findByText('Opisz usługę.')).toBeTruthy();
    await userEvent.type(dialog.getByLabelText('Opis usługi'), 'Nowy opis');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz opis' }));
    await waitFor(() => {
      expect(parseBody(fake.calls(`PATCH ${SCOPE}/${custom.id}`)[0]?.body ?? '')).toEqual({ notes: 'Nowy opis' });
    });
  });

  it('EVM-035 AC4 412 keeps the typed values, reads the scope again and shows "Aktualnie: …"; the next save uses the new version', async () => {
    let reads = 0;
    let attempts = 0;
    const fake = api({
      items: [SUPPLY],
      extra: {
        [`PATCH ${SCOPE}/${SUPPLY.id}`]: () => {
          attempts += 1;
          return attempts === 1 ? problem(412, 'version_conflict') : json(200, { ...SUPPLY, version: 7 });
        },
      },
    });
    fake.set(`GET ${SCOPE}`, () => {
      reads += 1;
      return json(200, {
        items: [reads === 1 ? SUPPLY : { ...SUPPLY, parameters: { dedicatedCircuit: false }, version: 6 }],
      });
    });
    await renderPanel(PATH, fake);
    await openEdit('Instalacja zasilająca', 'Edytuj parametry…');
    const dialog = within(await screen.findByRole('dialog', { name: 'Edytuj parametry: Instalacja zasilająca' }));
    await userEvent.type(dialog.getByLabelText('Długość kabla (opcjonalnie)'), '9');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz parametry' }));
    expect((await dialog.findByRole('alert')).textContent).toContain('Tę pozycję zmieniono w międzyczasie. Twoje zmiany zachowaliśmy');
    expect(await dialog.findByText(/Aktualnie: obwód niededykowany/)).toBeTruthy();
    expect(dialog.getByLabelText<HTMLInputElement>('Długość kabla (opcjonalnie)').value).toBe('9');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz parametry' }));
    await waitFor(() => {
      expect(fake.calls(`PATCH ${SCOPE}/${SUPPLY.id}`)).toHaveLength(2);
    });
    expect(fake.calls(`PATCH ${SCOPE}/${SUPPLY.id}`)[1]?.headers.get('If-Match')).toBe('"6"');
  });

  it('EVM-035 AC8 an item of another order (404) is told "Nie znaleziono pozycji. Odśwież zlecenie."', async () => {
    const fake = api({ items: [SUPPLY], extra: { [`PATCH ${SCOPE}/${SUPPLY.id}`]: () => problem(404, 'not_found') } });
    await renderPanel(PATH, fake);
    await openEdit('Instalacja zasilająca', 'Edytuj parametry…');
    const dialog = within(await screen.findByRole('dialog', { name: 'Edytuj parametry: Instalacja zasilająca' }));
    await userEvent.type(dialog.getByLabelText('Długość kabla (opcjonalnie)'), '9');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz parametry' }));
    expect(await dialog.findByText('Nie znaleziono pozycji. Odśwież zlecenie.')).toBeTruthy();
  });

  it('EVM-035 AC4 a note with markup is text and the dialog has no accessibility violations', async () => {
    const noted = { ...SUPPLY, notes: '<b onclick=alert(1)>x</b>' };
    await renderPanel(PATH, api({ items: [noted] }));
    expect(await screen.findByText(/<b onclick=alert\(1\)>x<\/b>/)).toBeTruthy();
    expect(document.querySelector('main b')).toBeNull();
    await openEdit('Instalacja zasilająca', 'Edytuj parametry…');
    expect(await axeViolations(await screen.findByRole('dialog'))).toEqual([]);
  });
});

describe('W-06 (c) "Usuń pozycję" (EVM-035 AC3, AC6, AC8)', () => {
  const SUPPLY = scopeItem(2, { name: 'Instalacja zasilająca', version: 4 });

  async function openRemove(name: string) {
    await startEditing();
    await userEvent.click(scopeRegion().getByRole('button', { name: `Akcje pozycji: ${name}` }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń pozycję…' }));
    return screen.findByRole('alertdialog', { name: `Usunąć pozycję „${name}”?` });
  }

  const withProcesses: ProcedureList = {
    items: [procedure('electrical_installation', 'Instalacja zasilająca', SUPPLY.id, 3), procedure('osd', 'Uzgodnienia z OSD')],
    openStageCount: 3,
  };

  it('EVM-035 AC3 the confirmation names the processes that stay and where to remove the stages; "Anuluj" has the focus', async () => {
    const fake = api({ items: [CHARGER, SUPPLY], procedures: withProcesses });
    await renderPanel(PATH, fake);
    const dialog = within(await openRemove('Instalacja zasilająca'));
    expect(dialog.getByText('Pozycja zniknie z zakresu zlecenia.')).toBeTruthy();
    expect(dialog.getByText('Procesy dodane z tą pozycją zostają: Instalacja zasilająca (3 etapy).')).toBeTruthy();
    expect(dialog.getByText('Zbędne etapy oznacz jako „Nie dotyczy” w menu statusu etapu.')).toBeTruthy();
    expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));
    expect(fake.calls(`DELETE ${SCOPE}/${SUPPLY.id}`)).toHaveLength(0);
  });

  it('EVM-035 AC3 the item is removed with If-Match, the list is read again, the processes stay and the focus goes to the next menu', async () => {
    let reads = 0;
    const fake = api({
      items: [CHARGER, SUPPLY],
      procedures: withProcesses,
      extra: { [`DELETE ${SCOPE}/${SUPPLY.id}`]: () => new Response(null, { status: 204 }) },
    });
    fake.set(`GET ${SCOPE}`, () => {
      reads += 1;
      return json(200, { items: reads === 1 ? [CHARGER, SUPPLY] : [CHARGER] });
    });
    await renderPanel(PATH, fake);
    const dialog = within(await openRemove('Instalacja zasilająca'));
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń pozycję' }));
    await waitFor(() => {
      expect(fake.calls(`DELETE ${SCOPE}/${SUPPLY.id}`)).toHaveLength(1);
    });
    const sent = fake.calls(`DELETE ${SCOPE}/${SUPPLY.id}`)[0];
    expect(sent?.headers.get('If-Match')).toBe('"4"');
    expect(sent?.headers.get('Idempotency-Key')).toMatch(UUID_V7);
    expect(await screen.findByText('Usunięto pozycję „Instalacja zasilająca”.')).toBeTruthy();
    await waitFor(() => {
      expect(scopeRegion().queryByText('Instalacja zasilająca')).toBeNull();
    });
    expect(scopeRegion().getByRole('heading', { level: 2, name: 'Zakres — edycja (1 pozycja)' })).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(scopeRegion().getByRole('button', { name: 'Akcje pozycji: Ładowarka klienta' }));
    });
    // the processes are not touched: no request to them
    expect(fake.calls(`DELETE ${BASE}/procedures`)).toHaveLength(0);
  });

  it('EVM-035 AC6 AC8 412, 404 and 409 are told in the confirmation', async () => {
    const answers = [problem(412, 'version_conflict'), problem(404, 'not_found'), problem(409, 'work_order_closed')];
    let call = 0;
    const fake = api({
      items: [SUPPLY],
      extra: { [`DELETE ${SCOPE}/${SUPPLY.id}`]: () => answers[call++] ?? problem(500, 'internal_error') },
    });
    await renderPanel(PATH, fake);
    const dialog = within(await openRemove('Instalacja zasilająca'));
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń pozycję' }));
    expect(await dialog.findByText('Tę pozycję zmieniono w międzyczasie. Sprawdź jej aktualny stan i spróbuj ponownie.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń pozycję' }));
    expect(await dialog.findByText('Nie znaleziono pozycji. Odśwież zlecenie.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń pozycję' }));
    expect(await dialog.findByText(/Zlecenie jest już rozliczone/)).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Usuń pozycję' }).getAttribute('aria-disabled')).toBe('true');
    expect(await axeViolations(screen.getByRole('alertdialog'))).toEqual([]);
  });
});
