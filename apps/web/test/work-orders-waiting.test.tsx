import type { WorkOrderList, WorkOrderListItem, WorkOrderWaiting } from '@evia/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';

// W-10 "Czekamy na…" (EVM-034 AC1–AC4, AC7, AC8): the columns "Czekamy na" and "Termin", the filter "dłużej niż X dni", the saved
// view "Czekamy na OSD > 14 dni" and the two sorts. The server counts the days and the due dates; the panel words them.
const LIST = 'GET /api/v1/work-orders';
const PATH = '/work-orders';
const ANNA = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa' };
const OSD_ID = '01968f3e-0000-7000-8000-00000000c001';

function order(index: number, overrides: Partial<WorkOrderListItem> = {}): WorkOrderListItem {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    number: `ZL-2026-${String(index).padStart(4, '0')}`,
    title: `Garaż — pełny proces ${String(index)}`,
    status: 'in_progress',
    coordinator: ANNA,
    createdAt: '2026-10-04T12:05:00.000Z',
    // EVM-056: no instalment invoiced ("—" in the column "Płatność", "brak wystawionych transz" at the end of the name of the row)
    payment: {
      state: 'none',
      invoicedCount: 0,
      invoicedTotal: { amountMinor: 0, currency: 'PLN' },
      overdueTotal: { amountMinor: 0, currency: 'PLN' },
    },
    waiting: null,
    nextDueDate: null,
    hasOverdueStage: false,
    ...overrides,
  };
}

const osdWait = (days: number, otherCount = 0, extra: Partial<WorkOrderWaiting> = {}): WorkOrderWaiting => ({
  waitingOn: 'party',
  party: { id: OSD_ID, displayName: 'Stoen Operator', kind: 'distribution_system_operator' },
  since: '2026-09-18',
  days,
  otherCount,
  ...extra,
});

const page = (items: WorkOrderListItem[], nextCursor: string | null = null): WorkOrderList => ({ items, nextCursor });
const ok =
  (items: WorkOrderListItem[] = [order(1)]): Handler =>
  () =>
    json(200, page(items));

function listApi(handler: Handler = ok(), session = ACTIVE_SESSION) {
  return activeSessionApi({ [SESSION_ROUTE]: () => json(200, session), [LIST]: handler });
}

const lastQuery = (api: ReturnType<typeof listApi>): URLSearchParams => api.calls(LIST).at(-1)?.query ?? new URLSearchParams();
// Cells of a row of W-10: Zlecenie, Klient, Lokalizacja, Status, Czekamy na, Termin (EVM-072 added the first two; "Opiekun" and "Utworzono" are lines of the first cell).
const WAITING = 4;
const DUE = 5;
const cellsOf = async (index = 0) => {
  const table = await screen.findByRole('table', { name: 'Lista zleceń' });
  const rows = within(table).getAllByRole('row').slice(1);
  return within(rows[index] as HTMLElement).getAllByRole('cell');
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('W-10 column "Czekamy na" (EVM-034 AC1)', () => {
  it('EVM-034 AC1 the longest wait is "Stoen Operator (OSD) · od 15 dni" with triangle-alert above 14 days and "+1" for the other', async () => {
    await renderPanel(PATH, listApi(ok([order(1, { waiting: osdWait(15, 1) })])));
    const cells = await cellsOf();
    const waiting = cells[WAITING] as HTMLElement;
    expect(waiting.textContent).toContain('Stoen Operator (OSD) · od 15 dni');
    expect(waiting.querySelector('svg')).not.toBeNull();
    expect(within(waiting).getByText('Czekamy dłużej niż 14 dni.')).toBeTruthy();
    expect(within(waiting).getByText('+1').getAttribute('aria-hidden')).toBe('true');
    expect(within(waiting).getByText('i jeszcze 1 oczekiwanie')).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-034 AC1 the customer is "Klient · od 3 dni"; 14 days and fewer carry no warning; "od dziś" and "od wczoraj" are words', async () => {
    const customer: WorkOrderWaiting = { waitingOn: 'customer', party: null, since: '2026-09-30', days: 3, otherCount: 0 };
    await renderPanel(
      PATH,
      listApi(
        ok([
          order(1, { waiting: customer }),
          order(2, { waiting: osdWait(14) }),
          order(3, { waiting: osdWait(0) }),
          order(4, { waiting: osdWait(1, 3) }),
        ]),
      ),
    );
    const first = await cellsOf(0);
    expect(within(first[WAITING] as HTMLElement).getByText('Klient · od 3 dni')).toBeTruthy();
    expect(first[WAITING]?.querySelector('svg')).toBeNull();
    expect((await cellsOf(1))[WAITING]?.querySelector('svg')).toBeNull();
    expect(within((await cellsOf(2))[WAITING] as HTMLElement).getByText('Stoen Operator (OSD) · od dziś')).toBeTruthy();
    const fourth = (await cellsOf(3))[WAITING] as HTMLElement;
    expect(fourth.textContent).toContain('Stoen Operator (OSD) · od wczoraj');
    expect(within(fourth).getByText('i jeszcze 3 oczekiwania')).toBeTruthy();
  });

  it('EVM-034 AC1 a kind this panel does not know shows the name only; a party that is not visible shows "Strona"; names are text', async () => {
    const unknownKind = osdWait(5, 0, { party: { id: OSD_ID, displayName: '<b>Nowy</b> Operator', kind: 'kind_of_a_newer_api' } });
    const hidden: WorkOrderWaiting = { waitingOn: 'party', party: null, since: '2026-09-30', days: 3, otherCount: 5 };
    await renderPanel(PATH, listApi(ok([order(1, { waiting: unknownKind }), order(2, { waiting: hidden })])));
    const first = (await cellsOf(0))[WAITING] as HTMLElement;
    expect(within(first).getByText('<b>Nowy</b> Operator · od 5 dni')).toBeTruthy();
    expect(first.querySelector('b')).toBeNull();
    expect(document.body.textContent).not.toContain('kind_of_a_newer_api');
    const second = (await cellsOf(1))[WAITING] as HTMLElement;
    expect(second.textContent).toContain('Strona · od 3 dni');
    expect(within(second).getByText('i jeszcze 5 oczekiwań')).toBeTruthy();
  });

  it('EVM-034 AC1 an order that waits for nobody shows a dash named "Brak oczekiwań"; the row says what it waits for only when it does', async () => {
    await renderPanel(
      PATH,
      listApi(ok([order(1), order(2, { waiting: osdWait(15, 1), nextDueDate: '2026-09-30', hasOverdueStage: true })])),
    );
    const first = (await cellsOf(0))[WAITING] as HTMLElement;
    expect(within(first).getByText('Brak oczekiwań')).toBeTruthy();
    expect(first.querySelector('[aria-hidden="true"]')?.textContent).toBe('—');
    const links = within(await screen.findByRole('table')).getAllByRole('link');
    expect(links[0]?.getAttribute('aria-label')).toBe(
      'ZL-2026-0001, Garaż — pełny proces 1, status: W realizacji, opiekun: Anna Testowa, utworzono 04.10.2026, brak wystawionych transz',
    );
    expect(links[1]?.getAttribute('aria-label')).toBe(
      'ZL-2026-0002, Garaż — pełny proces 2, status: W realizacji, opiekun: Anna Testowa, utworzono 04.10.2026, czekamy na: Stoen Operator (OSD), od 15 dni, termin: 30.09.2026, po terminie, brak wystawionych transz',
    );
  });

  it('EVM-034 AC1 an answer of an older server without the new fields is still a list (the fields are additive)', async () => {
    const old = order(1) as Partial<WorkOrderListItem>;
    delete old.waiting;
    delete old.nextDueDate;
    delete old.hasOverdueStage;
    await renderPanel(PATH, listApi(ok([old as WorkOrderListItem])));
    const cells = await cellsOf();
    expect(within(cells[WAITING] as HTMLElement).getByText('Brak oczekiwań')).toBeTruthy();
    expect(within(cells[DUE] as HTMLElement).getByText('Brak terminu')).toBeTruthy();
  });
});

describe('W-10 column "Termin" and the sorts (EVM-034 AC4)', () => {
  it('EVM-034 AC4 the nearest due date; a date that has passed has alarm-clock and a hidden sentence, a future one has neither', async () => {
    await renderPanel(
      PATH,
      listApi(
        ok([
          order(1, { nextDueDate: '2026-09-30', hasOverdueStage: true }),
          order(2, { nextDueDate: '2026-10-20', hasOverdueStage: false }),
        ]),
      ),
    );
    const late = (await cellsOf(0))[DUE] as HTMLElement;
    expect(late.textContent).toContain('30.09.2026');
    expect(late.querySelector('svg')).not.toBeNull();
    expect(within(late).getByText('Termin minął.')).toBeTruthy();
    const coming = (await cellsOf(1))[DUE] as HTMLElement;
    expect(coming.textContent).toContain('20.10.2026');
    expect(coming.querySelector('svg')).toBeNull();
  });

  it('EVM-034 AC4 "Najdłużej czekamy" and "Termin" are sorts of the list and mark their column (aria-sort, ascending)', async () => {
    const api = listApi();
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    const sort = screen.getByRole('combobox', { name: 'Sortuj' });
    await userEvent.selectOptions(sort, 'Najdłużej czekamy');
    await waitFor(() => {
      expect(lastQuery(api).get('sort')).toBe('longestWaitingSince');
    });
    expect(screen.getByRole('columnheader', { name: 'Czekamy na' }).getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('columnheader', { name: 'Zlecenie' }).hasAttribute('aria-sort')).toBe(false);
    await userEvent.selectOptions(sort, 'Termin');
    await waitFor(() => {
      expect(lastQuery(api).get('sort')).toBe('nextDueDate');
    });
    expect(screen.getByRole('columnheader', { name: 'Termin' }).getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('columnheader', { name: 'Czekamy na' }).hasAttribute('aria-sort')).toBe(false);
    // the sort stays in the memory of the tab — not in the address
    expect(history.location.search).toBe('');
  });
});

describe('W-10 filter "Czekamy na … dłużej niż X dni" (EVM-034 AC2)', () => {
  it('EVM-034 AC2 a kind of party and X go to the request; the address holds the kind and X and nothing else', async () => {
    const api = listApi();
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    expect(screen.queryByRole('textbox', { name: 'Dłużej niż' })).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Czekamy na' }), 'OSD');
    await waitFor(() => {
      expect(lastQuery(api).get('waitingOn')).toBe('party');
    });
    const query = lastQuery(api);
    expect(query.get('waitingOnPartyKind')).toBe('distribution_system_operator');
    expect(query.get('waitingLongerThanDays')).toBe('14');
    expect(query.get('view')).toBe('all_open');
    expect(history.location.search).toBe('?waitingOn=distribution_system_operator&waitingDays=14');
    expect(history.location.href).not.toContain(OSD_ID);
    expect(screen.getByRole('button', { name: 'Usuń filtr Czekamy na: OSD > 14 dni' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Dłużej niż' }).value).toBe('14');
  });

  it('EVM-034 AC2 X is changed in the field: 15 asks the server for 15 and the address follows', async () => {
    const api = listApi();
    const { history } = await renderPanel(`${PATH}?waitingOn=distribution_system_operator&waitingDays=14`, api);
    await screen.findByRole('table');
    expect(lastQuery(api).get('waitingLongerThanDays')).toBe('14');
    const field = screen.getByRole('textbox', { name: 'Dłużej niż' });
    await userEvent.clear(field);
    await userEvent.type(field, '15');
    await waitFor(() => {
      expect(lastQuery(api).get('waitingLongerThanDays')).toBe('15');
    });
    expect(history.location.search).toBe('?waitingOn=distribution_system_operator&waitingDays=15');
    expect(screen.getByRole('button', { name: 'Usuń filtr Czekamy na: OSD > 15 dni' })).toBeTruthy();
  });

  it('EVM-034 AC2 a value outside 1–365 or not a number is told under the field and is not sent', async () => {
    const api = listApi();
    await renderPanel(`${PATH}?waitingOn=customer`, api);
    await screen.findByRole('table');
    expect(lastQuery(api).get('waitingOn')).toBe('customer');
    expect(lastQuery(api).has('waitingOnPartyKind')).toBe(false);
    const before = api.calls(LIST).length;
    const field = screen.getByRole('textbox', { name: 'Dłużej niż' });
    for (const bad of ['0', '366', '14a', '']) {
      await userEvent.clear(field);
      if (bad !== '') await userEvent.type(field, bad);
      expect((await screen.findByRole('alert')).textContent).toContain('Podaj liczbę dni od 1 do 365.');
      expect(field.getAttribute('aria-invalid')).toBe('true');
    }
    // a pause long enough for the debounced value to settle changes nothing
    await act(async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
    });
    expect(api.calls(LIST)).toHaveLength(before);
    await userEvent.type(field, '365');
    await waitFor(() => {
      expect(lastQuery(api).get('waitingLongerThanDays')).toBe('365');
    });
  });

  it('EVM-034 AC2 the filter works for the customer and for any party; a kind with the customer is never sent', async () => {
    const api = listApi();
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    const select = screen.getByRole('combobox', { name: 'Czekamy na' });
    await userEvent.selectOptions(select, 'Klient');
    await waitFor(() => {
      expect(lastQuery(api).get('waitingOn')).toBe('customer');
    });
    expect(lastQuery(api).has('waitingOnPartyKind')).toBe(false);
    await userEvent.selectOptions(select, 'Dowolna strona');
    await waitFor(() => {
      expect(lastQuery(api).get('waitingOn')).toBe('party');
    });
    expect(lastQuery(api).has('waitingOnPartyKind')).toBe(false);
    await userEvent.selectOptions(select, 'Administracja');
    await waitFor(() => {
      expect(lastQuery(api).get('waitingOnPartyKind')).toBe('building_administration');
    });
  });

  it('EVM-034 AC2 a link with an unknown kind or a number outside the range is read as no filter / the default 14', async () => {
    const api = listApi();
    await renderPanel(`${PATH}?waitingOn=drop_table&waitingDays=999`, api);
    await screen.findByRole('table');
    expect(lastQuery(api).has('waitingOn')).toBe(false);
    expect(lastQuery(api).has('waitingLongerThanDays')).toBe(false);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Czekamy na' }).value).toBe('');
  });

  it('EVM-034 AC2 the chip removes the filter and the address returns to the default; "Wyczyść filtry" does the same', async () => {
    const api = listApi();
    const { history } = await renderPanel(`${PATH}?waitingOn=party&waitingDays=30`, api);
    await screen.findByRole('table');
    expect(lastQuery(api).get('waitingLongerThanDays')).toBe('30');
    await userEvent.click(screen.getByRole('button', { name: 'Usuń filtr Czekamy na: Dowolna strona > 30 dni' }));
    await waitFor(() => {
      expect(lastQuery(api).has('waitingOn')).toBe(false);
    });
    expect(history.location.search).toBe('');
    expect(screen.queryByRole('textbox', { name: 'Dłużej niż' })).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Czekamy na' }), 'Klient');
    await userEvent.click(await screen.findByRole('button', { name: 'Wyczyść filtry' }));
    await waitFor(() => {
      expect(lastQuery(api).has('waitingOn')).toBe(false);
    });
    expect(history.location.search).toBe('');
  });

  it('EVM-034 AC2 a filter with no results says so and offers "Wyczyść filtry"; the result of a changed X is one request', async () => {
    const api = listApi((request) => json(200, page(request.query.has('waitingOn') ? [] : [order(1)])));
    await renderPanel(`${PATH}?waitingOn=distribution_system_operator&waitingDays=15`, api);
    expect(await screen.findByRole('heading', { level: 2, name: 'Brak zleceń spełniających filtry.' })).toBeTruthy();
    expect(api.calls(LIST)).toHaveLength(1);
  });
});

describe('W-10 saved view "Czekamy na OSD > 14 dni" (EVM-034 AC3)', () => {
  it('EVM-034 AC3 the view sends only its identifier and the address holds only the identifier', async () => {
    const api = listApi();
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Czekamy na OSD > 14 dni' }));
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('waiting_on_dso_over_14_days');
    });
    expect(history.location.search).toBe('?view=waiting_on_dso_over_14_days');
    expect(lastQuery(api).has('waitingOn')).toBe(false);
    expect(lastQuery(api).has('waitingLongerThanDays')).toBe(false);
    expect(screen.getByRole('button', { name: 'Czekamy na OSD > 14 dni' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Czekamy na OSD > 14 dni' }));
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('all_open');
    });
    expect(history.location.search).toBe('');
  });

  it('EVM-034 AC3 no results: "Nie czekamy na OSD dłużej niż 14 dni. Dobra wiadomość." instead of the sentence of empty filters', async () => {
    await renderPanel(`${PATH}?view=waiting_on_dso_over_14_days`, listApi(ok([])));
    expect(await screen.findByRole('heading', { level: 2, name: 'Nie czekamy na OSD dłużej niż 14 dni. Dobra wiadomość.' })).toBeTruthy();
    expect(screen.queryByText('Brak zleceń spełniających filtry.')).toBeNull();
  });

  it('EVM-034 AC3 the view with a narrower filter is a plain empty filter; the view and the filter of the bar take each other away', async () => {
    const api = listApi(ok([]));
    await renderPanel(`${PATH}?view=waiting_on_dso_over_14_days&status=new`, api);
    expect(await screen.findByRole('heading', { level: 2, name: 'Brak zleceń spełniających filtry.' })).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Czekamy na' }), 'Klient');
    await waitFor(() => {
      expect(lastQuery(api).get('waitingOn')).toBe('customer');
    });
    expect(lastQuery(api).get('view')).toBe('all_open');
    expect(screen.getByRole('button', { name: 'Czekamy na OSD > 14 dni' }).getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Czekamy na OSD > 14 dni' }));
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('waiting_on_dso_over_14_days');
    });
    expect(lastQuery(api).has('waitingOn')).toBe(false);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Czekamy na' }).value).toBe('');
  });
});

describe('W-10 roles and states (EVM-034 AC7, AC8)', () => {
  it('EVM-034 AC7 Tylko odczyt sees the columns, the filter and the view', async () => {
    const readOnly = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'read_only' as const } };
    await renderPanel(PATH, listApi(ok([order(1, { waiting: osdWait(15) })]), readOnly));
    const cells = await cellsOf();
    expect(cells[WAITING]?.textContent).toContain('Stoen Operator (OSD) · od 15 dni');
    expect(screen.getByRole('combobox', { name: 'Czekamy na' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Czekamy na OSD > 14 dni' })).toBeTruthy();
  });

  it('EVM-034 AC8 offline: the data of the tab stays, the filter, the field and the view are disabled', async () => {
    await renderPanel(`${PATH}?waitingOn=party&waitingDays=20`, listApi(ok([order(1, { waiting: osdWait(25) })])));
    await screen.findByRole('table');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Czekamy na' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Dłużej niż' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Czekamy na OSD > 14 dni' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/Stoen Operator \(OSD\) · od 25 dni/)).toBeTruthy();
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });

  it('EVM-034 AC8 a 429 shows the minutes to wait and keeps the filter; the filter bar with the new controls passes axe', async () => {
    let limited = false;
    const api = listApi(() => (limited ? problem(429, 'rate_limited', {}, { 'Retry-After': '60' }) : json(200, page([order(1)]))));
    await renderPanel(`${PATH}?waitingOn=customer&waitingDays=14`, api);
    await screen.findByRole('table');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    limited = true;
    await userEvent.click(screen.getByRole('button', { name: 'Czekamy na OSD > 14 dni' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Zbyt wiele zapytań. Spróbuj ponownie za 1 min.');
    expect(screen.getByRole('combobox', { name: 'Czekamy na' })).toBeTruthy();
  });
});
