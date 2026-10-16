import type { PaymentMilestone } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, plainTextProblem } from '../src/work-orders/milestone-command.tsx';
import { daysBetween, isDayInRange } from '../src/work-orders/milestone-days.ts';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem, type Handler } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import {
  ALL,
  CANCELLED,
  INVOICED,
  PAID,
  PLANNED,
  PAYMENTS_LIST,
  PAYMENTS_PATH,
  patchRoute,
  paymentsApi,
  paymentsOf,
  roleSession,
  transitionRoute,
  UUIDV7,
} from './payment-api.ts';

const NBSP = String.fromCharCode(0xa0);
/** "1 230,00 zł" as the panel writes it — with non-breaking spaces (styleguide § 6.3). */
const zl = (text: string): string => text.replaceAll(' ', NBSP);

beforeEach(() => {
  // AC2: the clock of the story — today is 2026-10-03 in Europe/Warsaw
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-03T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const ready = () => screen.findByRole('table', { name: 'Transze płatności zlecenia' });
const rowOf = (name: string): HTMLElement => {
  const row = screen.getByText(name).closest('tr');
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
};
const setDay = (field: HTMLElement, value: string) => {
  fireEvent.change(field, { target: { value } });
};

/** A list that the handlers of a test change, read anew by every GET. */
function store(initial: PaymentMilestone[] = [PLANNED, INVOICED, PAID, CANCELLED]) {
  let items = initial;
  return {
    read: () => paymentsOf(items),
    put(saved: PaymentMilestone) {
      items = items.map((entry) => (entry.id === saved.id ? saved : entry));
    },
  };
}

async function openRow(name: string, button: string) {
  await ready();
  await userEvent.click(within(rowOf(name)).getByRole('button', { name: button }));
}

async function openMenu(name: string, item: string) {
  await ready();
  await userEvent.click(screen.getByRole('button', { name: `Akcje transzy: ${name}` }));
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}

const ISSUED: PaymentMilestone = {
  ...PLANNED,
  status: 'invoiced',
  invoiceNumber: 'FV/TEST/0021/2026',
  invoicedOn: '2026-10-03',
  dueDate: '2026-10-10',
  version: 3,
  allowedTransitions: ['paid'],
};

describe('the pure rules of the dialogs (EVM-054 AC1, AC4)', () => {
  it('EVM-054 AC1 the due date is the date of the invoice + the days of the plan, counted on calendar days', () => {
    expect(addDays('2026-10-03', 7)).toBe('2026-10-10');
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31');
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(daysBetween('2026-09-28', '2026-10-03')).toBe(5);
    expect(isDayInRange('2000-01-01')).toBe(true);
    expect(isDayInRange('2101-01-01')).toBe(false);
    expect(isDayInRange('1999-12-31')).toBe(false);
    expect(isDayInRange('')).toBe(false);
    expect(plainTextProblem('  ', 60)).toBe('required');
    expect(plainTextProblem('FV/TEST‮/1', 60)).toBe('invalid_characters');
    expect(plainTextProblem('x'.repeat(61), 60)).toBe('too_long');
    expect(plainTextProblem(` ${'x'.repeat(60)} `, 60)).toBeUndefined();
  });
});

describe('"Wystaw fakturę…" (EVM-054 AC1)', () => {
  it('EVM-054 AC1 the Editor issues FV/TEST/0021/2026 for 1 230,00 zł on 2026-10-03: the summary, the due date of the plan, the request and the toast', async () => {
    const list = store();
    const api = paymentsApi(list.read, roleSession('editor'), {
      [transitionRoute(PLANNED)]: () => {
        list.put(ISSUED);
        return json(200, ISSUED, { ETag: '"3"' });
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openRow('Zaliczka (20%)', 'Wystaw fakturę…');
    const dialog = screen.getByRole('dialog', { name: 'Wystawić fakturę dla transzy „Zaliczka”?' });
    const view = within(dialog);
    // the focus starts in the first field (a dialog with a summary and fields — "UX / UI" → "Dostępność")
    const amount = view.getByRole('textbox', { name: 'Kwota' });
    expect(document.activeElement).toBe(amount);
    expect((amount as HTMLInputElement).value).toBe(zl('1 230,00'));
    expect(amount.getAttribute('inputmode')).toBe('decimal');
    expect(view.getByLabelText<HTMLInputElement>('Data wystawienia').value).toBe('2026-10-03');
    expect(view.getByLabelText<HTMLInputElement>('Termin płatności').value).toBe('2026-10-10');
    expect(view.getByText('ZL-2026-0042 · Garaż — pełny proces')).toBeTruthy();
    expect(view.getByText('Cofnąć wystawienie może tylko administrator.')).toBeTruthy();
    // the dialog is described by the order and the effect
    const described = (dialog.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'ZL-2026-0042 · Garaż — pełny proces',
      'Cofnąć wystawienie może tylko administrator.',
    ]);
    await userEvent.type(view.getByRole('textbox', { name: 'Nr faktury lub proformy' }), 'FV/TEST/0021/2026');
    // the summary follows what was typed
    const summary = view.getByText('Nr faktury').closest('dl');
    if (summary === null) throw new Error('no summary');
    expect([...summary.querySelectorAll('dd')].map((entry) => entry.textContent)).toEqual([
      'Zaliczka (20%)',
      'ZL-2026-0042',
      zl('1 230,00 zł'),
      'FV/TEST/0021/2026',
      '03.10.2026',
      '10.10.2026',
    ]);
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(view.getByRole('button', { name: 'Wystaw fakturę' }));
    expect(await screen.findByText('Wystawiono fakturę FV/TEST/0021/2026 na 1 230,00 zł, termin płatności 10.10.2026.')).toBeTruthy();
    const [request] = api.calls(transitionRoute(PLANNED));
    // the default due date is counted by the server (the plan has 7 days): the panel does not send it
    expect(parseBody(request?.body ?? '')).toEqual({
      to: 'invoiced',
      amount: { amountMinor: 123000, currency: 'PLN' },
      invoiceNumber: 'FV/TEST/0021/2026',
      invoicedOn: '2026-10-03',
    });
    expect(request?.headers.get('If-Match')).toBe('"2"');
    expect(request?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    // no "Cofnij": only the Administrator withdraws an invoice
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(rowOf('Zaliczka (20%)')).getByText('Wystawiona')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }));
    });
  });

  it('EVM-054 AC1 the due date follows the date of the invoice until the person changes it; then it is sent', async () => {
    const api = paymentsApi(() => ALL, undefined, { [transitionRoute(PLANNED)]: () => json(200, ISSUED) });
    await renderPanel(PAYMENTS_PATH, api);
    await openRow('Zaliczka (20%)', 'Wystaw fakturę…');
    const view = within(screen.getByRole('dialog'));
    setDay(view.getByLabelText('Data wystawienia'), '2026-10-24');
    expect(view.getByLabelText<HTMLInputElement>('Termin płatności').value).toBe('2026-10-31');
    setDay(view.getByLabelText('Termin płatności'), '2026-11-15');
    setDay(view.getByLabelText('Data wystawienia'), '2026-10-20');
    expect(view.getByLabelText<HTMLInputElement>('Termin płatności').value).toBe('2026-11-15');
    await userEvent.type(view.getByRole('textbox', { name: 'Nr faktury lub proformy' }), 'FV/TEST/0022/2026');
    await userEvent.click(view.getByRole('button', { name: 'Wystaw fakturę' }));
    await waitFor(() => {
      expect(api.calls(transitionRoute(PLANNED))).toHaveLength(1);
    });
    expect(parseBody(api.calls(transitionRoute(PLANNED))[0]?.body ?? '')).toMatchObject({
      invoicedOn: '2026-10-20',
      dueDate: '2026-11-15',
    });
  });

  it('EVM-054 AC1 refused before sending: no number, no amount, a date out of 2000–2100 and a due date before the invoice (Q3a, Q3b)', async () => {
    const manual = { ...PLANNED, amount: null };
    const api = paymentsApi(() => paymentsOf([manual]));
    await renderPanel(PAYMENTS_PATH, api);
    await openRow('Zaliczka (20%)', 'Wystaw fakturę…');
    const view = within(screen.getByRole('dialog'));
    setDay(view.getByLabelText('Data wystawienia'), '2101-01-01');
    await userEvent.click(view.getByRole('button', { name: 'Wystaw fakturę' }));
    const summary = view.getByText('Popraw zaznaczone pola, aby wystawić fakturę.').closest<HTMLElement>('[role="alert"]');
    await waitFor(() => {
      expect(document.activeElement).toBe(summary);
    });
    expect(view.getAllByText('Podaj kwotę większą od zera, np. 1 500,00 zł.').length).toBeGreaterThan(0);
    expect(view.getAllByText('Podaj nr faktury lub proformy.').length).toBeGreaterThan(0);
    expect(view.getAllByText('Podaj datę z lat 2000–2100.').length).toBeGreaterThan(0);
    // a link of the summary moves the focus into its field
    await userEvent.click(view.getByRole('link', { name: 'Podaj nr faktury lub proformy.' }));
    expect(document.activeElement).toBe(view.getByRole('textbox', { name: 'Nr faktury lub proformy' }));
    setDay(view.getByLabelText('Data wystawienia'), '2026-10-03');
    setDay(view.getByLabelText('Termin płatności'), '2026-10-02');
    await userEvent.type(view.getByRole('textbox', { name: 'Kwota' }), '1230');
    await userEvent.click(view.getByRole('button', { name: 'Wystaw fakturę' }));
    expect(view.getAllByText('Termin płatności nie może być wcześniejszy niż data wystawienia.').length).toBeGreaterThan(0);
    expect(api.calls(transitionRoute(PLANNED))).toHaveLength(0);
  });

  it('EVM-054 AC1 an instalment added by hand has no days of the plan: the due date is empty and required (Q3c); a past one is a hint', async () => {
    const manual = { ...PLANNED, code: null, sharePercent: null, paymentTermDays: null, name: 'Dopłata' };
    const api = paymentsApi(() => paymentsOf([manual]), undefined, { [transitionRoute(manual)]: () => json(200, ISSUED) });
    await renderPanel(PAYMENTS_PATH, api);
    await openRow('Dopłata', 'Wystaw fakturę…');
    const view = within(screen.getByRole('dialog', { name: 'Wystawić fakturę dla transzy „Dopłata”?' }));
    expect(view.getByLabelText<HTMLInputElement>('Termin płatności').value).toBe('');
    await userEvent.type(view.getByRole('textbox', { name: 'Nr faktury lub proformy' }), 'FV/TEST/0023/2026');
    await userEvent.click(view.getByRole('button', { name: 'Wystaw fakturę' }));
    expect(view.getAllByText('Podaj termin płatności.').length).toBeGreaterThan(0);
    setDay(view.getByLabelText('Data wystawienia'), '2026-09-01');
    setDay(view.getByLabelText('Termin płatności'), '2026-09-15');
    expect(view.getByText('Termin już minął — faktura będzie od razu po terminie.')).toBeTruthy();
    await userEvent.click(view.getByRole('button', { name: 'Wystaw fakturę' }));
    await waitFor(() => {
      expect(api.calls(transitionRoute(manual))).toHaveLength(1);
    });
    expect(parseBody(api.calls(transitionRoute(manual))[0]?.body ?? '')).toMatchObject({ dueDate: '2026-09-15', invoicedOn: '2026-09-01' });
  });

  it('EVM-054 AC1 400 of the server is shown under its field; closing with typed data asks first', async () => {
    const api = paymentsApi(() => ALL, undefined, {
      [transitionRoute(PLANNED)]: () =>
        problem(400, 'validation_failed', {
          errors: [
            { pointer: '/invoiceNumber', code: 'invalid_characters' },
            { pointer: '/dueDate', code: 'before_invoiced_on' },
          ],
        }),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openRow('Zaliczka (20%)', 'Wystaw fakturę…');
    const view = within(screen.getByRole('dialog'));
    await userEvent.type(view.getByRole('textbox', { name: 'Nr faktury lub proformy' }), 'FV/TEST/0024/2026');
    await userEvent.click(view.getByRole('button', { name: 'Wystaw fakturę' }));
    expect(await view.findByText('Nr faktury lub proformy zawiera niedozwolone znaki.')).toBeTruthy();
    expect(view.getByText('Termin płatności nie może być wcześniejszy niż data wystawienia.')).toBeTruthy();
    await userEvent.click(view.getByRole('button', { name: 'Anuluj' }));
    expect(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Wróć do edycji' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Nr faktury lub proformy' }).value).toBe('FV/TEST/0024/2026');
  });
});

describe('"Odnotuj wpłatę…" (EVM-054 AC2)', () => {
  const PAID_NOW: PaymentMilestone = { ...INVOICED, status: 'paid', paidOn: '2026-10-03', version: 4, allowedTransitions: [] };

  it('EVM-054 AC2 the payment of today: the summary of W-11, the focus on "Anuluj", the request and the toast without "Cofnij"', async () => {
    const list = store();
    const api = paymentsApi(list.read, roleSession('editor'), {
      [transitionRoute(INVOICED)]: () => {
        list.put(PAID_NOW);
        return json(200, PAID_NOW);
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openRow('Po uzyskaniu zgód (30%)', 'Odnotuj wpłatę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Odnotować wpłatę za transzę „Po uzyskaniu zgód”?' });
    const view = within(dialog);
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Anuluj' }));
    expect(view.getByText('Faktura FV/TEST/0021/2026 · 1 230,00 zł')).toBeTruthy();
    expect(view.getByText('Termin 10.10.2026')).toBeTruthy();
    expect(view.getByLabelText<HTMLInputElement>('Data wpłaty').value).toBe('2026-10-03');
    expect(view.getByText('Nie później niż dziś.')).toBeTruthy();
    expect(view.getByText('Cofnąć wpłatę może tylko administrator.')).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(view.getByRole('button', { name: 'Odnotuj wpłatę' }));
    expect(await screen.findByText('Odnotowano wpłatę 1 230,00 zł za fakturę FV/TEST/0021/2026.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
    const [request] = api.calls(transitionRoute(INVOICED));
    expect(parseBody(request?.body ?? '')).toEqual({ to: 'paid', paidOn: '2026-10-03' });
    expect(request?.headers.get('If-Match')).toBe('"3"');
    expect(within(rowOf('Po uzyskaniu zgód (30%)')).getByText('Opłacona')).toBeTruthy();
  });

  it('EVM-054 AC2 a day in the future (2026-10-04) is refused before sending and when the server refuses it (422)', async () => {
    const api = paymentsApi(() => ALL, undefined, {
      [transitionRoute(INVOICED)]: () =>
        problem(422, 'transition_condition_not_met', { errors: [{ pointer: '/paidOn', code: 'in_future' }] }),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openRow('Po uzyskaniu zgód (30%)', 'Odnotuj wpłatę…');
    const view = within(screen.getByRole('alertdialog'));
    const field = view.getByLabelText('Data wpłaty');
    expect(field.getAttribute('max')).toBe('2026-10-03');
    setDay(field, '2026-10-04');
    await userEvent.click(view.getByRole('button', { name: 'Odnotuj wpłatę' }));
    expect(view.getByText('Data wpłaty nie może być późniejsza niż dziś.')).toBeTruthy();
    expect(api.calls(transitionRoute(INVOICED))).toHaveLength(0);
    // the clock of the panel may be behind the server's: the 422 of the server says the same under the field
    setDay(field, '2026-10-03');
    await userEvent.click(view.getByRole('button', { name: 'Odnotuj wpłatę' }));
    expect(await view.findByText('Data wpłaty nie może być późniejsza niż dziś.')).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    setDay(field, '');
    await userEvent.click(view.getByRole('button', { name: 'Odnotuj wpłatę' }));
    expect(view.getByText('Podaj datę z lat 2000–2100.')).toBeTruthy();
  });

  it.each([
    ['2026-09-28', 'Termin 28.09.2026 (5 dni po terminie)'],
    ['2026-10-02', 'Termin 02.10.2026 (1 dzień po terminie)'],
  ])('EVM-054 AC2 an instalment after its due date %s says how many days ago it was', async (dueDate, text) => {
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => paymentsOf([{ ...INVOICED, dueDate, isOverdue: true }])),
    );
    await openRow('Po uzyskaniu zgód (30%)', 'Odnotuj wpłatę…');
    const view = within(screen.getByRole('alertdialog'));
    expect(view.getByText(text)).toBeTruthy();
    // Esc (the event "cancel" of the native dialog) closes it without a request
    fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('"Anuluj transzę…" (EVM-054 AC3)', () => {
  const GONE: PaymentMilestone = { ...PLANNED, status: 'cancelled', version: 3, allowedTransitions: [] };

  it('EVM-054 AC3 the required reason, the danger button and the effect; the reason goes only in the request; the status is "Anulowana"', async () => {
    const list = store();
    const api = paymentsApi(list.read, roleSession('editor'), {
      [transitionRoute(PLANNED)]: () => {
        list.put(GONE);
        return json(200, GONE);
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Anuluj transzę…');
    const view = within(screen.getByRole('dialog', { name: 'Anulować transzę „Zaliczka”?' }));
    const reason = view.getByRole('textbox', { name: 'Powód anulowania' });
    expect(document.activeElement).toBe(reason);
    expect(view.getByText('Przywrócić transzę może tylko administrator.')).toBeTruthy();
    expect(view.getByText('20%')).toBeTruthy();
    const submit = view.getByRole('button', { name: 'Anuluj transzę' });
    expect(submit.className).toContain('bg-action-danger-bg');
    await userEvent.click(submit);
    expect(view.getByText('Podaj powód anulowania.')).toBeTruthy();
    expect(api.calls(transitionRoute(PLANNED))).toHaveLength(0);
    await userEvent.type(reason, '  Klient zrezygnował z tej transzy  ');
    expect(view.getByText('Nie wpisuj danych osobowych. 32 z 500 znaków')).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(submit);
    expect(await screen.findByText('Anulowano transzę „Zaliczka”.')).toBeTruthy();
    expect(parseBody(api.calls(transitionRoute(PLANNED))[0]?.body ?? '')).toEqual({
      to: 'cancelled',
      reason: 'Klient zrezygnował z tej transzy',
    });
    const badge = within(rowOf('Zaliczka (20%)')).getByText('Anulowana');
    expect(badge.closest('[class*="bg-status-payment-cancelled-bg"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
  });

  it('EVM-054 AC3 a reason longer than 500 characters is refused; the server 400 on the reason is shown under the field', async () => {
    const api = paymentsApi(() => ALL, undefined, {
      [transitionRoute(PLANNED)]: () => problem(400, 'validation_failed', { errors: [{ pointer: '/reason', code: 'invalid_characters' }] }),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Anuluj transzę…');
    const view = within(screen.getByRole('dialog'));
    fireEvent.change(view.getByRole('textbox', { name: 'Powód anulowania' }), { target: { value: 'x'.repeat(501) } });
    await userEvent.click(view.getByRole('button', { name: 'Anuluj transzę' }));
    expect(view.getByText('Powód może mieć najwyżej 500 znaków.')).toBeTruthy();
    fireEvent.change(view.getByRole('textbox', { name: 'Powód anulowania' }), { target: { value: 'Powód testowy' } });
    await userEvent.click(view.getByRole('button', { name: 'Anuluj transzę' }));
    expect(await view.findByText('Powód zawiera niedozwolone znaki.')).toBeTruthy();
    // a typed reason asks before it is dropped
    await userEvent.click(view.getByRole('button', { name: 'Anuluj' }));
    expect(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Odrzuć zmiany' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('corrections of the invoice and of the payment (EVM-054 AC4)', () => {
  it('EVM-054 AC4 "Popraw dane faktury…": only the changed number goes with If-Match; the amount is read only; the toast', async () => {
    const fixed = { ...INVOICED, invoiceNumber: 'FV/TEST/0031/2026', version: 4 };
    const list = store();
    const api = paymentsApi(list.read, roleSession('editor'), {
      [patchRoute(INVOICED)]: () => {
        list.put(fixed);
        return json(200, fixed);
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Po uzyskaniu zgód (30%)', 'Popraw dane faktury…');
    const view = within(screen.getByRole('dialog', { name: 'Popraw dane faktury' }));
    const number = view.getByRole('textbox', { name: 'Nr faktury lub proformy' });
    expect(document.activeElement).toBe(number);
    expect(view.getByText('Kwota: 1 230,00 zł')).toBeTruthy();
    expect(view.getByText('Kwotę zmieni administrator korektą płatności.')).toBeTruthy();
    expect(view.queryByRole('textbox', { name: 'Kwota' })).toBeNull();
    const save = view.getByRole('button', { name: 'Zapisz zmiany' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    await userEvent.clear(number);
    await userEvent.type(number, 'FV/TEST/0031/2026');
    expect(save.getAttribute('aria-disabled')).toBeNull();
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(save);
    expect(await screen.findByText('Zapisano dane faktury FV/TEST/0031/2026.')).toBeTruthy();
    const [request] = api.calls(patchRoute(INVOICED));
    expect(parseBody(request?.body ?? '')).toEqual({ invoiceNumber: 'FV/TEST/0031/2026' });
    expect(request?.headers.get('If-Match')).toBe('"3"');
    expect(within(rowOf('Po uzyskaniu zgód (30%)')).getByText('FV/TEST/0031/2026')).toBeTruthy();
  });

  it('EVM-054 AC4 the dates: the due date before the invoice is refused on the field that changed (Q3b); the dates go alone', async () => {
    const api = paymentsApi(() => ALL, undefined, { [patchRoute(INVOICED)]: () => json(200, INVOICED) });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Po uzyskaniu zgód (30%)', 'Popraw dane faktury…');
    const view = within(screen.getByRole('dialog'));
    setDay(view.getByLabelText('Data wystawienia'), '2026-10-12');
    await userEvent.click(view.getByRole('button', { name: 'Zapisz zmiany' }));
    // only the date of the invoice changed: the message stands under it (as the server points at /invoicedOn)
    expect(view.getByLabelText('Data wystawienia').getAttribute('aria-invalid')).toBe('true');
    expect(view.getAllByText('Termin płatności nie może być wcześniejszy niż data wystawienia.').length).toBeGreaterThan(0);
    setDay(view.getByLabelText('Termin płatności'), '2026-10-11');
    await userEvent.click(view.getByRole('button', { name: 'Zapisz zmiany' }));
    expect(view.getByLabelText('Termin płatności').getAttribute('aria-invalid')).toBe('true');
    setDay(view.getByLabelText('Termin płatności'), '2026-10-20');
    setDay(view.getByLabelText('Data wystawienia'), '2026-10-04');
    await userEvent.click(view.getByRole('button', { name: 'Zapisz zmiany' }));
    await waitFor(() => {
      expect(api.calls(patchRoute(INVOICED))).toHaveLength(1);
    });
    expect(parseBody(api.calls(patchRoute(INVOICED))[0]?.body ?? '')).toEqual({ invoicedOn: '2026-10-04', dueDate: '2026-10-20' });
  });

  it('EVM-054 AC4 "Popraw datę wpłaty…": the day goes with If-Match, the toast names it; the future and a 400 in_future are refused', async () => {
    const fixed = { ...PAID, paidOn: '2026-10-02', version: 5 };
    const answers: Handler[] = [
      () => problem(400, 'validation_failed', { errors: [{ pointer: '/paidOn', code: 'in_future' }] }),
      () => json(200, fixed),
    ];
    const api = paymentsApi(() => ALL, roleSession('editor'), {
      [patchRoute(PAID)]: (request) => (answers.shift() ?? answers[0] ?? (() => json(200, fixed)))(request),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Po wykonaniu instalacji (30%)', 'Popraw datę wpłaty…');
    const view = within(screen.getByRole('dialog', { name: 'Popraw datę wpłaty' }));
    const field = view.getByLabelText('Data wpłaty');
    expect((field as HTMLInputElement).value).toBe('2026-10-01');
    setDay(field, '2026-10-04');
    await userEvent.click(view.getByRole('button', { name: 'Zapisz datę' }));
    expect(view.getByText('Data wpłaty nie może być późniejsza niż dziś.')).toBeTruthy();
    setDay(field, '2026-10-02');
    await userEvent.click(view.getByRole('button', { name: 'Zapisz datę' }));
    expect(await view.findByText('Data wpłaty nie może być późniejsza niż dziś.')).toBeTruthy();
    await userEvent.click(view.getByRole('button', { name: 'Zapisz datę' }));
    expect(await screen.findByText('Zapisano datę wpłaty 02.10.2026.')).toBeTruthy();
    const requests = api.calls(patchRoute(PAID));
    expect(requests.map((entry) => parseBody(entry.body))).toEqual([{ paidOn: '2026-10-02' }, { paidOn: '2026-10-02' }]);
    expect(requests[1]?.headers.get('If-Match')).toBe('"4"');
  });

  it('EVM-054 AC4 the same day as before closes "Popraw datę wpłaty" without a request', async () => {
    const api = paymentsApi();
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Po wykonaniu instalacji (30%)', 'Popraw datę wpłaty…');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Zapisz datę' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls(patchRoute(PAID))).toHaveLength(0);
  });
});

describe('the rules of the commands in the dialogs (EVM-054 AC7)', () => {
  it('EVM-054 AC7 412: the alert names the status of now with "Odśwież"; the typed data stays; another status closes the dialog', async () => {
    let items = [PLANNED, INVOICED, PAID, CANCELLED];
    const api = paymentsApi(() => paymentsOf(items), undefined, {
      [transitionRoute(PLANNED)]: () => {
        items = [{ ...ISSUED, status: 'paid', paidOn: '2026-10-03', version: 5 }, INVOICED, PAID, CANCELLED];
        return problem(412, 'precondition_failed');
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openRow('Zaliczka (20%)', 'Wystaw fakturę…');
    const view = within(screen.getByRole('dialog'));
    await userEvent.type(view.getByRole('textbox', { name: 'Nr faktury lub proformy' }), 'FV/TEST/0025/2026');
    await userEvent.click(view.getByRole('button', { name: 'Wystaw fakturę' }));
    const alert = await view.findByText('Tę transzę zmieniono w międzyczasie (teraz: «Opłacona»).');
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(view.getByRole<HTMLInputElement>('textbox', { name: 'Nr faktury lub proformy' }).value).toBe('FV/TEST/0025/2026');
    expect(api.calls(PAYMENTS_LIST).length).toBeGreaterThan(1);
    await userEvent.click(view.getByRole('button', { name: 'Odśwież' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-054 AC7 409 invalid_state_transition with the same status: "Odśwież" takes the fresh version and the next try uses it', async () => {
    const answers: Handler[] = [() => problem(409, 'invalid_state_transition'), () => json(200, { ...PAID, version: 9 })];
    let items = [PLANNED, INVOICED, PAID, CANCELLED];
    const api = paymentsApi(() => paymentsOf(items), undefined, {
      [transitionRoute(INVOICED)]: (request) => {
        items = [PLANNED, { ...INVOICED, version: 7 }, PAID, CANCELLED];
        return (answers.shift() ?? (() => json(200, PAID)))(request);
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openRow('Po uzyskaniu zgód (30%)', 'Odnotuj wpłatę…');
    const view = within(screen.getByRole('alertdialog'));
    await userEvent.click(view.getByRole('button', { name: 'Odnotuj wpłatę' }));
    expect(await view.findByText('Tę transzę zmieniono w międzyczasie (teraz: «Wystawiona»).')).toBeTruthy();
    await userEvent.click(view.getByRole('button', { name: 'Odśwież' }));
    expect(view.queryByText(/zmieniono w międzyczasie/)).toBeNull();
    await userEvent.click(view.getByRole('button', { name: 'Odnotuj wpłatę' }));
    await waitFor(() => {
      expect(api.calls(transitionRoute(INVOICED))).toHaveLength(2);
    });
    expect(api.calls(transitionRoute(INVOICED))[1]?.headers.get('If-Match')).toBe('"7"');
  });

  it.each([
    [
      problem(409, 'work_order_closed'),
      'Zlecenie jest już rozliczone — płatności są tylko do odczytu. Zmienisz je po przywróceniu zlecenia.',
    ],
    [problem(404, 'not_found'), 'Nie znaleziono transzy. Odśwież zlecenie.'],
    [problem(403, 'forbidden'), 'Nie masz uprawnień do tej operacji.'],
    [problem(428, 'precondition_required'), 'Nie udało się zapisać. Spróbuj ponownie — nie wykonamy tej operacji dwa razy.'],
    [problem(429, 'rate_limited', {}, { 'Retry-After': '30' }), 'Zbyt wiele zapytań. Spróbuj ponownie za 30 s.'],
    [problem(409, 'idempotency_in_progress'), 'Poprzednie żądanie jeszcze trwa. Spróbuj ponownie za chwilę.'],
    [problem(503, 'unavailable'), 'Nie udało się zapisać. Spróbuj ponownie — nie wykonamy tej operacji dwa razy.'],
    [problem(422, 'idempotency_mismatch'), 'Nie udało się zapisać. Spróbuj ponownie — nie wykonamy tej operacji dwa razy.'],
  ])('EVM-054 AC7 the answer %# is told in the dialog and the reason stays', async (answer, text) => {
    const api = paymentsApi(() => ALL, undefined, { [transitionRoute(PLANNED)]: () => answer.clone() });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Anuluj transzę…');
    const view = within(screen.getByRole('dialog'));
    await userEvent.type(view.getByRole('textbox', { name: 'Powód anulowania' }), 'Powód testowy');
    await userEvent.click(view.getByRole('button', { name: 'Anuluj transzę' }));
    expect(await view.findByText(text)).toBeTruthy();
    expect(view.getByRole<HTMLTextAreaElement>('textbox', { name: 'Powód anulowania' }).value).toBe('Powód testowy');
  });

  it('EVM-054 AC7 412 and the instalment is gone after the refresh: the dialog stays and says so', async () => {
    let items = [PLANNED, INVOICED, PAID, CANCELLED];
    const api = paymentsApi(() => paymentsOf(items), undefined, {
      [patchRoute(PAID)]: () => {
        items = [PLANNED, INVOICED, CANCELLED];
        return problem(412, 'precondition_failed');
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Po wykonaniu instalacji (30%)', 'Popraw datę wpłaty…');
    const view = within(screen.getByRole('dialog'));
    setDay(view.getByLabelText('Data wpłaty'), '2026-09-30');
    await userEvent.click(view.getByRole('button', { name: 'Zapisz datę' }));
    expect(await view.findByText('Nie znaleziono transzy. Odśwież zlecenie.')).toBeTruthy();
  });

  it('EVM-054 AC8 offline an open dialog keeps the data and its button says "Zapiszesz po powrocie połączenia."', async () => {
    const api = paymentsApi();
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Po uzyskaniu zgód (30%)', 'Popraw dane faktury…');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    const view = within(screen.getByRole('dialog'));
    const save = await view.findByRole('button', { name: 'Zapisz zmiany' });
    await waitFor(() => {
      expect(save.getAttribute('title')).toBe('Zapiszesz po powrocie połączenia.');
    });
    expect(view.getAllByText('Zapiszesz po powrocie połączenia.').length).toBeGreaterThan(0);
  });
});
