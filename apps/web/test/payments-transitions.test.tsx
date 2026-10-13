import type { PaymentMilestone, PaymentMilestoneList, WorkOrderDetails, WorkOrderStatus } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeTransitionFailure } from '../src/work-orders/transition-actions.ts';
import { ApiError } from '../src/api/client.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER, NO_PAYMENTS, ORDER_ID, workOrderRoutes } from './work-order-api.ts';

const userEvent = userEventDefault.setup({ delay: null });
const PATH = `/work-orders/${ORDER_ID}`;
const TRANSITIONS = `POST /api/v1/work-orders/${ORDER_ID}/transitions`;
const READ = `GET /api/v1/work-orders/${ORDER_ID}`;
const LIST = `GET /api/v1/work-orders/${ORDER_ID}/payment-milestones`;

const MENU: Readonly<Partial<Record<WorkOrderStatus, WorkOrderStatus[]>>> = {
  in_progress: ['completed', 'on_hold', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  completed: ['settled', 'in_progress'],
};
const orderWith = (status: WorkOrderStatus, version = 3): WorkOrderDetails => ({
  ...HEADER,
  status,
  version,
  allowedTransitions: MENU[status] ?? [],
});

const milestone = (n: number, status: PaymentMilestone['status']): PaymentMilestone => ({
  id: `01968f3e-0000-7000-8000-0000000c0${String(n).padStart(3, '0')}`,
  code: `plan_${String(n)}`,
  name: `Transza ${String(n)}`,
  position: n,
  sharePercent: 25,
  paymentTermDays: 7,
  amount: status === 'planned' ? null : { amountMinor: 100000, currency: 'PLN' },
  status,
  invoiceNumber: null,
  invoicedOn: null,
  dueDate: null,
  paidOn: status === 'paid' ? '2026-10-01' : null,
  isOverdue: false,
  version: 1,
});
const listOf = (statuses: PaymentMilestone['status'][]): PaymentMilestoneList => ({
  items: statuses.map((status, index) => milestone(index + 1, status)),
  totals: {
    unpaid: { amountMinor: 0, currency: 'PLN' },
    paid: { amountMinor: statuses.filter((status) => status === 'paid').length * 100000, currency: 'PLN' },
  },
});

function transitionApi(order: WorkOrderDetails, payments: () => PaymentMilestoneList, post: Handler) {
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, ACTIVE_SESSION),
    ...workOrderRoutes(ORDER_ID, { payments: () => json(200, payments()) }),
    [READ]: () => json(200, order, { ETag: `"${String(order.version)}"` }),
    [TRANSITIONS]: post,
  });
}

async function choose(statusLabel: string, item: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Status zlecenia: ${statusLabel}. Zmień status` }));
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settling an order with instalments (EVM-053 AC6)', () => {
  it('EVM-053 AC6 422 unpaid_milestones: the dialog "Rozlicz…" says "Rozliczysz, gdy wszystkie transze będą opłacone albo anulowane."', async () => {
    const api = transitionApi(
      orderWith('completed'),
      () => listOf(['planned']),
      () => problem(422, 'transition_condition_not_met', { errors: [{ pointer: '/to', code: 'unpaid_milestones' }] }),
    );
    await renderPanel(PATH, api);
    await screen.findByRole('table', { name: 'Transze płatności zlecenia' });
    const reads = api.calls(LIST).length;
    await choose('Zakończone', 'Rozlicz…');
    const dialog = within(await screen.findByRole('alertdialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Rozlicz zlecenie' }));
    expect((await dialog.findByRole('alert')).textContent).toBe('Rozliczysz, gdy wszystkie transze będą opłacone albo anulowane.');
    // the instalments are read again: the section shows the state the server judged
    await waitFor(() => {
      expect(api.calls(LIST).length).toBeGreaterThan(reads);
    });
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-053 AC6 a condition of another module keeps the general sentence', () => {
    const failure = describeTransitionFailure(
      new ApiError(422, { code: 'transition_condition_not_met', errors: [{ pointer: '/to', code: 'open_documents' }] }),
    );
    expect(failure).toEqual({ kind: 'condition', reasons: ['open_documents'] });
  });
});

describe('cancelling an order with instalments (EVM-053 AC6, P1)', () => {
  it.each([
    ['W realizacji', 'in_progress'],
    ['Wstrzymane', 'on_hold'],
  ] as const)(
    'EVM-053 AC6 from "%s" the dialog warns "Planowane transze (3) zostaną anulowane." and the instalments are read again after it',
    async (label, status) => {
      let payments = listOf(['planned', 'planned', 'planned']);
      const api = transitionApi(
        orderWith(status),
        () => payments,
        () => {
          payments = listOf(['cancelled', 'cancelled', 'cancelled']);
          return json(200, orderWith('cancelled', 4), { ETag: '"4"' });
        },
      );
      await renderPanel(PATH, api);
      await screen.findByRole('table', { name: 'Transze płatności zlecenia' });
      await choose(label, 'Anuluj zlecenie…');
      const dialog = within(await screen.findByRole('dialog', { name: 'Anuluj zlecenie ZL-2026-0042' }));
      expect(await dialog.findByText('Planowane transze (3) zostaną anulowane.')).toBeTruthy();
      await userEvent.type(dialog.getByRole('textbox', { name: 'Powód anulowania' }), 'Klient zrezygnował');
      await userEvent.click(dialog.getByRole('button', { name: 'Anuluj zlecenie' }));
      await waitFor(() => {
        expect(screen.getAllByText('Anulowana')).toHaveLength(3);
      });
    },
  );

  it('EVM-053 AC6 only planned instalments are counted, and without them the sentence is not there', async () => {
    let payments = listOf(['paid', 'planned', 'cancelled']);
    const api = transitionApi(
      orderWith('in_progress'),
      () => payments,
      () => problem(500, 'internal_error'),
    );
    await renderPanel(PATH, api);
    await screen.findByRole('table', { name: 'Transze płatności zlecenia' });
    await choose('W realizacji', 'Anuluj zlecenie…');
    let dialog = within(await screen.findByRole('dialog', { name: 'Anuluj zlecenie ZL-2026-0042' }));
    expect(await dialog.findByText('Planowane transze (1) zostaną anulowane.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Wróć' }));

    payments = listOf(['paid']);
    await choose('W realizacji', 'Anuluj zlecenie…');
    dialog = within(await screen.findByRole('dialog', { name: 'Anuluj zlecenie ZL-2026-0042' }));
    // the dialog reads the instalments as they are now
    await waitFor(() => {
      expect(dialog.queryByText(/Planowane transze/)).toBeNull();
    });
    await userEvent.click(dialog.getByRole('button', { name: 'Wróć' }));

    payments = NO_PAYMENTS;
    await choose('W realizacji', 'Anuluj zlecenie…');
    dialog = within(await screen.findByRole('dialog', { name: 'Anuluj zlecenie ZL-2026-0042' }));
    expect(dialog.getByText('Zlecenie otrzyma status „Anulowane”. Przywrócić zlecenie może tylko administrator.')).toBeTruthy();
    await waitFor(() => {
      expect(dialog.queryByText(/Planowane transze/)).toBeNull();
    });
  });
});
