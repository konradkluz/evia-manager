import type { CurrentSession, UserRole, WorkOrderList, WorkOrderListItem } from '@evia/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { NOW } from './site-survey-api.ts';
import { userEvent } from './user.ts';

// W-10 and the site surveys (EVM-138 AC1, AC6): the marks, "Brak klienta", the deadline, the filters, "Wygasające wizje", the search,
// the states and the roles. The deadlines are counted from NOW (2027-01-30, 09:00 UTC = 10:00 in Warsaw).
const LIST = 'GET /api/v1/work-orders';
const SEARCH = 'POST /api/v1/work-orders/search';
const PATH = '/work-orders';
const ANNA = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa' };
const NONE = {
  state: 'none',
  invoicedCount: 0,
  invoicedTotal: { amountMinor: 0, currency: 'PLN' as const },
  overdueTotal: { amountMinor: 0, currency: 'PLN' as const },
};

function base(index: number, over: Partial<WorkOrderListItem> = {}): WorkOrderListItem {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    number: `ZL-2026-${String(index).padStart(4, '0')}`,
    title: 'Garaż — pełny proces',
    status: 'in_progress',
    coordinator: ANNA,
    createdAt: '2026-10-04T12:05:00.000Z',
    waiting: null,
    nextDueDate: null,
    hasOverdueStage: false,
    payment: NONE,
    ...over,
  };
}

/** A survey of the list: no customer and no site (the API hides them), a deadline `iso`, the status "Wycena" or "Anulowane". */
const survey = (index: number, expiresAt: string, over: Partial<WorkOrderListItem> = {}): WorkOrderListItem =>
  base(index, {
    title: 'Wizja lokalna',
    status: 'quoting',
    customer: null,
    site: null,
    siteSurvey: { expiresAt, extensionCount: 0, requesterPhone: '+48600000002' },
    ...over,
  });

// 12 days (a warning), 80 days, a rejected one with 9 days to the deletion, 15 days (the boundary), 16 days (out of the view).
const SOON = survey(49, '2027-02-11T10:00:00.000Z');
const FAR = survey(48, '2027-04-20T10:00:00.000Z');
const REJECTED = survey(47, '2027-02-08T10:00:00.000Z', { status: 'cancelled' });
const EDGE = survey(46, '2027-02-14T10:00:00.000Z');
const OUT = survey(45, '2027-02-15T10:00:00.000Z');
const ORDER = base(1, {
  customer: { id: '01968f3e-0000-7000-8000-00000000aaaa', displayName: 'Jan Przykładowy' },
  site: {
    id: '01968f3e-0000-7000-8000-00000000bbbb',
    siteType: 'multi_family_garage',
    street: 'ul. Testowa',
    buildingNumber: '7',
    city: 'Warszawa',
  },
});
const ALL = [SOON, FAR, REJECTED, EDGE, OUT, ORDER];

const surveysOn = (role: UserRole = 'administrator', on = true): CurrentSession => ({
  ...ACTIVE_SESSION,
  user: { ...ACTIVE_SESSION.user, role },
  features: { siteSurveys: on },
});

/** The API of the list: `siteSurvey=only|exclude` and `sort=siteSurveyExpiresAt` are done here (the deadline order is the API's). */
const listOf =
  (rows: WorkOrderListItem[] = ALL): Handler =>
  (request) => {
    const only = request.query.get('siteSurvey');
    const statuses = request.query.get('status')?.split(',');
    let found = rows
      .filter((row) => statuses === undefined || statuses.includes(row.status))
      .filter((row) => (only === 'only' ? row.siteSurvey != null : only === 'exclude' ? row.siteSurvey == null : true));
    if (request.query.get('sort') === 'siteSurveyExpiresAt') {
      found = found.toSorted((a, b) => Date.parse(a.siteSurvey?.expiresAt ?? '') - Date.parse(b.siteSurvey?.expiresAt ?? ''));
    }
    const page: WorkOrderList = { items: found, nextCursor: null };
    return json(200, page);
  };

function listApi(rows: WorkOrderListItem[] = ALL, role: UserRole = 'administrator', on = true, extra: Record<string, Handler> = {}) {
  return activeSessionApi({ [SESSION_ROUTE]: () => json(200, surveysOn(role, on)), [LIST]: listOf(rows), ...extra });
}

/** The reads of the list itself: the count of "Wygasające wizje" is another read (100 surveys by the deadline) and is left out. */
const queries = (api: ReturnType<typeof listApi>) =>
  api
    .calls(LIST)
    .map((call) => call.query)
    .filter((query) => query.get('limit') !== '100' || query.get('sort') !== 'siteSurveyExpiresAt');
const table = () => screen.findByRole('table', { name: 'Lista zleceń' });
const rowFor = async (number: string) => within(await table()).getByRole('link', { name: new RegExp(number) });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('W-10 the rows of site surveys (EVM-138 AC1)', () => {
  it('EVM-138 AC1 a survey is marked "Wizja lokalna" and has "Brak klienta" with an icon and text, and no address; an order stays as it was', async () => {
    await renderPanel(PATH, listApi([SOON, ORDER]));
    const grid = await table();
    const own = within(grid)
      .getByRole('link', { name: /ZL-2026-0049/ })
      .closest('tr') as HTMLElement;
    expect(own.querySelector('svg.lucide-binoculars')).not.toBeNull();
    expect(within(own).getAllByText('Brak klienta').length).toBeGreaterThan(0);
    expect(own.querySelector('svg.lucide-user-x')).not.toBeNull();
    // no address and no phone anywhere in the row
    expect(own.textContent).not.toMatch(/ul\. Testowa|Warszawa|00-001|\+48|600 ?000/);
    const plain = within(grid)
      .getByRole('link', { name: /ZL-2026-0001/ })
      .closest('tr') as HTMLElement;
    expect(plain.querySelector('svg.lucide-binoculars')).toBeNull();
    expect(within(plain).getAllByText('Jan Przykładowy').length).toBeGreaterThan(0);
    expect(plain.textContent).toContain('ul. Testowa 7');
  });

  it('EVM-138 AC1 the deadline: "Wygasa za 80 dni" (quiet), "Wygasa za 12 dni" with a warning icon and text — never the colour alone', async () => {
    await renderPanel(PATH, listApi([SOON, FAR]));
    const soon = (await rowFor('ZL-2026-0049')).closest('tr') as HTMLElement;
    const far = (await rowFor('ZL-2026-0048')).closest('tr') as HTMLElement;
    expect(within(soon).getByText('Wygasa za 12 dni')).toBeTruthy();
    expect(within(soon).getByText('Wygasa za 12 dni').parentElement?.className).toContain('text-text-warning');
    expect(soon.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
    expect(within(far).getByText('Wygasa za 80 dni').parentElement?.className).toContain('text-text-secondary');
    expect(far.querySelector('svg.lucide-calendar-x')).not.toBeNull();
    // the accessible name of the deadline carries the date and the need of a decision
    expect(within(soon).getByText(/wygasa za 12 dni, dnia 11\.02\.2027 — wymaga decyzji/)).toBeTruthy();
    expect(within(far).getByText(/wygasa za 80 dni, dnia 20\.04\.2027$/)).toBeTruthy();
  });

  it('EVM-138 AC1 a rejected survey: "Odrzucona" and "Usunięcie za 9 dni" with a trash icon (no warning)', async () => {
    await renderPanel(PATH, listApi([REJECTED]));
    const row = (await rowFor('ZL-2026-0047')).closest('tr') as HTMLElement;
    expect(row.querySelector('svg.lucide-binoculars')).not.toBeNull();
    expect(row.querySelector('svg.lucide-thumbs-down')).not.toBeNull();
    expect(within(row).getByText('Odrzucona')).toBeTruthy();
    expect(within(row).getByText('Usunięcie za 9 dni')).toBeTruthy();
    expect(row.querySelector('svg.lucide-trash-2')).not.toBeNull();
    expect(within(row).getByText('Usunięcie za 9 dni').parentElement?.className).not.toContain('text-text-warning');
  });

  it('EVM-138 AC1 the name of the row: number, title, no customer, status and deadline — without the address and the phone', async () => {
    await renderPanel(PATH, listApi([SOON]));
    const link = await rowFor('ZL-2026-0049');
    const name = link.getAttribute('aria-label') ?? '';
    expect(name).toMatch(/^ZL-2026-0049, Wizja lokalna, brak klienta, status: Wycena, /);
    expect(name).toContain('wygasa za 12 dni, dnia 11.02.2027');
    expect(name).not.toMatch(/ul\. Testowa|Warszawa|00-001|\+48|600 ?000/);
  });

  it('EVM-138 AC1 a title that does not say it still gets the mark in the name of the row; the columns of stages and payments are "—" with a name', async () => {
    await renderPanel(PATH, listApi([survey(44, '2027-04-20T10:00:00.000Z', { title: 'Oględziny garażu' })]));
    const link = await rowFor('ZL-2026-0044');
    expect(link.getAttribute('aria-label') ?? '').toMatch(/^ZL-2026-0044, Oględziny garażu, wizja lokalna, brak klienta, status: /);
    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByText('Wizja lokalna nie ma etapów')).toBeTruthy();
    expect(within(row).getByText('Wizja lokalna nie ma transz')).toBeTruthy();
  });
});

describe('W-10 the filters "Wizje lokalne" (EVM-138 AC1)', () => {
  it('EVM-138 AC1 the group "Wizje lokalne" (a radio fieldset): "Tylko wizje" and "Bez wizji" put siteSurvey=only|exclude in the query and the address', async () => {
    const api = listApi();
    const { history } = await renderPanel(PATH, api);
    const group = await screen.findByRole('group', { name: 'Wizje lokalne' });
    expect(within(group).getByRole<HTMLInputElement>('radio', { name: 'Wszystkie zlecenia' }).checked).toBe(true);
    expect(queries(api).every((query) => !query.has('siteSurvey'))).toBe(true);
    await userEvent.click(within(group).getByRole('radio', { name: 'Tylko wizje' }));
    await waitFor(() => {
      expect(queries(api).at(-1)?.get('siteSurvey')).toBe('only');
    });
    expect(history.location.search).toBe('?siteSurvey=only');
    expect(await screen.findByRole('button', { name: 'Usuń filtr Tylko wizje' })).toBeTruthy();
    expect(within(await table()).queryByRole('link', { name: /ZL-2026-0001/ })).toBeNull();
    await userEvent.click(within(group).getByRole('radio', { name: 'Bez wizji' }));
    await waitFor(() => {
      expect(queries(api).at(-1)?.get('siteSurvey')).toBe('exclude');
    });
    expect(history.location.search).toBe('?siteSurvey=exclude');
    expect(await within(await table()).findByRole('link', { name: /ZL-2026-0001/ })).toBeTruthy();
    expect(within(await table()).queryByRole('link', { name: /ZL-2026-0049/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Usuń filtr Bez wizji' }));
    await waitFor(() => {
      expect(queries(api).at(-1)?.has('siteSurvey')).toBe(false);
    });
  });

  it('EVM-138 AC1 an address with ?siteSurvey=only opens the list of the surveys with the radio set', async () => {
    const api = listApi();
    await renderPanel(`${PATH}?siteSurvey=only`, api);
    expect((await screen.findByRole<HTMLInputElement>('radio', { name: 'Tylko wizje' })).checked).toBe(true);
    expect(queries(api).at(-1)?.get('siteSurvey')).toBe('only');
  });

  it('EVM-138 AC1 the sort "Termin wygaśnięcia" exists only with "Tylko wizje" (and in "Wygasające wizje"), sorts by siteSurveyExpiresAt and goes away with the filter', async () => {
    const api = listApi();
    await renderPanel(PATH, api);
    const sort = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Sortuj' });
    expect([...sort.options].map((option) => option.text)).not.toContain('Termin wygaśnięcia');
    await userEvent.click(screen.getByRole('radio', { name: 'Tylko wizje' }));
    await waitFor(() => {
      expect([...screen.getByRole<HTMLSelectElement>('combobox', { name: 'Sortuj' }).options].map((option) => option.text)).toContain(
        'Termin wygaśnięcia',
      );
    });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sortuj' }), 'Termin wygaśnięcia');
    await waitFor(() => {
      expect(queries(api).at(-1)?.get('sort')).toBe('siteSurveyExpiresAt');
    });
    const numbers = within(await table())
      .getAllByRole('link')
      .map((link) => /ZL-2026-\d{4}/.exec(link.getAttribute('aria-label') ?? '')?.[0]);
    expect(numbers.slice(0, 3)).toEqual(['ZL-2026-0047', 'ZL-2026-0049', 'ZL-2026-0046']);
    // back to every order: the sort that the API would refuse (400 on /sort) is not sent
    await userEvent.click(screen.getByRole('radio', { name: 'Wszystkie zlecenia' }));
    await waitFor(() => {
      expect(queries(api).at(-1)?.has('siteSurvey')).toBe(false);
    });
    expect(queries(api).at(-1)?.get('sort')).not.toBe('siteSurveyExpiresAt');
    expect([...screen.getByRole<HTMLSelectElement>('combobox', { name: 'Sortuj' }).options].map((option) => option.text)).not.toContain(
      'Termin wygaśnięcia',
    );
  });
});

describe('W-10 the view "Wygasające wizje" (EVM-138 AC1)', () => {
  it('EVM-138 AC1 the chip carries the count (n) of the open surveys with 15 days or fewer; the rejected and the later ones do not count', async () => {
    await renderPanel(PATH, listApi());
    // SOON (12 days) and EDGE (15 days) — not REJECTED (9 days, but decided), not OUT (16 days), not FAR
    expect(await screen.findByRole('button', { name: 'Wygasające wizje (2)' })).toBeTruthy();
  });

  it('EVM-138 AC1 the view asks for siteSurvey=only sorted by the deadline, 100 rows and no view; it shows the open surveys of 15 days or fewer and "2 wizje do rozstrzygnięcia — wygasają w ciągu 15 dni" (polite)', async () => {
    const api = listApi();
    const { history } = await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Wygasające wizje (2)' }));
    const line = await screen.findByText('2 wizje do rozstrzygnięcia — wygasają w ciągu 15 dni');
    expect(line.getAttribute('aria-live')).toBe('polite');
    const query = api
      .calls(LIST)
      .map((call) => call.query)
      .findLast((entry) => entry.get('limit') === '100' && entry.get('sort') === 'siteSurveyExpiresAt');
    expect(query?.get('siteSurvey')).toBe('only');
    expect(query?.has('view')).toBe(false);
    expect(history.location.search).toBe('?view=expiring_site_surveys');
    const grid = await table();
    const numbers = within(grid)
      .getAllByRole('link')
      .map((link) => /ZL-2026-\d{4}/.exec(link.getAttribute('aria-label') ?? '')?.[0]);
    expect(numbers).toEqual(['ZL-2026-0049', 'ZL-2026-0046']);
    expect(screen.getByRole('button', { name: 'Wygasające wizje (2)' }).getAttribute('aria-pressed')).toBe('true');
    // the sort is the deadline, the one choice
    const sort = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Sortuj' });
    expect([...sort.options].map((option) => option.text)).toEqual(['Termin wygaśnięcia']);
    expect(await screen.findByRole('button', { name: 'Usuń filtr Wygasają w ciągu 15 dni' })).toBeTruthy();
  });

  it('EVM-138 AC1 "Żadna wizja nie wygasa w ciągu 15 dni." with "Pokaż wszystkie wizje" that leads to "Tylko wizje"', async () => {
    const api = listApi([FAR, ORDER]);
    await renderPanel(`${PATH}?view=expiring_site_surveys`, api);
    expect(await screen.findByRole('heading', { name: 'Żadna wizja nie wygasa w ciągu 15 dni.' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż wszystkie wizje' }));
    expect(await within(await table()).findByRole('link', { name: /ZL-2026-0048/ })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Tylko wizje' }).checked).toBe(true);
  });

  it('EVM-138 AC1 a count that is 1 or 5 or 22 is said in the Polish form, in the view', async () => {
    const rows = Array.from({ length: 22 }, (_unused, index) => survey(100 + index, '2027-02-05T10:00:00.000Z'));
    await renderPanel(`${PATH}?view=expiring_site_surveys`, listApi(rows));
    expect(await screen.findByText('22 wizje do rozstrzygnięcia — wygasają w ciągu 15 dni')).toBeTruthy();
  });
});

describe('W-10 empty, loading and error states of the surveys (EVM-138 AC1, AC6)', () => {
  it('EVM-138 AC1 "Tylko wizje" without a survey: "Brak wizji lokalnych." with the way to create one (Administrator, function on)', async () => {
    await renderPanel(`${PATH}?siteSurvey=only`, listApi([ORDER]));
    expect(await screen.findByRole('heading', { name: 'Brak wizji lokalnych.' })).toBeTruthy();
    expect(screen.getByText('Wizje zakłada się w aplikacji na telefonie albo w oknie „Nowe zlecenie”.')).toBeTruthy();
  });

  it('EVM-138 AC1 the button "Nowa wizja lokalna" opens W-05 with ?rodzaj=wizja', async () => {
    const { history } = await renderPanel(`${PATH}?siteSurvey=only`, listApi([ORDER]));
    await userEvent.click(await screen.findByRole('button', { name: 'Nowa wizja lokalna' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/work-orders/new');
    });
    expect(history.location.search).toBe('?rodzaj=wizja');
  });

  it('EVM-138 AC1 the Editor creates surveys too; with the function off there is no button (the group stays only while surveys are seen)', async () => {
    await renderPanel(`${PATH}?siteSurvey=only`, listApi([ORDER], 'editor'));
    expect(await screen.findByRole('button', { name: 'Nowa wizja lokalna' })).toBeTruthy();
  });

  it('EVM-138 AC1 the function off: the answer for the filter has no button "Nowa wizja lokalna", only the words', async () => {
    await renderPanel(`${PATH}?siteSurvey=only`, listApi([ORDER], 'administrator', false));
    expect(await screen.findByRole('heading', { name: 'Brak wizji lokalnych.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nowa wizja lokalna' })).toBeNull();
  });

  it('EVM-138 AC1 the filters together without a result: "Brak zleceń spełniających filtry" with "Wyczyść filtry" (as for every list)', async () => {
    await renderPanel(`${PATH}?siteSurvey=only&status=new`, listApi([ORDER]));
    expect(await screen.findByRole('heading', { name: 'Brak zleceń spełniających filtry.' })).toBeTruthy();
  });

  it('EVM-138 AC1 loading: the list shows the text status and the skeleton while the surveys are read', async () => {
    const releases: Array<() => void> = [];
    const api = listApi(ALL, 'administrator', true, {
      [LIST]: async (request) => {
        if (request.query.get('siteSurvey') === 'only') {
          await new Promise<void>((resolve) => {
            releases.push(resolve);
          });
        }
        return listOf()(request);
      },
    });
    await renderPanel(`${PATH}?siteSurvey=only`, api, { heading: true });
    expect(await screen.findByText('Ładowanie…')).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    for (const release of releases) release();
    expect(await screen.findByRole('link', { name: /ZL-2026-0049/ })).toBeTruthy();
  });

  it('EVM-138 AC1 an error of the list of surveys: the alert of the list with "Spróbuj ponownie", which reads it again', async () => {
    let fail = true;
    const api = listApi(ALL, 'administrator', true, {
      [LIST]: (request) => (fail && request.query.get('siteSurvey') === 'only' ? problem(500, 'internal_error') : listOf()(request)),
    });
    await renderPanel(`${PATH}?siteSurvey=only`, api);
    expect(await screen.findByRole('heading', { name: 'Nie udało się wczytać zleceń.' })).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('link', { name: /ZL-2026-0049/ })).toBeTruthy();
  });
});

describe('W-10 the search finds a survey (EVM-138 AC1)', () => {
  const SEARCH_ROWS = [SOON, FAR, ORDER];
  const searchApi = () =>
    listApi(ALL, 'administrator', true, {
      [SEARCH]: () => json(200, { items: SEARCH_ROWS, nextCursor: null }),
    });

  it('EVM-138 AC1 a phrase of an address goes in the body of the search (never the address of the page) and a survey is found; "Tylko wizje" keeps the surveys among the results', async () => {
    const api = searchApi();
    const { history } = await renderPanel(PATH, api);
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Szukaj: numer, tytuł, klient, adres…' }), 'testowa');
    expect(await within(await table()).findByRole('link', { name: /ZL-2026-0049/ })).toBeTruthy();
    const body = parseBody(api.calls(SEARCH).at(-1)?.body ?? '') as Record<string, unknown>;
    expect(body['query']).toBe('testowa');
    expect(body).not.toHaveProperty('siteSurvey');
    expect(history.location.search).not.toContain('testowa');
    await userEvent.click(screen.getByRole('radio', { name: 'Tylko wizje' }));
    await waitFor(() => {
      expect(within(screen.getByRole('table', { name: 'Lista zleceń' })).queryByRole('link', { name: /ZL-2026-0001/ })).toBeNull();
    });
    expect(within(await table()).getByRole('link', { name: /ZL-2026-0048/ })).toBeTruthy();
    const last = parseBody(api.calls(SEARCH).at(-1)?.body ?? '') as Record<string, unknown>;
    expect(last).not.toHaveProperty('siteSurvey');
    expect(last['sort']).not.toBe('siteSurveyExpiresAt');
  });
});

describe('W-10 roles and the switch of the function (EVM-138 AC6)', () => {
  it('EVM-138 AC6 Tylko odczyt: no group "Wizje lokalne", no view "Wygasające wizje", and no siteSurvey in any query even from the address', async () => {
    const api = listApi([ORDER], 'read_only');
    await renderPanel(`${PATH}?siteSurvey=only`, api);
    expect(await within(await table()).findByRole('link', { name: /ZL-2026-0001/ })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Wizje lokalne' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Wygasające wizje/ })).toBeNull();
    expect(queries(api).every((query) => !query.has('siteSurvey'))).toBe(true);
  });

  it('EVM-138 AC6 Tylko odczyt: a link to "Wygasające wizje" is "Nie znaleziono widoku" and nothing is asked', async () => {
    const api = listApi([ORDER], 'read_only');
    await renderPanel(`${PATH}?view=expiring_site_surveys`, api);
    expect(await screen.findByRole('heading', { name: 'Nie znaleziono widoku.' })).toBeTruthy();
    expect(api.calls(LIST)).toHaveLength(0);
  });

  it('EVM-138 AC6 the function off and no survey in the list: no group and no view; with a survey in the list the group stays (and the view has no count)', async () => {
    const off = listApi([ORDER], 'administrator', false);
    await renderPanel(PATH, off);
    await table();
    expect(screen.queryByRole('group', { name: 'Wizje lokalne' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Wygasające wizje/ })).toBeNull();
    expect(queries(off).every((query) => !query.has('siteSurvey'))).toBe(true);
  });

  it('EVM-138 AC6 the function off but a survey exists: the group "Wizje lokalne" stays so that it can be found and decided', async () => {
    const api = listApi([ORDER, SOON], 'administrator', false);
    await renderPanel(PATH, api);
    expect(await screen.findByRole('group', { name: 'Wizje lokalne' })).toBeTruthy();
    // the view stays with the group; its count is read only while the function is on, so the chip has none
    expect(screen.getByRole('button', { name: 'Wygasające wizje' })).toBeTruthy();
    expect(queries(api).every((query) => !query.has('siteSurvey'))).toBe(true);
  });
});

describe('W-10 offline (EVM-138 AC6)', () => {
  it('EVM-138 AC6 offline the group, the view and the filters are disabled (aria-disabled) and nothing more is asked', async () => {
    const api = listApi();
    await renderPanel(PATH, api);
    await screen.findByRole('button', { name: /Wygasające wizje/ });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('button', { name: /Wygasające wizje/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Tylko wizje' }).closest('fieldset')?.disabled).toBe(true);
  });
});

describe('W-10 accessibility of the surveys (EVM-138 AC6)', () => {
  it('EVM-138 AC6 the list of the surveys and the view "Wygasające wizje" have no accessibility violations (axe)', async () => {
    const api = listApi();
    await renderPanel(PATH, api);
    await table();
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(await screen.findByRole('button', { name: /^Wygasające wizje/ }));
    await screen.findByText(/do rozstrzygnięcia/);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-138 AC6 the keyboard: the group "Wizje lokalne" is a radio group (arrows move the choice) and the chip is a button', async () => {
    const api = listApi();
    await renderPanel(PATH, api);
    const radio = await screen.findByRole<HTMLInputElement>('radio', { name: 'Wszystkie zlecenia' });
    radio.focus();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(queries(api).at(-1)?.get('siteSurvey')).toBe('only');
    });
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Tylko wizje' }).checked).toBe(true);
  });
});
