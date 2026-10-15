import type { CurrentSession, PaymentMilestone, PaymentMilestoneList } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER, NO_PAYMENTS, ORDER_ID, workOrderRoutes } from './work-order-api.ts';

const userEvent = userEventDefault.setup({ delay: null });
const PATH = `/work-orders/${ORDER_ID}`;
const BASE = `/api/v1/work-orders/${ORDER_ID}`;
const LIST = `GET ${BASE}/payment-milestones`;
const CREATE = `POST ${BASE}/payment-milestones`;
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NBSP = String.fromCharCode(0xa0);
/** "3 600,00 zł" as the panel writes it — with non-breaking spaces (styleguide § 6.3). */
const zl = (text: string): string => text.replaceAll(' ', NBSP);

const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } });

const milestone = (n: number, extra: Partial<PaymentMilestone> = {}): PaymentMilestone => ({
  id: `01968f3e-0000-7000-8000-0000000c0${String(n).padStart(3, '0')}`,
  code: `plan_${String(n)}`,
  name: `Transza ${String(n)}`,
  position: n,
  sharePercent: null,
  paymentTermDays: null,
  amount: null,
  status: 'planned',
  invoiceNumber: null,
  invoicedOn: null,
  dueDate: null,
  paidOn: null,
  isOverdue: false,
  version: 1,
  allowedTransitions: [],
  ...extra,
});

const ADVANCE = milestone(1, {
  name: 'Zaliczka',
  sharePercent: 20,
  paymentTermDays: 7,
  amount: { amountMinor: 360000, currency: 'PLN' },
  status: 'invoiced',
  invoiceNumber: 'FV/TEST/0007/2026',
  invoicedOn: '2026-09-01',
  dueDate: '2026-09-08',
});
const CONSENTS = milestone(2, { name: 'Po uzyskaniu zgód', sharePercent: 30, paymentTermDays: 7 });
const INSTALLATION = milestone(3, {
  name: 'Po wykonaniu instalacji',
  sharePercent: 30,
  amount: { amountMinor: 540000, currency: 'PLN' },
  status: 'paid',
  invoiceNumber: 'FV/TEST/0008/2026',
  dueDate: '2026-10-01',
  paidOn: '2026-09-28',
});
const FINAL = milestone(4, {
  name: 'Płatność końcowa',
  sharePercent: 20,
  amount: { amountMinor: 360000, currency: 'PLN' },
  status: 'cancelled',
});

const listOf = (items: PaymentMilestone[], unpaid = 0, paid = 0): PaymentMilestoneList => ({
  items,
  totals: { unpaid: { amountMinor: unpaid, currency: 'PLN' }, paid: { amountMinor: paid, currency: 'PLN' } },
});
const FULL = listOf([ADVANCE, CONSENTS, INSTALLATION, FINAL], 360000, 540000);

function api(
  payments: Handler = () => json(200, FULL),
  session: CurrentSession = ACTIVE_SESSION,
  extra: Record<string, Handler> = {},
  header: Partial<typeof HEADER> = {},
) {
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    ...workOrderRoutes(ORDER_ID, { payments, header: () => json(200, { ...HEADER, ...header }, { ETag: '"3"' }) }),
    ...extra,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const section = () => within(screen.getByRole('region', { name: 'Płatności' }));
const paymentsReady = () => screen.findByRole('table', { name: 'Transze płatności zlecenia' });
const rowOf = (name: string): HTMLElement => {
  const row = screen.getByText(name).closest('tr');
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
};

async function openAmount(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Akcje transzy: ${name}` }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Zmień kwotę…' }));
  return within(await screen.findByRole('dialog', { name: 'Zmień kwotę transzy' }));
}

async function openAdd() {
  await userEvent.click(await screen.findByRole('button', { name: 'Dodaj transzę' }));
  return within(await screen.findByRole('dialog', { name: 'Dodaj transzę' }));
}

describe('W-06 "Płatności" (EVM-053 AC2)', () => {
  it('EVM-053 AC2 the section lists the instalments — name with share, amount, status, invoice number, due date — and the totals of the server', async () => {
    await renderPanel(PATH, api());
    await paymentsReady();
    const view = section();
    expect(view.getByRole('heading', { level: 2, name: 'Płatności' })).toBeTruthy();
    // "Nieopłacone" is the sum of the invoiced instalments, "Opłacone" of the paid ones — as the server counted them
    const totals = view.getByText('Nieopłacone 3 600,00 zł · Opłacone 5 400,00 zł');
    // the amounts keep their non-breaking spaces (§ 6.3): a line break never splits "3 600,00 zł"
    expect(totals.textContent).toBe(`Nieopłacone 3${NBSP}600,00${NBSP}zł · Opłacone 5${NBSP}400,00${NBSP}zł`);
    const headers = view.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Transza', 'Kwota', 'Status', 'Nr faktury', 'Termin', 'Akcje']);
    const advance = within(rowOf('Zaliczka (20%)'));
    expect(advance.getByText('3 600,00 zł')).toBeTruthy();
    expect(advance.getByText('Wystawiona')).toBeTruthy();
    expect(advance.getByText('FV/TEST/0007/2026')).toBeTruthy();
    expect(advance.getByText('08.09.2026')).toBeTruthy();
    const consents = within(rowOf('Po uzyskaniu zgód (30%)'));
    expect(consents.getByText('Planowana')).toBeTruthy();
    expect(consents.getAllByText('—')).toHaveLength(3);
    expect(within(rowOf('Po wykonaniu instalacji (30%)')).getByText('Opłacona')).toBeTruthy();
    expect(within(rowOf('Płatność końcowa (20%)')).getByText('Anulowana')).toBeTruthy();
    // the rows keep the order of the server (position)
    const names = view
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('td')?.textContent);
    expect(names).toEqual(['Zaliczka (20%)', 'Po uzyskaniu zgód (30%)', 'Po wykonaniu instalacji (30%)', 'Płatność końcowa (20%)']);
  });

  it('EVM-053 AC2 EVM-054 AC5 in the narrow card the amount, the invoice number and the due date say what they are; the actions take a full line', async () => {
    await renderPanel(PATH, api());
    await paymentsReady();
    const cells = within(rowOf('Po uzyskaniu zgód (30%)')).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'Po uzyskaniu zgód (30%)',
      'Kwota: —',
      'PlanowanaWystaw fakturę…',
      'Nr faktury: —',
      'Termin: —',
      '',
    ]);
    // the labels are for the cards only: from breakpoint.medium the column headers say it
    for (const cell of [cells[1], cells[3], cells[4]]) expect(cell?.querySelector('span')?.className).toContain('medium:hidden');
    // EVM-054 ("UX / UI" → "Responsywność"): the button of the row stands under the status in the table and stretches over the
    // card, a full line of its own there; the menu `⋮` stays at the top right of the card
    const button = within(cells[2] as HTMLElement).getByRole('button', { name: 'Wystaw fakturę…' });
    expect(button.parentElement?.className).toContain('max-medium:col-span-3');
    expect(cells[5]?.className).toContain('max-medium:col-start-3');
  });

  it('EVM-053 AC2 EVM-054 AC5 the Administrator has a menu for every instalment but a cancelled one (its corrections come with EVM-057)', async () => {
    await renderPanel(PATH, api());
    await paymentsReady();
    expect(screen.getAllByRole('button', { name: /^Akcje transzy:/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Akcje transzy: Zaliczka (20%)',
      'Akcje transzy: Po uzyskaniu zgód (30%)',
      'Akcje transzy: Po wykonaniu instalacji (30%)',
    ]);
  });

  it('EVM-053 AC2 an invoiced instalment after its due date shows the strong badge "Po terminie" instead of "Wystawiona"', async () => {
    await renderPanel(
      PATH,
      api(() => json(200, listOf([{ ...ADVANCE, isOverdue: true }], 360000))),
    );
    await paymentsReady();
    const row = rowOf('Zaliczka (20%)');
    const badge = within(row).getByText('Po terminie');
    expect(badge.className).toContain('bg-status-payment-overdue-bg');
    // the full wording stays the accessible name of the row (styleguide § 4.4)
    expect(row.getAttribute('aria-label')).toBe('Zaliczka (20%) — wystawiona, po terminie');
  });

  it('EVM-053 AC2 a status this panel does not know is the badge of an unknown value; names are text, never markup (SR-WEB-03)', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    await renderPanel(
      PATH,
      api(() => json(200, listOf([milestone(1, { name: markup, status: 'refunded' as PaymentMilestone['status'] })]))),
    );
    await paymentsReady();
    expect(section().getByText('Nieznany status')).toBeTruthy();
    expect(document.body.textContent).not.toContain('refunded');
    expect(section().getByText(markup)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('EVM-053 AC2 the page with the instalments has no accessibility violations', async () => {
    await renderPanel(PATH, api());
    await paymentsReady();
    await screen.findByText('Instalacja zasilająca');
    await screen.findByText('Operator Testowy');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });
});

describe('W-06 "Płatności" — states (EVM-053 AC8)', () => {
  it('EVM-053 AC8 an order without instalments says "Brak transz." with "Dodaj transzę"', async () => {
    await renderPanel(
      PATH,
      api(() => json(200, NO_PAYMENTS)),
    );
    expect(await section().findByText('Brak transz.')).toBeTruthy();
    expect(section().queryByText(/Nieopłacone/)).toBeNull();
    await userEvent.click(section().getByRole('button', { name: 'Dodaj transzę' }));
    expect(await screen.findByRole('dialog', { name: 'Dodaj transzę' })).toBeTruthy();
  });

  it('EVM-053 AC8 the instalments are loading (a skeleton with a status) and a failed read offers "Spróbuj ponownie"', async () => {
    let fail = true;
    const payments = api(() => (fail ? problem(500, 'internal_error') : json(200, FULL)));
    await renderPanel(PATH, payments);
    expect(await section().findByText('Nie udało się wczytać płatności.')).toBeTruthy();
    fail = false;
    await userEvent.click(section().getByRole('button', { name: 'Spróbuj ponownie' }));
    await paymentsReady();
    expect(payments.calls(LIST)).toHaveLength(2);
  });

  it('EVM-053 AC8 offline "Dodaj transzę" and "Zmień kwotę…" are disabled with "Zmienisz po powrocie połączenia."', async () => {
    await renderPanel(PATH, api());
    await paymentsReady();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    globalThis.dispatchEvent(new Event('offline'));
    const add = await section().findByRole('button', { name: 'Dodaj transzę' });
    await waitFor(() => {
      expect(add.getAttribute('aria-disabled')).toBe('true');
    });
    expect(add.getAttribute('title')).toBe('Zmienisz po powrocie połączenia.');
    await userEvent.click(screen.getByRole('button', { name: 'Akcje transzy: Po uzyskaniu zgód (30%)' }));
    const item = screen.getByRole('menuitem', { name: /Zmień kwotę…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe('Zmienisz po powrocie połączenia.');
    await userEvent.click(item);
    expect(screen.queryByRole('dialog', { name: 'Zmień kwotę transzy' })).toBeNull();
  });

  it('EVM-053 AC8 with 20 instalments "Dodaj transzę" is disabled with "Zlecenie ma już 20 transz — to limit."', async () => {
    const twenty = listOf(Array.from({ length: 20 }, (_unused, index) => milestone(index + 1)));
    const payments = api(() => json(200, twenty));
    await renderPanel(PATH, payments);
    await paymentsReady();
    const add = section().getByRole('button', { name: 'Dodaj transzę' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('title')).toBe('Zlecenie ma już 20 transz — to limit.');
    await userEvent.click(add);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(payments.calls(CREATE)).toHaveLength(0);
  });
});

describe('W-06 "Płatności" — roles and a closed order (EVM-053 AC5, AC7)', () => {
  it('EVM-053 AC7 Tylko odczyt sees the amounts, the statuses and the totals without "Dodaj transzę" and without menus (P6)', async () => {
    await renderPanel(PATH, api(undefined, roleSession('read_only')));
    await paymentsReady();
    expect(section().getByText('Nieopłacone 3 600,00 zł · Opłacone 5 400,00 zł')).toBeTruthy();
    expect(within(rowOf('Zaliczka (20%)')).getByText('3 600,00 zł')).toBeTruthy();
    expect(section().queryByRole('button', { name: 'Dodaj transzę' })).toBeNull();
    expect(section().queryByRole('button', { name: /^Akcje transzy/ })).toBeNull();
    expect(section().queryByRole('columnheader', { name: 'Akcje' })).toBeNull();
  });

  it('EVM-053 AC7 Tylko odczyt without instalments sees "Brak transz." and nothing to add', async () => {
    await renderPanel(
      PATH,
      api(() => json(200, NO_PAYMENTS), roleSession('read_only')),
    );
    expect(await section().findByText('Brak transz.')).toBeTruthy();
    expect(section().queryByRole('button')).toBeNull();
  });

  it.each([
    [
      'administrator',
      ACTIVE_SESSION,
      'settled',
      'Zlecenie jest rozliczone — płatności są tylko do odczytu. Zmienisz je po przywróceniu zlecenia.',
    ],
    [
      'editor',
      roleSession('editor'),
      'settled',
      'Zlecenie jest rozliczone — płatności są tylko do odczytu. Przywrócić zlecenie może tylko administrator.',
    ],
    [
      'administrator',
      ACTIVE_SESSION,
      'cancelled',
      'Zlecenie jest anulowane — płatności są tylko do odczytu. Zmienisz je po przywróceniu zlecenia.',
    ],
  ] as const)(
    'EVM-053 AC5 %s in a %s order: "Dodaj transzę" and "Zmień kwotę…" are disabled with the hint',
    async (_role, session, status, hint) => {
      await renderPanel(PATH, api(undefined, session, {}, { status, allowedTransitions: [] }));
      await paymentsReady();
      const add = section().getByRole('button', { name: 'Dodaj transzę' });
      expect(add.getAttribute('aria-disabled')).toBe('true');
      expect(add.getAttribute('title')).toBe(hint);
      await userEvent.click(screen.getByRole('button', { name: 'Akcje transzy: Po uzyskaniu zgód (30%)' }));
      const item = screen.getByRole('menuitem', { name: /Zmień kwotę…/ });
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(item.getAttribute('title')).toBe(hint);
    },
  );
});

describe('"Zmień kwotę transzy" (EVM-053 AC3, AC5, AC7, AC8)', () => {
  const PATCH = `PATCH ${BASE}/payment-milestones/${CONSENTS.id}`;
  const saved = (amountMinor: number, version = 2): PaymentMilestone => ({
    ...CONSENTS,
    amount: { amountMinor, currency: 'PLN' },
    version,
  });

  it('EVM-053 AC3 the Editor types 3 600,00 zł: the amount goes in grosze (360000, PLN) with If-Match and a key, then a toast and the focus back on the menu', async () => {
    let current = FULL;
    const payments = api(() => json(200, current), roleSession('editor'), {
      [PATCH]: () => {
        current = listOf([ADVANCE, saved(360000), INSTALLATION, FINAL], 360000, 540000);
        return json(200, saved(360000), { ETag: '"2"' });
      },
    });
    await renderPanel(PATH, payments);
    const dialog = await openAmount('Po uzyskaniu zgód (30%)');
    expect(dialog.getByText('Po uzyskaniu zgód (30%) · ZL-2026-0042')).toBeTruthy();
    expect(dialog.getByText('Udział z planu: 30% (tylko informacyjnie)')).toBeTruthy();
    const field = dialog.getByRole('textbox', { name: 'Kwota' });
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('inputmode')).toBe('decimal');
    expect(dialog.getByText('Kwota brutto do zapłaty. Status zostaje „Planowana”.')).toBeTruthy();
    await userEvent.type(field, '3600,00');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(await screen.findByText('Zmieniono kwotę transzy „Po uzyskaniu zgód”: 3 600,00 zł.')).toBeTruthy();
    const [request] = payments.calls(PATCH);
    expect(parseBody(request?.body ?? '')).toEqual({ amount: { amountMinor: 360000, currency: 'PLN' } });
    expect(request?.headers.get('If-Match')).toBe('"1"');
    expect(request?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(rowOf('Po uzyskaniu zgód (30%)')).getByText('3 600,00 zł')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje transzy: Po uzyskaniu zgód (30%)' }));
    });
  });

  it('EVM-053 AC3 an amount of zero, a negative one or with more than 2 decimal places is refused before sending', async () => {
    const payments = api(undefined, ACTIVE_SESSION, { [PATCH]: () => json(200, saved(1)) });
    await renderPanel(PATH, payments);
    const dialog = await openAmount('Po uzyskaniu zgód (30%)');
    const field = dialog.getByRole('textbox', { name: 'Kwota' });
    const submit = dialog.getByRole('button', { name: 'Zapisz kwotę' });
    await userEvent.click(submit);
    expect(dialog.getByText('Podaj kwotę większą od zera, np. 1 500,00 zł.')).toBeTruthy();
    await userEvent.type(field, '0');
    await userEvent.click(submit);
    expect(dialog.getByText('Podaj kwotę większą od zera, np. 1 500,00 zł.')).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.type(field, '-5');
    await userEvent.click(submit);
    expect(dialog.getByText('Podaj kwotę większą od zera, np. 1 500,00 zł.')).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.type(field, '3600,101');
    await userEvent.click(submit);
    expect(dialog.getByText('Kwota może mieć najwyżej 2 miejsca po przecinku.')).toBeTruthy();
    // what was typed stays as typed when it is not an amount (the blur normalises only an amount)
    expect((field as HTMLInputElement).value).toBe('3600,101');
    await userEvent.clear(field);
    await userEvent.type(field, '1000000000');
    await userEvent.click(submit);
    expect(dialog.getByText('Kwota może wynosić najwyżej 999 999 999,99 zł.')).toBeTruthy();
    expect(payments.calls(PATCH)).toHaveLength(0);
  });

  it('EVM-053 AC3 a 400 of the server on the amount is shown under the field', async () => {
    const payments = api(undefined, ACTIVE_SESSION, {
      [PATCH]: () => problem(400, 'validation_failed', { errors: [{ pointer: '/amount/amountMinor', code: 'out_of_range' }] }),
    });
    await renderPanel(PATH, payments);
    const dialog = await openAmount('Po uzyskaniu zgód (30%)');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Kwota' }), '10');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(await dialog.findByText('Podaj kwotę większą od zera, np. 1 500,00 zł.')).toBeTruthy();
  });

  it('EVM-053 AC3 an instalment that is no longer planned (403 forbidden): the alert of the mockup and "Zapisz kwotę" disabled', async () => {
    let current = FULL;
    const payments = api(() => json(200, current), ACTIVE_SESSION, {
      [PATCH]: () => {
        current = listOf([ADVANCE, { ...CONSENTS, status: 'invoiced', amount: { amountMinor: 540000, currency: 'PLN' }, version: 2 }]);
        return problem(403, 'forbidden');
      },
    });
    await renderPanel(PATH, payments);
    const dialog = await openAmount('Po uzyskaniu zgód (30%)');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Kwota' }), '5400');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(
      await dialog.findByText('Transza ma już status «Wystawiona» — kwotę zmieni administrator korektą płatności.', {
        selector: '[role="alert"] *',
      }),
    ).toBeTruthy();
    const submit = dialog.getByRole('button', { name: 'Zapisz kwotę' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(submit);
    expect(payments.calls(PATCH)).toHaveLength(1);
  });

  it('EVM-053 AC8 412: the alert of the mockup, "Aktualnie: …" under the field, the typed amount stays and the next save uses the fresh version', async () => {
    let current = FULL;
    let answers = 0;
    const payments = api(() => json(200, current), ACTIVE_SESSION, {
      [PATCH]: () => {
        answers += 1;
        if (answers === 1) {
          current = listOf([ADVANCE, saved(480000, 2), INSTALLATION, FINAL], 360000, 540000);
          return problem(412, 'version_conflict');
        }
        return json(200, saved(540000, 3));
      },
    });
    await renderPanel(PATH, payments);
    const dialog = await openAmount('Po uzyskaniu zgód (30%)');
    const field = dialog.getByRole('textbox', { name: 'Kwota' });
    await userEvent.type(field, '5400');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(
      await dialog.findByText(
        'Tę transzę zmieniono w międzyczasie. Twoje zmiany zachowaliśmy — sprawdź aktualne wartości i zapisz ponownie.',
      ),
    ).toBeTruthy();
    expect(await dialog.findByText('Aktualnie: 4 800,00 zł · Planowana')).toBeTruthy();
    expect((field as HTMLInputElement).value).toBe(zl('5 400,00'));
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    await waitFor(() => {
      expect(payments.calls(PATCH)).toHaveLength(2);
    });
    expect(payments.calls(PATCH)[1]?.headers.get('If-Match')).toBe('"2"');
    expect(await screen.findByText('Zmieniono kwotę transzy „Po uzyskaniu zgód”: 5 400,00 zł.')).toBeTruthy();
  });

  it('EVM-053 AC8 412 and the instalment is no longer planned after the refresh: the alert says so and the save is disabled', async () => {
    let current = FULL;
    const payments = api(() => json(200, current), ACTIVE_SESSION, {
      [PATCH]: () => {
        current = listOf([{ ...CONSENTS, status: 'cancelled', version: 2 }]);
        return problem(412, 'version_conflict');
      },
    });
    await renderPanel(PATH, payments);
    const dialog = await openAmount('Po uzyskaniu zgód (30%)');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Kwota' }), '10');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(
      await dialog.findByText('Transza ma już status «Anulowana» — kwotę zmieni administrator korektą płatności.', {
        selector: '[role="alert"] *',
      }),
    ).toBeTruthy();
    expect(dialog.getByText('Aktualnie: bez kwoty · Anulowana')).toBeTruthy();
  });

  it('EVM-053 AC5 409 work_order_closed in the dialog: the alert for the role and the order is read again; the typed amount stays', async () => {
    const payments = api(undefined, roleSession('editor'), { [PATCH]: () => problem(409, 'work_order_closed') });
    await renderPanel(PATH, payments);
    const headerReads = payments.calls(`GET ${BASE}`).length;
    const dialog = await openAmount('Po uzyskaniu zgód (30%)');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Kwota' }), '10');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(await dialog.findByText(/płatności są tylko do odczytu\. Przywrócić zlecenie może tylko administrator\./)).toBeTruthy();
    await waitFor(() => {
      expect(payments.calls(`GET ${BASE}`).length).toBeGreaterThan(headerReads);
    });
    expect(dialog.getByRole<HTMLInputElement>('textbox', { name: 'Kwota' }).value).toBe(zl('10,00'));
  });

  it('EVM-053 AC7 404 (an instalment of another order through this one, or gone): "Nie znaleziono transzy. Odśwież zlecenie."', async () => {
    const payments = api(undefined, ACTIVE_SESSION, { [PATCH]: () => problem(404, 'not_found') });
    await renderPanel(PATH, payments);
    const dialog = await openAmount('Po uzyskaniu zgód (30%)');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Kwota' }), '10');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(await dialog.findByText('Nie znaleziono transzy. Odśwież zlecenie.')).toBeTruthy();
  });

  it('EVM-053 AC3 the same amount as before closes the dialog without a request; a typed change asks before it is dropped', async () => {
    const priced = listOf([{ ...CONSENTS, amount: { amountMinor: 540000, currency: 'PLN' } }]);
    const payments = api(() => json(200, priced), ACTIVE_SESSION, { [PATCH]: () => json(200, saved(1)) });
    await renderPanel(PATH, payments);
    let dialog = await openAmount('Po uzyskaniu zgód (30%)');
    const field = dialog.getByRole<HTMLInputElement>('textbox', { name: 'Kwota' });
    expect(field.value).toBe(zl('5 400,00'));
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(screen.queryByRole('dialog', { name: 'Zmień kwotę transzy' })).toBeNull();
    dialog = await openAmount('Po uzyskaniu zgód (30%)');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Kwota' }), '1');
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));
    expect(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeTruthy();
    expect(payments.calls(PATCH)).toHaveLength(0);
  });

  it('EVM-053 AC3 failures without a field: rate limit, a server error and no connection keep the typed amount', async () => {
    let answer: () => Response = () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' });
    const payments = api(undefined, ACTIVE_SESSION, { [PATCH]: () => answer() });
    await renderPanel(PATH, payments);
    const dialog = await openAmount('Po uzyskaniu zgód (30%)');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Kwota' }), '10');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(await dialog.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeTruthy();
    answer = () => problem(422, 'unexpected');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(await dialog.findByText(/Nie udało się zapisać płatności\. .*\(kod: abcdef01\)/)).toBeTruthy();
    answer = () => {
      throw new TypeError('network down');
    };
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(await dialog.findByText('Nie udało się zapisać kwoty. Sprawdź połączenie i spróbuj ponownie.')).toBeTruthy();
    answer = () => problem(409, 'idempotency_in_progress');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(await dialog.findByText('Poprzednie żądanie jeszcze trwa. Spróbuj ponownie za chwilę.')).toBeTruthy();
    answer = () => problem(403, 'channel_not_allowed');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(await dialog.findByText('Nie masz uprawnień do tej zmiany.')).toBeTruthy();
  });
});

describe('"Zmień kwotę transzy" — more states (EVM-053 AC3, AC5, AC8)', () => {
  const MANUAL = milestone(5, { code: null, name: 'Dopłata', version: 4 });
  const PATCH = `PATCH ${BASE}/payment-milestones/${MANUAL.id}`;
  const manualApi = (extra: Record<string, Handler> = {}, payments: Handler = () => json(200, listOf([MANUAL]))) =>
    api(payments, ACTIVE_SESSION, extra);

  it('EVM-053 AC3 an instalment added by hand has no share: the dialog names it without one and has no line about the plan', async () => {
    await renderPanel(PATH, manualApi());
    const dialog = await openAmount('Dopłata');
    expect(dialog.getByText('Dopłata · ZL-2026-0042')).toBeTruthy();
    expect(dialog.queryByText(/Udział z planu/)).toBeNull();
  });

  it('EVM-053 AC5 the Administrator gets 409 work_order_closed: the alert says the payments change after the restore', async () => {
    await renderPanel(PATH, manualApi({ [PATCH]: () => problem(409, 'work_order_closed') }));
    const dialog = await openAmount('Dopłata');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Kwota' }), '10');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(await dialog.findByText(/płatności są tylko do odczytu\. Zmienisz je po przywróceniu zlecenia\./)).toBeTruthy();
  });

  it('EVM-053 AC8 412 and the instalment is gone after the refresh: "Nie znaleziono transzy. Odśwież zlecenie."', async () => {
    let current = listOf([MANUAL]);
    const changed: Handler = () => {
      current = NO_PAYMENTS;
      return problem(412, 'version_conflict');
    };
    await renderPanel(
      PATH,
      manualApi({ [PATCH]: changed }, () => json(200, current)),
    );
    const dialog = await openAmount('Dopłata');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Kwota' }), '10');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(await screen.findByText('Nie znaleziono transzy. Odśwież zlecenie.')).toBeTruthy();
  });

  it('EVM-053 AC8 a status the panel does not know after 412 is "Nieznany status"; Enter does not send a blocked save', async () => {
    let current = listOf([MANUAL]);
    const changed: Handler = () => {
      current = listOf([{ ...MANUAL, status: 'refunded' as PaymentMilestone['status'], version: 5 }]);
      return problem(412, 'version_conflict');
    };
    const payments = manualApi({ [PATCH]: changed }, () => json(200, current));
    await renderPanel(PATH, payments);
    const dialog = await openAmount('Dopłata');
    const field = dialog.getByRole('textbox', { name: 'Kwota' });
    await userEvent.type(field, '10');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz kwotę' }));
    expect(await dialog.findByText('Aktualnie: bez kwoty · Nieznany status')).toBeTruthy();
    expect(
      dialog.getByText('Transza ma już status «Nieznany status» — kwotę zmieni administrator korektą płatności.', {
        selector: '[role="alert"] *',
      }),
    ).toBeTruthy();
    await userEvent.type(field, '{Enter}');
    expect(payments.calls(PATCH)).toHaveLength(1);
  });

  it('EVM-053 AC8 offline the dialog keeps the amount, shows the banner and its save says "Zapiszesz po powrocie połączenia."', async () => {
    await renderPanel(PATH, manualApi());
    const dialog = await openAmount('Dopłata');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Kwota' }), '10');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    globalThis.dispatchEvent(new Event('offline'));
    const submit = dialog.getByRole('button', { name: 'Zapisz kwotę' });
    await waitFor(() => {
      expect(submit.getAttribute('title')).toBe('Zapiszesz po powrocie połączenia.');
    });
    expect(dialog.getByRole<HTMLInputElement>('textbox', { name: 'Kwota' }).value).toBe('10');
  });

  it('EVM-053 AC3 "Wróć do edycji" of "Odrzucić zmiany?" brings back the dialog with the typed amount', async () => {
    await renderPanel(PATH, manualApi());
    const dialog = await openAmount('Dopłata');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Kwota' }), '77');
    await userEvent.click(dialog.getByRole('button', { name: 'Zamknij okno' }));
    const discard = within(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' }));
    await userEvent.click(discard.getByRole('button', { name: 'Wróć do edycji' }));
    const back = within(await screen.findByRole('dialog', { name: 'Zmień kwotę transzy' }));
    expect(back.getByRole<HTMLInputElement>('textbox', { name: 'Kwota' }).value).toBe('77,00');
  });
});

describe('"Dodaj transzę" (EVM-053 AC4, AC5, AC8)', () => {
  it('EVM-053 AC4 the Administrator gets 409 work_order_closed; "Wróć do edycji" keeps the typed name', async () => {
    const payments = api(undefined, ACTIVE_SESSION, { [CREATE]: () => problem(409, 'work_order_closed') });
    await renderPanel(PATH, payments);
    const dialog = await openAdd();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa transzy' }), 'Dopłata');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj transzę' }));
    expect(await dialog.findByText(/płatności są tylko do odczytu\. Zmienisz je po przywróceniu zlecenia\./)).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));
    const discard = within(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' }));
    await userEvent.click(discard.getByRole('button', { name: 'Wróć do edycji' }));
    const back = within(await screen.findByRole('dialog', { name: 'Dodaj transzę' }));
    expect(back.getByRole<HTMLInputElement>('textbox', { name: 'Nazwa transzy' }).value).toBe('Dopłata');
  });

  const added = (body: Record<string, unknown>): PaymentMilestone =>
    milestone(5, {
      id: String(body['id']),
      code: null,
      name: String(body['name']),
      amount: (body['amount'] as PaymentMilestone['amount'] | undefined) ?? null,
    });

  it('EVM-053 AC4 a name and an amount: POST with a UUIDv7 and an Idempotency-Key, the instalment is last, a toast and the focus on its menu', async () => {
    let current = FULL;
    const payments = api(() => json(200, current), roleSession('editor'), {
      [CREATE]: (request) => {
        const created = added(parseBody(request.body) as Record<string, unknown>);
        current = listOf([...FULL.items, created], 360000, 540000);
        return json(201, created, { ETag: '"1"' });
      },
    });
    await renderPanel(PATH, payments);
    await paymentsReady();
    const dialog = await openAdd();
    expect(dialog.getByText('ZL-2026-0042 · Garaż — pełny proces')).toBeTruthy();
    const name = dialog.getByRole('textbox', { name: 'Nazwa transzy' });
    expect(document.activeElement).toBe(name);
    expect(dialog.getByText('Nowa transza będzie ostatnia na liście i będzie miała status „Planowana”.')).toBeTruthy();
    await userEvent.type(name, '  Dopłata za instalację zasilającą ');
    const amount = dialog.getByRole('textbox', { name: 'Kwota (opcjonalnie)' });
    await userEvent.type(amount, '1500');
    await userEvent.tab();
    expect((amount as HTMLInputElement).value).toBe(zl('1 500,00'));
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj transzę' }));
    expect(await screen.findByText('Dodano transzę „Dopłata za instalację zasilającą”.')).toBeTruthy();
    const [request] = payments.calls(CREATE);
    const body = parseBody(request?.body ?? '') as Record<string, unknown>;
    expect(body).toEqual({
      id: expect.stringMatching(UUIDV7) as unknown,
      name: 'Dopłata za instalację zasilającą',
      amount: { amountMinor: 150000, currency: 'PLN' },
    });
    expect(request?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    const names = section()
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('td')?.textContent);
    expect(names.at(-1)).toBe('Dopłata za instalację zasilającą');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje transzy: Dopłata za instalację zasilającą' }));
    });
  });

  it('EVM-053 AC4 without an amount the request has none; a retry after a lost answer sends the same id and key (no second instalment)', async () => {
    let fail = true;
    const payments = api(undefined, ACTIVE_SESSION, {
      [CREATE]: (request) => {
        if (fail) throw new TypeError('network down');
        return json(201, added(parseBody(request.body) as Record<string, unknown>), { ETag: '"1"' });
      },
    });
    await renderPanel(PATH, payments);
    const dialog = await openAdd();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa transzy' }), 'Dopłata');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj transzę' }));
    expect(await dialog.findByText('Nie udało się dodać transzy. Spróbuj ponownie — nie dodamy jej dwa razy.')).toBeTruthy();
    fail = false;
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj transzę' }));
    expect(await screen.findByText('Dodano transzę „Dopłata”.')).toBeTruthy();
    const [first, second] = payments.calls(CREATE);
    expect(parseBody(first?.body ?? '')).toEqual(parseBody(second?.body ?? ''));
    expect(Object.keys(parseBody(first?.body ?? '') as object)).toEqual(['id', 'name']);
    expect(first?.headers.get('Idempotency-Key')).toBe(second?.headers.get('Idempotency-Key'));
  });

  it('EVM-053 AC4 an empty name, one longer than 120 characters, control characters or a wrong amount are refused before sending', async () => {
    const payments = api(undefined, ACTIVE_SESSION, { [CREATE]: () => problem(500, 'internal_error') });
    await renderPanel(PATH, payments);
    const dialog = await openAdd();
    const submit = dialog.getByRole('button', { name: 'Dodaj transzę' });
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa transzy' }), '   ');
    await userEvent.click(submit);
    expect(dialog.getByText('Podaj nazwę transzy.')).toBeTruthy();
    const name = dialog.getByRole('textbox', { name: 'Nazwa transzy' });
    await userEvent.clear(name);
    await userEvent.click(name);
    await userEvent.paste('x'.repeat(121));
    await userEvent.click(submit);
    expect(dialog.getByText('Nazwa transzy może mieć najwyżej 120 znaków.')).toBeTruthy();
    await userEvent.clear(name);
    await userEvent.click(name);
    await userEvent.paste(`Zal${String.fromCharCode(0x202e)}iczka`);
    await userEvent.click(submit);
    expect(dialog.getByText('Nazwa transzy zawiera niedozwolone znaki.')).toBeTruthy();
    await userEvent.clear(name);
    await userEvent.type(name, 'Dopłata');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Kwota (opcjonalnie)' }), '12,345');
    await userEvent.click(submit);
    expect(dialog.getByText('Kwota może mieć najwyżej 2 miejsca po przecinku.')).toBeTruthy();
    expect(payments.calls(CREATE)).toHaveLength(0);
  });

  it('EVM-053 AC4 400 of the server on the name or the amount is shown under the field', async () => {
    let errors = [{ pointer: '/name', code: 'too_long' }];
    const payments = api(undefined, ACTIVE_SESSION, { [CREATE]: () => problem(400, 'validation_failed', { errors }) });
    await renderPanel(PATH, payments);
    const dialog = await openAdd();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa transzy' }), 'Dopłata');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj transzę' }));
    expect(await dialog.findByText('Nazwa transzy może mieć najwyżej 120 znaków.')).toBeTruthy();
    errors = [{ pointer: '/amount/currency', code: 'invalid_value' }];
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj transzę' }));
    expect(await dialog.findByText('Podaj kwotę większą od zera, np. 1 500,00 zł.')).toBeTruthy();
    errors = [{ pointer: '/id', code: 'invalid_format' }];
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj transzę' }));
    expect(await dialog.findByText(/Nie udało się zapisać płatności\./)).toBeTruthy();
  });

  it('EVM-053 AC4 the 21st instalment (422 limit_exceeded) is told in the dialog with the limit; what was typed stays', async () => {
    const payments = api(undefined, ACTIVE_SESSION, { [CREATE]: () => problem(422, 'limit_exceeded') });
    await renderPanel(PATH, payments);
    const dialog = await openAdd();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa transzy' }), 'Dopłata');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj transzę' }));
    expect(await dialog.findByText('Zlecenie ma już 20 transz — to limit.')).toBeTruthy();
    expect(dialog.getByRole<HTMLInputElement>('textbox', { name: 'Nazwa transzy' }).value).toBe('Dopłata');
  });

  it('EVM-053 AC5 a race with closing: 409 work_order_closed in the dialog, then 404, 403, 429 and "already running"', async () => {
    let answer: () => Response = () => problem(409, 'work_order_closed');
    const payments = api(undefined, roleSession('editor'), { [CREATE]: () => answer() });
    await renderPanel(PATH, payments);
    const dialog = await openAdd();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa transzy' }), 'Dopłata');
    const submit = dialog.getByRole('button', { name: 'Dodaj transzę' });
    await userEvent.click(submit);
    expect(await dialog.findByText(/płatności są tylko do odczytu\. Przywrócić zlecenie może tylko administrator\./)).toBeTruthy();
    answer = () => problem(404, 'not_found');
    await userEvent.click(submit);
    expect(await dialog.findByText('Nie znaleziono zlecenia. Odśwież stronę.')).toBeTruthy();
    answer = () => problem(403, 'forbidden');
    await userEvent.click(submit);
    expect(await dialog.findByText('Nie masz uprawnień do tej zmiany.')).toBeTruthy();
    answer = () => problem(429, 'rate_limited', {}, { 'Retry-After': '60' });
    await userEvent.click(submit);
    expect(await dialog.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 60 s.')).toBeTruthy();
    answer = () => problem(409, 'idempotency_in_progress');
    await userEvent.click(submit);
    expect(await dialog.findByText('Poprzednie żądanie jeszcze trwa. Spróbuj ponownie za chwilę.')).toBeTruthy();
    answer = () => problem(409, 'id_conflict');
    await userEvent.click(submit);
    expect(await dialog.findByText('Nie udało się dodać transzy. Spróbuj ponownie — nie dodamy jej dwa razy.')).toBeTruthy();
  });

  it('EVM-053 AC8 offline the open dialog keeps the data and its button is disabled with "Zapiszesz po powrocie połączenia."', async () => {
    await renderPanel(PATH, api());
    const dialog = await openAdd();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa transzy' }), 'Dopłata');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    globalThis.dispatchEvent(new Event('offline'));
    const submit = dialog.getByRole('button', { name: 'Dodaj transzę' });
    await waitFor(() => {
      expect(submit.getAttribute('aria-disabled')).toBe('true');
    });
    expect(submit.getAttribute('title')).toBe('Zapiszesz po powrocie połączenia.');
    expect(dialog.getByRole<HTMLInputElement>('textbox', { name: 'Nazwa transzy' }).value).toBe('Dopłata');
  });

  it('EVM-053 AC4 closing without data does not ask; with data "Odrzucić zmiany?" comes first', async () => {
    await renderPanel(PATH, api());
    let dialog = await openAdd();
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(section().getByRole('button', { name: 'Dodaj transzę' }));
    dialog = await openAdd();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Nazwa transzy' }), 'D');
    await userEvent.click(dialog.getByRole('button', { name: 'Zamknij okno' }));
    expect(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeTruthy();
  });
});
