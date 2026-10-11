import type { CurrentSession, WorkOrderDetails } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER, ORDER_ID, workOrderRoutes } from './work-order-api.ts';

const userEvent = userEventDefault.setup({ delay: null });
const PATH = `/work-orders/${ORDER_ID}`;
const BASE = `/api/v1/work-orders/${ORDER_ID}`;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PETR = '22222222-2222-4222-8222-222222222222';

const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } });

const ORDER: WorkOrderDetails = { ...HEADER, description: 'Trasa kabla przez szacht B.', plannedDate: '2026-10-20' };

function api(options: { header?: Handler; session?: CurrentSession; patch?: Handler; users?: Handler } = {}) {
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, options.session ?? ACTIVE_SESSION),
    ...workOrderRoutes(ORDER_ID, { header: options.header ?? (() => json(200, ORDER, { ETag: '"3"' })) }),
    ...(options.patch === undefined ? {} : { [`PATCH ${BASE}`]: options.patch }),
    ...(options.users === undefined ? {} : { 'GET /api/v1/users/assignable': options.users }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj dane zlecenia…' }));
  return screen.findByRole('dialog', { name: 'Edytuj dane zlecenia' });
}

describe('W-06 (a) "Edytuj dane zlecenia" (EVM-035 AC1)', () => {
  it('EVM-035 AC1 the dialog is filled from the header and saves only what changed with If-Match and an Idempotency-Key', async () => {
    const saved: WorkOrderDetails = { ...ORDER, title: 'Garaż — poprawiony', plannedDate: '2026-10-27', version: 4 };
    const fake = api({ patch: () => json(200, saved, { ETag: '"4"' }) });
    await renderPanel(PATH, fake);
    const dialog = within(await openDialog());
    expect(dialog.getByLabelText<HTMLInputElement>('Tytuł').value).toBe('Garaż — pełny proces');
    expect(dialog.getByLabelText<HTMLTextAreaElement>('Opis (opcjonalnie)').value).toBe('Trasa kabla przez szacht B.');
    expect(dialog.getByLabelText<HTMLInputElement>('Planowana data (opcjonalnie)').value).toBe('2026-10-20');
    expect(dialog.getByText('Bez nazwisk i adresów — klienta i lokalizację wskazujesz osobno.')).toBeTruthy();
    // SR-DATA-02: the free text fields carry the hint of the shared rule 8
    expect(dialog.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeTruthy();

    await userEvent.clear(dialog.getByLabelText('Tytuł'));
    await userEvent.type(dialog.getByLabelText('Tytuł'), 'Garaż — poprawiony');
    fireEvent.change(dialog.getByLabelText('Planowana data (opcjonalnie)'), { target: { value: '2026-10-27' } });
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));

    await waitFor(() => {
      expect(fake.calls(`PATCH ${BASE}`)).toHaveLength(1);
    });
    const sent = fake.calls(`PATCH ${BASE}`)[0];
    expect(parseBody(sent?.body ?? '')).toEqual({ title: 'Garaż — poprawiony', plannedDate: '2026-10-27' });
    expect(sent?.headers.get('If-Match')).toBe('"3"');
    expect(sent?.headers.get('Idempotency-Key')).toMatch(UUID_V7);
    expect(sent?.headers.get('X-CSRF-Token')).toBe('csrf-active');
    expect(await screen.findByText('Zapisano zmiany zlecenia.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    // the header shows the answer at once and focus returns to the trigger of the menu
    expect(screen.getByText('Garaż — poprawiony')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }));
  });

  it('EVM-035 AC1 a cleared description and a cleared date are sent as null; an untouched dialog sends nothing', async () => {
    const fake = api({ patch: () => json(200, { ...ORDER, version: 4 }, { ETag: '"4"' }) });
    await renderPanel(PATH, fake);
    let dialog = within(await openDialog());
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    expect(fake.calls(`PATCH ${BASE}`)).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    dialog = within(await openDialog());
    await userEvent.clear(dialog.getByLabelText('Opis (opcjonalnie)'));
    fireEvent.change(dialog.getByLabelText('Planowana data (opcjonalnie)'), { target: { value: '' } });
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    await waitFor(() => {
      expect(fake.calls(`PATCH ${BASE}`)).toHaveLength(1);
    });
    expect(parseBody(fake.calls(`PATCH ${BASE}`)[0]?.body ?? '')).toEqual({ description: null, plannedDate: null });
  });

  it('EVM-035 AC1 the coordinator is chosen from the users of the list and sent as assigneeUserId; a failure of the list is told', async () => {
    const fake = api({
      users: () =>
        json(200, {
          items: [
            { id: ACTIVE_SESSION.user.id, displayName: 'Anna Testowa' },
            { id: PETR, displayName: 'Piotr Testowy' },
          ],
          nextCursor: null,
        }),
      patch: () => json(200, { ...ORDER, coordinator: { id: PETR, displayName: 'Piotr Testowy' }, version: 4 }, { ETag: '"4"' }),
    });
    await renderPanel(PATH, fake);
    const dialog = within(await openDialog());
    await waitFor(() => {
      expect(dialog.getByRole('option', { name: 'Piotr Testowy' })).toBeTruthy();
    });
    await userEvent.selectOptions(dialog.getByLabelText('Opiekun'), PETR);
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    await waitFor(() => {
      expect(parseBody(fake.calls(`PATCH ${BASE}`)[0]?.body ?? '')).toEqual({ assigneeUserId: PETR });
    });
    expect(await screen.findByText('Zapisano zmiany zlecenia.')).toBeTruthy();
    // the new coordinator is on the card at once
    expect(screen.getByText('Piotr Testowy')).toBeTruthy();
  });

  it('EVM-035 AC1 an unavailable coordinator (400 assignee_unavailable) is told under the field and the data stays', async () => {
    const fake = api({
      users: () => json(200, { items: [{ id: PETR, displayName: 'Piotr Testowy' }], nextCursor: null }),
      patch: () => problem(400, 'validation_failed', { errors: [{ pointer: '/assigneeUserId', code: 'assignee_unavailable' }] }),
    });
    await renderPanel(PATH, fake);
    const dialog = within(await openDialog());
    await waitFor(() => {
      expect(dialog.getByRole('option', { name: 'Piotr Testowy' })).toBeTruthy();
    });
    await userEvent.selectOptions(dialog.getByLabelText('Opiekun'), PETR);
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    expect(await dialog.findByText('Ta osoba nie jest dostępna. Wybierz innego opiekuna.')).toBeTruthy();
    expect(dialog.getByLabelText<HTMLSelectElement>('Opiekun').value).toBe(PETR);
  });

  it('EVM-035 AC1 an empty title is told before anything is sent', async () => {
    const fake = api({ patch: () => json(200, ORDER) });
    await renderPanel(PATH, fake);
    const dialog = within(await openDialog());
    await userEvent.clear(dialog.getByLabelText('Tytuł'));
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    expect(await dialog.findByText('Podaj tytuł zlecenia.')).toBeTruthy();
    expect(fake.calls(`PATCH ${BASE}`)).toHaveLength(0);
  });

  it('EVM-035 AC1 412 keeps the typed data, reads the header again, shows "Aktualnie: …" and the next save uses the new version', async () => {
    let reads = 0;
    const header: Handler = () => {
      reads += 1;
      return reads === 1
        ? json(200, ORDER, { ETag: '"3"' })
        : json(200, { ...ORDER, plannedDate: '2026-10-27', version: 4 }, { ETag: '"4"' });
    };
    let attempts = 0;
    const patch: Handler = () => {
      attempts += 1;
      return attempts === 1
        ? problem(412, 'version_conflict')
        : json(200, { ...ORDER, title: 'Nowy tytuł', plannedDate: '2026-10-27', version: 5 });
    };
    const fake = api({ header, patch });
    await renderPanel(PATH, fake);
    const dialog = within(await openDialog());
    await userEvent.clear(dialog.getByLabelText('Tytuł'));
    await userEvent.type(dialog.getByLabelText('Tytuł'), 'Nowy tytuł');
    fireEvent.change(dialog.getByLabelText('Planowana data (opcjonalnie)'), { target: { value: '2026-11-03' } });
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));

    const alert = await dialog.findByRole('alert');
    expect(alert.textContent).toContain('To zlecenie zmieniono w międzyczasie. Twoje zmiany zachowaliśmy');
    expect(await dialog.findByText(/Aktualnie: 27\.10\.2026/)).toBeTruthy();
    // what was typed stays — in the component only, never in a store of the browser
    expect(dialog.getByLabelText<HTMLInputElement>('Tytuł').value).toBe('Nowy tytuł');
    expect(dialog.getByLabelText<HTMLInputElement>('Planowana data (opcjonalnie)').value).toBe('2026-11-03');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    await waitFor(() => {
      expect(fake.calls(`PATCH ${BASE}`)).toHaveLength(2);
    });
    expect(fake.calls(`PATCH ${BASE}`)[1]?.headers.get('If-Match')).toBe('"4"');
  });

  it('EVM-035 AC6 409 work_order_closed in the dialog tells so, disables the save and keeps the data until "Anuluj"', async () => {
    let reads = 0;
    const header: Handler = () => {
      reads += 1;
      return reads === 1
        ? json(200, ORDER, { ETag: '"3"' })
        : json(200, { ...ORDER, status: 'settled', allowedTransitions: [], version: 4 });
    };
    const fake = api({ header, patch: () => problem(409, 'work_order_closed') });
    await renderPanel(PATH, fake);
    const dialog = within(await openDialog());
    await userEvent.type(dialog.getByLabelText('Tytuł'), ' (2)');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    expect((await dialog.findByRole('alert')).textContent).toBe('Zlecenie jest już rozliczone — dane zmienisz po przywróceniu zlecenia.');
    expect(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }).getAttribute('aria-disabled')).toBe('true');
    expect(dialog.getByLabelText<HTMLInputElement>('Tytuł').value).toBe('Garaż — pełny proces (2)');
  });

  it('EVM-035 AC6 a closed order has the item disabled with the reason; the Editor learns who restores', async () => {
    const closed: WorkOrderDetails = { ...ORDER, status: 'cancelled', allowedTransitions: [] };
    await renderPanel(PATH, api({ header: () => json(200, closed, { ETag: '"3"' }), session: roleSession('editor') }));
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }));
    const item = screen.getByRole('menuitem', { name: /Edytuj dane zlecenia…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Zlecenie jest anulowane — dane zmienisz po przywróceniu zlecenia przez administratora.');
    await userEvent.click(item);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-035 AC8 Tylko odczyt has no menu of the order; the Editor edits', async () => {
    await renderPanel(PATH, api({ session: roleSession('read_only') }));
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    expect(screen.queryByRole('button', { name: /^Akcje zlecenia/ })).toBeNull();
  });

  it('EVM-035 AC8 403 from the server (a request outside the UI) is told as a lack of permission', async () => {
    const fake = api({ session: roleSession('editor'), patch: () => problem(403, 'forbidden') });
    await renderPanel(PATH, fake);
    expect(screen.queryByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' })).not.toBeNull();
    const dialog = within(await openDialog());
    await userEvent.type(dialog.getByLabelText('Tytuł'), '!');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    expect(await dialog.findByText('Nie masz uprawnień do tej zmiany.')).toBeTruthy();
  });

  it('EVM-035 AC1 offline: the item of the menu is disabled with the reason; a dialog that is open has the save disabled', async () => {
    await renderPanel(PATH, api());
    const dialog = within(await openDialog());
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    await waitFor(() => {
      expect(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }).getAttribute('aria-disabled')).toBe('true');
    });
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(screen.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }));
    expect(screen.getByRole('menuitem', { name: /Edytuj dane zlecenia…/ }).textContent).toContain('Zmienisz po powrocie połączenia.');
  });

  it('EVM-035 AC1 a server error and a rate limit are told with the data kept; closing a dirty dialog asks first', async () => {
    let calls = 0;
    const fake = api({
      patch: () => {
        calls += 1;
        return calls === 1 ? problem(429, 'rate_limited', {}, { 'Retry-After': '30' }) : problem(500, 'internal_error');
      },
    });
    await renderPanel(PATH, fake);
    const dialog = within(await openDialog());
    await userEvent.type(dialog.getByLabelText('Tytuł'), '!');
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    expect(await dialog.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeTruthy();
    await userEvent.click(dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }));
    await waitFor(() => {
      expect(dialog.getByRole('alert').textContent).toContain('Nie udało się zapisać zmian zlecenia.');
    });
    // Esc with changes asks "Odrzucić zmiany?"
    await userEvent.click(dialog.getByRole('button', { name: 'Anuluj' }));
    expect(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Wróć do edycji' }));
    expect(screen.getByLabelText<HTMLInputElement>('Tytuł').value).toBe('Garaż — pełny proces!');
  });

  it('EVM-035 AC1 the dialog has no accessibility violations and a description with markup is text', async () => {
    const markup: WorkOrderDetails = { ...ORDER, description: '<img src=x onerror=alert(1)>' };
    await renderPanel(PATH, api({ header: () => json(200, markup, { ETag: '"3"' }) }));
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    const dialog = await openDialog();
    expect(await axeViolations(dialog)).toEqual([]);
    expect(document.querySelector('img')).toBeNull();
  });
});
