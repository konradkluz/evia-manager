import type { PaymentMilestone, PaymentMilestoneList, WorkOrderDetails, WorkOrderStatus } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER, ORDER_ID, workOrderRoutes } from './work-order-api.ts';

const PATH = `/work-orders/${ORDER_ID}`;
const TRANSITIONS = `POST /api/v1/work-orders/${ORDER_ID}/transitions`;
const READ = `GET /api/v1/work-orders/${ORDER_ID}`;
const LIST = `GET /api/v1/work-orders/${ORDER_ID}/payment-milestones`;
const TABLE = 'Transze płatności zlecenia';
const CANCEL_TITLE = 'Anuluj zlecenie ZL-2026-0042';
const SETTLE_TITLE = 'Rozliczyć zlecenie ZL-2026-0042?';
const REASON = 'Powód anulowania';

const MENU: Readonly<Partial<Record<WorkOrderStatus, WorkOrderStatus[]>>> = {
  in_progress: ['completed', 'on_hold', 'cancelled'],
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
  allowedTransitions: [],
});
const listOf = (statuses: PaymentMilestone['status'][]): PaymentMilestoneList => ({
  items: statuses.map((status, index) => milestone(index + 1, status)),
  totals: { unpaid: { amountMinor: 0, currency: 'PLN' }, paid: { amountMinor: 0, currency: 'PLN' } },
});

function api(order: WorkOrderDetails, payments: () => PaymentMilestoneList | Response, post: Handler, role = 'editor') {
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } }),
    ...workOrderRoutes(ORDER_ID, {
      payments: () => {
        const value = payments();
        return value instanceof Response ? value : json(200, value);
      },
    }),
    [READ]: () => json(200, order, { ETag: `"${String(order.version)}"` }),
    [TRANSITIONS]: post,
  });
}

async function openMenu(statusLabel: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Status zlecenia: ${statusLabel}. Zmień status` }));
}
async function choose(statusLabel: string, item: string) {
  await openMenu(statusLabel);
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}
const dialogOf = async (name: string, role: 'dialog' | 'alertdialog') => within(await screen.findByRole(role, { name }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settling and cancelling with the summary of the instalments (EVM-058)', () => {
  it('EVM-058 AC1 "Rozlicz…" shows "Opłacone: 3, anulowane: 1, suma wpłat 3 000,00 zł." and the admin-only sentence; confirming settles', async () => {
    const fake = api(
      orderWith('completed'),
      () => listOf(['paid', 'paid', 'paid', 'cancelled']),
      () => json(200, orderWith('settled', 4), { ETag: '"4"' }),
    );
    await renderPanel(PATH, fake);
    await screen.findByRole('table', { name: TABLE });
    await choose('Zakończone', 'Rozlicz…');
    const dialog = await dialogOf(SETTLE_TITLE, 'alertdialog');
    expect(dialog.getByText('Opłacone: 3, anulowane: 1, suma wpłat 3 000,00 zł.')).toBeTruthy();
    expect(dialog.getByText(/Cofnąć rozliczenie może tylko administrator\./)).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(dialog.getByRole('button', { name: 'Rozlicz zlecenie' }));
    expect(await screen.findByRole('button', { name: /Status zlecenia: Rozliczone/ })).toBeTruthy();
    expect(fake.calls(TRANSITIONS)).toHaveLength(1);
  });

  it('EVM-058 AC2 "Anuluj zlecenie…" warns about the planned ones and says the paid one stays; the section shows the server state after it', async () => {
    let payments = listOf(['planned', 'planned', 'paid']);
    const fake = api(
      orderWith('in_progress'),
      () => payments,
      () => {
        payments = listOf(['cancelled', 'cancelled', 'paid']);
        return json(200, orderWith('cancelled', 4), { ETag: '"4"' });
      },
    );
    await renderPanel(PATH, fake);
    await screen.findByRole('table', { name: TABLE });
    await choose('W realizacji', 'Anuluj zlecenie…');
    const dialog = await dialogOf(CANCEL_TITLE, 'dialog');
    expect(await dialog.findByText('Planowane transze (2) zostaną anulowane.')).toBeTruthy();
    expect(dialog.getByText('Opłacone transze (1) pozostają bez zmian.')).toBeTruthy();
    await userEvent.type(dialog.getByRole('textbox', { name: REASON }), 'Klient zrezygnował');
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj zlecenie' }));
    await waitFor(() => {
      expect(screen.getAllByText('Anulowana')).toHaveLength(2);
    });
    expect(screen.getByRole('button', { name: /Status zlecenia: Anulowane/ })).toBeTruthy();
  });

  it.each([['invoiced'], ['planned']] as const)(
    'EVM-058 AC3 "Zakończone" with a "%s" instalment: "Rozlicz…" is disabled and nothing is sent',
    async (blocking) => {
      const fake = api(
        orderWith('completed'),
        () => listOf(['paid', blocking]),
        () => json(200, orderWith('settled', 4)),
      );
      await renderPanel(PATH, fake);
      await screen.findByRole('table', { name: TABLE });
      await openMenu('Zakończone');
      const item = screen.getByRole('menuitem', { name: /^Rozlicz…/ });
      expect(item.getAttribute('aria-disabled')).toBe('true');
      await userEvent.click(item);
      expect(fake.calls(TRANSITIONS)).toHaveLength(0);
      expect(screen.queryByRole('alertdialog')).toBeNull();
    },
  );

  it('EVM-058 AC3 an invoiced instalment: the dialog "Anuluj zlecenie…" blocks the confirmation with the message and sends nothing', async () => {
    const fake = api(
      orderWith('in_progress'),
      () => listOf(['invoiced']),
      () => json(200, orderWith('cancelled', 4)),
    );
    await renderPanel(PATH, fake);
    await screen.findByRole('table', { name: TABLE });
    await choose('W realizacji', 'Anuluj zlecenie…');
    const dialog = await dialogOf(CANCEL_TITLE, 'dialog');
    expect(await dialog.findByText('Najpierw odnotuj wpłatę albo poproś administratora o anulowanie faktury.')).toBeTruthy();
    await userEvent.type(dialog.getByRole('textbox', { name: REASON }), 'Klient zrezygnował');
    const submit = dialog.getByRole('button', { name: 'Anuluj zlecenie' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(submit);
    expect(fake.calls(TRANSITIONS)).toHaveLength(0);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-058 AC3 without the data of the payments the panel does not block: the server decides', async () => {
    const fake = api(
      orderWith('completed'),
      () => problem(500, 'internal_error'),
      () => problem(422, 'transition_condition_not_met', { errors: [{ pointer: '/to', code: 'unpaid_milestones' }] }),
    );
    await renderPanel(PATH, fake);
    await choose('Zakończone', 'Rozlicz…');
    const dialog = await dialogOf(SETTLE_TITLE, 'alertdialog');
    await userEvent.click(dialog.getByRole('button', { name: 'Rozlicz zlecenie' }));
    expect((await dialog.findByRole('alert')).textContent).toBe('Rozliczysz, gdy wszystkie transze będą opłacone albo anulowane.');
    expect(fake.calls(TRANSITIONS)).toHaveLength(1);
  });

  it('EVM-058 AC5 an instalment invoiced meanwhile: 422 shows the server message, the summary is read again and the reason stays', async () => {
    let payments = listOf(['planned']);
    const fake = api(
      orderWith('in_progress'),
      () => payments,
      () => {
        payments = listOf(['invoiced']);
        return problem(422, 'transition_condition_not_met', { errors: [{ pointer: '/to', code: 'invoiced_milestones' }] });
      },
    );
    await renderPanel(PATH, fake);
    await screen.findByRole('table', { name: TABLE });
    await choose('W realizacji', 'Anuluj zlecenie…');
    const dialog = await dialogOf(CANCEL_TITLE, 'dialog');
    await userEvent.type(dialog.getByRole('textbox', { name: REASON }), 'Klient zrezygnował');
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj zlecenie' }));
    await waitFor(() => {
      expect(dialog.getByRole('button', { name: 'Anuluj zlecenie' }).getAttribute('aria-disabled')).toBe('true');
    });
    expect(dialog.getAllByText('Najpierw odnotuj wpłatę albo poproś administratora o anulowanie faktury.').length).toBeGreaterThan(0);
    expect(dialog.getByRole<HTMLTextAreaElement>('textbox', { name: REASON }).value).toBe('Klient zrezygnował');
  });

  it('EVM-058 AC5 412: the dialog shows the conflict, the instalments are read again and the reason stays', async () => {
    const fake = api(
      orderWith('in_progress'),
      () => listOf(['planned']),
      () => problem(412, 'precondition_failed'),
    );
    await renderPanel(PATH, fake);
    await screen.findByRole('table', { name: TABLE });
    await choose('W realizacji', 'Anuluj zlecenie…');
    const dialog = await dialogOf(CANCEL_TITLE, 'dialog');
    const reads = fake.calls(LIST).length;
    await userEvent.type(dialog.getByRole('textbox', { name: REASON }), 'Klient zrezygnował');
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj zlecenie' }));
    expect((await dialog.findByRole('alert')).textContent).toMatch(/zmieniono w międzyczasie/);
    await waitFor(() => {
      expect(fake.calls(LIST).length).toBeGreaterThan(reads);
    });
    expect(dialog.getByRole<HTMLTextAreaElement>('textbox', { name: REASON }).value).toBe('Klient zrezygnował');
  });

  it('EVM-058 AC6 offline the badge is disabled and nothing is sent', async () => {
    const fake = api(
      orderWith('completed'),
      () => listOf(['paid']),
      () => json(200, orderWith('settled', 4)),
    );
    await renderPanel(PATH, fake);
    await screen.findByRole('table', { name: TABLE });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    const badge = await screen.findByRole('button', { name: 'Status zlecenia: Zakończone. Zmień status' });
    await waitFor(() => {
      expect(badge.getAttribute('aria-disabled')).toBe('true');
    });
    await userEvent.click(badge);
    expect(screen.queryByRole('menuitem', { name: 'Rozlicz…' })).toBeNull();
    expect(fake.calls(TRANSITIONS)).toHaveLength(0);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
  });

  it('EVM-058 AC6 the read-only role has a static badge without a menu', async () => {
    const fake = api(
      orderWith('completed'),
      () => listOf(['paid']),
      () => json(200, orderWith('settled', 4)),
      'read_only',
    );
    await renderPanel(PATH, fake);
    await screen.findByRole('table', { name: TABLE });
    expect(screen.queryByRole('button', { name: /Zmień status/ })).toBeNull();
  });
});
