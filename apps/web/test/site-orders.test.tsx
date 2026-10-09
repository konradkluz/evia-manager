import type { SiteOrders } from '@evia/contracts';
import { screen, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, problem } from './api-fake.ts';
import { locationServer, OTHER_ORDER_ID, OTHER_ORDERS, PATH, roleSession } from './location-edit-api.ts';
import { renderPanel } from './render.tsx';
import { ORDER_ID } from './work-order-api.ts';

const userEvent = userEventDefault.setup({ delay: null });
const READ = `GET /api/v1/work-orders/${ORDER_ID}/site-orders`;
const card = () => within(screen.getByRole('region', { name: 'Lokalizacja' }));

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('"Inne zlecenia w tej lokalizacji" (EVM-036 AC5)', () => {
  it('EVM-036 AC5 the card lists the number, the title, the status badge and the date of closing of the settled order of another customer — and nothing of its customer', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    const section = within(await card().findByRole('region', { name: 'Inne zlecenia w tej lokalizacji (1)' }));
    const link = section.getByRole('link', { name: 'ZL-2026-0017' });
    expect(link.getAttribute('href')).toBe(`/work-orders/${OTHER_ORDER_ID}`);
    expect(section.getByText('Przyłącze — garaż')).toBeTruthy();
    expect(section.getByText('Rozliczone')).toBeTruthy();
    expect(section.getByText('zamknięte 30.09.2026')).toBeTruthy();
    // no customer, no contact, no thumbnails
    expect(section.queryByText(/Kowalsk|Przykładowy|@|\+48/)).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(await axeViolations(screen.getByRole('main'))).toEqual([]);
  });

  it('EVM-036 AC5 a title is free text of another order: markup in it stays text', async () => {
    const orders: SiteOrders = {
      total: 1,
      items: [
        { id: OTHER_ORDER_ID, number: 'ZL-2026-0017', title: '<script>alert(1)</script> https://example.test', status: 'in_progress' },
      ],
    };
    const { api } = locationServer({ orders: () => json(200, orders) });
    await renderPanel(PATH, api);
    const section = within(await card().findByRole('region', { name: 'Inne zlecenia w tej lokalizacji (1)' }));
    expect(section.getByText('<script>alert(1)</script> https://example.test')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
    expect(section.queryByText(/zamknięte/)).toBeNull();
    expect(section.getByText('W realizacji')).toBeTruthy();
  });

  it('EVM-036 AC5 a status this panel does not know is the badge of an unknown value, never the raw code', async () => {
    const orders = {
      total: 1,
      items: [{ id: OTHER_ORDER_ID, number: 'ZL-2026-0017', title: 'Nowy status', status: 'archived' }],
    };
    const { api } = locationServer({ orders: () => json(200, orders) });
    await renderPanel(PATH, api);
    const section = within(await card().findByRole('region', { name: 'Inne zlecenia w tej lokalizacji (1)' }));
    expect(section.getByText('Nieznany status')).toBeTruthy();
    expect(section.queryByText('archived')).toBeNull();
  });

  it('EVM-036 AC5 the count is the total the server counted; more than listed says how many are shown', async () => {
    const orders: SiteOrders = { total: 23, items: OTHER_ORDERS.items };
    const { api } = locationServer({ orders: () => json(200, orders) });
    await renderPanel(PATH, api);
    const section = within(await card().findByRole('region', { name: 'Inne zlecenia w tej lokalizacji (23)' }));
    expect(section.getByText('Pokazano 1 z 23.')).toBeTruthy();
  });

  it('EVM-036 AC8 no other orders: the section is hidden', async () => {
    const { api } = locationServer({ orders: () => json(200, { total: 0, items: [] }) });
    await renderPanel(PATH, api);
    await card().findByText('PL-TEST-0001');
    await screen.findByRole('button', { name: 'Edytuj lokalizację' });
    expect(screen.queryByText(/Inne zlecenia w tej lokalizacji/)).toBeNull();
  });

  it('EVM-036 AC8 the order of the site is gone (404): the section is hidden, the card works', async () => {
    const { api } = locationServer({ orders: () => problem(404, 'not_found') });
    await renderPanel(PATH, api);
    await card().findByText('PL-TEST-0001');
    expect(screen.queryByText(/Inne zlecenia w tej lokalizacji/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('EVM-036 AC8 a failure says so inside the section with "Spróbuj ponownie" and the rest of the card works; 429 uses the pattern of the README with the seconds from Retry-After', async () => {
    let answer = problem(500, 'internal_error');
    const { api } = locationServer({ orders: () => answer });
    await renderPanel(PATH, api);
    expect(await card().findByText('Nie udało się wczytać innych zleceń w tej lokalizacji.')).toBeTruthy();
    expect(card().getByText('PL-TEST-0001')).toBeTruthy();
    answer = problem(429, 'rate_limited', {}, { 'Retry-After': '45' });
    await userEvent.click(card().getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await card().findByText('Zbyt wiele zapytań. Spróbuj ponownie za 45 s.')).toBeTruthy();
    answer = json(200, OTHER_ORDERS);
    await userEvent.click(card().getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await card().findByRole('link', { name: 'ZL-2026-0017' })).toBeTruthy();
  });
});

describe('minimisation and no access through the site (EVM-036 AC6; SR-AUTHZ-08)', () => {
  it('EVM-036 AC6 the list asks for the orders by the order it is open on — only its UUID in the path, nothing in the query, no site identifier — and no other route of the site is asked', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    await card().findByRole('link', { name: 'ZL-2026-0017' });
    const [call] = api.calls(READ);
    expect(call?.path).toBe(`/api/v1/work-orders/${ORDER_ID}/site-orders`);
    expect(call?.query.size).toBe(0);
    expect(call?.body).toBe('');
    const paths = api.requests.map((request) => request.path);
    expect(paths.filter((path) => /\/(media|documents|customer)$/.test(path) && !path.includes(ORDER_ID))).toEqual([]);
    expect(paths.some((path) => path.includes('/sites/'))).toBe(false);
  });

  it('EVM-036 AC6 the page does not open the other order: it only links to it, so its media, documents and customer stay behind its own authorisation', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    await card().findByRole('link', { name: 'ZL-2026-0017' });
    expect(api.requests.some((request) => request.path.includes(OTHER_ORDER_ID))).toBe(false);
  });
});

describe('roles (EVM-036 AC7; SR-AUTHZ-05)', () => {
  it.each([
    ['administrator', undefined, true],
    ['editor', roleSession('editor'), true],
    ['read_only', roleSession('read_only'), false],
  ] as const)(
    'EVM-036 AC7 %s: "Edytuj" and the menus of the parties are shown: %s; the list of other orders is shown to all',
    async (_role, session, edits) => {
      const { api } = locationServer(session === undefined ? {} : { session });
      await renderPanel(PATH, api);
      expect(await card().findByRole('link', { name: 'ZL-2026-0017' })).toBeTruthy();
      expect(card().getByText('Operator Testowy')).toBeTruthy();
      expect(card().queryAllByRole('button', { name: 'Edytuj lokalizację' })).toHaveLength(edits ? 1 : 0);
      expect(card().queryAllByRole('button', { name: /^Akcje strony/ })).toHaveLength(edits ? 2 : 0);
    },
  );

  it('EVM-036 AC7 the roles that may edit see the data of the site and of the parties only in the dialogs they open: nothing is read before', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    await card().findByRole('link', { name: 'ZL-2026-0017' });
    expect(api.requests.filter((request) => /\/(sites|parties)\//.test(request.path))).toEqual([]);
  });
});
