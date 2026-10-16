import type { PaymentMilestone } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStepUp } from '../src/session/step-up.ts';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem, type Handler } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import {
  milestone,
  PAYMENTS_BASE,
  PAYMENTS_LIST,
  PAYMENTS_PATH,
  patchRoute,
  paymentsApi,
  paymentsOf,
  roleSession,
  transitionRoute,
  UUIDV7,
} from './payment-api.ts';
import { OVERDUE, orderPayments, TWO, UNPAID_PATH, fullOf, unpaidApi } from './unpaid-api.ts';

const NBSP = String.fromCharCode(0xa0);
/** "3 600,00 zł" as the panel writes it — with non-breaking spaces (styleguide § 6.3). */
const zl = (text: string): string => text.replaceAll(' ', NBSP);
const STEP_UP_TITLE = 'Potwierdź tożsamość, aby skorygować płatność';
const AUDIT = 'Operacja zostanie zapisana w dzienniku audytu.';

/** The synthetic instalments of ZL-2026-0042 (EVM-057 AC1–AC4): an invoiced FV/TEST/0007/2026, a paid one and a cancelled one. */
const ISSUED = milestone(1, {
  name: 'Zaliczka',
  sharePercent: 20,
  paymentTermDays: 7,
  amount: { amountMinor: 360000, currency: 'PLN' },
  status: 'invoiced',
  invoiceNumber: 'FV/TEST/0007/2026',
  invoicedOn: '2026-10-03',
  dueDate: '2026-10-10',
  isOverdue: true,
  version: 3,
  allowedTransitions: ['paid', 'planned', 'cancelled'],
});
const PAID = milestone(2, {
  name: 'Po uzyskaniu zgód',
  sharePercent: 30,
  amount: { amountMinor: 540000, currency: 'PLN' },
  status: 'paid',
  invoiceNumber: 'FV/TEST/0008/2026',
  invoicedOn: '2026-09-20',
  dueDate: '2026-09-27',
  paidOn: '2026-10-03',
  version: 4,
  allowedTransitions: ['invoiced'],
});
const CANCELLED = milestone(3, {
  name: 'Płatność końcowa',
  sharePercent: 20,
  status: 'cancelled',
  version: 2,
  allowedTransitions: ['planned'],
});

const STEP_UP_ROUTES: Record<string, Handler> = {
  'POST /api/v1/auth/step-up/options': () =>
    json(200, {
      challenge: 'Y2hhbGxlbmdl',
      rpId: 'localhost',
      userVerification: 'required',
      allowCredentials: [{ id: 'Y3JlZA', type: 'public-key' }],
    }),
  'POST /api/v1/auth/step-up': () => json(200, { csrfToken: 'csrf-rotated' }),
};

function stubWebAuthn() {
  const credential = {
    id: 'Y3JlZA',
    rawId: 'Y3JlZA',
    type: 'public-key',
    response: { clientDataJSON: 'Y2xpZW50', authenticatorData: 'YXV0aA', signature: 'c2ln' },
  };
  class Fake {
    static readonly parseRequestOptionsFromJSON = vi.fn((options: object) => ({ ...options, parsed: true }));
    toJSON() {
      return credential;
    }
  }
  vi.stubGlobal('PublicKeyCredential', Fake);
  Object.defineProperty(navigator, 'credentials', { value: { get: vi.fn(() => Promise.resolve(new Fake())) }, configurable: true });
}

beforeEach(() => {
  // the clock of the story — today is 2026-10-14 in Europe/Warsaw (never the clock of the machine)
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T10:00:00.000Z'));
  stubWebAuthn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'credentials');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  resetStepUp();
});

/** A list that the handlers of a test change, read anew by every GET. */
function store(initial: PaymentMilestone[] = [ISSUED, PAID, CANCELLED]) {
  let items = initial;
  return {
    read: () => paymentsOf(items),
    put(saved: PaymentMilestone) {
      items = items.map((entry) => (entry.id === saved.id ? saved : entry));
    },
    drop(id: string) {
      items = items.filter((entry) => entry.id !== id);
    },
  };
}

/** Answers in turn (the last one repeats): e.g. `403 step_up_required`, then the saved instalment. */
const inTurn = (...answers: Array<() => Response>): Handler => {
  let index = 0;
  return () => {
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (answer === undefined) throw new Error('no answer');
    return answer();
  };
};

const ready = () => screen.findByRole('table', { name: 'Transze płatności zlecenia' });
const rowOf = (name: string): HTMLElement => {
  const row = screen.getByText(name).closest('tr');
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
};

async function openMenu(name: string, item: string) {
  await ready();
  await userEvent.click(screen.getByRole('button', { name: `Akcje transzy: ${name}` }));
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}

const deleteRoute = (entry: PaymentMilestone): string => `DELETE ${PAYMENTS_BASE}/${entry.id}`;

describe('"Wycofaj fakturę…" (EVM-057 AC1, AC5)', () => {
  it('EVM-057 AC1 the dialog "Wystawiona → Planowana" with the amount and the number, W-04 after 403 step_up_required, the same request again, the toast', async () => {
    const list = store();
    const withdrawn: PaymentMilestone = {
      ...ISSUED,
      status: 'planned',
      invoiceNumber: null,
      invoicedOn: null,
      dueDate: null,
      isOverdue: false,
      version: 4,
      allowedTransitions: ['invoiced', 'cancelled'],
    };
    const api = paymentsApi(list.read, undefined, {
      ...STEP_UP_ROUTES,
      [transitionRoute(ISSUED)]: inTurn(
        () => problem(403, 'step_up_required'),
        () => {
          list.put(withdrawn);
          return json(200, withdrawn, { ETag: '"4"' });
        },
      ),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await ready();
    expect(within(rowOf('Zaliczka (20%)')).getByText('Po terminie')).toBeTruthy();
    await openMenu('Zaliczka (20%)', 'Wycofaj fakturę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Wycofać fakturę FV/TEST/0007/2026?' });
    const view = within(dialog);
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Anuluj' }));
    expect(view.getByText('ZL-2026-0042 · Garaż — pełny proces · „Zaliczka”')).toBeTruthy();
    // the change of the status — two badges for the eye, one sentence for a screen reader
    expect(view.getByText('Stan: z Wystawiona na Planowana')).toBeTruthy();
    expect(view.getAllByText('Wystawiona').length).toBeGreaterThan(0);
    expect(view.getAllByText('Planowana').length).toBeGreaterThan(0);
    expect(dialog.textContent).toContain(zl('3 600,00 zł'));
    expect(view.getByText('Numer faktury, data wystawienia i termin zostaną wyczyszczone.')).toBeTruthy();
    expect(view.getByText(AUDIT)).toBeTruthy();
    expect(view.getByRole('button', { name: 'Wycofaj fakturę' }).className).toContain('bg-action-danger-bg');
    expect(await axeViolations(dialog)).toEqual([]);

    await userEvent.click(view.getByRole('button', { name: 'Wycofaj fakturę' }));
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    // W-04 does not stack on the dialog: the dialog of the correction steps aside meanwhile (§ 3.13)
    expect(screen.queryByRole('alertdialog', { name: 'Wycofać fakturę FV/TEST/0007/2026?' })).toBeNull();
    expect(within(stepUp).getByText('Wycofanie faktury FV/TEST/0007/2026')).toBeTruthy();
    expect(within(stepUp).getByText('Transza „Zaliczka” · ZL-2026-0042 · 3 600,00 zł')).toBeTruthy();
    expect(await axeViolations(stepUp)).toEqual([]);
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Użyj klucza dostępu' }));

    expect(await screen.findByText('Wycofano fakturę FV/TEST/0007/2026 — transza jest Planowana.')).toBeTruthy();
    const calls = api.calls(transitionRoute(ISSUED));
    expect(calls).toHaveLength(2);
    // the correction takes the target alone; the retry after W-04 is the same request with the same key (SR-API-05)
    for (const call of calls) {
      expect(parseBody(call.body)).toEqual({ to: 'planned' });
      expect(call.headers.get('If-Match')).toBe('"3"');
    }
    expect(calls[0]?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    expect(calls[1]?.headers.get('Idempotency-Key')).toBe(calls[0]?.headers.get('Idempotency-Key'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // the row is "Planowana" without the invoice; "Po terminie" is gone; the focus is on the menu of the instalment
    await waitFor(() => {
      expect(within(rowOf('Zaliczka (20%)')).getByText('Planowana')).toBeTruthy();
    });
    expect(within(rowOf('Zaliczka (20%)')).queryByText('Po terminie')).toBeNull();
    expect(within(rowOf('Zaliczka (20%)')).queryByText('FV/TEST/0007/2026')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }));
    });
  });

  it('EVM-057 AC5 cancelling W-04 brings the dialog back with "Nie wykonano korekty."; a second try uses the same key', async () => {
    const api = paymentsApi(store().read, undefined, {
      ...STEP_UP_ROUTES,
      [transitionRoute(ISSUED)]: () => problem(403, 'step_up_required'),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Wycofaj fakturę…');
    await userEvent.click(screen.getByRole('button', { name: 'Wycofaj fakturę' }));
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Anuluj' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Wycofać fakturę FV/TEST/0007/2026?' });
    expect(within(dialog).getByRole('alert').textContent).toBe('Nie wykonano korekty.');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(api.calls('POST /api/v1/auth/step-up')).toHaveLength(0);
    // the server kept no key of the refused request: the next try is the same request with the same key
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wycofaj fakturę' }));
    await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    const calls = api.calls(transitionRoute(ISSUED));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.get('Idempotency-Key')).toBe(calls[0]?.headers.get('Idempotency-Key'));
  });

  it('EVM-057 AC5 a second "step_up_required" after W-04 opens no second W-04 (no loop)', async () => {
    const api = paymentsApi(store().read, undefined, {
      ...STEP_UP_ROUTES,
      [transitionRoute(ISSUED)]: () => problem(403, 'step_up_required'),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Wycofaj fakturę…');
    await userEvent.click(screen.getByRole('button', { name: 'Wycofaj fakturę' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog', { name: STEP_UP_TITLE })).getByRole('button', { name: 'Użyj klucza dostępu' }),
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Wycofać fakturę FV/TEST/0007/2026?' });
    expect(await within(dialog).findByText('Nie masz uprawnień do tej operacji.')).toBeTruthy();
    expect(api.calls(transitionRoute(ISSUED))).toHaveLength(2);
    expect(api.calls('POST /api/v1/auth/step-up')).toHaveLength(1);
  });
});

describe('"Anuluj fakturę…" and "Cofnij wpłatę…" (EVM-057 AC2)', () => {
  it('EVM-057 AC2 "Anuluj fakturę…" — "Wystawiona → Anulowana", danger, the target alone, the toast', async () => {
    const list = store();
    const cancelled: PaymentMilestone = { ...ISSUED, status: 'cancelled', isOverdue: false, version: 4, allowedTransitions: ['planned'] };
    const api = paymentsApi(list.read, undefined, {
      [transitionRoute(ISSUED)]: () => {
        list.put(cancelled);
        return json(200, cancelled, { ETag: '"4"' });
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Anuluj fakturę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Anulować fakturę FV/TEST/0007/2026?' });
    expect(within(dialog).getByText('Stan: z Wystawiona na Anulowana')).toBeTruthy();
    expect(within(dialog).getByText('Transzę będzie można przywrócić jako Planowaną.')).toBeTruthy();
    expect(within(dialog).getByText(AUDIT)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj fakturę' }));
    expect(await screen.findByText('Anulowano fakturę FV/TEST/0007/2026.')).toBeTruthy();
    expect(parseBody(api.calls(transitionRoute(ISSUED))[0]?.body ?? '')).toEqual({ to: 'cancelled' });
    await waitFor(() => {
      expect(within(rowOf('Zaliczka (20%)')).getByText('Anulowana')).toBeTruthy();
    });
  });

  it('EVM-057 AC2 "Cofnij wpłatę…" — "Opłacona → Wystawiona", the day of the payment cleared, "Po terminie" at once (the due date has passed)', async () => {
    const list = store();
    const undone: PaymentMilestone = {
      ...PAID,
      status: 'invoiced',
      paidOn: null,
      isOverdue: true,
      version: 5,
      allowedTransitions: ['paid'],
    };
    const api = paymentsApi(list.read, undefined, {
      [transitionRoute(PAID)]: () => {
        list.put(undone);
        return json(200, undone, { ETag: '"5"' });
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Po uzyskaniu zgód (30%)', 'Cofnij wpłatę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Cofnąć wpłatę za fakturę FV/TEST/0008/2026?' });
    const view = within(dialog);
    expect(view.getByText('Stan: z Opłacona na Wystawiona')).toBeTruthy();
    expect(view.getByText('Data wpłaty 03.10.2026 zostanie wyczyszczona.')).toBeTruthy();
    expect(view.getByText('Transza może od razu być po terminie, jeśli termin minął.')).toBeTruthy();
    // a reversible correction is a primary button, not danger
    expect(view.getByRole('button', { name: 'Cofnij wpłatę' }).className).toContain('bg-action-primary-bg');
    await userEvent.click(view.getByRole('button', { name: 'Cofnij wpłatę' }));
    expect(await screen.findByText('Cofnięto wpłatę za fakturę FV/TEST/0008/2026 — transza jest Wystawiona.')).toBeTruthy();
    expect(parseBody(api.calls(transitionRoute(PAID))[0]?.body ?? '')).toEqual({ to: 'invoiced' });
    expect(api.calls(transitionRoute(PAID))[0]?.headers.get('If-Match')).toBe('"4"');
    await waitFor(() => {
      expect(within(rowOf('Po uzyskaniu zgód (30%)')).getByText('Po terminie')).toBeTruthy();
    });
  });

  it('EVM-057 AC2 "Cofnij wpłatę…" of an instalment whose due date has not passed has no sentence about "po terminie"', async () => {
    const fresh = { ...PAID, dueDate: '2026-10-20' };
    await renderPanel(PAYMENTS_PATH, paymentsApi(store([ISSUED, fresh, CANCELLED]).read));
    await openMenu('Po uzyskaniu zgód (30%)', 'Cofnij wpłatę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Cofnąć wpłatę za fakturę FV/TEST/0008/2026?' });
    expect(within(dialog).queryByText('Transza może od razu być po terminie, jeśli termin minął.')).toBeNull();
  });
});

describe('"Zmień kwotę…" of an invoiced or paid instalment (EVM-057 AC3, AC5)', () => {
  it('EVM-057 AC3 3 600,00 zł → 3 690,00 zł: the field "Nowa kwota", the live summary, the button disabled while unchanged, PATCH with If-Match', async () => {
    const list = store();
    const corrected: PaymentMilestone = { ...ISSUED, amount: { amountMinor: 369000, currency: 'PLN' }, version: 4 };
    const api = paymentsApi(list.read, undefined, {
      ...STEP_UP_ROUTES,
      [patchRoute(ISSUED)]: inTurn(
        () => problem(403, 'step_up_required'),
        () => {
          list.put(corrected);
          return json(200, corrected, { ETag: '"4"' });
        },
      ),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Zmień kwotę…');
    const dialog = screen.getByRole('dialog', { name: 'Zmienić kwotę transzy „Zaliczka”?' });
    const view = within(dialog);
    const field = view.getByRole('textbox', { name: 'Nowa kwota' });
    expect(document.activeElement).toBe(field);
    expect((field as HTMLInputElement).value).toBe(zl('3 600,00'));
    expect(field.getAttribute('inputmode')).toBe('decimal');
    expect(view.getByText('Stan: Wystawiona')).toBeTruthy();
    expect(view.getByText('FV/TEST/0007/2026')).toBeTruthy();
    expect(view.getByText('Status i dane faktury zostają bez zmian.')).toBeTruthy();
    expect(view.getByText(AUDIT)).toBeTruthy();
    const submit = view.getByRole('button', { name: 'Zmień kwotę' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    await userEvent.clear(field);
    await userEvent.type(field, '3690');
    expect(view.getByText('3 600,00 zł → 3 690,00 zł')).toBeTruthy();
    expect(submit.getAttribute('aria-disabled')).toBeNull();
    expect(await axeViolations(dialog)).toEqual([]);
    await userEvent.click(submit);

    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    expect(within(stepUp).getByText('Zmiana kwoty transzy „Zaliczka”: 3 600,00 zł → 3 690,00 zł')).toBeTruthy();
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(await screen.findByText('Zmieniono kwotę transzy „Zaliczka”: 3 600,00 zł → 3 690,00 zł.')).toBeTruthy();
    const calls = api.calls(patchRoute(ISSUED));
    expect(calls).toHaveLength(2);
    expect(parseBody(calls[1]?.body ?? '')).toEqual({ amount: { amountMinor: 369000, currency: 'PLN' } });
    expect(calls[1]?.headers.get('If-Match')).toBe('"3"');
    expect(calls[1]?.headers.get('Idempotency-Key')).toBe(calls[0]?.headers.get('Idempotency-Key'));
  });

  it('EVM-057 AC5 cancelling W-04 keeps the typed amount, says "Nie wykonano korekty." and puts the focus in the field', async () => {
    const api = paymentsApi(store().read, undefined, {
      ...STEP_UP_ROUTES,
      [patchRoute(PAID)]: () => problem(403, 'step_up_required'),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Po uzyskaniu zgód (30%)', 'Zmień kwotę…');
    const field = screen.getByRole('textbox', { name: 'Nowa kwota' });
    await userEvent.clear(field);
    await userEvent.type(field, '5500');
    await userEvent.click(screen.getByRole('button', { name: 'Zmień kwotę' }));
    await userEvent.click(within(await screen.findByRole('alertdialog', { name: STEP_UP_TITLE })).getByRole('button', { name: 'Anuluj' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zmienić kwotę transzy „Po uzyskaniu zgód”?' });
    expect(within(dialog).getByRole('alert').textContent).toBe('Nie wykonano korekty.');
    const again = within(dialog).getByRole('textbox', { name: 'Nowa kwota' });
    expect((again as HTMLInputElement).value).toBe(zl('5 500,00'));
    expect(document.activeElement).toBe(again);
  });

  it('EVM-057 AC3 an amount the API refuses is told under the field (400 /amount); a malformed one before sending', async () => {
    const api = paymentsApi(store().read, undefined, {
      [patchRoute(ISSUED)]: () => problem(400, 'validation_failed', { errors: [{ pointer: '/amount', code: 'invalid_value' }] }),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Zmień kwotę…');
    const field = screen.getByRole('textbox', { name: 'Nowa kwota' });
    await userEvent.clear(field);
    await userEvent.type(field, '12,345');
    await userEvent.click(screen.getByRole('button', { name: 'Zmień kwotę' }));
    expect(screen.getByText('Kwota może mieć najwyżej 2 miejsca po przecinku.')).toBeTruthy();
    expect(api.calls(patchRoute(ISSUED))).toHaveLength(0);
    await userEvent.clear(field);
    await userEvent.type(field, '4000');
    await userEvent.click(screen.getByRole('button', { name: 'Zmień kwotę' }));
    expect(await screen.findByText('Podaj kwotę większą od zera, np. 1 500,00 zł.')).toBeTruthy();
  });
});

describe('"Przywróć transzę…" and "Usuń transzę…" (EVM-057 AC4)', () => {
  it('EVM-057 AC4 "Przywróć transzę…" — "Anulowana → Planowana" with the share and "—" without an amount', async () => {
    const list = store();
    const restored: PaymentMilestone = { ...CANCELLED, status: 'planned', version: 3, allowedTransitions: ['invoiced', 'cancelled'] };
    const api = paymentsApi(list.read, undefined, {
      [transitionRoute(CANCELLED)]: () => {
        list.put(restored);
        return json(200, restored, { ETag: '"3"' });
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Płatność końcowa (20%)', 'Przywróć transzę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Przywrócić transzę „Płatność końcowa”?' });
    const view = within(dialog);
    expect(view.getByText('Stan: z Anulowana na Planowana')).toBeTruthy();
    expect(view.getByText('20%')).toBeTruthy();
    expect(view.getByText('—')).toBeTruthy();
    expect(view.getByText('Transza wróci na swoje miejsce na liście.')).toBeTruthy();
    await userEvent.click(view.getByRole('button', { name: 'Przywróć transzę' }));
    expect(await screen.findByText('Przywrócono transzę „Płatność końcowa” — jest Planowana.')).toBeTruthy();
    expect(parseBody(api.calls(transitionRoute(CANCELLED))[0]?.body ?? '')).toEqual({ to: 'planned' });
  });

  it('EVM-057 AC4 "Usuń transzę…" — DELETE with If-Match and a key after W-04, the row is gone, the focus on the menu of the next instalment', async () => {
    const list = store();
    const api = paymentsApi(list.read, undefined, {
      ...STEP_UP_ROUTES,
      [deleteRoute(ISSUED)]: inTurn(
        () => problem(403, 'step_up_required'),
        () => {
          list.drop(ISSUED.id);
          return new Response(null, { status: 204 });
        },
      ),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Usuń transzę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Usunąć transzę „Zaliczka”?' });
    const view = within(dialog);
    expect(view.getByText('Stan: Wystawiona')).toBeTruthy();
    expect(view.getByText('FV/TEST/0007/2026')).toBeTruthy();
    expect(view.getByText('Transza zniknie z listy. Edytor i osoba z rolą Tylko odczyt jej nie zobaczą.')).toBeTruthy();
    expect(view.getByText(AUDIT)).toBeTruthy();
    expect(view.getByRole('button', { name: 'Usuń transzę' }).className).toContain('bg-action-danger-bg');
    await userEvent.click(view.getByRole('button', { name: 'Usuń transzę' }));
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    expect(within(stepUp).getByText('Usunięcie transzy „Zaliczka”')).toBeTruthy();
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(await screen.findByText('Usunięto transzę „Zaliczka”.')).toBeTruthy();
    const calls = api.calls(deleteRoute(ISSUED));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.get('If-Match')).toBe('"3"');
    expect(calls[1]?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    expect(calls[1]?.headers.get('Idempotency-Key')).toBe(calls[0]?.headers.get('Idempotency-Key'));
    await waitFor(() => {
      expect(screen.queryByText('Zaliczka (20%)')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje transzy: Po uzyskaniu zgód (30%)' }));
    });
    expect(api.calls(PAYMENTS_LIST).length).toBeGreaterThan(1);
  });

  it('EVM-057 AC4 deleting the last instalment of the list puts the focus on "Dodaj transzę"; with none left the section says "Brak transz."', async () => {
    const list = store([CANCELLED]);
    const api = paymentsApi(list.read, undefined, {
      [deleteRoute(CANCELLED)]: () => {
        list.drop(CANCELLED.id);
        return new Response(null, { status: 204 });
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Płatność końcowa (20%)', 'Usuń transzę…');
    await userEvent.click(screen.getByRole('button', { name: 'Usuń transzę' }));
    expect(await within(screen.getByRole('region', { name: 'Płatności' })).findByText('Brak transz.')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dodaj transzę' }));
    });
  });
});

describe('the failures of a correction (EVM-057 AC7, AC8)', () => {
  it('EVM-057 AC7 409 work_order_closed — "Zlecenie jest rozliczone — … Przywrócić zlecenie może tylko administrator.", the button disabled', async () => {
    const api = paymentsApi(store().read, undefined, {
      [transitionRoute(ISSUED)]: () => problem(409, 'work_order_closed'),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Anuluj fakturę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Anulować fakturę FV/TEST/0007/2026?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj fakturę' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Zlecenie jest rozliczone — płatności są tylko do odczytu. Przywrócić zlecenie może tylko administrator.',
    );
    expect(within(dialog).getByRole('button', { name: 'Anuluj fakturę' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('EVM-057 AC8 412 — the alert with the status of now and "Odśwież"; a status the correction no longer fits closes the dialog', async () => {
    const list = store();
    const api = paymentsApi(list.read, undefined, {
      [transitionRoute(ISSUED)]: () => {
        list.put({ ...ISSUED, status: 'paid', paidOn: '2026-10-13', version: 5 });
        return problem(412, 'version_conflict');
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Wycofaj fakturę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Wycofać fakturę FV/TEST/0007/2026?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wycofaj fakturę' }));
    const alert = await within(dialog).findByText('Tę transzę zmieniono w międzyczasie (teraz: «Opłacona»).');
    expect(alert).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Odśwież' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('EVM-057 AC8 412 with the same status — "Odśwież" takes the new version and the next try sends it', async () => {
    const list = store();
    let first = true;
    const api = paymentsApi(list.read, undefined, {
      [transitionRoute(ISSUED)]: () => {
        if (first) {
          first = false;
          list.put({ ...ISSUED, version: 6 });
          return problem(412, 'version_conflict');
        }
        return json(200, { ...ISSUED, status: 'cancelled', version: 7 }, { ETag: '"7"' });
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Anuluj fakturę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Anulować fakturę FV/TEST/0007/2026?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj fakturę' }));
    await within(dialog).findByText('Tę transzę zmieniono w międzyczasie (teraz: «Wystawiona»).');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Odśwież' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj fakturę' }));
    expect(await screen.findByText('Anulowano fakturę FV/TEST/0007/2026.')).toBeTruthy();
    expect(api.calls(transitionRoute(ISSUED))[1]?.headers.get('If-Match')).toBe('"6"');
  });

  it.each([
    [404, 'not_found', 'Nie znaleziono transzy. Odśwież zlecenie.'],
    [403, 'forbidden', 'Nie masz uprawnień do tej operacji.'],
    [429, 'rate_limited', 'Zbyt wiele zapytań. Spróbuj ponownie za 30 s.'],
    [500, 'internal_error', 'Nie udało się zapisać. Spróbuj ponownie — nie wykonamy tej operacji dwa razy.'],
  ] as const)('EVM-057 AC8 %i %s of DELETE is told in the dialog', async (status, code, text) => {
    const api = paymentsApi(store().read, undefined, {
      [deleteRoute(PAID)]: () => problem(status, code, {}, status === 429 ? { 'Retry-After': '30' } : {}),
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Po uzyskaniu zgód (30%)', 'Usuń transzę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Usunąć transzę „Po uzyskaniu zgód”?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń transzę' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(text);
  });

  it('EVM-057 AC8 offline the open dialog keeps its data and the button is disabled with "Zapiszesz po powrocie połączenia."', async () => {
    const api = paymentsApi(store().read);
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Zmień kwotę…');
    const field = screen.getByRole('textbox', { name: 'Nowa kwota' });
    await userEvent.clear(field);
    await userEvent.type(field, '3690');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    const submit = await screen.findByRole('button', { name: 'Zmień kwotę' });
    await waitFor(() => {
      expect(submit.getAttribute('aria-disabled')).toBe('true');
    });
    expect(submit.getAttribute('title')).toBe('Zapiszesz po powrocie połączenia.');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Nowa kwota' }).value).toBe('3690');
    await userEvent.click(submit);
    expect(api.calls(patchRoute(ISSUED))).toHaveLength(0);
  });

  it('EVM-057 AC8 the Editor: the corrections are disabled with the reason and open nothing; Tylko odczyt has no menu', async () => {
    const api = paymentsApi(store().read, roleSession('editor'));
    const { unmount } = await renderPanel(PAYMENTS_PATH, api);
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }));
    const item = screen.getByRole('menuitem', { name: /Wycofaj fakturę…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe('Korektę płatności może wykonać tylko administrator.');
    await userEvent.click(item);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    unmount();
    await renderPanel(PAYMENTS_PATH, paymentsApi(store().read, roleSession('read_only')));
    await ready();
    expect(screen.queryByRole('button', { name: /^Akcje transzy/ })).toBeNull();
  });
});

describe('the corrections in W-11 (EVM-057; the story → "UX / UI" → "Ekrany i przepływ")', () => {
  const ROW = OVERDUE;
  const transition = `POST ${orderPayments(ROW)}/${ROW.id}/transitions`;
  const patch = `PATCH ${orderPayments(ROW)}/${ROW.id}`;
  const remove = `DELETE ${orderPayments(ROW)}/${ROW.id}`;

  const openRowMenu = async (item: string) => {
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Akcje transzy: Płatność końcowa, ZL-2026-0031' }));
    await userEvent.click(screen.getByRole('menuitem', { name: item }));
  };

  it('EVM-057 AC1 AC8 the Administrator has the corrections of an invoiced row; a withdrawal sends `to` alone and the focus goes to the title', async () => {
    const api = unpaidApi(undefined, undefined, {
      [transition]: () => json(200, { ...fullOf(ROW), status: 'planned', invoiceNumber: null, version: 4 }, { ETag: '"4"' }),
      [`GET ${orderPayments(ROW)}`]: () => json(200, paymentsOf([fullOf(ROW)])),
    });
    await renderPanel(UNPAID_PATH, api);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Akcje transzy: Płatność końcowa, ZL-2026-0031' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.firstChild?.textContent)).toEqual([
      'Popraw dane faktury…',
      'Wycofaj fakturę…',
      'Anuluj fakturę…',
      'Zmień kwotę…',
      'Usuń transzę…',
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Wycofaj fakturę…' }));
    const dialog = screen.getByRole('alertdialog', { name: `Wycofać fakturę ${ROW.invoiceNumber}?` });
    expect(within(dialog).getByText(`ZL-2026-0031 · ${ROW.workOrder.title} · „Płatność końcowa”`)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wycofaj fakturę' }));
    expect(await screen.findByText(`Wycofano fakturę ${ROW.invoiceNumber} — transza jest Planowana.`)).toBeTruthy();
    expect(parseBody(api.calls(transition)[0]?.body ?? '')).toEqual({ to: 'planned' });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Płatności — nieopłacone' }));
    });
  });

  it('EVM-057 AC3 "Zmień kwotę…" of a row of W-11 sends PATCH with the version of the row; the focus goes back to its menu', async () => {
    const api = unpaidApi(() => json(200, TWO), undefined, {
      [patch]: () => json(200, { ...fullOf(ROW), amount: { amountMinor: 610000, currency: 'PLN' }, version: 4 }, { ETag: '"4"' }),
    });
    await renderPanel(UNPAID_PATH, api);
    await openRowMenu('Zmień kwotę…');
    const field = screen.getByRole('textbox', { name: 'Nowa kwota' });
    await userEvent.clear(field);
    await userEvent.type(field, '6100');
    await userEvent.click(screen.getByRole('button', { name: 'Zmień kwotę' }));
    expect(await screen.findByText('Zmieniono kwotę transzy „Płatność końcowa”: 6 000,00 zł → 6 100,00 zł.')).toBeTruthy();
    expect(api.calls(patch)[0]?.headers.get('If-Match')).toBe(`"${String(ROW.version)}"`);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje transzy: Płatność końcowa, ZL-2026-0031' }));
    });
  });

  it('EVM-057 AC4 AC7 "Usuń transzę…" in W-11: a closed order is told with the text without the state (W-11 does not know it)', async () => {
    const api = unpaidApi(undefined, undefined, { [remove]: () => problem(409, 'work_order_closed') });
    await renderPanel(UNPAID_PATH, api);
    await openRowMenu('Usuń transzę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Usunąć transzę „Płatność końcowa”?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń transzę' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Zlecenie jest zamknięte — płatności są tylko do odczytu. Przywrócić zlecenie może tylko administrator.',
    );
  });

  it('EVM-057 AC4 a deleted row of W-11 is gone after the list is read again; the focus goes to the title', async () => {
    let rows = TWO;
    const api = unpaidApi(() => json(200, rows), undefined, {
      [remove]: () => {
        rows = { ...TWO, items: TWO.items.filter((entry) => entry.id !== ROW.id) };
        return new Response(null, { status: 204 });
      },
    });
    await renderPanel(UNPAID_PATH, api);
    await openRowMenu('Usuń transzę…');
    await userEvent.click(screen.getByRole('button', { name: 'Usuń transzę' }));
    expect(await screen.findByText('Usunięto transzę „Płatność końcowa”.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Akcje transzy: Płatność końcowa, ZL-2026-0031' })).toBeNull();
    });
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Płatności — nieopłacone' }));
  });
});

/** An answer the test settles itself: a request stays "in flight" until `settle` (no timers, no sleeping). */
function deferred(): { readonly handler: Handler; readonly settle: (answer: Response) => void } {
  let settle: (answer: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    settle = resolve;
  });
  return { handler: () => pending, settle };
}

describe('closing, blocking and the edge data of the dialogs of a correction (EVM-057 AC3, AC5, AC8)', () => {
  it('EVM-057 AC5 "Anuluj" closes the dialog of a correction and the dialog of the amount without a request', async () => {
    const api = paymentsApi(store().read);
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Wycofaj fakturę…');
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await openMenu('Zaliczka (20%)', 'Zmień kwotę…');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls(transitionRoute(ISSUED))).toHaveLength(0);
    expect(api.calls(patchRoute(ISSUED))).toHaveLength(0);
  });

  it('EVM-057 AC8 Escape does not close the dialog of a correction while the request is in flight', async () => {
    const wait = deferred();
    const list = store();
    const api = paymentsApi(list.read, undefined, { [transitionRoute(ISSUED)]: wait.handler });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Anuluj fakturę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Anulować fakturę FV/TEST/0007/2026?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj fakturę' }));
    await waitFor(() => {
      expect(api.calls(transitionRoute(ISSUED))).toHaveLength(1);
    });
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog', { name: 'Anulować fakturę FV/TEST/0007/2026?' })).toBeTruthy();
    const cancelled: PaymentMilestone = { ...ISSUED, status: 'cancelled', isOverdue: false, version: 4, allowedTransitions: ['planned'] };
    list.put(cancelled);
    wait.settle(json(200, cancelled, { ETag: '"4"' }));
    expect(await screen.findByText('Anulowano fakturę FV/TEST/0007/2026.')).toBeTruthy();
  });

  it('EVM-057 AC8 Escape does not close the dialog of the amount while the request is in flight', async () => {
    const wait = deferred();
    const list = store();
    const api = paymentsApi(list.read, undefined, { [patchRoute(ISSUED)]: wait.handler });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Zmień kwotę…');
    const field = screen.getByRole('textbox', { name: 'Nowa kwota' });
    await userEvent.clear(field);
    await userEvent.type(field, '3690');
    await userEvent.click(screen.getByRole('button', { name: 'Zmień kwotę' }));
    await waitFor(() => {
      expect(api.calls(patchRoute(ISSUED))).toHaveLength(1);
    });
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Zmienić kwotę transzy „Zaliczka”?' })).toBeTruthy();
    const corrected: PaymentMilestone = { ...ISSUED, amount: { amountMinor: 369000, currency: 'PLN' }, version: 4 };
    list.put(corrected);
    wait.settle(json(200, corrected, { ETag: '"4"' }));
    expect(await screen.findByText('Zmieniono kwotę transzy „Zaliczka”: 3 600,00 zł → 3 690,00 zł.')).toBeTruthy();
  });

  it('EVM-057 AC3 Enter in the field of an unchanged amount sends nothing; an empty one is told under the field', async () => {
    const api = paymentsApi(store().read);
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Zmień kwotę…');
    const field = screen.getByRole('textbox', { name: 'Nowa kwota' });
    await userEvent.type(field, '{Enter}');
    expect(api.calls(patchRoute(ISSUED))).toHaveLength(0);
    await userEvent.clear(field);
    await userEvent.type(field, '{Enter}');
    expect(api.calls(patchRoute(ISSUED))).toHaveLength(0);
    expect(within(screen.getByRole('dialog')).getByText('Podaj kwotę większą od zera, np. 1 500,00 zł.')).toBeTruthy();
  });

  it('EVM-057 AC3 an instalment without an amount and an invoice shows "—" for both in the dialog of the amount', async () => {
    const bare = { ...ISSUED, amount: null, invoiceNumber: null };
    const api = paymentsApi(store([bare]).read);
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Zmień kwotę…');
    const dialog = screen.getByRole('dialog', { name: 'Zmienić kwotę transzy „Zaliczka”?' });
    expect(within(dialog).getAllByText('—')).toHaveLength(2);
    expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Nowa kwota' }).value).toBe('');
  });

  it('EVM-057 AC8 412 in the dialog of the amount: the same status keeps the typed amount; a status it no longer fits closes it', async () => {
    const list = store();
    let first = true;
    const api = paymentsApi(list.read, undefined, {
      [patchRoute(ISSUED)]: () => {
        if (first) {
          first = false;
          list.put({ ...ISSUED, version: 6 });
        } else {
          list.put({ ...ISSUED, status: 'cancelled', version: 7 });
        }
        return problem(412, 'version_conflict');
      },
    });
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Zmień kwotę…');
    const dialog = screen.getByRole('dialog', { name: 'Zmienić kwotę transzy „Zaliczka”?' });
    const field = within(dialog).getByRole('textbox', { name: 'Nowa kwota' });
    await userEvent.clear(field);
    await userEvent.type(field, '3690');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień kwotę' }));
    await within(dialog).findByText('Tę transzę zmieniono w międzyczasie (teraz: «Wystawiona»).');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Odśwież' }));
    expect((field as HTMLInputElement).value).toBe(zl('3 690,00'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień kwotę' }));
    await within(dialog).findByText('Tę transzę zmieniono w międzyczasie (teraz: «Anulowana»).');
    expect(api.calls(patchRoute(ISSUED))[1]?.headers.get('If-Match')).toBe('"6"');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Odśwież' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-057 AC2 "Cofnij wpłatę…" of an instalment without the day of the payment and the due date has neither sentence', async () => {
    const bare = { ...PAID, paidOn: null, dueDate: null };
    await renderPanel(PAYMENTS_PATH, paymentsApi(store([ISSUED, bare, CANCELLED]).read));
    await openMenu('Po uzyskaniu zgód (30%)', 'Cofnij wpłatę…');
    const dialog = screen.getByRole('alertdialog', { name: 'Cofnąć wpłatę za fakturę FV/TEST/0008/2026?' });
    expect(within(dialog).queryByText(/Data wpłaty/)).toBeNull();
    expect(within(dialog).queryByText('Transza może od razu być po terminie, jeśli termin minął.')).toBeNull();
  });

  it('EVM-057 AC8 offline the dialog of a correction says so and its button is disabled with the reason', async () => {
    const api = paymentsApi(store().read);
    await renderPanel(PAYMENTS_PATH, api);
    await openMenu('Zaliczka (20%)', 'Wycofaj fakturę…');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    const dialog = screen.getByRole('alertdialog', { name: 'Wycofać fakturę FV/TEST/0007/2026?' });
    const submit = await within(dialog).findByRole('button', { name: 'Wycofaj fakturę' });
    await waitFor(() => {
      expect(submit.getAttribute('aria-disabled')).toBe('true');
    });
    expect(submit.getAttribute('title')).toBe('Zapiszesz po powrocie połączenia.');
    expect(within(dialog).getAllByText('Zapiszesz po powrocie połączenia.').length).toBeGreaterThan(0);
    await userEvent.click(submit);
    expect(api.calls(transitionRoute(ISSUED))).toHaveLength(0);
  });

  it('EVM-057 AC5 "Anuluj" closes the dialogs of the corrections of W-11', async () => {
    const api = unpaidApi();
    await renderPanel(UNPAID_PATH, api);
    await screen.findByRole('table');
    const menu = 'Akcje transzy: Płatność końcowa, ZL-2026-0031';
    await userEvent.click(screen.getByRole('button', { name: menu }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Wycofaj fakturę…' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: menu }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zmień kwotę…' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
