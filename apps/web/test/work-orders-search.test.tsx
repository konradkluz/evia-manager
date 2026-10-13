import type { WorkOrderList, WorkOrderListItem, WorkOrderTemplate } from '@evia/contracts';
import { act, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { setWorkOrderPhrase } from '../src/search/work-order-search-store.ts';
import { json, parseBody, problem, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';

const LIST = 'GET /api/v1/work-orders';
const SEARCH = 'POST /api/v1/work-orders/search';
const TEMPLATES = 'GET /api/v1/catalog/work-order-templates';
const PATH = '/work-orders';

const ANNA = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa' };
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444';
const TEMPLATE_ID = '55555555-5555-4555-8555-555555555555';

function order(index: number, overrides: Partial<WorkOrderListItem> = {}): WorkOrderListItem {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    number: `ZL-2026-${String(index).padStart(4, '0')}`,
    title: `Garaż — pełny proces ${String(index)}`,
    status: 'in_progress',
    coordinator: ANNA,
    createdAt: '2026-10-04T12:05:00.000Z',
    customer: { id: CUSTOMER_ID, displayName: 'Jan Przykładowy' },
    site: { id: '66666666-6666-4666-8666-666666666666', city: 'Łódź', street: 'ul. Żółkiewskiego', buildingNumber: '7' },
    ...overrides,
  };
}

const page = (items: WorkOrderListItem[], nextCursor: string | null = null): WorkOrderList => ({ items, nextCursor });
const ok =
  (items: WorkOrderListItem[] = [order(1)], next: string | null = null): Handler =>
  () =>
    json(200, page(items, next));

const template: WorkOrderTemplate = {
  id: TEMPLATE_ID,
  code: 'garage_full',
  name: 'Garaż — pełny proces',
  siteTypeHint: 'multi_family_garage',
  isActive: true,
  items: [],
  procedures: [],
  paymentMilestones: [],
};

function listApi(list: Handler = ok(), search: Handler = ok([])) {
  return activeSessionApi({
    [LIST]: list,
    [SEARCH]: search,
    [TEMPLATES]: () => json(200, { items: [template], nextCursor: null }),
  });
}

const lastBody = (api: ReturnType<typeof listApi>): Record<string, unknown> =>
  parseBody(api.calls(SEARCH).at(-1)?.body ?? '{}') as Record<string, unknown>;
const field = () => screen.getByRole('searchbox', { name: 'Szukaj: numer, tytuł, klient, adres…' });
const topBar = () => screen.getByRole('searchbox', { name: 'Szukaj zleceń…' });

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('W-10 customer and location on the list (EVM-072 AC1)', () => {
  it('EVM-072 AC1 the column "Klient" shows the name and, under it, the street with the number and the city; "Lokalizacja" is its own column', async () => {
    await renderPanel(PATH, listApi(ok([order(42, { title: 'Garaż — pełny' })])));
    const table = await screen.findByRole('table', { name: 'Lista zleceń' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers.slice(0, 3)).toEqual(['Zlecenie', 'Klient', 'Lokalizacja']);
    const cells = within(table).getAllByRole('cell');
    expect(cells[1]?.textContent).toBe('Jan Przykładowyul. Żółkiewskiego 7, Łódź');
    expect(cells[2]?.textContent).toBe('ul. Żółkiewskiego 7Łódź');
    // The location of the second line is hidden where the column of its own is shown (no repetition on `wide`).
    expect(within(cells[1] as HTMLElement).getByText('ul. Żółkiewskiego 7, Łódź').className).toContain('wide:hidden');
    // Below `expanded` the first cell carries both lines.
    expect(cells[0]?.textContent).toContain('Jan Przykładowy');
    expect(cells[0]?.textContent).toContain('ul. Żółkiewskiego 7, Łódź');
  });

  it('EVM-072 AC1 the name of the row has the customer and the location after the title', async () => {
    await renderPanel(PATH, listApi(ok([order(42, { title: 'Garaż — pełny' })])));
    const link = await screen.findByRole('link', {
      name: 'ZL-2026-0042, Garaż — pełny, Jan Przykładowy, ul. Żółkiewskiego 7, Łódź, status: W realizacji, opiekun: Anna Testowa, utworzono 04.10.2026',
    });
    expect(link.getAttribute('href')).toBe('/work-orders/00000000-0000-4000-8000-000000000042');
  });

  it('EVM-072 AC1 a deleted customer is "Klient usunięty" without a name, an identifier or a link; the location stays', async () => {
    await renderPanel(PATH, listApi(ok([order(7, { customer: { deleted: true } })])));
    const table = await screen.findByRole('table');
    const cells = within(table).getAllByRole('cell');
    expect(cells[1]?.textContent).toBe('Klient usunięty' + 'ul. Żółkiewskiego 7, Łódź');
    expect(cells[1]?.className).not.toContain('font-semibold');
    expect(cells[1]?.querySelector('a')).toBeNull();
    expect(table.textContent).not.toContain('Jan Przykładowy');
    expect(table.textContent).not.toContain(CUSTOMER_ID);
    expect(screen.getByRole('link', { name: /Klient usunięty, ul\. Żółkiewskiego 7, Łódź/ })).toBeTruthy();
  });

  it('EVM-072 AC1 an order without a customer or a location shows a dash named for assistive technology', async () => {
    await renderPanel(PATH, listApi(ok([order(8, { customer: null, site: null })])));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Brak klienta')).toBeTruthy();
    expect(within(table).getByText('Brak lokalizacji')).toBeTruthy();
  });

  it('EVM-072 AC1 names are shown as text only — markup in a customer name or a street is not interpreted', async () => {
    await renderPanel(
      PATH,
      listApi(
        ok([
          order(9, {
            customer: { id: CUSTOMER_ID, displayName: '<img src=x onerror=alert(1)> Jan' },
            site: { id: 'x', city: '<b>Łódź</b>', street: '<script>1</script>', buildingNumber: '1' },
          }),
        ]),
      ),
    );
    const table = await screen.findByRole('table');
    expect(table.querySelector('img')).toBeNull();
    expect(table.querySelector('b')).toBeNull();
    expect(table.querySelector('script')).toBeNull();
    expect(table.textContent).toContain('<img src=x onerror=alert(1)> Jan');
  });
});

describe('W-10 search by a phrase (EVM-072 AC2)', () => {
  it('EVM-072 AC2 a phrase of 3 characters goes in the body of POST /work-orders/search — never in the address, history state, tab title or a store', async () => {
    const api = listApi(ok([order(1)]), ok([order(42, { title: 'Garaż — pełny' })]));
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(field(), 'Lodz');
    expect(await screen.findByRole('link', { name: /ZL-2026-0042/ })).toBeTruthy();
    expect(api.calls(SEARCH)).toHaveLength(1);
    expect(lastBody(api)).toEqual({ query: 'Lodz', view: 'all_open', sort: '-number', limit: 25 });
    expect(api.calls(SEARCH)[0]?.headers.get('content-type')).toContain('application/json');
    // The phrase is nowhere in the address, in the state of the history, in the title or in a store of the browser.
    expect(history.location.pathname + history.location.search + history.location.hash).toBe(PATH);
    expect(JSON.stringify(history.location.state)).not.toContain('Lodz');
    expect(document.title).toBe('Zlecenia · EVia Manager');
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
    expect(api.requests.every((request) => !request.path.includes('Lodz') && !request.query.toString().includes('Lodz'))).toBe(true);
    expect(screen.getByText('Wczytano wyniki wyszukiwania.')).toBeTruthy();
  });

  it('EVM-072 AC2 every phrase of the story is sent as typed, with Polish letters normalised (NFC) and trimmed', async () => {
    const api = listApi(ok(), ok([order(42)]));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(field(), 'Garaż — pełny  ');
    await screen.findByRole('link', { name: /ZL-2026-0042/ });
    expect(lastBody(api)['query']).toBe('Garaż — pełny');
  });

  it('EVM-072 AC2 fewer than 3 characters are never sent: the hint stays and the plain list stays', async () => {
    const api = listApi();
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(field(), '00');
    expect(screen.getAllByText('Co najmniej 3 znaki: numer, tytuł, nazwisko klienta albo adres.').length).toBeGreaterThan(0);
    expect(api.calls(SEARCH)).toHaveLength(0);
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('EVM-072 AC2 a phrase longer than 100 characters is not sent and the hint says so', async () => {
    const api = listApi();
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.click(field());
    await userEvent.paste('a'.repeat(101));
    expect(screen.getByText('Fraza może mieć najwyżej 100 znaków.')).toBeTruthy();
    expect(api.calls(SEARCH)).toHaveLength(0);
  });

  it('EVM-072 AC2 the field has no autocomplete (the form history of the browser would keep the phrase)', async () => {
    await renderPanel(PATH, listApi());
    await screen.findByRole('table');
    expect(field().getAttribute('autocomplete')).toBe('off');
    expect(topBar().getAttribute('autocomplete')).toBe('off');
  });

  it('EVM-072 AC2 the TopBar search from another screen leads to W-10, where the phrase is searched and shown in both fields', async () => {
    const api = listApi(ok(), ok([order(42)]));
    const { history } = await renderPanel('/customers', api, { heading: true });
    await userEvent.type(topBar(), 'zolkiewskiego');
    expect(await screen.findByRole('link', { name: /ZL-2026-0042/ })).toBeTruthy();
    expect(history.location.pathname).toBe(PATH);
    expect(history.location.search).toBe('');
    expect(lastBody(api)['query']).toBe('zolkiewskiego');
    expect(api.calls(SEARCH)).toHaveLength(1);
    expect((field() as HTMLInputElement).value).toBe('zolkiewskiego');
    expect((topBar() as HTMLInputElement).value).toBe('zolkiewskiego');
    expect(document.title).toBe('Zlecenia · EVia Manager');
  });

  it('EVM-072 AC2 the TopBar does not leave the screen for a phrase shorter than 3 characters', async () => {
    const api = listApi();
    const { history } = await renderPanel('/customers', api);
    await userEvent.type(topBar(), 'zo');
    expect(history.location.pathname).toBe('/customers');
    expect(api.calls(SEARCH)).toHaveLength(0);
  });

  it('EVM-072 AC2 a phrase kept in the memory of the tab does not pull the person away from another screen', async () => {
    setWorkOrderPhrase('przykladowy');
    const api = listApi();
    const { history } = await renderPanel('/customers', api);
    expect((topBar() as HTMLInputElement).value).toBe('przykladowy');
    await new Promise((resolve) => globalThis.setTimeout(resolve, 450));
    expect(history.location.pathname).toBe('/customers');
    expect(api.calls(SEARCH)).toHaveLength(0);
  });

  it('EVM-072 AC2 the TopBar phrase typed on a work order leads to the list as well', async () => {
    const api = listApi(ok(), ok([order(42)]));
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    act(() => {
      history.push('/work-orders/new');
    });
    await screen.findByRole('heading', { level: 1, name: 'Nowe zlecenie' });
    await userEvent.type(topBar(), '0042');
    expect(await screen.findByRole('link', { name: /ZL-2026-0042/ })).toBeTruthy();
    expect(history.location.pathname).toBe(PATH);
  });

  it('EVM-072 AC2 "Wyczyść frazę" returns to the plain list', async () => {
    const api = listApi(ok([order(1, { title: 'Plain 1' })]), ok([order(2, { title: 'Found 2' })]));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(field(), 'Przy');
    await screen.findByRole('link', { name: /Found 2/ });
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Filtry listy zleceń' })).getByRole('button', { name: 'Wyczyść frazę' }),
    );
    expect(await screen.findByRole('link', { name: /Plain 1/ })).toBeTruthy();
    expect((field() as HTMLInputElement).value).toBe('');
  });

  it('EVM-072 AC2 a result list passes the accessibility check (axe)', async () => {
    const api = listApi(ok(), ok([order(42), order(43, { customer: { deleted: true } }), order(44, { customer: null, site: null })]));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(field(), 'Przy');
    await screen.findByRole('link', { name: /ZL-2026-0042/ });
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });
});

describe('W-10 search with filters and pages (EVM-072 AC3)', () => {
  it('EVM-072 AC3 the phrase joins the status and the view; the cursor is in the body; a new phrase returns to the first page', async () => {
    const api = listApi(ok(), (request) =>
      (parseBody(request.body) as { cursor?: string }).cursor === 'next-1'
        ? json(200, page([order(27)]))
        : json(200, page([order(2)], 'next-1')),
    );
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Moje' }));
    await userEvent.click(screen.getByRole('button', { name: 'W realizacji' }));
    await userEvent.type(field(), 'Przy');
    await screen.findByRole('link', { name: /ZL-2026-0002/ });
    expect(lastBody(api)).toEqual({ query: 'Przy', view: 'mine', status: ['in_progress'], sort: '-number', limit: 25 });
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByRole('link', { name: /ZL-2026-0027/ })).toBeTruthy();
    expect(lastBody(api)).toEqual({ query: 'Przy', view: 'mine', status: ['in_progress'], sort: '-number', limit: 25, cursor: 'next-1' });
    await userEvent.type(field(), 'k');
    expect(await screen.findByRole('link', { name: /ZL-2026-0002/ })).toBeTruthy();
    expect(lastBody(api)).toEqual({ query: 'Przyk', view: 'mine', status: ['in_progress'], sort: '-number', limit: 25 });
  });

  it('EVM-072 AC3 a cursor the server refuses (400 invalid_cursor) returns to the first page with a message and keeps the phrase', async () => {
    const api = listApi(ok(), (request) =>
      (parseBody(request.body) as { cursor?: string }).cursor === undefined
        ? json(200, page([order(1)], 'old'))
        : problem(400, 'invalid_cursor'),
    );
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(field(), 'Przy');
    await screen.findByRole('link', { name: /ZL-2026-0001/ });
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByText('Lista się zmieniła — wróciliśmy na początek.')).toBeTruthy();
    expect((field() as HTMLInputElement).value).toBe('Przy');
  });

  it('EVM-072 AC3 the filter of "Czekamy na" and the coordinator go with the phrase in the body', async () => {
    const api = listApi(ok([order(1)]), ok([order(2)]));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Czekamy na' }), 'customer');
    await userEvent.type(field(), 'Przy');
    await screen.findByRole('link', { name: /ZL-2026-0002/ });
    expect(lastBody(api)).toMatchObject({ query: 'Przy', waitingOn: 'customer', waitingLongerThanDays: 14 });
  });
});

describe('W-10 "Więcej filtrów" (EVM-072 AC4)', () => {
  it('EVM-072 AC4 the panel opens under the bar with aria-expanded and offers "Typ obiektu" and "Szablon" (the templates by name)', async () => {
    const api = listApi();
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    const button = screen.getByRole('button', { name: 'Więcej filtrów' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(api.calls(TEMPLATES)).toHaveLength(0);
    await userEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-controls') ?? '')?.hasAttribute('hidden')).toBe(false);
    const siteType = screen.getByRole('combobox', { name: 'Typ obiektu' });
    expect(
      within(siteType)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Wszystkie typy', 'Dom jednorodzinny', 'Garaż w budynku wielorodzinnym', 'Obiekt komercyjny', 'Inny']);
    expect(
      await within(screen.getByRole('combobox', { name: 'Szablon' })).findByRole('option', { name: 'Garaż — pełny proces' }),
    ).toBeTruthy();
  });

  it('EVM-072 AC4 a type of object narrows the list at once (GET), is a chip with a count on the button, and is not in the address', async () => {
    const api = listApi(ok([order(1)]));
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Więcej filtrów' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'multi_family_garage');
    await vi.waitFor(() => {
      expect(api.calls(LIST).at(-1)?.query.get('siteType')).toBe('multi_family_garage');
    });
    expect(history.location.search).toBe('');
    const button = screen.getByRole('button', { name: 'Więcej filtrów (1)' });
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Aktywne filtry w panelu: 1');
    const chips = screen.getByRole('group', { name: 'Aktywne filtry' });
    expect(within(chips).getByText('Typ obiektu: Garaż w budynku wielorodzinnym')).toBeTruthy();
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });

  it('EVM-072 AC4 a template goes to the search body together with the phrase and the type of object', async () => {
    const api = listApi(ok([order(1)]), ok([order(2)]));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Więcej filtrów' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'commercial');
    const templates = screen.getByRole('combobox', { name: 'Szablon' });
    await within(templates).findByRole('option', { name: 'Garaż — pełny proces' });
    await userEvent.selectOptions(templates, TEMPLATE_ID);
    expect(screen.getByRole('button', { name: 'Więcej filtrów (2)' })).toBeTruthy();
    await userEvent.type(field(), 'Przy');
    await screen.findByRole('link', { name: /ZL-2026-0002/ });
    expect(lastBody(api)).toMatchObject({ query: 'Przy', siteType: 'commercial', templateId: TEMPLATE_ID });
    expect(api.calls(LIST).at(-1)?.query.get('templateId')).toBe(TEMPLATE_ID);
  });

  it('EVM-072 AC4 "Wyczyść te filtry" clears only the filters of the panel; the chip "✕" clears one', async () => {
    const api = listApi(ok([order(1)]));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Więcej filtrów' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'commercial');
    await userEvent.click(screen.getByRole('button', { name: 'W realizacji' }));
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść te filtry' }));
    await vi.waitFor(() => {
      expect(api.calls(LIST).at(-1)?.query.has('siteType')).toBe(false);
    });
    expect(api.calls(LIST).at(-1)?.query.get('status')).toBe('in_progress');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'other');
    await userEvent.click(screen.getByRole('button', { name: 'Usuń filtr Typ obiektu: Inny' }));
    await vi.waitFor(() => {
      expect(api.calls(LIST).at(-1)?.query.has('siteType')).toBe(false);
    });
  });

  it('EVM-072 AC4 a failed list of templates says so and offers a retry; the other filters keep working', async () => {
    let failing = true;
    const api = listApi(ok([order(1)]));
    api.set(TEMPLATES, () => (failing ? problem(500, 'internal_error') : json(200, { items: [template], nextCursor: null })));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Więcej filtrów' }));
    expect(await screen.findByText('Nie udało się wczytać szablonów.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Typ obiektu' }).getAttribute('disabled')).toBeNull();
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(
      await within(screen.getByRole('combobox', { name: 'Szablon' })).findByRole('option', { name: 'Garaż — pełny proces' }),
    ).toBeTruthy();
  });

  it('EVM-072 AC4 the panel passes the accessibility check (axe), open and with filters on', async () => {
    await renderPanel(PATH, listApi());
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Więcej filtrów' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'commercial');
    await screen.findByRole('button', { name: 'Więcej filtrów (1)' });
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });
});

describe('W-10 states of the search (EVM-072 AC8)', () => {
  it('EVM-072 AC8 no results: "Brak zleceń spełniających filtry." with "Wyczyść filtry", which clears the phrase too', async () => {
    const api = listApi(ok([order(1, { title: 'Plain 1' })]), ok([]));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(field(), 'Zzzz');
    expect(await screen.findByRole('heading', { name: 'Brak zleceń spełniających filtry.' })).toBeTruthy();
    await userEvent.click(screen.getAllByRole('button', { name: 'Wyczyść filtry' })[0] as HTMLElement);
    expect(await screen.findByRole('link', { name: /Plain 1/ })).toBeTruthy();
    expect((field() as HTMLInputElement).value).toBe('');
  });

  it('EVM-072 AC8 429 says how long to wait, keeps the phrase and the filters, and "Spróbuj ponownie" asks again', async () => {
    let limited = true;
    const api = listApi(ok(), () => (limited ? problem(429, 'rate_limited', {}, { 'Retry-After': '61' }) : json(200, page([order(9)]))));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(field(), 'Przy');
    expect((await screen.findByRole('alert')).textContent).toContain('Zbyt wiele zapytań. Spróbuj ponownie za 2 min.');
    expect((field() as HTMLInputElement).value).toBe('Przy');
    limited = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('link', { name: /ZL-2026-0009/ })).toBeTruthy();
  });

  it('EVM-072 AC8 a phrase that is too broad is told so, without an error page and without any value of the answer', async () => {
    const api = listApi(ok(), () =>
      json(400, {
        type: '/problems/validation_failed',
        title: 'validation_failed',
        status: 400,
        code: 'validation_failed',
        traceId: 'abcdef0123456789abcdef0123456789',
        errors: [{ pointer: '/query', code: 'too_broad' }],
      }),
    );
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(field(), '2026');
    expect(await screen.findByText(/Fraza pasuje do zbyt wielu pozycji/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('too_broad');
  });

  it('EVM-072 AC8 a phrase with forbidden characters is told so', async () => {
    const api = listApi(ok(), () =>
      json(400, {
        type: '/problems/validation_failed',
        title: 'validation_failed',
        status: 400,
        code: 'validation_failed',
        traceId: 'abcdef0123456789abcdef0123456789',
        errors: [{ pointer: '/query', code: 'invalid_characters' }],
      }),
    );
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(field(), 'Przy');
    expect(await screen.findByText(/Fraza zawiera niedozwolone znaki/)).toBeTruthy();
  });

  it('EVM-072 AC8 offline: both fields are disabled with "Wyszukasz po powrocie połączenia." and nothing is sent', async () => {
    const api = listApi(ok([order(1)]));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    for (const box of [field(), topBar()]) {
      expect(box.getAttribute('aria-disabled')).toBe('true');
      expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Wyszukasz po powrocie połączenia.');
    }
    const before = api.calls(LIST).length;
    await userEvent.type(field(), 'Przy');
    expect(api.calls(SEARCH)).toHaveLength(0);
    expect(api.calls(LIST)).toHaveLength(before);
  });

  it('EVM-072 AC8 the title of the tab never carries the phrase, also with the results shown', async () => {
    const api = listApi(ok(), ok([order(42)]));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(field(), 'przykladowy');
    await screen.findByRole('link', { name: /ZL-2026-0042/ });
    expect(document.title).toBe('Zlecenia · EVia Manager');
    expect(document.title).not.toContain('przykladowy');
  });

  it('EVM-072 AC5 the answer of a search is not kept in the cache once it is no longer shown (gcTime 0)', async () => {
    const api = listApi(ok(), ok([order(42)]));
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(field(), 'Przy');
    await screen.findByRole('link', { name: /ZL-2026-0042/ });
    act(() => {
      history.push('/customers');
    });
    await screen.findByRole('heading', { level: 1, name: 'Klienci' });
    act(() => {
      history.push(PATH);
    });
    // The phrase is still in the memory of the tab, so the search is asked again — nothing came from the cache.
    await screen.findByRole('link', { name: /ZL-2026-0042/ });
    expect(api.calls(SEARCH).length).toBeGreaterThanOrEqual(2);
  });
});
