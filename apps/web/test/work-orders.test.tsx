import type { WorkOrderList, WorkOrderListItem } from '@evia/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, SESSION_ROUTE, type Handler, type Recorded } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';

const LIST = 'GET /api/v1/work-orders';
const PATH = '/work-orders';

const ANNA = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa' };
const JAN = { id: '22222222-2222-4222-8222-222222222222', displayName: 'Jan Przykładowy' };

function order(index: number, overrides: Partial<WorkOrderListItem> = {}): WorkOrderListItem {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    number: `ZL-2026-${String(index).padStart(4, '0')}`,
    title: `Garaż — pełny proces ${String(index)}`,
    status: 'in_progress',
    coordinator: ANNA,
    createdAt: '2026-10-04T12:05:00.000Z',
    ...overrides,
  };
}

const page = (items: WorkOrderListItem[], nextCursor: string | null = null): WorkOrderList => ({ items, nextCursor });
const ok =
  (items: WorkOrderListItem[] = [order(1)], next: string | null = null): Handler =>
  () =>
    json(200, page(items, next));

function listApi(handler: Handler = ok(), session = ACTIVE_SESSION) {
  return activeSessionApi({ [SESSION_ROUTE]: () => json(200, session), [LIST]: handler });
}

const lastQuery = (api: ReturnType<typeof listApi>): URLSearchParams => api.calls(LIST).at(-1)?.query ?? new URLSearchParams();
const reads = (api: ReturnType<typeof listApi>): Recorded[] => api.calls(LIST);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('W-10 default view, columns and rows (EVM-017 AC1)', () => {
  it('EVM-017 AC1 the default view asks for "Wszystkie niezamknięte" newest number first, 25 on a page, and shows the four columns', async () => {
    const api = listApi(
      ok([
        order(2, { title: 'Dom — pełny pakiet', status: 'quoting', coordinator: null, createdAt: '2026-10-05T22:30:00.000Z' }),
        order(1, { coordinator: JAN }),
      ]),
    );
    await renderPanel(PATH, api);
    const table = await screen.findByRole('table', { name: 'Lista zleceń' });
    const query = lastQuery(api);
    expect(query.get('view')).toBe('all_open');
    expect(query.get('sort')).toBe('-number');
    expect(query.get('limit')).toBe('25');
    expect(query.has('status')).toBe(false);
    expect(query.has('cursor')).toBe(false);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Zlecenie', 'Status', 'Opiekun', 'Utworzono']);
    expect(within(table).getByRole('columnheader', { name: 'Zlecenie' }).getAttribute('aria-sort')).toBe('descending');
    const cells = within(table)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    // A day in Warsaw: 22:30 UTC on 5 October is already 6 October there.
    expect(cells).toEqual([
      'ZL-2026-0002Dom — pełny pakiet',
      'Wycena',
      'Brak opiekuna',
      '06.10.2026',
      'ZL-2026-0001Garaż — pełny proces 1',
      'W realizacji',
      'Jan Przykładowy',
      '04.10.2026',
    ]);
    expect(document.title).toBe('Zlecenia · EVia Manager');
  });

  it('EVM-017 AC1 the whole row is one link to the details, named with the full description', async () => {
    await renderPanel(PATH, listApi(ok([order(42, { title: 'Garaż — pełny proces' })])));
    const link = await screen.findByRole('link', {
      name: 'ZL-2026-0042, Garaż — pełny proces, status: W realizacji, opiekun: Anna Testowa, utworzono 04.10.2026',
    });
    expect(link.getAttribute('href')).toBe('/work-orders/00000000-0000-4000-8000-000000000042');
    expect(link.closest('td')).toBe(screen.getAllByRole('cell')[0]);
  });

  it('EVM-017 AC1 a status this panel does not know is the "Nieznany status" badge — never the raw value (P-12)', async () => {
    const unknown = order(7, { status: 'archived_by_a_newer_api' as WorkOrderListItem['status'] });
    await renderPanel(PATH, listApi(ok([unknown])));
    const link = await screen.findByRole('link', { name: /ZL-2026-0007/ });
    expect(screen.getByText('Nieznany status', { exact: false }).getAttribute('title')).toBe('Odśwież stronę, aby zobaczyć szczegóły.');
    expect(link.getAttribute('aria-label')).toContain('status: nieznany');
    expect(document.body.textContent).not.toContain('archived_by_a_newer_api');
    expect(screen.queryByRole('button', { name: /archived/ })).toBeNull();
  });

  it('EVM-017 AC1 titles and names are shown as text only — markup in them is not interpreted', async () => {
    await renderPanel(
      PATH,
      listApi(ok([order(5, { title: '<img src=x onerror=alert(1)> Garaż', coordinator: { ...ANNA, displayName: '<b>Anna</b>' } })])),
    );
    const table = await screen.findByRole('table');
    expect(table.querySelector('img')).toBeNull();
    expect(table.querySelector('b')).toBeNull();
    expect(table.textContent).toContain('<img src=x onerror=alert(1)> Garaż');
  });

  it('EVM-017 AC1 the tab title never carries titles or names, and nothing is written to the stores of the browser (SR-WEB-05)', async () => {
    await renderPanel(PATH, listApi(ok([order(9, { title: 'Jan Przykładowy, ul. Testowa 7' })])));
    await screen.findByRole('table');
    expect(document.title).toBe('Zlecenia · EVia Manager');
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });

  it('EVM-017 AC1 a screen of the list passes the accessibility check (axe)', async () => {
    await renderPanel(
      PATH,
      listApi(ok([order(1), order(2, { status: 'settled' }), order(3, { status: 'x' as WorkOrderListItem['status'] })])),
    );
    await screen.findByRole('table');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-017 AC7 Tylko odczyt sees the list and the filters and no "Nowe zlecenie"', async () => {
    const api = listApi(ok(), { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'read_only' } });
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    expect(screen.getByRole('group', { name: 'Status' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /nowe zlecenie/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /nowe zlecenie/i })).toBeNull();
  });
});

describe('W-10 filters, views and sorting (EVM-017 AC2)', () => {
  it('EVM-017 AC2 several statuses go to the request and to the address — the address holds nothing else', async () => {
    const api = listApi();
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    const group = screen.getByRole('group', { name: 'Status' });
    await userEvent.click(within(group).getByRole('button', { name: 'Wycena' }));
    await userEvent.click(within(group).getByRole('button', { name: 'Nowe' }));
    await waitFor(() => {
      expect(lastQuery(api).get('status')).toBe('new,quoting');
    });
    // Choosing a status leaves "Wszystkie niezamknięte": the closed statuses can be asked for, and the server is not asked for a contradiction.
    expect(lastQuery(api).has('view')).toBe(false);
    expect(history.location.search).toBe('?status=new%2Cquoting&view=all');
    expect(screen.getByRole('button', { name: 'Usuń filtr Status: Nowe' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Nowe' }).getAttribute('aria-pressed')).toBe('true');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-017 AC2 "Moje" sends only the view — never the identifier of a person — and the address holds the view id', async () => {
    const api = listApi();
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Moje' }));
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('mine');
    });
    expect(lastQuery(api).has('coordinatorId')).toBe(false);
    expect(history.location.search).toBe('?view=mine');
    expect(history.location.search).not.toContain(ACTIVE_SESSION.user.id);
    await userEvent.click(screen.getByRole('button', { name: 'Moje' }));
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('all_open');
    });
    expect(history.location.search).toBe('');
  });

  it('EVM-017 AC2 the coordinator and the sort order stay out of the address; the coordinator is chosen from the people seen on the list', async () => {
    const api = listApi(ok([order(1, { coordinator: JAN }), order(2)]));
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Opiekun' }), 'Jan Przykładowy');
    await waitFor(() => {
      expect(lastQuery(api).get('coordinatorId')).toBe(JAN.id);
    });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sortuj' }), 'Utworzono — od najstarszych');
    await waitFor(() => {
      expect(lastQuery(api).get('sort')).toBe('createdAt');
    });
    expect(lastQuery(api).get('coordinatorId')).toBe(JAN.id);
    expect(history.location.search).toBe('');
    expect(history.location.href).not.toContain(JAN.id);
    expect(screen.getByRole('button', { name: 'Usuń filtr Opiekun: Jan Przykładowy' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Utworzono' }).getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('columnheader', { name: 'Zlecenie' }).hasAttribute('aria-sort')).toBe(false);
  });

  it('EVM-017 AC2 the statuses and the view of a link are applied; an unknown status code in the address is dropped', async () => {
    const api = listApi();
    await renderPanel(`${PATH}?status=on_hold,nonsense&view=mine`, api);
    await screen.findByRole('table');
    const query = lastQuery(api);
    expect(query.get('status')).toBe('on_hold');
    expect(query.get('view')).toBe('mine');
    expect(screen.getByRole('button', { name: 'Moje' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('EVM-017 AC2 a view that is not known (a link from somewhere else) says so and does not ask the server; the action shows the list', async () => {
    const api = listApi();
    const { history } = await renderPanel(`${PATH}?view=po_terminie`, api);
    expect(await screen.findByRole('heading', { level: 2, name: 'Nie znaleziono widoku.' })).toBeTruthy();
    expect(reads(api)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż wszystkie zlecenia' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(history.location.search).toBe('');
    expect(lastQuery(api).get('view')).toBe('all_open');
  });

  it('EVM-017 AC2 "Wyczyść filtry" returns to "Wszystkie niezamknięte" and keeps the sort order', async () => {
    const api = listApi();
    await renderPanel(`${PATH}?view=mine`, api);
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sortuj' }), 'Numer — od najniższego');
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść filtry' }));
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('all_open');
    });
    expect(lastQuery(api).get('sort')).toBe('number');
    expect(screen.queryByRole('button', { name: 'Wyczyść filtry' })).toBeNull();
  });
});

describe('W-10 one request for one change (EVM-017 AC2, AC5)', () => {
  it('EVM-017 AC5 a change of the view and of the coordinator together asks the server once — never for a mix of the old and the new filters', async () => {
    const api = listApi(ok([order(1, { coordinator: JAN }), order(2)]));
    await renderPanel(`${PATH}?view=mine`, api);
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Opiekun' }), 'Jan Przykładowy');
    await waitFor(() => {
      expect(lastQuery(api).get('coordinatorId')).toBe(JAN.id);
    });
    const before = reads(api).length;
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść filtry' }));
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('all_open');
    });
    await screen.findByRole('table');
    expect(reads(api)).toHaveLength(before + 1);
    expect(lastQuery(api).has('coordinatorId')).toBe(false);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Opiekun' }).value).toBe('');
  });
});

describe('W-10 pages by cursor (EVM-017 AC3)', () => {
  const pages = (calls: Recorded[] = []): Handler => {
    return (request) => {
      calls.push(request);
      const cursor = request.query.get('cursor');
      if (cursor === 'cursor-2') return json(200, page([order(2)], 'cursor-3'));
      if (cursor === 'cursor-3') return json(200, page([order(1)], null));
      return json(200, page([order(3)], 'cursor-2'));
    };
  };

  it('EVM-017 AC3 "Następna" sends the cursor of the page, "Poprzednia" goes back; the buttons follow the cursors; focus moves to the list heading', async () => {
    const api = listApi(pages());
    await renderPanel(PATH, api);
    await screen.findByText('ZL-2026-0003', { exact: false });
    const previous = screen.getByRole('button', { name: 'Poprzednia strona' });
    const next = screen.getByRole('button', { name: 'Następna strona' });
    expect(previous.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(next);
    await screen.findByText('ZL-2026-0002', { exact: false });
    expect(lastQuery(api).get('cursor')).toBe('cursor-2');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Lista zleceń' }));
    expect(screen.getByText('Wczytano następną stronę zleceń').getAttribute('role')).toBe('status');
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    await screen.findByText('ZL-2026-0001', { exact: false });
    expect(screen.getByRole('button', { name: 'Następna strona' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Poprzednia strona' }));
    await screen.findByText('ZL-2026-0002', { exact: false });
    expect(lastQuery(api).get('cursor')).toBe('cursor-2');
  });

  it('EVM-017 AC3 a changed filter starts again from the first page — the old cursor is not sent with the new filters', async () => {
    const api = listApi(pages());
    await renderPanel(PATH, api);
    await screen.findByText('ZL-2026-0003', { exact: false });
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    await screen.findByText('ZL-2026-0002', { exact: false });
    await userEvent.click(screen.getByRole('button', { name: 'Moje' }));
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('mine');
    });
    expect(lastQuery(api).has('cursor')).toBe(false);
  });

  it('EVM-017 AC3 a cursor the server refuses brings the list back to the first page with the message; the filters stay', async () => {
    let refuse = true;
    const api = listApi((request) => {
      const cursor = request.query.get('cursor');
      if (cursor === 'cursor-2') return refuse ? problem(400, 'invalid_cursor') : json(200, page([order(2)]));
      return json(200, page([order(3)], 'cursor-2'));
    });
    await renderPanel(`${PATH}?view=mine`, api);
    await screen.findByText('ZL-2026-0003', { exact: false });
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByText('Lista się zmieniła — wróciliśmy na początek.')).toBeTruthy();
    await screen.findByText('ZL-2026-0003', { exact: false });
    expect(lastQuery(api).has('cursor')).toBe(false);
    expect(lastQuery(api).get('view')).toBe('mine');
    expect(screen.getByRole('button', { name: 'Moje' }).getAttribute('aria-pressed')).toBe('true');
    refuse = false;
  });
});

describe('W-10 mass reading and errors (EVM-017 AC5, AC8)', () => {
  it('EVM-017 AC5 a 429 says how long to wait in minutes (from Retry-After, rounded up); the filters stay and "Spróbuj ponownie" asks again', async () => {
    let limited = true;
    const api = listApi(() => (limited ? problem(429, 'rate_limited', {}, { 'Retry-After': '121' }) : json(200, page([order(1)]))));
    await renderPanel(`${PATH}?view=mine`, api);
    expect((await screen.findByRole('alert')).textContent).toContain('Zbyt wiele zapytań. Spróbuj ponownie za 3 min.');
    expect(screen.getByRole('button', { name: 'Moje' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('group', { name: 'Status' })).toBeTruthy();
    limited = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.queryByText(/Zbyt wiele zapytań/)).toBeNull();
  });

  it('EVM-017 AC8 an error shows "Nie udało się wczytać zleceń." with a retry that reads again', async () => {
    let failing = true;
    const api = listApi(() => (failing ? problem(500, 'internal_error') : json(200, page([order(1)]))));
    await renderPanel(PATH, api);
    expect(await screen.findByRole('heading', { level: 2, name: 'Nie udało się wczytać zleceń.' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('internal_error');
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(reads(api)).toHaveLength(2);
  });
});

describe('W-10 states (EVM-017 AC8)', () => {
  it('EVM-017 AC8 no orders at all: "Nie masz jeszcze zleceń." without a button and without "Nowe zlecenie"', async () => {
    await renderPanel(PATH, listApi(ok([])));
    expect(await screen.findByRole('heading', { level: 2, name: 'Nie masz jeszcze zleceń.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /nowe zlecenie|wyczyść filtry/i })).toBeNull();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-017 AC8 no results for the filters: "Brak zleceń spełniających filtry." with "Wyczyść filtry" that restores the default view', async () => {
    const api = listApi((request) => json(200, page(request.query.get('view') === 'mine' ? [] : [order(1)])));
    await renderPanel(`${PATH}?view=mine`, api);
    expect(await screen.findByRole('heading', { level: 2, name: 'Brak zleceń spełniających filtry.' })).toBeTruthy();
    const clear = within(screen.getByRole('heading', { level: 2 }).closest('section') as HTMLElement).getByRole('button', {
      name: 'Wyczyść filtry',
    });
    await userEvent.click(clear);
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('EVM-017 AC8 loading: a skeleton with a text status; after 10 s "Ładowanie trwa dłużej niż zwykle…"; the filters stay active', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    let release: (response: Response) => void = () => undefined;
    const api = listApi(() => new Promise<Response>((resolve) => (release = resolve)));
    await renderPanel(PATH, api);
    const busy = await screen.findByText('Ładowanie…');
    expect(busy.closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Moje' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText('Ładowanie trwa dłużej niż zwykle…')).toBeNull();
    // The page asks for a timer of 10 s; it is fired by hand (no waiting, no fake timers that would stop the queries).
    const slow = timers.mock.calls.find(([, delay]) => delay === 10_000)?.[0] as (() => void) | undefined;
    expect(slow).toBeTypeOf('function');
    act(() => {
      slow?.();
    });
    expect(screen.getByText('Ładowanie trwa dłużej niż zwykle…')).toBeTruthy();
    release(json(200, page([order(1)])));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('EVM-017 AC8 offline: the last page from the memory of the tab with "Dane mogą być nieaktualne (z …)", filters and pages disabled, nothing in the stores', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:05:00.000Z'));
    const api = listApi(ok([order(1), order(2)], 'cursor-2'));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    // 12:05 UTC in October is 14:05 in Warsaw.
    expect(screen.getByText('Dane mogą być nieaktualne (z 14:05)').closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Moje' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Nowe' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Sortuj' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Opiekun' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Następna strona' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Brak połączenia — strony są niedostępne.')).toBeTruthy();
    const before = reads(api).length;
    await userEvent.click(screen.getByRole('button', { name: 'Moje' }));
    expect(reads(api)).toHaveLength(before);
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });

  it('EVM-017 AC8 offline without any page loaded shows the error state, and the return of the connection reads the list again', async () => {
    let online = false;
    const api = listApi(() => {
      if (!online) throw new TypeError('Failed to fetch');
      return json(200, page([order(1)]));
    });
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await renderPanel(PATH, api);
    expect(await screen.findByRole('heading', { level: 2, name: 'Nie udało się wczytać zleceń.' })).toBeTruthy();
    online = true;
    onLine.mockReturnValue(true);
    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('EVM-017 AC8 the list is read only in an active session: a session at the hand-over to W-03 does not ask for data', async () => {
    const api = listApi(ok(), { ...ACTIVE_SESSION, state: 'mfa_enrollment' });
    await renderPanel(PATH, api);
    await screen.findByRole('heading', { level: 1 });
    expect(reads(api)).toHaveLength(0);
  });
});
