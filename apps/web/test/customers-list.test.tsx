import type { CustomerList, CustomerSearchItem } from '@evia/contracts';
import { act, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler, type Recorded } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';

const LIST = 'GET /api/v1/customers';
const SEARCH = 'POST /api/v1/customers/search';
const PATH = '/customers';

function customer(index: number, overrides: Partial<CustomerSearchItem> = {}): CustomerSearchItem {
  const id = `01968f3e-0000-7000-8000-${String(index).padStart(12, '0')}`;
  return {
    id,
    kind: 'person',
    displayName: `Jan Przykładowy ${String(index)}`,
    sortName: `Przykładowy ${String(index)} Jan`,
    phone: `+486000000${String(index).padStart(2, '0')}`,
    email: null,
    ...overrides,
  };
}

const page = (items: CustomerSearchItem[], nextCursor: string | null = null): CustomerList => ({ items, nextCursor });
const ok =
  (items: CustomerSearchItem[] = [customer(1)], next: string | null = null): Handler =>
  () =>
    json(200, page(items, next));

function listApi(list: Handler = ok(), search: Handler = ok([]), role: 'administrator' | 'editor' | 'read_only' = 'administrator') {
  const session = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } };
  return activeSessionApi({ [SESSION_ROUTE]: () => json(200, session), [LIST]: list, [SEARCH]: search });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('W-14 the list (EVM-039 AC1)', () => {
  it('EVM-039 AC1 opens with 25 on a page in the order of the API, with the four columns and the sorted column marked', async () => {
    const api = listApi(
      ok([
        customer(1, { sortName: 'Licznikowy Adam', displayName: 'Adam Licznikowy', phone: '+48600000004' }),
        customer(2, { sortName: 'Ładowarkowa Ewa', displayName: 'Ewa Ładowarkowa', email: 'ewa.ladowarkowa@example.com' }),
        customer(3, {
          kind: 'company',
          sortName: 'Firma Testowa sp. z o.o.',
          displayName: 'Firma Testowa sp. z o.o.',
          phone: '+48220000001',
        }),
      ]),
    );
    await renderPanel(PATH, api);
    const table = await screen.findByRole('table', { name: 'Klienci' });
    const query = api.calls(LIST).at(-1)?.query ?? new URLSearchParams();
    expect(query.get('limit')).toBe('25');
    expect(query.has('cursor')).toBe(false);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Klient (nazwisko i imię / firma)', 'Rodzaj', 'Telefon', 'E-mail']);
    expect(
      within(table)
        .getByRole('columnheader', { name: /Klient/ })
        .getAttribute('aria-sort'),
    ).toBe('ascending');
    expect(
      within(table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Licznikowy Adam',
      'Osoba',
      '+48 600 000 004',
      '—',
      // below the wide breakpoint the e-mail is the second line of the first cell, from it — a column of its own
      'Ładowarkowa Ewaewa.ladowarkowa@example.com',
      'Osoba',
      '+48 600 000 002',
      'ewa.ladowarkowa@example.com',
      'Firma Testowa sp. z o.o.',
      'Firma',
      '+48 220 000 001',
      '—',
    ]);
    expect(document.title).toBe('Klienci · EVia Manager');
  });

  it('EVM-039 AC1 a row is one link named from the visible name of the customer and goes on in the order of the columns; the address has only the identifier', async () => {
    await renderPanel(
      PATH,
      listApi(
        ok([
          customer(7, { sortName: 'Przykładowy Jan', email: 'jan.przykladowy@example.com', phone: '+48600000001' }),
          customer(8, { sortName: 'Licznikowy Adam', phone: '+48600000004' }),
        ]),
      ),
    );
    const withEmail = await screen.findByRole('link', {
      name: 'Przykładowy Jan, osoba, telefon +48 600 000 001, e-mail jan.przykladowy@example.com',
    });
    expect(withEmail.getAttribute('href')).toBe('/customers/01968f3e-0000-7000-8000-000000000007');
    expect(screen.getByRole('link', { name: 'Licznikowy Adam, osoba, telefon +48 600 000 004' })).toBeTruthy();
  });

  it('EVM-039 AC1 the next page asks with the cursor, the previous one goes back, the focus moves to the heading of the table and the change is announced', async () => {
    const api = listApi((request: Recorded) =>
      request.query.get('cursor') === 'cursor-2' ? json(200, page([customer(26)])) : json(200, page([customer(1)], 'cursor-2')),
    );
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Poprzednia strona' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByRole('link', { name: /Przykładowy 26 Jan/ })).toBeTruthy();
    expect(api.calls(LIST).at(-1)?.query.get('cursor')).toBe('cursor-2');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Lista klientów' }));
    expect(screen.getByText('Wczytano następną stronę klientów.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Następna strona' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Poprzednia strona' }));
    expect(await screen.findByRole('link', { name: /Przykładowy 1 Jan/ })).toBeTruthy();
    expect(screen.getByText('Wczytano poprzednią stronę klientów.')).toBeTruthy();
  });

  it('EVM-039 AC1 a phrase of 3 characters goes in the body of POST /customers/search — never in the address, the tab title or a store of the browser', async () => {
    const api = listApi(ok([customer(1)]), ok([customer(5, { sortName: 'Przykładowy Jan', displayName: 'Jan Przykładowy' })]));
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    const field = screen.getByRole('searchbox', { name: 'Szukaj klientów' });
    await userEvent.type(field, 'Lodz');
    expect(await screen.findByRole('link', { name: /Przykładowy Jan/ })).toBeTruthy();
    const searches = api.calls(SEARCH);
    expect(searches).toHaveLength(1);
    expect(parseBody(searches[0]?.body ?? '')).toEqual({ query: 'Lodz', limit: 25 });
    expect(searches[0]?.headers.get('content-type')).toContain('application/json');
    expect(history.location.pathname + history.location.search + history.location.hash).toBe(PATH);
    expect(document.title).toBe('Klienci · EVia Manager');
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
    expect(screen.getByText('Wczytano wyniki wyszukiwania.')).toBeTruthy();
  });

  it('EVM-039 AC1 fewer than 3 characters are never sent, the hint stays and the full list stays', async () => {
    const api = listApi();
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Szukaj klientów' }), 'Lo');
    expect(screen.getByText('Co najmniej 3 znaki: nazwisko, nazwa firmy, NIP, telefon albo e-mail.')).toBeTruthy();
    expect(api.calls(SEARCH)).toHaveLength(0);
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('EVM-039 AC1 a phrase longer than 100 characters is not sent and the hint says so', async () => {
    const api = listApi();
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('searchbox', { name: 'Szukaj klientów' }));
    await userEvent.paste('a'.repeat(101));
    expect(screen.getByText('Fraza może mieć najwyżej 100 znaków.')).toBeTruthy();
    expect(api.calls(SEARCH)).toHaveLength(0);
  });

  it('EVM-039 AC1 the search has its own cursor pages in the body; changing the phrase returns to the first page', async () => {
    const api = listApi(ok(), (request) =>
      (parseBody(request.body) as { cursor?: string }).cursor === 'next-1'
        ? json(200, page([customer(27)]))
        : json(200, page([customer(2)], 'next-1')),
    );
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Szukaj klientów' }), 'Przy');
    await screen.findByRole('link', { name: /Przykładowy 2 Jan/ });
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByRole('link', { name: /Przykładowy 27 Jan/ })).toBeTruthy();
    expect(parseBody(api.calls(SEARCH).at(-1)?.body ?? '')).toEqual({ query: 'Przy', limit: 25, cursor: 'next-1' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Szukaj klientów' }), 'k');
    expect(await screen.findByRole('link', { name: /Przykładowy 2 Jan/ })).toBeTruthy();
    expect(parseBody(api.calls(SEARCH).at(-1)?.body ?? '')).toEqual({ query: 'Przyk', limit: 25 });
  });

  it('EVM-039 AC1 "Wyczyść frazę" returns to the full list', async () => {
    const api = listApi(ok([customer(1)]), ok([customer(2)]));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Szukaj klientów' }), 'Przy');
    await screen.findByRole('link', { name: /Przykładowy 2 Jan/ });
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść frazę' }));
    expect(await screen.findByRole('link', { name: /Przykładowy 1 Jan/ })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('');
  });

  it('EVM-039 AC1 names are shown as text only — markup in them is not interpreted', async () => {
    await renderPanel(PATH, listApi(ok([customer(3, { sortName: '<img src=x onerror=alert(1)> Jan', email: '<b>x</b>@example.com' })])));
    const table = await screen.findByRole('table');
    expect(table.querySelector('img')).toBeNull();
    expect(table.querySelector('b')).toBeNull();
    expect(table.textContent).toContain('<img src=x onerror=alert(1)> Jan');
  });

  it('EVM-039 AC1 the list passes axe', async () => {
    await renderPanel(PATH, listApi(ok([customer(1), customer(2, { email: 'jan@example.com' })], 'c')));
    await screen.findByRole('table');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-039 AC1 "Klienci" in the Sidebar leads to the list and is the current page there', async () => {
    await renderPanel('/work-orders', listApi());
    const nav = screen.getByRole('navigation', { name: 'Główna nawigacja' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Klienci' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Klienci' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Klienci' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('W-14 the states of the list (EVM-039 AC8)', () => {
  it('EVM-039 AC8 no customers: "Nie masz jeszcze klientów. Dodasz ich przy nowym zleceniu." for the Administrator and the Editor', async () => {
    for (const role of ['administrator', 'editor'] as const) {
      const { unmount } = await renderPanel(PATH, listApi(ok([]), ok([]), role));
      expect(await screen.findByRole('heading', { level: 2, name: 'Nie masz jeszcze klientów.' })).toBeTruthy();
      expect(screen.getByText('Dodasz ich przy nowym zleceniu.')).toBeTruthy();
      unmount();
    }
  });

  it('EVM-039 AC8 no customers for Tylko odczyt: "Nie ma jeszcze klientów." (nothing to add)', async () => {
    await renderPanel(PATH, listApi(ok([]), ok([]), 'read_only'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Nie ma jeszcze klientów.' })).toBeTruthy();
    expect(screen.queryByText(/Dodasz ich/)).toBeNull();
  });

  it('EVM-039 AC8 no results: "Brak klientów spełniających kryteria." with "Wyczyść wyszukiwanie", which returns to the list', async () => {
    const api = listApi(ok([customer(1)]), ok([]));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Szukaj klientów' }), 'Zzzz');
    expect(await screen.findByRole('heading', { level: 2, name: 'Brak klientów spełniających kryteria.' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść wyszukiwanie' }));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('EVM-039 AC8 loading is a Skeleton with a text status; after 10 s it says the load takes longer than usual', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    await renderPanel(
      PATH,
      listApi(() => pending),
    );
    expect(screen.getByText('Ładowanie…').closest('[aria-busy="true"]')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText('Ładowanie trwa dłużej niż zwykle…')).toBeTruthy();
    release(json(200, page([customer(1)])));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('EVM-039 AC8 a 429 says how long to wait (from Retry-After, rounded up in minutes), the phrase stays and "Spróbuj ponownie" asks again', async () => {
    let limited = true;
    const api = listApi(ok(), () => (limited ? problem(429, 'rate_limited', {}, { 'Retry-After': '61' }) : json(200, page([customer(9)]))));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Szukaj klientów' }), 'Przy');
    expect((await screen.findByRole('alert')).textContent).toContain('Zbyt wiele zapytań. Spróbuj ponownie za 2 min.');
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('Przy');
    limited = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('link', { name: /Przykładowy 9 Jan/ })).toBeTruthy();
  });

  it('EVM-039 AC8 an error shows "Nie udało się wczytać klientów." with a retry; no technical detail is shown', async () => {
    let failing = true;
    const api = listApi(() => (failing ? problem(500, 'internal_error') : json(200, page([customer(1)]))));
    await renderPanel(PATH, api);
    expect(await screen.findByRole('heading', { level: 2, name: 'Nie udało się wczytać klientów.' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('internal_error');
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('EVM-039 AC8 a cursor the server refuses (400 invalid_cursor) returns to the first page with a message', async () => {
    const api = listApi((request) =>
      request.query.get('cursor') === null ? json(200, page([customer(1)], 'old')) : problem(400, 'invalid_cursor'),
    );
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByText('Lista się zmieniła — wróciliśmy na początek.')).toBeTruthy();
    expect(await screen.findByRole('link', { name: /Przykładowy 1 Jan/ })).toBeTruthy();
  });

  it('EVM-039 AC8 offline: the last page stays with "Dane mogą być nieaktualne (z …)", the search and the pages are disabled with their reasons, nothing in the stores', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:05:00.000Z'));
    const api = listApi(ok([customer(1)], 'more'));
    await renderPanel(PATH, api);
    await screen.findByRole('table');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('Dane mogą być nieaktualne (z 14:05)').closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('table')).toBeTruthy();
    const field = screen.getByRole('searchbox', { name: 'Szukaj klientów' });
    expect(field.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Wyszukasz po powrocie połączenia.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Następna strona' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Brak połączenia — strony są niedostępne.')).toBeTruthy();
    const before = api.calls(LIST).length;
    await userEvent.type(field, 'Przy');
    expect(api.calls(SEARCH)).toHaveLength(0);
    expect(api.calls(LIST)).toHaveLength(before);
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });

  it('EVM-039 AC8 the list is not kept in the memory of the tab once the page is left (gcTime 0): leaving it drops the pages', async () => {
    const { history } = await renderPanel(PATH, listApi());
    await screen.findByRole('table');
    act(() => {
      history.push('/work-orders');
    });
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    expect(screen.queryByRole('table', { name: 'Klienci' })).toBeNull();
  });
});
