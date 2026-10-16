import type { CurrentSession, UserRole, WorkOrderList, WorkOrderListItem } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER } from './work-order-api.ts';

// W-10 and the view "Usunięte" (EVM-060 AC4, AC6): the Administrator's filter, the list of the deleted orders and "Przywróć".
const userEvent = userEventDefault.setup({ delay: null });
const LIST = 'GET /api/v1/work-orders';
const ANNA = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa' };
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ID_1 = '00000000-0000-4000-8000-000000000001';
const ID_2 = '00000000-0000-4000-8000-000000000002';
const restoreRoute = (id: string) => `POST /api/v1/work-orders/${id}/restore`;

function deletedOrder(index: number, overrides: Partial<WorkOrderListItem> = {}): WorkOrderListItem {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    number: `ZL-2026-${String(index).padStart(4, '0')}`,
    title: `Garaż pomyłkowy ${String(index)}`,
    status: 'new',
    coordinator: ANNA,
    customer: { id: '01968f3e-0000-7000-8000-00000000aaaa', displayName: 'Jan Przykładowy' },
    site: { id: '01968f3e-0000-7000-8000-00000000bbbb', street: 'ul. Testowa', buildingNumber: '7', city: 'Warszawa' } as never,
    createdAt: '2026-10-04T12:05:00.000Z',
    waiting: null,
    nextDueDate: null,
    hasOverdueStage: false,
    deletedAt: '2026-10-10T08:30:00.000Z',
    version: 6,
    ...overrides,
  };
}

const DELETED_TWO = [deletedOrder(1), deletedOrder(2, { customer: { deleted: true }, version: 9 })];
const page = (items: WorkOrderListItem[]): WorkOrderList => ({ items, nextCursor: null });
const restored: Handler = () => json(200, { ...HEADER, version: 7 }, { ETag: '"7"' });

const roleSession = (role: UserRole): CurrentSession => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } });

/** The list answers `view=deleted` with the deleted orders (as long as they are not restored) and everything else with nothing. */
function deletedApi({
  role = 'administrator',
  items = DELETED_TWO,
  restores = {},
}: { role?: UserRole; items?: WorkOrderListItem[]; restores?: Record<string, Handler> } = {}) {
  const gone = new Set<string>();
  const api = activeSessionApi({
    [SESSION_ROUTE]: () => json(200, roleSession(role)),
    [LIST]: (request) => json(200, page(request.query.get('view') === 'deleted' ? items.filter((entry) => !gone.has(entry.id)) : [])),
    ...Object.fromEntries(
      items.map((entry) => [
        restoreRoute(entry.id),
        (request: Parameters<Handler>[0]) => {
          const handler = restores[entry.id] ?? restored;
          const answer = handler(request);
          gone.add(entry.id);
          return answer;
        },
      ]),
    ),
  });
  return api;
}

const lastQuery = (api: ReturnType<typeof deletedApi>): URLSearchParams => api.calls(LIST).at(-1)?.query ?? new URLSearchParams();
const rowOf = async (number: string) => {
  const table = await screen.findByRole('table', { name: 'Usunięte zlecenia' });
  return within(table)
    .getAllByRole('row')
    .find((row) => row.textContent.includes(number)) as HTMLElement;
};

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('Filtr „Usunięte” (EVM-060 AC4)', () => {
  it('EVM-060 AC4 only the Administrator sees the view "Usunięte", the last of the views', async () => {
    await renderPanel('/work-orders', deletedApi());
    const views = await screen.findByRole('group', { name: 'Widoki' });
    const names = within(views)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(names.at(-1)).toBe('Usunięte');
  });

  it.each<UserRole>(['editor', 'read_only'])(
    'EVM-060 AC4 %s does not see the view "Usunięte" (the API says 403 all the same)',
    async (role) => {
      await renderPanel('/work-orders', deletedApi({ role }));
      const views = await screen.findByRole('group', { name: 'Widoki' });
      expect(within(views).queryByRole('button', { name: 'Usunięte' })).toBeNull();
    },
  );

  it.each<UserRole>(['editor', 'read_only'])(
    'EVM-060 AC6 a link to the view "Usunięte" is "Nie znaleziono widoku" for %s and the list is not asked',
    async (role) => {
      const api = deletedApi({ role });
      await renderPanel('/work-orders?view=deleted', api);
      expect(await screen.findByText('Nie znaleziono widoku.')).toBeTruthy();
      expect(api.calls(LIST)).toHaveLength(0);
    },
  );

  it('EVM-060 AC4 choosing the view asks the API for view=deleted and lists the deleted orders with their date and "Przywróć"', async () => {
    const api = deletedApi();
    const { history } = await renderPanel('/work-orders', api);
    await userEvent.click(await screen.findByRole('button', { name: 'Usunięte' }));
    expect(await screen.findByRole('table', { name: 'Usunięte zlecenia' })).toBeTruthy();
    await waitFor(() => {
      expect(lastQuery(api).get('view')).toBe('deleted');
    });
    expect(history.location.search).toContain('view=deleted');
    const first = await rowOf('ZL-2026-0001');
    expect(within(first).getByText('Garaż pomyłkowy 1')).toBeTruthy();
    expect(within(first).getAllByText('10.10.2026').length).toBeGreaterThan(0);
    expect(within(first).getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0001' })).toBeTruthy();
    // a deleted order is 404 on its own page: the row is not a link
    expect(within(first).queryByRole('link')).toBeNull();
    // a customer that is gone is told without a name
    expect(within(await rowOf('ZL-2026-0002')).getAllByText('Klient usunięty').length).toBeGreaterThan(0);
    // the search is off in this view and says why
    expect(screen.getByRole('searchbox', { name: 'Szukaj: numer, tytuł, klient, adres…' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Wyszukiwanie w usuniętych zleceniach jest niedostępne.')).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-060 AC4 the phrase of the search is never sent in the view "Usunięte"', async () => {
    const api = deletedApi();
    api.set('POST /api/v1/work-orders/search', () => problem(400, 'validation_failed'));
    await renderPanel('/work-orders?view=deleted', api);
    await screen.findByRole('table', { name: 'Usunięte zlecenia' });
    expect(api.calls('POST /api/v1/work-orders/search')).toHaveLength(0);
  });

  it('EVM-060 AC4 an empty view says there is nothing deleted', async () => {
    await renderPanel('/work-orders?view=deleted', deletedApi({ items: [] }));
    expect(await screen.findByText('Brak usuniętych zleceń.')).toBeTruthy();
  });
});

describe('Przywróć (EVM-060 AC4, AC6)', () => {
  it('EVM-060 AC4 "Przywróć" sends POST with If-Match of the version of the row and an Idempotency-Key, the row leaves and the focus goes to the heading', async () => {
    const api = deletedApi();
    await renderPanel('/work-orders?view=deleted', api);
    await userEvent.click(within(await rowOf('ZL-2026-0002')).getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0002' }));
    expect(await screen.findByText('Przywrócono zlecenie ZL-2026-0002.')).toBeTruthy();
    const sent = api.calls(restoreRoute(ID_2));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers.get('If-Match')).toBe('"9"');
    expect(sent[0]?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Przywróć zlecenie ZL-2026-0002' })).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0001' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Zlecenia' }));
    // restoring asks for no step-up
    expect(api.calls('POST /api/v1/auth/step-up/options')).toHaveLength(0);
  });

  it('EVM-060 AC6 412 says the order changed and the list is read again', async () => {
    const api = deletedApi({ restores: { [ID_1]: () => problem(412, 'version_conflict') } });
    await renderPanel('/work-orders?view=deleted', api);
    const before = api.calls(LIST).length;
    await userEvent.click(within(await rowOf('ZL-2026-0001')).getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0001' }));
    expect(await screen.findByText('To zlecenie zmieniono w międzyczasie. Lista została odświeżona — spróbuj ponownie.')).toBeTruthy();
    await waitFor(() => {
      expect(api.calls(LIST).length).toBeGreaterThan(before);
    });
  });

  it('EVM-060 AC6 404 (restored elsewhere, or not an order of this person) is told the same way', async () => {
    const api = deletedApi({ restores: { [ID_1]: () => problem(404, 'not_found') } });
    await renderPanel('/work-orders?view=deleted', api);
    await userEvent.click(within(await rowOf('ZL-2026-0001')).getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0001' }));
    expect(await screen.findByText('Nie znaleziono zlecenia. Lista została odświeżona.')).toBeTruthy();
  });

  it('EVM-060 AC6 403 (even a step_up_required) says only an administrator restores; 429 and 5xx are told in words', async () => {
    const api = deletedApi({
      restores: {
        [ID_1]: () => problem(403, 'step_up_required'),
        [ID_2]: () => problem(429, 'rate_limited', {}, { 'Retry-After': '45' }),
      },
    });
    await renderPanel('/work-orders?view=deleted', api);
    await userEvent.click(within(await rowOf('ZL-2026-0001')).getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0001' }));
    expect(await screen.findByText('Przywrócić zlecenie może tylko administrator.')).toBeTruthy();
    await userEvent.click(within(await rowOf('ZL-2026-0002')).getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0002' }));
    expect(await screen.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 45 s.')).toBeTruthy();
  });

  it('EVM-060 AC6 a lost answer is retried with the same Idempotency-Key; a trace code is shown for an unknown error', async () => {
    let call = 0;
    const api = deletedApi({
      restores: {
        [ID_1]: (request) => {
          call += 1;
          return call === 1 ? problem(503, 'unavailable') : restored(request);
        },
        [ID_2]: () => problem(418, 'teapot'),
      },
    });
    await renderPanel('/work-orders?view=deleted', api);
    await userEvent.click(within(await rowOf('ZL-2026-0001')).getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0001' }));
    expect(await screen.findByText(/nie przywrócimy go dwa razy/)).toBeTruthy();
    await userEvent.click(within(await rowOf('ZL-2026-0001')).getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0001' }));
    await screen.findByText('Przywrócono zlecenie ZL-2026-0001.');
    const sent = api.calls(restoreRoute(ID_1));
    expect(sent[1]?.headers.get('Idempotency-Key')).toBe(sent[0]?.headers.get('Idempotency-Key'));
    await userEvent.click(within(await rowOf('ZL-2026-0002')).getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0002' }));
    expect(await screen.findByText(/kod: abcdef01/)).toBeTruthy();
  });

  it('EVM-060 AC6 a row without a version sends nothing (it would only provoke 412)', async () => {
    const api = deletedApi({ items: [deletedOrder(1, { version: undefined })] });
    await renderPanel('/work-orders?view=deleted', api);
    const button = within(await rowOf('ZL-2026-0001')).getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0001' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(button);
    expect(api.calls(restoreRoute(ID_1))).toHaveLength(0);
  });

  it('EVM-060 AC6 offline "Przywróć" is disabled with the reason', async () => {
    const api = deletedApi();
    await renderPanel('/work-orders?view=deleted', api);
    const button = within(await rowOf('ZL-2026-0001')).getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0001' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    await waitFor(() => {
      expect(button.getAttribute('aria-disabled')).toBe('true');
    });
    expect(button.getAttribute('title')).toBe('Przywrócisz po powrocie połączenia.');
    await userEvent.click(button);
    expect(api.calls(restoreRoute(ID_1))).toHaveLength(0);
  });
});
