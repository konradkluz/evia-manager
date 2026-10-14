import type { UserRole, WorkOrderList, WorkOrderListItem, WorkOrderPayment } from '@evia/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';

// W-10 and the payments (EVM-056 AC1–AC3, AC7, AC8): the column "Płatność", the views "Po terminie" and "Nieopłacone" and the
// sort "Najpilniejsze". The server counts the state and the sums from its own day (the panel never compares dates).
const LIST = 'GET /api/v1/work-orders';
const PATH = '/work-orders';
const ANNA = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa' };

const NBSP = ' ';
const pln = (amountMinor: number) => ({ amountMinor, currency: 'PLN' as const });
const payment = (state: string, invoicedCount: number, invoiced: number, overdue: number): WorkOrderPayment => ({
  state,
  invoicedCount,
  invoicedTotal: pln(invoiced),
  overdueTotal: pln(overdue),
});
// The four orders of AC1: an instalment after its due date (3 600,00 zł), one invoiced (4 500,00 zł), all paid, none invoiced.
const OVERDUE = payment('overdue', 1, 360_000, 360_000);
const UNPAID = payment('unpaid', 1, 450_000, 0);
const PAID = payment('paid', 0, 0, 0);
const NONE = payment('none', 0, 0, 0);

function order(index: number, overrides: Partial<WorkOrderListItem> = {}): WorkOrderListItem {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    number: `ZL-2026-${String(index).padStart(4, '0')}`,
    title: `Garaż — pełny proces ${String(index)}`,
    status: 'in_progress',
    coordinator: ANNA,
    createdAt: '2026-10-04T12:05:00.000Z',
    waiting: null,
    nextDueDate: null,
    hasOverdueStage: false,
    payment: NONE,
    ...overrides,
  };
}

const page = (items: WorkOrderListItem[], nextCursor: string | null = null): WorkOrderList => ({ items, nextCursor });
const FOUR = [order(1, { payment: OVERDUE }), order(2, { payment: UNPAID }), order(3, { payment: PAID }), order(4, { payment: NONE })];
const ok =
  (items: WorkOrderListItem[] = FOUR): Handler =>
  () =>
    json(200, page(items));

function listApi(handler: Handler = ok(), role: UserRole = 'administrator') {
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } }),
    [LIST]: handler,
  });
}

const lastQuery = (api: ReturnType<typeof listApi>): URLSearchParams => api.calls(LIST).at(-1)?.query ?? new URLSearchParams();
// Cells of a row of W-10: Zlecenie, Klient, Lokalizacja, Status, Czekamy na, Termin, Płatność, Opiekun, Utworzono.
const PAYMENT = 6;
const rowsOf = async () => {
  const table = await screen.findByRole('table', { name: 'Lista zleceń' });
  return within(table).getAllByRole('row').slice(1);
};
const paymentCell = async (index: number) => within((await rowsOf())[index] as HTMLElement).getAllByRole('cell')[PAYMENT] as HTMLElement;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('W-10 column "Płatność" (EVM-056 AC1)', () => {
  it('EVM-056 AC1 the column shows "Po terminie" with the sum, "Nieopłacone (1)" with the sum, "Opłacone" and "—"', async () => {
    await renderPanel(PATH, listApi());
    const table = await screen.findByRole('table', { name: 'Lista zleceń' });
    const header = within(table).getByRole('columnheader', { name: 'Płatność' });
    // § 4.2: the column and its header stand on the right.
    expect(header.className).toContain('text-end');
    const overdue = await paymentCell(0);
    expect(within(overdue).getByText('Po terminie')).toBeTruthy();
    expect(overdue.textContent).toContain(`3${NBSP}600,00${NBSP}zł`);
    // the strong badge carries the icon alarm-clock (not the colour alone)
    expect(within(overdue).getByText('Po terminie').closest('span')?.className).toContain('bg-status-payment-overdue-bg');
    expect(within(overdue).getByText('Po terminie').closest('span')?.querySelector('svg')).not.toBeNull();
    const unpaid = await paymentCell(1);
    expect(within(unpaid).getByText('Nieopłacone (1)').closest('span')?.className).toContain('bg-status-payment-invoiced-bg');
    expect(unpaid.textContent).toContain(`4${NBSP}500,00${NBSP}zł`);
    const paid = await paymentCell(2);
    expect(within(paid).getByText('Opłacone').closest('span')?.className).toContain('bg-status-payment-paid-bg');
    expect(paid.textContent).not.toContain('zł');
    const none = await paymentCell(3);
    expect(none.querySelector('[aria-hidden="true"]')?.textContent).toBe('—');
    expect(within(none).getByText('Brak wystawionych transz')).toBeTruthy();
    // the number of days after the due date is not on the list (only in W-06)
    expect(table.textContent).not.toMatch(/dni/);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-056 AC1 the payment closes the full name of the row', async () => {
    await renderPanel(PATH, listApi());
    const links = within(await screen.findByRole('table')).getAllByRole('link');
    const head = (index: number) =>
      `ZL-2026-000${String(index)}, Garaż — pełny proces ${String(index)}, status: W realizacji, opiekun: Anna Testowa, utworzono 04.10.2026`;
    expect(links[0]?.getAttribute('aria-label')).toBe(`${head(1)}, płatność po terminie, 3${NBSP}600,00${NBSP}zł`);
    expect(links[1]?.getAttribute('aria-label')).toBe(`${head(2)}, nieopłacone: 1, 4${NBSP}500,00${NBSP}zł`);
    expect(links[2]?.getAttribute('aria-label')).toBe(`${head(3)}, opłacone`);
    expect(links[3]?.getAttribute('aria-label')).toBe(`${head(4)}, brak wystawionych transz`);
  });

  it('EVM-056 AC1 a state this panel does not know is the "Nieznany status" badge, never the raw value; markup stays text', async () => {
    await renderPanel(PATH, listApi(ok([order(1, { payment: payment('<b>partially_paid</b>', 2, 100, 0) })])));
    const cell = await paymentCell(0);
    expect(within(cell).getByText('Nieznany status')).toBeTruthy();
    expect(document.body.textContent).not.toContain('partially_paid');
    expect(cell.querySelector('b')).toBeNull();
    const link = within(await screen.findByRole('table')).getAllByRole('link')[0];
    expect(link?.getAttribute('aria-label')).toMatch(/płatność: nieznany status$/);
  });

  it('EVM-056 AC1 an item without the field (an answer the panel did not expect) is shown as unknown, not as "no payments"', async () => {
    const item = Object.fromEntries(Object.entries(order(1)).filter(([name]) => name !== 'payment')) as unknown as WorkOrderListItem;
    await renderPanel(PATH, listApi(ok([item])));
    expect(within(await paymentCell(0)).getByText('Nieznany status')).toBeTruthy();
  });
});

describe('W-10 views "Po terminie" and "Nieopłacone" (EVM-056 AC2)', () => {
  it('EVM-056 AC2 "Po terminie" asks for the view and the address carries only its identifier; the chip says it is for open orders', async () => {
    const api = listApi();
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    const chip = screen.getByRole('button', { name: 'Po terminie' });
    expect(document.getElementById(chip.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Tylko zlecenia niezamknięte.');
    await userEvent.click(chip);
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('overdue_payments');
    });
    expect(lastQuery(api).get('sort')).toBe('urgency');
    expect(history.location.search).toBe('?view=overdue_payments');
    expect(screen.getByRole('button', { name: 'Po terminie' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Nieopłacone' }));
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('unpaid');
    });
    expect(history.location.search).toBe('?view=unpaid');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-056 AC2 a link to a view opens it; the change of the view is announced when the list arrives', async () => {
    const api = listApi();
    await renderPanel(`${PATH}?view=unpaid`, api);
    await screen.findByRole('table');
    expect(lastQuery(api).get('view')).toBe('unpaid');
    await userEvent.click(screen.getByRole('button', { name: 'Po terminie' }));
    await waitFor(() => {
      expect(screen.getByText('Widok: Po terminie')).toBeTruthy();
    });
    expect(screen.getByText('Widok: Po terminie').getAttribute('role')).toBe('status');
  });

  it('EVM-056 AC2 empty views have their own words without a button', async () => {
    await renderPanel(`${PATH}?view=overdue_payments`, listApi(ok([])));
    const overdue = await screen.findByRole('heading', { level: 2, name: 'Brak zleceń z płatnością po terminie. Dobra wiadomość.' });
    expect(overdue.closest('section')?.querySelector('button')).toBeNull();
  });

  it('EVM-056 AC2 the empty view "Nieopłacone"', async () => {
    await renderPanel(`${PATH}?view=unpaid`, listApi(ok([])));
    expect(await screen.findByRole('heading', { level: 2, name: 'Brak zleceń z nieopłaconymi transzami.' })).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-056 AC2 a view narrowed further and empty is the usual "Brak zleceń spełniających filtry."', async () => {
    await renderPanel(`${PATH}?view=unpaid&status=new`, listApi(ok([])));
    expect(await screen.findByRole('heading', { level: 2, name: 'Brak zleceń spełniających filtry.' })).toBeTruthy();
  });
});

describe('W-10 sort "Najpilniejsze" (EVM-056 AC3)', () => {
  it('EVM-056 AC3 the list asks for "Najpilniejsze" by default; it is the first option and no column carries aria-sort', async () => {
    const api = listApi();
    const { history } = await renderPanel(PATH, api);
    const table = await screen.findByRole('table');
    expect(lastQuery(api).get('sort')).toBe('urgency');
    const sort = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Sortuj' });
    expect(sort.value).toBe('urgency');
    expect(Array.from(sort.options).map((option) => option.textContent)).toEqual([
      'Najpilniejsze',
      'Najdłużej czekamy',
      'Termin',
      'Numer — od najwyższego',
      'Numer — od najniższego',
      'Utworzono — od najnowszych',
      'Utworzono — od najstarszych',
    ]);
    for (const header of within(table).getAllByRole('columnheader')) expect(header.hasAttribute('aria-sort')).toBe(false);
    expect(history.location.search).toBe('');
  });

  it('EVM-056 AC3 a change of the sort is announced, stays out of the address, and back on "Najpilniejsze" is asked again', async () => {
    const api = listApi();
    const { history } = await renderPanel(PATH, api);
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sortuj' }), 'Termin');
    await waitFor(() => {
      expect(lastQuery(api).get('sort')).toBe('nextDueDate');
    });
    expect(await screen.findByText('Sortowanie: Termin')).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sortuj' }), 'Najpilniejsze');
    await waitFor(() => {
      expect(lastQuery(api).get('sort')).toBe('urgency');
    });
    expect(await screen.findByText('Sortowanie: Najpilniejsze')).toBeTruthy();
    expect(history.location.search).toBe('');
  });

  it('EVM-056 AC3 "Wyczyść filtry" keeps "Najpilniejsze"', async () => {
    const api = listApi();
    await renderPanel(`${PATH}?view=unpaid`, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść filtry' }));
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('all_open');
    });
    expect(lastQuery(api).get('sort')).toBe('urgency');
  });
});

describe('W-10 payments and the roles (EVM-056 AC7)', () => {
  it('EVM-056 AC7 Tylko odczyt sees the column, the views and "Najpilniejsze"', async () => {
    const api = listApi(ok(), 'read_only');
    await renderPanel(PATH, api);
    expect(within(await screen.findByRole('table')).getByRole('columnheader', { name: 'Płatność' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Po terminie' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nieopłacone' })).toBeTruthy();
    expect(lastQuery(api).get('sort')).toBe('urgency');
  });

  it('EVM-056 AC7 a role without the right to read payments (not in v1) has no column, views nor "Najpilniejsze"; a link to a view is not found', async () => {
    const role = 'auditor_of_a_newer_api' as UserRole;
    const api = listApi(ok([order(1)]), role);
    await renderPanel(PATH, api);
    const table = await screen.findByRole('table');
    expect(within(table).queryByRole('columnheader', { name: 'Płatność' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Po terminie' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nieopłacone' })).toBeNull();
    const sort = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Sortuj' });
    expect(Array.from(sort.options).map((option) => option.value)).not.toContain('urgency');
    expect(lastQuery(api).get('sort')).toBe('-number');
    expect(within(table).getAllByRole('link')[0]?.getAttribute('aria-label')).not.toMatch(/płatn|opłac|transz/);
  });

  it('EVM-056 AC7 the link to a payment view of a role without the right: "Nie znaleziono widoku." and nothing is asked', async () => {
    const api = listApi(ok(), 'auditor_of_a_newer_api' as UserRole);
    await renderPanel(`${PATH}?view=overdue_payments`, api);
    expect(await screen.findByRole('heading', { level: 2, name: 'Nie znaleziono widoku.' })).toBeTruthy();
    expect(api.calls(LIST)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż wszystkie zlecenia' }));
    await waitFor(() => {
      expect(lastQuery(api).get('sort')).toBe('-number');
    });
  });
});

describe('W-10 payments and the states (EVM-056 AC8)', () => {
  it('EVM-056 AC8 loading: the skeleton of the rows, and the filters with the views', async () => {
    let release: (response: Response) => void = () => undefined;
    await renderPanel(
      PATH,
      listApi(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    expect((await screen.findByText('Ładowanie…')).closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Po terminie' })).toBeTruthy();
    release(json(200, page(FOUR)));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('EVM-056 AC8 offline: the payments of the last page from the memory of the tab under the banner, views and sort disabled', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:05:00.000Z'));
    const api = listApi();
    await renderPanel(`${PATH}?view=unpaid`, api);
    await screen.findByRole('table');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('Dane mogą być nieaktualne (z 14:05)')).toBeTruthy();
    expect((await paymentCell(0)).textContent).toContain(`3${NBSP}600,00${NBSP}zł`);
    expect(screen.getByRole('button', { name: 'Po terminie' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Nieopłacone' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Sortuj' }).disabled).toBe(true);
    const before = api.calls(LIST).length;
    await userEvent.click(screen.getByRole('button', { name: 'Po terminie' }));
    expect(api.calls(LIST)).toHaveLength(before);
    // the amounts are in the memory of the tab only (SR-WEB-05)
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });

  it('EVM-056 AC8 a 429 of a payment view says how long to wait; the view stays chosen', async () => {
    await renderPanel(
      `${PATH}?view=overdue_payments`,
      listApi(() => problem(429, 'rate_limited', {}, { 'Retry-After': '60' })),
    );
    expect(await screen.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 1 min.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Po terminie' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('EVM-056 AC8 an error of a payment view is the error of the list (no raw code)', async () => {
    await renderPanel(
      `${PATH}?view=unpaid`,
      listApi(() => problem(403, 'forbidden')),
    );
    expect(await screen.findByRole('heading', { level: 2, name: 'Nie udało się wczytać zleceń.' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('forbidden');
  });
});
