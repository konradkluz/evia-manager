import type { CustomerList, CustomerSearchItem } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { CUSTOMER, HEADER, ORDER_ID, workOrderRoutes } from './work-order-api.ts';

const LIST = 'GET /api/v1/customers';
const SEARCH = 'POST /api/v1/customers/search';

const item = (index: number, overrides: Partial<CustomerSearchItem> = {}): CustomerSearchItem => ({
  id: `01968f3e-0000-7000-8000-${String(index).padStart(12, '0')}`,
  kind: 'person',
  displayName: `Piotr Przykładowy ${String(index)}`,
  sortName: `Przykładowy ${String(index)} Piotr`,
  phone: `+486000000${String(index).padStart(2, '0')}`,
  email: null,
  ...overrides,
});
const page = (items: CustomerSearchItem[], nextCursor: string | null = null): CustomerList => ({ items, nextCursor });

function listApi(
  list: Handler,
  role: 'administrator' | 'editor' | 'read_only' = 'administrator',
  search: Handler = () => json(200, page([])),
) {
  const session = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } };
  return activeSessionApi({ [SESSION_ROUTE]: () => json(200, session), [LIST]: list, [SEARCH]: search });
}
const chip = () => screen.findByRole('button', { name: 'Usunięci' });

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('W-14 the filter "Usunięci" (EVM-041 AC3)', () => {
  it('EVM-041 AC3 the Administrator turns it on: the list is read with deleted=true, every row carries the mark "Usunięty", and it turns off again', async () => {
    const api = listApi((request) => (request.query.get('deleted') === 'true' ? json(200, page([item(9)])) : json(200, page([item(1)]))));
    await renderPanel('/customers', api);
    await screen.findByRole('table', { name: 'Klienci' });
    expect(api.calls(LIST).at(-1)?.query.has('deleted')).toBe(false);
    const button = await chip();
    expect(button.getAttribute('aria-pressed')).toBe('false');

    await userEvent.click(button);
    const table = await screen.findByRole('table', { name: 'Klienci' });
    await waitFor(() => {
      expect(within(table).getByText('Przykładowy 9 Piotr')).toBeTruthy();
    });
    expect(api.calls(LIST).at(-1)?.query.get('deleted')).toBe('true');
    expect(within(table).getByText('Usunięty')).toBeTruthy();
    expect(within(table).getByRole('link', { name: /Przykładowy 9 Piotr.*usunięty$/ })).toBeTruthy();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);

    await userEvent.click(button);
    await waitFor(() => {
      expect(screen.queryByText('Przykładowy 9 Piotr')).toBeNull();
    });
    expect(await screen.findByText('Przykładowy 1 Piotr')).toBeTruthy();
    expect(screen.queryByText('Usunięty')).toBeNull();
  });

  it('EVM-041 AC3 the search in the deleted view carries deleted:true in the body and the phrase stays out of the address', async () => {
    const api = listApi(
      () => json(200, page([item(9)])),
      'administrator',
      () => json(200, page([item(9)])),
    );
    await renderPanel('/customers', api);
    await userEvent.click(await chip());
    await screen.findByRole('table', { name: 'Klienci' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Szukaj klientów' }), 'Przyk');
    await waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(1);
    });
    expect(parseBody(api.calls(SEARCH)[0]?.body ?? '')).toEqual({ query: 'Przyk', limit: 25, deleted: true });
  });

  it('EVM-041 AC3 no deleted customers says "Brak usuniętych klientów." and "Pokaż wszystkich klientów" goes back', async () => {
    const api = listApi((request) => (request.query.get('deleted') === 'true' ? json(200, page([])) : json(200, page([item(1)]))));
    await renderPanel('/customers', api);
    await userEvent.click(await chip());
    expect(await screen.findByText('Brak usuniętych klientów.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż wszystkich klientów' }));
    expect(await screen.findByText('Przykładowy 1 Piotr')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Usunięci' }).getAttribute('aria-pressed')).toBe('false');
  });

  it.each(['editor', 'read_only'] as const)('EVM-041 AC3 %s has no chip and never sends the parameter', async (role) => {
    const api = listApi(() => json(200, page([item(1)])), role);
    await renderPanel('/customers', api);
    await screen.findByRole('table', { name: 'Klienci' });
    expect(screen.queryByRole('button', { name: 'Usunięci' })).toBeNull();
    expect(api.calls(LIST).every((call) => !call.query.has('deleted'))).toBe(true);
  });

  it('EVM-041 AC3 the cursor of the other view is not carried over: turning the filter starts at the first page', async () => {
    const api = listApi((request) =>
      request.query.get('deleted') === 'true' ? json(200, page([item(9)])) : json(200, page([item(1)], 'next-active')),
    );
    await renderPanel('/customers', api);
    await userEvent.click(await screen.findByRole('button', { name: 'Następna strona' }));
    await waitFor(() => {
      expect(api.calls(LIST).at(-1)?.query.get('cursor')).toBe('next-active');
    });
    await userEvent.click(await chip());
    await waitFor(() => {
      expect(api.calls(LIST).at(-1)?.query.get('deleted')).toBe('true');
    });
    expect(api.calls(LIST).at(-1)?.query.has('cursor')).toBe(false);
  });

  it('EVM-041 AC3 offline the chip is off with the reason', async () => {
    const api = listApi(() => json(200, page([item(1)])));
    await renderPanel('/customers', api);
    await screen.findByRole('table', { name: 'Klienci' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    globalThis.dispatchEvent(new Event('offline'));
    const button = await chip();
    await waitFor(() => {
      expect(button.getAttribute('aria-disabled')).toBe('true');
    });
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.body.textContent).toContain('Zmienisz po powrocie połączenia.');
  });

  it('EVM-041 AC8 a refusal (403) of the view is a failed list with a retry, not a silent full list', async () => {
    const api = listApi((request) => (request.query.get('deleted') === 'true' ? problem(403, 'forbidden') : json(200, page([item(1)]))));
    await renderPanel('/customers', api);
    await userEvent.click(await chip());
    expect(await screen.findByText('Nie udało się wczytać klientów.')).toBeTruthy();
    expect(screen.queryByText('Przykładowy 1 Piotr')).toBeNull();
  });
});

describe('W-06 the card "Klient" of an anonymized customer (EVM-041 AC4)', () => {
  it('EVM-041 AC4 shows "—" instead of the placeholder number, the state line and no tel: link', async () => {
    const api = activeSessionApi({
      ...workOrderRoutes(ORDER_ID, {
        customer: () =>
          json(200, { ...CUSTOMER, displayName: 'Klient zanonimizowany', phone: '+48000000000', email: null, anonymized: true }),
      }),
    });
    await renderPanel(`/work-orders/${ORDER_ID}`, api);
    await screen.findByRole('heading', { level: 1, name: HEADER.number });
    const card = within(await screen.findByRole('region', { name: 'Klient' }));
    expect(await card.findByText('Klient zanonimizowany — dane kontaktowe usunięto.')).toBeTruthy();
    expect(card.getAllByText('—')).toHaveLength(2);
    expect(card.queryByRole('link', { name: /\+48|@/ })).toBeNull();
    expect(document.body.innerHTML).not.toContain('tel:+48000000000');
  });
});
