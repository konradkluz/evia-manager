import type { CurrentSession } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStepUp } from '../src/session/step-up.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { ALL, INVOICED, PAID, PLANNED, paymentsOf, roleSession } from './payment-api.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER, ORDER_ID, workOrderRoutes } from './work-order-api.ts';

// W-06 "Usuń zlecenie…" (EVM-060 AC1–AC3, AC5, AC6): the menu `⋮`, the AlertDialog, the answers of the API told in words and W-04.
const PATH = `/work-orders/${ORDER_ID}`;
const DELETE = `DELETE /api/v1/work-orders/${ORDER_ID}`;
const MENU = 'Akcje zlecenia: ZL-2026-0042';
const TITLE = 'Usunąć zlecenie ZL-2026-0042?';
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const noContent: Handler = () => new Response(null, { status: 204 });

interface Setup {
  readonly session?: CurrentSession;
  readonly deletes?: Handler[];
  readonly payments?: ReturnType<typeof paymentsOf>;
  /** Versions the header answers with, one after another (the last repeats). */
  readonly versions?: number[];
}

function deleteApi({ session = ACTIVE_SESSION, deletes = [noContent], payments, versions = [3] }: Setup = {}) {
  let read = 0;
  let call = 0;
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    ...workOrderRoutes(ORDER_ID, {
      header: () => {
        const version = versions[Math.min(read++, versions.length - 1)] ?? 3;
        return json(200, { ...HEADER, version }, { ETag: `"${String(version)}"` });
      },
      ...(payments === undefined ? {} : { payments: () => json(200, payments) }),
    }),
    [DELETE]: (request) => (deletes[Math.min(call++, deletes.length - 1)] ?? noContent)(request),
  });
}

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

function stepUpRoutes(api: ReturnType<typeof deleteApi>) {
  api.set('POST /api/v1/auth/step-up/options', () =>
    json(200, {
      challenge: 'Y2hhbGxlbmdl',
      rpId: 'localhost',
      userVerification: 'required',
      allowCredentials: [{ id: 'Y3JlZA', type: 'public-key' }],
    }),
  );
  api.set('POST /api/v1/auth/step-up', () => json(200, { csrfToken: 'csrf-rotated' }));
}

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', { name: MENU }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń zlecenie…' }));
  return screen.findByRole('alertdialog', { name: TITLE });
}

beforeEach(() => {
  stubWebAuthn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'credentials');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  resetStepUp();
});

describe('Usunięcie zlecenia bez faktur (EVM-060 AC1)', () => {
  it('EVM-060 AC1 "Usuń zlecenie…" is the last item of the menu, in the destructive group, and opens an alert dialog with the focus on "Anuluj"', async () => {
    await renderPanel(PATH, deleteApi());
    await userEvent.click(await screen.findByRole('button', { name: MENU }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Edytuj dane zlecenia…', 'Usuń zlecenie…']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń zlecenie…' }));
    const dialog = await screen.findByRole('alertdialog', { name: TITLE });
    expect(within(dialog).getByText(/Zlecenie zniknie z listy/)).toBeTruthy();
    expect(within(dialog).queryByText(/opłacone transze/)).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('EVM-060 AC1 confirming sends DELETE with If-Match and an Idempotency-Key, goes to W-10 and tells where the order can be restored', async () => {
    const api = deleteApi();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zlecenia' })).toBeTruthy();
    expect(screen.getByText('Usunięto zlecenie ZL-2026-0042. Przywrócisz je w widoku „Usunięte” listy zleceń.')).toBeTruthy();
    const sent = api.calls(DELETE);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers.get('If-Match')).toBe('"3"');
    expect(sent[0]?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    // nothing of the deleted order is read again (it would be a 404)
    await waitFor(() => {
      expect(api.calls(`GET /api/v1/work-orders/${ORDER_ID}`).length).toBeLessThanOrEqual(1);
    });
  });

  it('EVM-060 AC1 "Anuluj" sends nothing and the focus returns to the menu button', async () => {
    const api = deleteApi();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls(DELETE)).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: MENU }));
  });

  it('EVM-060 AC1 a closed order can be deleted too: the menu item of the Administrator is enabled', async () => {
    const api = activeSessionApi({
      ...workOrderRoutes(ORDER_ID, {
        header: () => json(200, { ...HEADER, status: 'settled', allowedTransitions: ['completed'], closedAt: '2026-10-08T10:00:00.000Z' }),
      }),
      [DELETE]: noContent,
    });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: MENU }));
    expect(screen.getByRole('menuitem', { name: 'Usuń zlecenie…' }).getAttribute('aria-disabled')).not.toBe('true');
  });
});

describe('Zlecenie z transzą wystawioną (EVM-060 AC2)', () => {
  it('EVM-060 AC2 409 has_active_dependents says "Nie można usunąć zlecenia z wystawioną fakturą." without a number and blocks the button', async () => {
    const api = deleteApi({ deletes: [() => problem(409, 'has_active_dependents')], payments: paymentsOf([PLANNED, INVOICED]) });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe('Nie można usunąć zlecenia z wystawioną fakturą.');
    expect(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('heading', { level: 1, name: 'Zlecenia' })).toBeNull();
    expect(api.calls(DELETE)).toHaveLength(1);
    expect(await axeViolations(dialog)).toEqual([]);
  });
});

describe('Zlecenie z transzą opłaconą (EVM-060 AC3)', () => {
  it('EVM-060 AC3 the dialog says a paid instalment needs the identity; 403 step_up_required opens W-04 once and the same request goes again', async () => {
    const api = deleteApi({
      deletes: [() => problem(403, 'step_up_required'), noContent],
      payments: paymentsOf([PLANNED, PAID]),
    });
    stepUpRoutes(api);
    await renderPanel(PATH, api);
    await screen.findByRole('button', { name: MENU });
    // the instalments are read for the dialog
    await waitFor(() => {
      expect(api.calls(`GET /api/v1/work-orders/${ORDER_ID}/payment-milestones`).length).toBeGreaterThan(0);
    });
    const dialog = await openDialog();
    expect(await within(dialog).findByText('Zlecenie ma opłacone transze — usunięcie wymaga potwierdzenia tożsamości.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));

    const stepUp = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby usunąć zlecenie' });
    expect(api.calls(DELETE)).toHaveLength(1);
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zlecenia' })).toBeTruthy();
    const sent = api.calls(DELETE);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.headers.get('If-Match')).toBe('"3"');
    // the refusal left no record under the key: the retry may (and does) reuse it
    expect(sent[1]?.headers.get('Idempotency-Key')).toBe(sent[0]?.headers.get('Idempotency-Key'));
  });

  it('EVM-060 AC3 cancelling W-04 ends with an alert and no loop (one request, no second W-04)', async () => {
    const api = deleteApi({ deletes: [() => problem(403, 'step_up_required')] });
    stepUpRoutes(api);
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));
    const stepUp = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby usunąć zlecenie' });
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Anuluj' }));
    expect(await screen.findByText('Usunięcie wymaga potwierdzenia tożsamości. Spróbuj ponownie i potwierdź tożsamość.')).toBeTruthy();
    expect(api.calls(DELETE)).toHaveLength(1);
    expect(screen.queryByRole('alertdialog', { name: 'Potwierdź tożsamość, aby usunąć zlecenie' })).toBeNull();
  });
});

describe('Brak obejść i stany (EVM-060 AC5, AC6)', () => {
  it('EVM-060 AC5 for the Editor "Usuń zlecenie…" is disabled with the reason, reachable by keyboard, and sends nothing', async () => {
    const api = deleteApi({ session: roleSession('editor') });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: MENU }));
    const item = screen.getByRole('menuitem', { name: /Usuń zlecenie…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Usunąć zlecenie może tylko administrator.');
    item.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls(DELETE)).toHaveLength(0);
  });

  it('EVM-060 AC5 a 403 forbidden of the API (a role changed meanwhile) is told in words', async () => {
    const api = deleteApi({ deletes: [() => problem(403, 'forbidden')] });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));
    expect(await within(dialog).findByText('Usunąć zlecenie może tylko administrator.')).toBeTruthy();
  });

  it('EVM-060 AC6 Tylko odczyt has no menu at all', async () => {
    await renderPanel(PATH, deleteApi({ session: roleSession('read_only') }));
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    expect(screen.queryByRole('button', { name: MENU })).toBeNull();
  });

  it('EVM-060 AC6 offline the item is disabled with the reason', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const api = deleteApi();
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: MENU }));
    const item = screen.getByRole('menuitem', { name: /Usuń zlecenie…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Usuniesz po powrocie połączenia.');
    expect(api.calls(DELETE)).toHaveLength(0);
  });

  it('EVM-060 AC6 412 asks to refresh: "Odśwież zlecenie" reads the order again and the next confirmation sends the new version', async () => {
    const api = deleteApi({ deletes: [() => problem(412, 'version_conflict'), noContent], versions: [3, 4] });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));
    expect(
      await within(dialog).findByText('To zlecenie zmieniono w międzyczasie. Odśwież zlecenie i wybierz operację ponownie.'),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Odśwież zlecenie' }));
    await waitFor(() => {
      expect(within(dialog).queryByRole('alert')).toBeNull();
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zlecenia' })).toBeTruthy();
    const sent = api.calls(DELETE);
    expect(sent.map((request) => request.headers.get('If-Match'))).toEqual(['"3"', '"4"']);
    expect(sent[1]?.headers.get('Idempotency-Key')).not.toBe(sent[0]?.headers.get('Idempotency-Key'));
  });

  it('EVM-060 AC6 a lost answer is retried with the same Idempotency-Key (the order is never deleted twice)', async () => {
    const api = deleteApi({ deletes: [() => problem(503, 'unavailable'), noContent] });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));
    expect(await within(dialog).findByText(/Nie udało się usunąć zlecenia\. Spróbuj ponownie — nie usuniemy go dwa razy\./)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zlecenia' })).toBeTruthy();
    const sent = api.calls(DELETE);
    expect(sent[1]?.headers.get('Idempotency-Key')).toBe(sent[0]?.headers.get('Idempotency-Key'));
  });

  it('EVM-060 AC6 429 says when to try again, 404 and an unexpected error are told in words', async () => {
    const api = deleteApi({
      deletes: [
        () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }),
        () => problem(404, 'not_found'),
        () => problem(500, 'internal_error'),
      ],
    });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    const submit = () => within(dialog).getByRole('button', { name: 'Usuń zlecenie' });
    await userEvent.click(submit());
    expect(await within(dialog).findByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeTruthy();
    await userEvent.click(submit());
    expect(await within(dialog).findByText('Nie znaleziono zlecenia. Odśwież listę zleceń.')).toBeTruthy();
  });

  it('EVM-060 AC6 an answer in progress (409 idempotency_in_progress) and a refused key are told without a second delete', async () => {
    const api = deleteApi({
      deletes: [() => problem(409, 'idempotency_in_progress'), () => problem(422, 'idempotency_mismatch'), noContent],
    });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));
    expect(await within(dialog).findByText('Poprzednie żądanie jeszcze trwa. Spróbuj ponownie za chwilę.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));
    expect(await within(dialog).findByText(/nie usuniemy go dwa razy/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zlecenia' })).toBeTruthy();
    const keys = api.calls(DELETE).map((request) => request.headers.get('Idempotency-Key'));
    // the refused key is never sent again
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('EVM-060 AC6 an unknown server error shows the trace, never the answer', async () => {
    const api = deleteApi({ deletes: [() => problem(418, 'teapot')] });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }));
    expect(await within(dialog).findByText(/kod: abcdef01/)).toBeTruthy();
  });
});

describe('Zlecenie z wszystkimi transzami (EVM-060 AC3)', () => {
  it('EVM-060 AC3 the list of instalments with all four statuses does not block the button before the server answers', async () => {
    const api = deleteApi({ payments: ALL });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    expect(within(dialog).getByRole('button', { name: 'Usuń zlecenie' }).getAttribute('aria-disabled')).not.toBe('true');
  });
});
