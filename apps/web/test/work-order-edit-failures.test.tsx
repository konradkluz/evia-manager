import type { ScopeItem, ServiceItem, WorkOrderDetails } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER, ORDER_ID, scopeItem, workOrderRoutes } from './work-order-api.ts';

const userEvent = userEventDefault.setup({ delay: null });
const PATH = `/work-orders/${ORDER_ID}`;
const BASE = `/api/v1/work-orders/${ORDER_ID}`;
const SCOPE = `${BASE}/scope-items`;
const ORDER: WorkOrderDetails = { ...HEADER, description: 'Opis', plannedDate: '2026-10-20' };
const SUPPLY: ScopeItem = scopeItem(2, { name: 'Instalacja zasilająca', version: 4 });
const CATALOG: ServiceItem[] = [
  { code: 'measurements', name: 'Pomiary i odbiór', category: 'acceptance', parameterSetCode: null, procedureTemplateCodes: [] },
  {
    code: 'supply_installation',
    name: 'Instalacja zasilająca',
    category: 'installation',
    parameterSetCode: 'supply_circuit',
    procedureTemplateCodes: ['electrical_installation', 'osd'],
  },
];
const TEMPLATES = [
  { code: 'electrical_installation', name: 'Instalacja zasilająca', stages: [] },
  { code: 'osd', name: 'Uzgodnienia z OSD', stages: [] },
];

afterEach(() => {
  vi.restoreAllMocks();
});

function api(extra: Record<string, Handler>) {
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, ACTIVE_SESSION),
    ...workOrderRoutes(ORDER_ID, {
      header: () => json(200, ORDER, { ETag: '"3"' }),
      scope: () => json(200, { items: [SUPPLY] }),
    }),
    'GET /api/v1/catalog/service-items': () => json(200, { items: CATALOG, nextCursor: null }),
    'GET /api/v1/catalog/procedure-templates': () => json(200, { items: TEMPLATES, nextCursor: null }),
    ...extra,
  });
}

/** The answers every dialog tells in words of its own; the shared ones are checked once for each of the three dialogs. */
const COMMON: ReadonlyArray<readonly [string, () => Response, RegExp]> = [
  ['403', () => problem(403, 'forbidden'), /Nie masz uprawnień do tej zmiany\./],
  ['429', () => problem(429, 'rate_limited', {}, { 'Retry-After': '45' }), /Zbyt wiele zapytań\. Spróbuj ponownie za 45 s\./],
  ['418', () => problem(418, 'teapot'), /kod: abcdef01/],
  ['502', () => problem(502, 'bad_gateway'), /Nie udało się/],
];

async function openOrderDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj dane zlecenia…' }));
  return within(await screen.findByRole('dialog', { name: 'Edytuj dane zlecenia' }));
}

async function openAddDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Edytuj zakres' }));
  await userEvent.click(await screen.findByRole('button', { name: /Dodaj pozycję…/ }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Dodaj pozycję zakresu' }));
  await waitFor(() => {
    expect(dialog.getByRole('option', { name: 'Pomiary i odbiór' })).toBeTruthy();
  });
  await userEvent.selectOptions(dialog.getByLabelText('Pozycja z katalogu'), 'measurements');
  return dialog;
}

async function openEditDialog() {
  const start = screen.queryByRole('button', { name: 'Edytuj zakres' });
  if (start !== null) await userEvent.click(start);
  await userEvent.click(await screen.findByRole('button', { name: 'Akcje pozycji: Instalacja zasilająca' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj parametry…' }));
  return within(await screen.findByRole('dialog', { name: 'Edytuj parametry: Instalacja zasilająca' }));
}

async function openRemoveDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Edytuj zakres' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Akcje pozycji: Instalacja zasilająca' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń pozycję…' }));
  return within(await screen.findByRole('alertdialog'));
}

describe('failures of the dialog "Edytuj dane zlecenia" (EVM-035 AC1, AC8)', () => {
  it.each(COMMON)('EVM-035 AC1 the answer %s is told in the dialog and the typed data stays', async (_name, answer, text) => {
    await renderPanel(PATH, api({ [`PATCH ${BASE}`]: answer }));
    const dialog = await openOrderDialog();
    await userEvent.type(dialog.getByLabelText('Tytuł'), '!');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    await waitFor(() => {
      expect(dialog.getByRole('alert').textContent).toMatch(text);
    });
    expect(dialog.getByLabelText<HTMLInputElement>('Tytuł').value).toBe('Garaż — pełny proces!');
  });

  it('EVM-035 AC1 404 says the order is gone; the limits of the text fields are told before sending', async () => {
    const fake = api({ [`PATCH ${BASE}`]: () => problem(404, 'not_found') });
    await renderPanel(PATH, fake);
    const dialog = await openOrderDialog();
    fireEvent.change(dialog.getByLabelText('Tytuł'), { target: { value: 'x'.repeat(201) } });
    fireEvent.change(dialog.getByLabelText('Opis (opcjonalnie)'), { target: { value: 'y'.repeat(2001) } });
    fireEvent.change(dialog.getByLabelText('Planowana data (opcjonalnie)'), { target: { value: '1999-01-01' } });
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    expect(await dialog.findByText('Tytuł może mieć najwyżej 200 znaków.')).toBeTruthy();
    expect(dialog.getByText('Opis może mieć najwyżej 2000 znaków.')).toBeTruthy();
    expect(dialog.getByText('Wybierz datę z lat 2000–2100.')).toBeTruthy();
    expect(fake.calls(`PATCH ${BASE}`)).toHaveLength(0);
    fireEvent.change(dialog.getByLabelText('Tytuł'), { target: { value: 'Nowy' } });
    fireEvent.change(dialog.getByLabelText('Opis (opcjonalnie)'), { target: { value: 'Opis' } });
    fireEvent.change(dialog.getByLabelText('Planowana data (opcjonalnie)'), { target: { value: '2026-10-20' } });
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    expect(await dialog.findByText('Nie znaleziono zlecenia. Mogło zostać usunięte.')).toBeTruthy();
  });

  it('EVM-035 AC1 the fields the server points at are told under them; an unknown pointer is a failure of the save', async () => {
    let call = 0;
    const answers = [
      problem(400, 'validation_failed', {
        errors: [
          { pointer: '/title', code: 'required' },
          { pointer: '/description', code: 'invalid_characters' },
          { pointer: '/plannedDate', code: 'out_of_range' },
        ],
      }),
      problem(400, 'validation_failed', { errors: [{ pointer: '/title', code: 'invalid_characters' }] }),
      problem(400, 'validation_failed', { errors: [{ pointer: '/other', code: 'x' }] }),
    ];
    await renderPanel(PATH, api({ [`PATCH ${BASE}`]: () => answers[call++] ?? problem(500, 'internal_error') }));
    const dialog = await openOrderDialog();
    await userEvent.type(dialog.getByLabelText('Tytuł'), '!');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    expect(await dialog.findByText('Podaj tytuł zlecenia.')).toBeTruthy();
    expect(dialog.getByText('Pole zawiera niedozwolone znaki.')).toBeTruthy();
    expect(dialog.getByText('Wybierz datę z lat 2000–2100.')).toBeTruthy();
    await userEvent.type(dialog.getByLabelText('Tytuł'), '?');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    await waitFor(() => {
      expect(dialog.getAllByText('Pole zawiera niedozwolone znaki.').length).toBeGreaterThan(0);
    });
    await userEvent.type(dialog.getByLabelText('Tytuł'), '?');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    expect(await dialog.findByText('Nie udało się zapisać zmian zlecenia. Sprawdź połączenie i spróbuj ponownie.')).toBeTruthy();
  });

  it('EVM-035 AC1 a conflict shows "Aktualnie: brak" for a field cleared meanwhile and the name of a new coordinator', async () => {
    const PETR = '22222222-2222-4222-8222-222222222222';
    let reads = 0;
    const fresh: WorkOrderDetails = {
      ...HEADER,
      coordinator: { id: PETR, displayName: 'Piotr Testowy' },
      version: 4,
    };
    const fake = api({ [`PATCH ${BASE}`]: () => problem(412, 'version_conflict') });
    fake.set(`GET ${BASE}`, () => {
      reads += 1;
      return reads === 1 ? json(200, ORDER, { ETag: '"3"' }) : json(200, fresh, { ETag: '"4"' });
    });
    fake.set('GET /api/v1/users/assignable', () =>
      json(200, {
        items: [
          { id: PETR, displayName: 'Piotr Testowy' },
          { id: ACTIVE_SESSION.user.id, displayName: 'Anna Testowa' },
        ],
        nextCursor: null,
      }),
    );
    await renderPanel(PATH, fake);
    const dialog = await openOrderDialog();
    await userEvent.type(dialog.getByLabelText('Tytuł'), '!');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    expect(await dialog.findByText(/Aktualnie: Piotr Testowy/)).toBeTruthy();
    expect(dialog.getAllByText(/Aktualnie: brak/).length).toBe(2);
  });
});

describe('failures of the dialog "Dodaj pozycję zakresu" (EVM-035 AC2, AC4, AC5, AC8)', () => {
  const POST = `POST ${SCOPE}`;

  it.each(COMMON)('EVM-035 AC2 the answer %s is told in the dialog', async (_name, answer, text) => {
    await renderPanel(PATH, api({ [POST]: answer }));
    const dialog = await openAddDialog();
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    await waitFor(() => {
      expect(dialog.getByRole('alert').textContent).toMatch(text);
    });
  });

  it('EVM-035 AC2 404, a request in progress, a refused identifier and the limit of the processes are told', async () => {
    let call = 0;
    const answers = [
      problem(404, 'not_found'),
      problem(409, 'idempotency_in_progress'),
      problem(409, 'id_conflict'),
      problem(422, 'limit_exceeded', { errors: [{ pointer: '/procedureCodes', code: 'too_many_procedures' }] }),
    ];
    const fake = api({ [POST]: () => answers[call++] ?? problem(500, 'internal_error') });
    await renderPanel(PATH, fake);
    const dialog = await openAddDialog();
    const submit = () => userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    await submit();
    expect(await dialog.findByText('Nie znaleziono zlecenia. Odśwież stronę.')).toBeTruthy();
    await submit();
    expect(await dialog.findByText('Poprzednie żądanie jeszcze trwa. Spróbuj ponownie za chwilę.')).toBeTruthy();
    await submit();
    expect(await dialog.findByText(/Nie udało się dodać pozycji\. Spróbuj ponownie — nie dodamy jej dwa razy\./)).toBeTruthy();
    await submit();
    expect(await dialog.findByText(/zbyt wiele procesów/)).toBeTruthy();
    // a refused identifier is not sent again: the next attempt carries a new one
    const ids = fake.calls(POST).map((entry) => (parseBody(entry.body) as { id: string }).id);
    expect(ids[3]).not.toBe(ids[2]);
  });

  it('EVM-035 AC4 the notes are checked before sending: too long, forbidden characters; the server may point at the item and the notes', async () => {
    let call = 0;
    const answers = [
      problem(400, 'validation_failed', { errors: [{ pointer: '/catalogItemCode', code: 'unknown_catalog_item' }] }),
      problem(400, 'validation_failed', { errors: [{ pointer: '/notes', code: 'invalid_characters' }] }),
    ];
    const fake = api({ [POST]: () => answers[call++] ?? problem(500, 'internal_error') });
    await renderPanel(PATH, fake);
    const dialog = await openAddDialog();
    const submit = () => userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    fireEvent.change(dialog.getByLabelText('Notatki do pozycji (opcjonalnie)'), { target: { value: 'x'.repeat(1001) } });
    await submit();
    expect(await dialog.findByText('Tekst może mieć najwyżej 1000 znaków.')).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('Notatki do pozycji (opcjonalnie)'), { target: { value: 'a​b' } });
    await submit();
    expect(await dialog.findByText('Tekst zawiera niedozwolone znaki.')).toBeTruthy();
    expect(fake.calls(POST)).toHaveLength(0);
    // a newline is allowed in the multi-line field
    fireEvent.change(dialog.getByLabelText('Notatki do pozycji (opcjonalnie)'), { target: { value: 'linia 1\nlinia 2' } });
    await submit();
    expect(await dialog.findByText('Ta pozycja nie jest już dostępna w katalogu. Wybierz inną.')).toBeTruthy();
    expect(parseBody(fake.calls(POST)[0]?.body ?? '')).toMatchObject({ notes: 'linia 1\nlinia 2' });
    await submit();
    expect(await dialog.findByText('Tekst zawiera niedozwolone znaki.')).toBeTruthy();
  });

  it('EVM-035 AC2 several processes are named in the toast and an item can be chosen again; the item must be chosen first', async () => {
    const fake = api({
      [POST]: () =>
        json(201, { item: { ...SUPPLY, version: 1 }, addedProcedureCodes: ['electrical_installation', 'osd'] }, { ETag: '"1"' }),
    });
    await renderPanel(PATH, fake);
    await userEvent.click(await screen.findByRole('button', { name: 'Edytuj zakres' }));
    await userEvent.click(await screen.findByRole('button', { name: /Dodaj pozycję…/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Dodaj pozycję zakresu' }));
    await waitFor(() => {
      expect(dialog.getByRole('option', { name: 'Pomiary i odbiór' })).toBeTruthy();
    });
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    expect(await dialog.findByText('Wybierz pozycję z katalogu.')).toBeTruthy();
    await userEvent.selectOptions(dialog.getByLabelText('Pozycja z katalogu'), 'supply_installation');
    await userEvent.click(within(dialog.getByRole('group', { name: 'Obwód dedykowany' })).getByRole('radio', { name: 'Nie' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj pozycję' }));
    expect(
      await screen.findByText('Dodano pozycję „Instalacja zasilająca” i procesy: Instalacja zasilająca, Uzgodnienia z OSD.'),
    ).toBeTruthy();
  });
});

describe('failures of the dialog "Edytuj parametry" (EVM-035 AC4, AC6, AC8)', () => {
  const PATCH = `PATCH ${SCOPE}/${SUPPLY.id}`;

  async function change(dialog: Awaited<ReturnType<typeof openEditDialog>>) {
    await userEvent.type(dialog.getByLabelText('Długość kabla (opcjonalnie)'), '9');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz parametry' }));
  }

  it.each(COMMON)('EVM-035 AC4 the answer %s is told in the dialog', async (_name, answer, text) => {
    await renderPanel(PATH, api({ [PATCH]: answer }));
    const dialog = await openEditDialog();
    await change(dialog);
    await waitFor(() => {
      expect(dialog.getByRole('alert').textContent).toMatch(text);
    });
  });

  it('EVM-035 AC6 409 work_order_closed disables the save; 400 of the set is told as a mismatch; notes are checked', async () => {
    let call = 0;
    const answers = [
      problem(400, 'validation_failed', { errors: [{ pointer: '/parameters/cableLengthM', code: 'too_big' }] }),
      problem(400, 'validation_failed', { errors: [{ pointer: '/notes', code: 'required' }] }),
      problem(409, 'work_order_closed'),
    ];
    const fake = api({ [PATCH]: () => answers[call++] ?? problem(500, 'internal_error') });
    await renderPanel(PATH, fake);
    const dialog = await openEditDialog();
    await change(dialog);
    expect(
      await dialog.findByText('Nie zapisano parametrów — dane nie pasują do zestawu. Odśwież zlecenie i spróbuj ponownie.'),
    ).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('Notatki do pozycji (opcjonalnie)'), { target: { value: 'x'.repeat(1001) } });
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz parametry' }));
    expect(await dialog.findByText('Tekst może mieć najwyżej 1000 znaków.')).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('Notatki do pozycji (opcjonalnie)'), { target: { value: 'a\u0007b' } });
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz parametry' }));
    expect(await dialog.findByText('Tekst zawiera niedozwolone znaki.')).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('Notatki do pozycji (opcjonalnie)'), { target: { value: 'Notatka' } });
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz parametry' }));
    expect(await dialog.findByText('Tekst zawiera niedozwolone znaki.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz parametry' }));
    expect(await dialog.findByText(/Zlecenie jest już/)).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Zapisz parametry' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('EVM-035 AC4 an untouched dialog sends nothing; a note with the comma number is the same value and sends only the notes', async () => {
    const fake = api({ [PATCH]: () => json(200, { ...SUPPLY, notes: 'Nota', version: 5 }) });
    await renderPanel(PATH, fake);
    let dialog = await openEditDialog();
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz parametry' }));
    expect(fake.calls(PATCH)).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    dialog = await openEditDialog();
    await userEvent.type(dialog.getByLabelText('Notatki do pozycji (opcjonalnie)'), 'Nota');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz parametry' }));
    await waitFor(() => {
      expect(parseBody(fake.calls(PATCH)[0]?.body ?? '')).toEqual({ notes: 'Nota' });
    });
  });
});

describe('failures of the confirmation "Usuń pozycję" (EVM-035 AC3, AC8)', () => {
  const DELETE = `DELETE ${SCOPE}/${SUPPLY.id}`;

  it.each(COMMON)('EVM-035 AC3 the answer %s is told in the confirmation', async (_name, answer, text) => {
    await renderPanel(PATH, api({ [DELETE]: answer }));
    const dialog = await openRemoveDialog();
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń pozycję' }));
    await waitFor(() => {
      expect(dialog.getByRole('alert').textContent).toMatch(text);
    });
  });

  it('EVM-035 AC3 an item without processes says only that it leaves the scope; the Editor learns who restores a closed order', async () => {
    await renderPanel(PATH, api({ [DELETE]: () => problem(409, 'work_order_closed') }));
    const dialog = await openRemoveDialog();
    expect(dialog.queryByText(/Procesy dodane z tą pozycją zostają/)).toBeNull();
    await userEvent.click(dialog.getByRole('button', { name: 'Usuń pozycję' }));
    expect(await dialog.findByText(/Zlecenie jest już/)).toBeTruthy();
  });
});
