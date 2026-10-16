import type { UnpaidPaymentMilestone } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem, type Handler } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import {
  CUSTOMERS,
  fullOf,
  lastQuery,
  orderPayments,
  OVERDUE,
  pageOf,
  roleSession,
  SEARCH,
  SUMMARY,
  TODAY,
  transitionOf,
  TWO,
  unpaid,
  UNPAID_LIST,
  UNPAID_PATH,
  unpaidApi,
} from './unpaid-api.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const ready = () => screen.findByRole('table', { name: 'Nieopłacone transze' });
const rowOf = (text: string): HTMLElement => {
  const row = screen.getByText(text).closest('tr');
  if (row === null) throw new Error(`no row for ${text}`);
  return row;
};
const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
  fireEvent(window, new Event(online ? 'online' : 'offline'));
};

describe('W-11 the list (EVM-055 AC1)', () => {
  it('EVM-055 AC1 the page is "Płatności" in the Sidebar and the table has the columns, sorted by the term with aria-sort', async () => {
    const api = unpaidApi();
    await renderPanel(UNPAID_PATH, api);
    await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'Płatności — nieopłacone' })).toBeTruthy();
    expect(document.title).toBe('Płatności · EVia Manager');
    expect(
      within(screen.getByRole('navigation', { name: 'Główna nawigacja' }))
        .getByRole('link', { name: 'Płatności' })
        .getAttribute('aria-current'),
    ).toBe('page');
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((cell) => cell.textContent)).toEqual([
      'Termin',
      'Dni po terminie',
      'Zlecenie',
      'Klient',
      'Transza',
      'Nr faktury',
      'Kwota',
      'Status',
    ]);
    expect(headers[0]?.getAttribute('aria-sort')).toBe('ascending');
    const query = lastQuery(api);
    expect(query.get('limit')).toBe('25');
    expect(query.has('sort')).toBe(false);
    expect(query.has('view')).toBe(false);
    expect(query.has('cursor')).toBe(false);
  });

  it('EVM-055 AC1 a row: the term, the days, the order with its title (the link to W-06), the customer, the instalment, the invoice, the amount', async () => {
    await renderPanel(UNPAID_PATH, unpaidApi());
    await ready();
    const row = within(rowOf('FV/TEST/0031/2026'));
    expect(row.getByText('28.09.2026')).toBeTruthy();
    expect(row.getByText('5 dni')).toBeTruthy();
    expect(row.getByRole('link', { name: 'ZL-2026-0031' }).getAttribute('href')).toBe(`/work-orders/${OVERDUE.workOrder.id}`);
    expect(row.getByText('Dom — pełny pakiet 31')).toBeTruthy();
    expect(row.getAllByText('Anna Testowa').length).toBeGreaterThan(0);
    expect(row.getByText('Płatność końcowa')).toBeTruthy();
    expect(row.getByText('6 000,00 zł')).toBeTruthy();
    // the rows keep the order of the server: the one longest overdue first
    const numbers = screen.getAllByRole('link', { name: /^ZL-2026-00(31|38)$/ }).map((link) => link.textContent);
    expect(numbers.slice(-2)).toEqual(['ZL-2026-0031', 'ZL-2026-0038']);
  });

  it('EVM-055 AC1 the Administrator and the Editor have "Odnotuj wpłatę" and the menu of the row; the names say which row', async () => {
    for (const session of [undefined, roleSession('editor')]) {
      const { unmount } = await renderPanel(UNPAID_PATH, unpaidApi(undefined, session));
      await ready();
      expect(screen.getByRole('button', { name: 'Odnotuj wpłatę: Płatność końcowa, ZL-2026-0031' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Odnotuj wpłatę: Zaliczka, ZL-2026-0038' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Akcje transzy: Płatność końcowa, ZL-2026-0031' })).toBeTruthy();
      unmount();
    }
  });

  it('EVM-055 AC1 the pages: "Następna strona" sends the cursor, "Poprzednia strona" goes back; the size of the page is sent', async () => {
    const second = pageOf([unpaid(40)], { summary: { filtered: { count: 3, total: { amountMinor: 1410000, currency: 'PLN' } } } });
    const api = unpaidApi((request) =>
      request.query.get('cursor') === 'cursor-2' ? json(200, second) : json(200, pageOf([OVERDUE, TODAY], { nextCursor: 'cursor-2' })),
    );
    await renderPanel(UNPAID_PATH, api);
    await ready();
    expect(screen.getByRole('button', { name: 'Poprzednia strona' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    await screen.findByText('FV/TEST/0040/2026');
    expect(lastQuery(api).get('cursor')).toBe('cursor-2');
    expect(document.activeElement?.textContent).toBe('Wystawione, nieopłacone transze');
    expect(screen.getByRole('button', { name: 'Następna strona' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Poprzednia strona' }));
    await screen.findByText('FV/TEST/0031/2026');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Na stronie' }), '50');
    await waitFor(() => {
      expect(lastQuery(api).get('limit')).toBe('50');
    });
    expect(lastQuery(api).has('cursor')).toBe(false);
  });

  it('EVM-055 AC1 a cursor the server refuses brings back the first page with a message', async () => {
    const api = unpaidApi((request) =>
      request.query.has('cursor') ? problem(400, 'invalid_cursor') : json(200, pageOf([OVERDUE], { nextCursor: 'old' })),
    );
    await renderPanel(UNPAID_PATH, api);
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByText('Zestawienie się zmieniło — wróciliśmy na pierwszą stronę.')).toBeTruthy();
    expect(await screen.findByText('FV/TEST/0031/2026')).toBeTruthy();
  });
});

describe('W-11 "Po terminie" (EVM-055 AC2)', () => {
  it('EVM-055 AC2 the term 2026-09-28 is "Po terminie" with the icon, the label and "5 dni"; the term of the day itself is "Wystawiona" without a mark', async () => {
    await renderPanel(UNPAID_PATH, unpaidApi());
    await ready();
    const overdue = within(rowOf('FV/TEST/0031/2026'));
    const badge = overdue.getByText('Po terminie');
    expect(badge.className).toContain('bg-status-payment-overdue-bg');
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(overdue.getByText('5 dni').parentElement?.querySelector('svg')).not.toBeNull();
    // the full name for assistive technology: "Wystawiona, po terminie od 5 dni"
    expect(rowOf('FV/TEST/0031/2026').getAttribute('aria-label')).toBe(
      'ZL-2026-0031 Dom — pełny pakiet 31, transza Płatność końcowa, Wystawiona, po terminie od 5 dni',
    );
    const today = within(rowOf('FV/TEST/0038/2026'));
    expect(today.getByText('Wystawiona').className).toContain('bg-status-payment-invoiced-bg');
    expect(today.queryByText('Po terminie')).toBeNull();
    expect(today.queryByText(/dni$/)).toBeNull();
    expect(today.getByText('Nie po terminie').className).toContain('sr-only');
    expect(rowOf('FV/TEST/0038/2026').getAttribute('aria-label')).toBe('ZL-2026-0038 Dom — pełny pakiet 38, transza Zaliczka, Wystawiona');
  });

  it('EVM-055 AC2 one day is "1 dzień" and the name says "od 1 dnia"', async () => {
    const one = unpaid(5, { dueDate: '2026-10-02', isOverdue: true, overdueDays: 1 });
    await renderPanel(
      UNPAID_PATH,
      unpaidApi(() => json(200, pageOf([one]))),
    );
    await ready();
    expect(within(rowOf('FV/TEST/0005/2026')).getByText('1 dzień')).toBeTruthy();
    expect(rowOf('FV/TEST/0005/2026').getAttribute('aria-label')).toContain('Wystawiona, po terminie od 1 dnia');
  });
});

describe('W-11 the tiles and the sum (EVM-055 AC3)', () => {
  it('EVM-055 AC3 the tiles say "12 transz · 48 300,00 zł", "4 · 15 200,00 zł" and "21 dni · ZL-2026-0031" (a link to W-06); the sum under the table is the sum of the filters', async () => {
    await renderPanel(UNPAID_PATH, unpaidApi());
    await ready();
    const tile = (title: string) => within(screen.getByRole('region', { name: title }));
    expect(tile('Nieopłacone').getByText('12 transz · 48 300,00 zł')).toBeTruthy();
    expect(tile('Po terminie').getByText('4 · 15 200,00 zł')).toBeTruthy();
    const longest = tile('Najdłużej po terminie');
    expect(longest.getByText('21 dni ·')).toBeTruthy();
    expect(longest.getByRole('link', { name: 'ZL-2026-0031' }).getAttribute('href')).toBe(
      `/work-orders/${SUMMARY.longestOverdue.workOrder.id}`,
    );
    expect(screen.getByText('Suma (2 transze): 10 500,00 zł')).toBeTruthy();
    expect(screen.getByText('2 transze · Sortowanie: Najdłużej po terminie')).toBeTruthy();
  });

  it('EVM-055 AC3 without an overdue instalment the third tile says so; one instalment is "1 transza"', async () => {
    await renderPanel(
      UNPAID_PATH,
      unpaidApi(() =>
        json(
          200,
          pageOf([TODAY], {
            summary: {
              unpaid: { count: 1, total: { amountMinor: 450000, currency: 'PLN' } },
              overdue: { count: 0, total: { amountMinor: 0, currency: 'PLN' } },
              longestOverdue: null,
              filtered: { count: 1, total: { amountMinor: 450000, currency: 'PLN' } },
            },
          }),
        ),
      ),
    );
    await ready();
    expect(screen.getByText('Brak transz po terminie')).toBeTruthy();
    expect(screen.getByText('1 transza · 4 500,00 zł')).toBeTruthy();
    expect(screen.getByText('0 · 0,00 zł')).toBeTruthy();
  });

  it('EVM-055 AC3 the tiles stay while the list is read again for a filter', async () => {
    let release: (() => void) | undefined;
    const api = unpaidApi((request) => {
      if (!request.query.has('view')) return json(200, TWO);
      return new Promise<Response>((resolve) => {
        release = () => {
          resolve(json(200, pageOf([OVERDUE])));
        };
      });
    });
    await renderPanel(UNPAID_PATH, api);
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Po terminie' }));
    expect(await screen.findByText('Ładowanie…')).toBeTruthy();
    expect(screen.getByText('12 transz · 48 300,00 zł')).toBeTruthy();
    release?.();
    await ready();
  });
});

describe('W-11 the filters (EVM-055 AC4)', () => {
  it('EVM-055 AC4 "Po terminie" is the only filter in the address: view=overdue; "Wszystkie wystawione" removes it', async () => {
    const api = unpaidApi();
    const { history } = await renderPanel(UNPAID_PATH, api);
    await ready();
    expect(screen.getByRole('button', { name: 'Wszystkie wystawione' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Po terminie' }));
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('overdue');
    });
    expect(history.location.search).toBe('?view=overdue');
    expect(screen.getByRole('button', { name: 'Po terminie' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Wszystkie wystawione' }));
    await waitFor(() => {
      expect(lastQuery(api).has('view')).toBe(false);
    });
    expect(history.location.search).toBe('');
  });

  it('EVM-055 AC4 only the view of the address is read (a customer, a range or a cursor in it is ignored); the range of the terms goes to the API and stays out of the address and the title', async () => {
    const api = unpaidApi();
    const { history } = await renderPanel(`${UNPAID_PATH}?view=overdue&dueFrom=2026-09-01&customerId=x&cursor=y`, api);
    await ready();
    const first = api.calls(UNPAID_LIST)[0]?.query;
    expect([first?.get('view'), first?.has('dueFrom'), first?.has('customerId'), first?.has('cursor')]).toEqual([
      'overdue',
      false,
      false,
      false,
    ]);
    fireEvent.change(screen.getByLabelText('Termin od'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Termin do'), { target: { value: '2026-10-03' } });
    await waitFor(() => {
      expect(lastQuery(api).get('dueTo')).toBe('2026-10-03');
    });
    const query = lastQuery(api);
    expect([query.get('view'), query.get('dueFrom'), query.get('dueTo')]).toEqual(['overdue', '2026-09-01', '2026-10-03']);
    expect(history.location.search).not.toContain('2026-10-03');
    expect(document.title).toBe('Płatności · EVia Manager');
    // a change of the view rewrites the address to the view alone
    await userEvent.click(screen.getByRole('button', { name: 'Wszystkie wystawione' }));
    await waitFor(() => {
      expect(history.location.search).toBe('');
    });
  });

  it('EVM-055 AC4 a range with "od" after "do" is refused under the field and not sent', async () => {
    const api = unpaidApi();
    await renderPanel(UNPAID_PATH, api);
    await ready();
    const before = api.calls(UNPAID_LIST).length;
    fireEvent.change(screen.getByLabelText('Termin od'), { target: { value: '2026-10-03' } });
    fireEvent.change(screen.getByLabelText('Termin do'), { target: { value: '2026-10-01' } });
    expect(await screen.findByText('Termin „od” nie może być późniejszy niż „do”.')).toBeTruthy();
    expect(
      api
        .calls(UNPAID_LIST)
        .slice(before)
        .some((call) => call.query.get('dueTo') === '2026-10-01'),
    ).toBe(false);
    fireEvent.change(screen.getByLabelText('Termin do'), { target: { value: '2026-10-05' } });
    await waitFor(() => {
      expect(lastQuery(api).get('dueTo')).toBe('2026-10-05');
    });
  });

  it('EVM-055 AC4 a year outside 2000–2100 is refused under the field and not sent', async () => {
    const api = unpaidApi();
    await renderPanel(UNPAID_PATH, api);
    await ready();
    fireEvent.change(screen.getByLabelText('Termin do'), { target: { value: '1999-12-31' } });
    expect(await screen.findByText('Podaj datę z lat 2000–2100.')).toBeTruthy();
    expect(api.calls(UNPAID_LIST).some((call) => call.query.get('dueTo') === '1999-12-31')).toBe(false);
  });

  it('EVM-055 AC4 the customer is found by POST /customers/search, goes to the API as an identifier and stays out of the address, the title and the console', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const api = unpaidApi(undefined, undefined, {
      [SEARCH]: () => json(200, { items: [{ id: CUSTOMERS.JAN.id, displayName: CUSTOMERS.JAN.displayName, phone: '+48600000001' }] }),
    });
    const { history } = await renderPanel(UNPAID_PATH, api);
    await ready();
    await userEvent.type(screen.getByRole('combobox', { name: 'Klient' }), 'Przyk');
    await userEvent.click(await screen.findByRole('option', { name: /Jan Przykładowy/ }));
    await waitFor(() => {
      expect(lastQuery(api).get('customerId')).toBe(CUSTOMERS.JAN.id);
    });
    const [search] = api.calls(SEARCH);
    expect(parseBody(search?.body ?? '')).toEqual({ query: 'Przyk' });
    expect(history.location.search).toBe('');
    expect(history.location.href).not.toContain('Przyk');
    expect(document.title).toBe('Płatności · EVia Manager');
    expect(JSON.stringify(log.mock.calls)).not.toContain('Przyk');
    // the chosen customer is a chip with an `x`; removing it drops the filter and the focus returns to the search
    const chip = screen.getByRole('button', { name: 'Usuń filtr: klient Jan Przykładowy' });
    expect(document.activeElement).toBe(chip);
    await userEvent.click(chip);
    await waitFor(() => {
      expect(lastQuery(api).has('customerId')).toBe(false);
    });
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Klient' }));
  });

  it('EVM-055 AC4 nothing of the filters or the rows is kept in a store of the browser', async () => {
    const api = unpaidApi();
    await renderPanel(UNPAID_PATH, api);
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Po terminie' }));
    fireEvent.change(screen.getByLabelText('Termin od'), { target: { value: '2026-09-01' } });
    await waitFor(() => {
      expect(lastQuery(api).get('dueFrom')).toBe('2026-09-01');
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('EVM-055 AC4 "Wyczyść filtry" drops the view, the range and the customer at once', async () => {
    const api = unpaidApi();
    const { history } = await renderPanel(`${UNPAID_PATH}?view=overdue`, api);
    await ready();
    fireEvent.change(screen.getByLabelText('Termin od'), { target: { value: '2026-09-01' } });
    await waitFor(() => {
      expect(lastQuery(api).get('dueFrom')).toBe('2026-09-01');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść filtry' }));
    await waitFor(() => {
      expect(lastQuery(api).has('dueFrom')).toBe(false);
    });
    expect(lastQuery(api).has('view')).toBe(false);
    expect(history.location.search).toBe('');
    expect(screen.queryByRole('button', { name: 'Wyczyść filtry' })).toBeNull();
  });
});

describe('W-11 Tylko odczyt (EVM-055 AC5)', () => {
  it('EVM-055 AC5 Tylko odczyt sees the amounts, the numbers, the terms and "Po terminie" without any action and without the menu', async () => {
    await renderPanel(UNPAID_PATH, unpaidApi(undefined, roleSession('read_only')));
    await ready();
    const row = within(rowOf('FV/TEST/0031/2026'));
    expect(row.getByText('6 000,00 zł')).toBeTruthy();
    expect(row.getByText('28.09.2026')).toBeTruthy();
    expect(row.getByText('Po terminie')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Odnotuj wpłatę/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Akcje transzy/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Płatności' })).toBeTruthy();
  });
});

describe('W-11 the limits (EVM-055 AC6)', () => {
  it('EVM-055 AC6 429 says when to try again and "Spróbuj ponownie" reads the list again', async () => {
    const answers: Handler[] = [() => problem(429, 'rate_limited', {}, { 'Retry-After': '600' }), () => json(200, TWO)];
    const api = unpaidApi((request) => (answers.shift() ?? (() => json(200, TWO)))(request));
    await renderPanel(UNPAID_PATH, api);
    expect(await screen.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 10 min.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await ready();
    expect(api.calls(UNPAID_LIST)).toHaveLength(2);
  });
});

describe('W-11 the states (EVM-055 AC8)', () => {
  it('EVM-055 AC8 nothing unpaid: "Wszystkie wystawione faktury są opłacone." with the tiles at zero', async () => {
    const zero = { count: 0, total: { amountMinor: 0, currency: 'PLN' } } as const;
    await renderPanel(
      UNPAID_PATH,
      unpaidApi(() => json(200, pageOf([], { summary: { unpaid: zero, overdue: zero, longestOverdue: null, filtered: zero } }))),
    );
    expect(await screen.findByRole('heading', { level: 2, name: 'Wszystkie wystawione faktury są opłacone.' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('0 transz · 0,00 zł')).toBeTruthy();
  });

  it('EVM-055 AC8 no result of the filters: "Brak transz spełniających filtry." and "Wyczyść filtry" brings the list back', async () => {
    const zero = { count: 0, total: { amountMinor: 0, currency: 'PLN' } } as const;
    const api = unpaidApi((request) =>
      request.query.has('view') ? json(200, pageOf([], { summary: { filtered: zero } })) : json(200, TWO),
    );
    await renderPanel(UNPAID_PATH, api);
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Po terminie' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Brak transz spełniających filtry.' })).toBeTruthy();
    const empty = screen.getByRole('heading', { level: 2, name: 'Brak transz spełniających filtry.' }).closest('section');
    await userEvent.click(within(empty as HTMLElement).getByRole('button', { name: 'Wyczyść filtry' }));
    await ready();
  });

  it('EVM-055 AC8 the skeleton while loading says so; an error has "Spróbuj ponownie"', async () => {
    const answers: Handler[] = [() => problem(500, 'internal_error'), () => json(200, TWO)];
    const api = unpaidApi((request) => (answers.shift() ?? (() => json(200, TWO)))(request));
    await renderPanel(UNPAID_PATH, api);
    expect(await screen.findByRole('heading', { level: 2, name: 'Nie udało się wczytać płatności.' })).toBeTruthy();
    expect(screen.queryByText(/internal_error/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await ready();
  });

  it('EVM-055 AC8 offline the last page stays with the banner, the filters and the actions are disabled', async () => {
    const api = unpaidApi();
    await renderPanel(UNPAID_PATH, api);
    await ready();
    setOnline(false);
    expect(await screen.findByText(/^Dane mogą być nieaktualne \(z \d\d:\d\d\)$/)).toBeTruthy();
    expect(screen.getByText('FV/TEST/0031/2026')).toBeTruthy();
    const pay = screen.getByRole('button', { name: 'Odnotuj wpłatę: Płatność końcowa, ZL-2026-0031' });
    expect(pay.getAttribute('aria-disabled')).toBe('true');
    expect(pay.title).toBe('Zmienisz po powrocie połączenia.');
    expect(screen.getByRole('button', { name: 'Po terminie' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole<HTMLInputElement>('combobox', { name: /Klient/ }).disabled).toBe(true);
    // the menu is there, its items are disabled with the reason
    await userEvent.click(screen.getByRole('button', { name: 'Akcje transzy: Płatność końcowa, ZL-2026-0031' }));
    expect(screen.getByRole('menuitem', { name: /Popraw dane faktury…/ }).getAttribute('aria-disabled')).toBe('true');
    expect(api.calls(UNPAID_LIST)).toHaveLength(1);
  });
});

describe('W-11 "Odnotuj wpłatę" (EVM-055 AC1, AC8; the dialog of EVM-054)', () => {
  // the clock of the story: today is 2026-10-03 in Europe/Warsaw (the dialog counts the days after the term with it)
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T10:00:00.000Z'));
  });

  const pay = async (row: UnpaidPaymentMilestone = OVERDUE) => {
    await userEvent.click(screen.getByRole('button', { name: `Odnotuj wpłatę: ${row.name}, ${row.workOrder.number}` }));
    return within(await screen.findByRole('alertdialog', { name: `Odnotować wpłatę za transzę „${row.name}”?` }));
  };

  it('EVM-055 AC1 the dialog has the summary of the row; the payment goes with If-Match of the row, the row leaves the list, the toast has no "Cofnij"', async () => {
    let items = [OVERDUE, TODAY];
    const api = unpaidApi(() => json(200, pageOf(items)), undefined, {
      [transitionOf(OVERDUE)]: () => {
        items = [TODAY];
        return json(200, fullOf(OVERDUE, { status: 'paid', paidOn: '2026-10-03', version: 4 }));
      },
    });
    await renderPanel(UNPAID_PATH, api);
    await ready();
    const view = await pay();
    expect(view.getByText('ZL-2026-0031 · Dom — pełny pakiet 31')).toBeTruthy();
    expect(view.getByText('Faktura FV/TEST/0031/2026 · 6 000,00 zł')).toBeTruthy();
    expect(view.getByText('Termin 28.09.2026 (5 dni po terminie)')).toBeTruthy();
    await userEvent.click(view.getByRole('button', { name: 'Odnotuj wpłatę' }));
    expect(await screen.findByText('Odnotowano wpłatę 6 000,00 zł za fakturę FV/TEST/0031/2026.')).toBeTruthy();
    const [request] = api.calls(transitionOf(OVERDUE).replace('POST ', 'POST ')).slice(-1);
    expect(request?.headers.get('If-Match')).toBe('"3"');
    expect(request?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(parseBody(request?.body ?? '')).toMatchObject({ to: 'paid' });
    await waitFor(() => {
      expect(screen.queryByText('FV/TEST/0031/2026')).toBeNull();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /Cofnij/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('EVM-055 AC8 412: the alert names the status of now, read from the instalments of the order, and "Odśwież" closes the dialog and reads the list again', async () => {
    let items = [OVERDUE, TODAY];
    const api = unpaidApi(() => json(200, pageOf(items)), undefined, {
      [transitionOf(OVERDUE)]: () => {
        items = [TODAY];
        return problem(412, 'version_conflict');
      },
      [`GET ${orderPayments(OVERDUE)}`]: () =>
        json(200, {
          items: [fullOf(OVERDUE, { status: 'paid', paidOn: '2026-10-02', version: 4 })],
          totals: { unpaid: { amountMinor: 0, currency: 'PLN' }, paid: { amountMinor: 600000, currency: 'PLN' } },
        }),
    });
    await renderPanel(UNPAID_PATH, api);
    await ready();
    const view = await pay();
    await userEvent.click(view.getByRole('button', { name: 'Odnotuj wpłatę' }));
    const alert = await view.findByText('Tę transzę zmieniono w międzyczasie (teraz: «Opłacona»).');
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    await userEvent.click(view.getByRole('button', { name: 'Odśwież' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => {
      expect(screen.queryByText('FV/TEST/0031/2026')).toBeNull();
    });
  });

  it('EVM-055 AC8 409 work_order_closed: the alert says the order is closed (the status of the order is unknown here)', async () => {
    const api = unpaidApi(undefined, undefined, { [transitionOf(OVERDUE)]: () => problem(409, 'work_order_closed') });
    await renderPanel(UNPAID_PATH, api);
    await ready();
    const view = await pay();
    await userEvent.click(view.getByRole('button', { name: 'Odnotuj wpłatę' }));
    expect(
      await view.findByText(/Zlecenie jest już zamknięte — płatności są tylko do odczytu\. Zmienisz je po przywróceniu zlecenia\./),
    ).toBeTruthy();
  });

  it('EVM-055 AC8 the Editor sees the other text of a closed order', async () => {
    const api = unpaidApi(undefined, roleSession('editor'), { [transitionOf(OVERDUE)]: () => problem(409, 'work_order_closed') });
    await renderPanel(UNPAID_PATH, api);
    await ready();
    const view = await pay();
    await userEvent.click(view.getByRole('button', { name: 'Odnotuj wpłatę' }));
    expect(await view.findByText(/Przywrócić zlecenie może tylko administrator\./)).toBeTruthy();
  });
});

describe('W-11 the menu of the row (EVM-055 AC1; EVM-054 AC4, AC5)', () => {
  const openDetails = async (row: UnpaidPaymentMilestone) => {
    await userEvent.click(screen.getByRole('button', { name: `Akcje transzy: ${row.name}, ${row.workOrder.number}` }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Popraw dane faktury…' }));
  };

  it('EVM-055 AC1 "Popraw dane faktury…" reads the instalments of the order, opens the dialog with the date of the invoice and the list shows the change', async () => {
    let row = OVERDUE;
    const api = unpaidApi(() => json(200, pageOf([row, TODAY])), undefined, {
      [`GET ${orderPayments(OVERDUE)}`]: () =>
        json(200, {
          items: [fullOf(OVERDUE)],
          totals: { unpaid: { amountMinor: 600000, currency: 'PLN' }, paid: { amountMinor: 0, currency: 'PLN' } },
        }),
      [`PATCH ${orderPayments(OVERDUE)}/${OVERDUE.id}`]: () => {
        row = { ...OVERDUE, invoiceNumber: 'FV/TEST/0099/2026', version: 4 };
        return json(200, fullOf(row));
      },
    });
    await renderPanel(UNPAID_PATH, api);
    await ready();
    await openDetails(OVERDUE);
    const view = within(await screen.findByRole('dialog', { name: 'Popraw dane faktury' }));
    expect(view.getByLabelText<HTMLInputElement>('Data wystawienia').value).toBe('2026-09-21');
    const number = view.getByRole('textbox', { name: 'Nr faktury lub proformy' });
    await userEvent.clear(number);
    await userEvent.type(number, 'FV/TEST/0099/2026');
    await userEvent.click(view.getByRole('button', { name: 'Zapisz zmiany' }));
    expect(await screen.findByText('Zapisano dane faktury FV/TEST/0099/2026.')).toBeTruthy();
    await screen.findByText('FV/TEST/0099/2026');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje transzy: Płatność końcowa, ZL-2026-0031' }));
    });
  });

  it('EVM-055 AC1 an instalment that is no longer invoiced is not opened: the list is read again with a message', async () => {
    const api = unpaidApi(undefined, undefined, {
      [`GET ${orderPayments(OVERDUE)}`]: () =>
        json(200, {
          items: [fullOf(OVERDUE, { status: 'paid', paidOn: '2026-10-02' })],
          totals: { unpaid: { amountMinor: 0, currency: 'PLN' }, paid: { amountMinor: 600000, currency: 'PLN' } },
        }),
    });
    await renderPanel(UNPAID_PATH, api);
    await ready();
    const before = api.calls(UNPAID_LIST).length;
    await openDetails(OVERDUE);
    expect(await screen.findByText('Tej transzy nie ma już wśród nieopłaconych. Odświeżyliśmy zestawienie.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(api.calls(UNPAID_LIST).length).toBeGreaterThan(before);
    });
  });

  it('EVM-055 AC1 a failed read of the instalments says so and opens nothing', async () => {
    const api = unpaidApi(undefined, undefined, { [`GET ${orderPayments(OVERDUE)}`]: () => problem(500, 'internal_error') });
    await renderPanel(UNPAID_PATH, api);
    await ready();
    await openDetails(OVERDUE);
    expect(await screen.findByText('Nie udało się wczytać danych transzy. Spróbuj ponownie.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-055 AC1 EVM-057 AC8 the Editor sees the corrections disabled with the reason', async () => {
    await renderPanel(UNPAID_PATH, unpaidApi(undefined, roleSession('editor')));
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Akcje transzy: Płatność końcowa, ZL-2026-0031' }));
    const withdraw = screen.getByRole('menuitem', { name: /Wycofaj fakturę…/ });
    expect(withdraw.getAttribute('aria-disabled')).toBe('true');
    expect(withdraw.getAttribute('title')).toBe('Korektę płatności może wykonać tylko administrator.');
  });
});

describe('W-11 the data are text, the page is accessible (EVM-055 AC1, AC5)', () => {
  it('EVM-055 AC1 names, titles and numbers are text, never markup (SR-WEB-03); a deleted customer has no name', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    const rows = [
      unpaid(1, {
        name: markup,
        workOrder: { id: OVERDUE.workOrder.id, number: 'ZL-2026-0001', title: markup },
        customer: { deleted: true },
      }),
      unpaid(2, { customer: null }),
    ];
    await renderPanel(
      UNPAID_PATH,
      unpaidApi(() => json(200, pageOf(rows))),
    );
    await ready();
    expect(screen.getAllByText(markup).length).toBeGreaterThan(0);
    expect(document.querySelector('img')).toBeNull();
    expect(within(rowOf('FV/TEST/0001/2026')).getAllByText('Klient usunięty').length).toBeGreaterThan(0);
    expect(within(rowOf('FV/TEST/0002/2026')).getAllByText('Brak klienta').length).toBeGreaterThan(0);
  });

  it('EVM-055 AC1 a status this panel does not know is the badge of an unknown value', async () => {
    const odd = unpaid(3, { status: 'refunded' as UnpaidPaymentMilestone['status'] });
    await renderPanel(
      UNPAID_PATH,
      unpaidApi(() => json(200, pageOf([odd]))),
    );
    await ready();
    expect(screen.getByText('Nieznany status')).toBeTruthy();
    expect(document.body.textContent).not.toContain('refunded');
    expect(screen.queryByRole('button', { name: /Odnotuj wpłatę/ })).toBeNull();
  });

  it('EVM-055 AC1 the page has no accessibility violations: the list, the filters, the empty and the error state', async () => {
    const api = unpaidApi();
    const { unmount } = await renderPanel(UNPAID_PATH, api);
    await ready();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    unmount();
    const zero = { count: 0, total: { amountMinor: 0, currency: 'PLN' } } as const;
    const empty = await renderPanel(
      UNPAID_PATH,
      unpaidApi(() => json(200, pageOf([], { summary: { unpaid: zero, overdue: zero, longestOverdue: null, filtered: zero } }))),
    );
    await screen.findByRole('heading', { level: 2, name: 'Wszystkie wystawione faktury są opłacone.' });
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    empty.unmount();
    await renderPanel(
      UNPAID_PATH,
      unpaidApi(() => problem(500, 'internal_error')),
    );
    await screen.findByRole('heading', { level: 2, name: 'Nie udało się wczytać płatności.' });
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-055 AC5 the page of Tylko odczyt has no accessibility violations', async () => {
    await renderPanel(UNPAID_PATH, unpaidApi(undefined, roleSession('read_only')));
    await ready();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });
});
