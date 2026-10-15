import type { PlannedPaymentMilestone } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem } from './api-fake.ts';
import { milestone as fullMilestone } from './payment-api.ts';
import { renderPanel } from './render.tsx';
import { CUSTOMERS, lastQuery, pageOf, roleSession, UNPAID_LIST, UNPAID_PATH, unpaidApi } from './unpaid-api.ts';

const userEvent = userEventDefault.setup({ delay: null });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const PLANNED_PATH = `${UNPAID_PATH}?view=planned`;
const id = (n: number): string => `01968f3e-0000-7000-8000-${String(n).padStart(12, '0')}`;

const planned = (n: number, extra: Partial<PlannedPaymentMilestone> = {}): PlannedPaymentMilestone => ({
  id: id(900 + n),
  workOrder: { id: id(800 + n), number: `ZL-2026-${String(n).padStart(4, '0')}`, title: `Montaż ${String(n)}` },
  customer: CUSTOMERS.ANNA,
  name: 'Zaliczka',
  sharePercent: 20,
  amount: { amountMinor: 123000, currency: 'PLN' },
  status: 'planned',
  version: 2,
  ...extra,
});

const ONE = planned(1);
const NO_AMOUNT = planned(2, { name: 'Płatność końcowa', sharePercent: null, amount: null, customer: null });
const zero = { count: 0, total: { amountMinor: 0, currency: 'PLN' } } as const;
const listOf = (items: PlannedPaymentMilestone[]) =>
  pageOf(items as never, { summary: { filtered: { count: items.length, total: { amountMinor: 123000, currency: 'PLN' } } } });
const ready = () => screen.findByRole('table', { name: 'Transze do wystawienia faktury' });
const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
  fireEvent(window, new Event(online ? 'online' : 'offline'));
};
const route = `/api/v1/work-orders/${ONE.workOrder.id}/payment-milestones`;

describe('W-11 "Do wystawienia" (EVM-059 AC1)', () => {
  it('EVM-059 AC1 the chip "Do wystawienia" sends only view=planned, the address carries only the view, the title stays', async () => {
    const api = unpaidApi((request) => json(200, request.query.get('view') === 'planned' ? listOf([ONE, NO_AMOUNT]) : pageOf([])));
    const { history } = await renderPanel(UNPAID_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Do wystawienia' }));
    await ready();
    expect(lastQuery(api).get('view')).toBe('planned');
    expect(lastQuery(api).has('dueFrom')).toBe(false);
    expect(history.location.search).toBe('?view=planned');
    expect(document.title).toBe('Płatności · EVia Manager');
    expect(screen.getByRole('heading', { level: 1, name: 'Płatności — do wystawienia' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Do wystawienia' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('EVM-059 AC1 a row: the order, the customer, the instalment, the share and the amount, "—" where there is none; the order of the server', async () => {
    await renderPanel(
      PLANNED_PATH,
      unpaidApi(() => json(200, listOf([ONE, NO_AMOUNT]))),
    );
    await ready();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Zlecenie',
      'Klient',
      'Transza',
      'Udział',
      'Kwota',
      'Status',
    ]);
    const first = within(screen.getByText('Montaż 1').closest('tr') as HTMLElement);
    expect(first.getByRole('link', { name: 'ZL-2026-0001' }).getAttribute('href')).toBe(`/work-orders/${ONE.workOrder.id}`);
    expect(first.getAllByText('Anna Testowa').length).toBeGreaterThan(0);
    expect(first.getByText('Zaliczka')).toBeTruthy();
    expect(first.getByText('20%')).toBeTruthy();
    expect(first.getByText('1 230,00 zł')).toBeTruthy();
    expect(first.getByText('Planowana')).toBeTruthy();
    const second = within(screen.getByText('Montaż 2').closest('tr') as HTMLElement);
    expect(second.getByText('Brak udziału z planu')).toBeTruthy();
    expect(second.getByText('Brak kwoty')).toBeTruthy();
    expect(second.getAllByText('Brak klienta').length).toBeGreaterThan(0);
    const numbers = screen.getAllByRole('link', { name: /^ZL-2026-000[12]$/ }).map((link) => link.textContent);
    expect(numbers.slice(-2)).toEqual(['ZL-2026-0001', 'ZL-2026-0002']);
    expect(screen.getByText('2 transze · Sortowanie: wg zlecenia')).toBeTruthy();
  });

  it('EVM-059 AC1 the range of the due dates is off in this view (the instalments have no term); "Wszystkie wystawione" brings the invoiced back', async () => {
    const api = unpaidApi((request) => json(200, request.query.get('view') === 'planned' ? listOf([ONE]) : pageOf([])));
    const { history } = await renderPanel(PLANNED_PATH, api);
    await ready();
    expect(screen.getByLabelText('Termin od').hasAttribute('disabled')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Wszystkie wystawione' }));
    await waitFor(() => {
      expect(lastQuery(api).has('view')).toBe(false);
    });
    expect(history.location.search).toBe('');
  });
});

describe('W-11 "Do wystawienia" (EVM-059 AC2)', () => {
  it('EVM-059 AC2 "Wystaw fakturę…" opens the dialog of EVM-054 and the instalment leaves the view after the invoice', async () => {
    let items = [ONE, NO_AMOUNT];
    const full = fullMilestone(1, {
      id: ONE.id,
      name: 'Zaliczka',
      sharePercent: 20,
      paymentTermDays: 7,
      amount: ONE.amount,
      version: 2,
      allowedTransitions: ['invoiced', 'cancelled'],
    });
    const api = unpaidApi((request) => json(200, request.query.get('view') === 'planned' ? listOf(items) : pageOf([])), undefined, {
      [`GET ${route}`]: () => json(200, { items: [full], totals: { unpaid: ONE.amount, paid: { amountMinor: 0, currency: 'PLN' } } }),
      [`POST ${route}/${ONE.id}/transitions`]: () => {
        items = [NO_AMOUNT];
        return json(200, {
          ...full,
          status: 'invoiced',
          invoiceNumber: 'FV/TEST/0001/2026',
          invoicedOn: '2026-10-15',
          dueDate: '2026-10-22',
          version: 3,
        });
      },
    });
    await renderPanel(PLANNED_PATH, api);
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Wystaw fakturę: Zaliczka, ZL-2026-0001' }));
    const view = within(await screen.findByRole('dialog', { name: 'Wystawić fakturę dla transzy „Zaliczka”?' }));
    await userEvent.type(view.getByRole('textbox', { name: 'Nr faktury lub proformy' }), 'FV/TEST/0001/2026');
    await userEvent.click(view.getByRole('button', { name: 'Wystaw fakturę' }));
    await waitFor(() => {
      expect(screen.queryByText('Montaż 1')).toBeNull();
    });
    const [request] = api.calls(`POST ${route}/${ONE.id}/transitions`).slice(-1);
    expect(request?.headers.get('If-Match')).toBe('"2"');
    expect(parseBody(request?.body ?? '')).toMatchObject({ to: 'invoiced', invoiceNumber: 'FV/TEST/0001/2026' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    expect(screen.getByText('Montaż 2')).toBeTruthy();
  });

  it('EVM-059 AC2 an instalment that is no longer planned says so and the view is read again', async () => {
    const gone = fullMilestone(1, { id: ONE.id, status: 'invoiced' });
    const api = unpaidApi(() => json(200, listOf([ONE])), undefined, {
      [`GET ${route}`]: () => json(200, { items: [gone], totals: { unpaid: ONE.amount, paid: { amountMinor: 0, currency: 'PLN' } } }),
    });
    await renderPanel(PLANNED_PATH, api);
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Wystaw fakturę: Zaliczka, ZL-2026-0001' }));
    expect(await screen.findByText('Tej transzy nie ma już wśród nieopłaconych. Odświeżyliśmy zestawienie.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(api.calls(UNPAID_LIST).length).toBeGreaterThan(1);
    });
  });
});

describe('W-11 "Do wystawienia" (EVM-059 AC4)', () => {
  it('EVM-059 AC4 the Administrator and the Editor have "Wystaw fakturę…", Tylko odczyt sees the filter without the action', async () => {
    for (const [session, action] of [
      [undefined, true],
      [roleSession('editor'), true],
      [roleSession('read_only'), false],
    ] as const) {
      const { unmount } = await renderPanel(
        PLANNED_PATH,
        unpaidApi(() => json(200, listOf([ONE])), session),
      );
      await ready();
      expect(screen.getByText('Montaż 1')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Do wystawienia' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Wystaw fakturę/ }) !== null).toBe(action);
      unmount();
    }
  });
});

describe('W-11 "Do wystawienia" (EVM-059 AC5)', () => {
  it('EVM-059 AC5 nothing to invoice: "Wszystkie transze mają wystawione faktury." and no table', async () => {
    await renderPanel(
      PLANNED_PATH,
      unpaidApi(() => json(200, pageOf([], { summary: { filtered: zero } }))),
    );
    expect(await screen.findByRole('heading', { level: 2, name: 'Wszystkie transze mają wystawione faktury.' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('EVM-059 AC5 offline the last page stays with the banner and "Wystaw fakturę…" is disabled', async () => {
    await renderPanel(
      PLANNED_PATH,
      unpaidApi(() => json(200, listOf([ONE]))),
    );
    await ready();
    setOnline(false);
    expect(await screen.findByText(/^Dane mogą być nieaktualne \(z \d\d:\d\d\)$/)).toBeTruthy();
    expect(screen.getByText('Montaż 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wystaw fakturę: Zaliczka, ZL-2026-0001' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('EVM-059 AC5 a failed read says so with "Spróbuj ponownie"', async () => {
    await renderPanel(
      PLANNED_PATH,
      unpaidApi(() => problem(500, 'internal_error')),
    );
    expect(await screen.findByText('Nie udało się wczytać płatności.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Spróbuj ponownie' })).toBeTruthy();
  });

  it('EVM-059 AC5 the view has no accessibility violations', async () => {
    await renderPanel(
      PLANNED_PATH,
      unpaidApi(() => json(200, listOf([ONE, NO_AMOUNT]))),
    );
    await ready();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });
});
