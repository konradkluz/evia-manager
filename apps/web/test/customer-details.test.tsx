import type { CurrentSession, Customer, WorkOrderListItem } from '@evia/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../src/app.tsx';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';

const ID = '01968f3e-0000-7000-8000-00000000aaa1';
const PATH = `/customers/${ID}`;
const READ = `GET /api/v1/customers/${ID}`;
const ORDERS = 'GET /api/v1/work-orders';

const JAN: Customer = {
  id: ID,
  kind: 'person',
  firstName: 'Jan',
  lastName: 'Przykładowy',
  phone: '+48600000001',
  email: 'jan.przykladowy@example.com',
  notes: 'Kontakt najlepiej po 16:00.',
  displayName: 'Jan Przykładowy',
  version: 3,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};
const FIRMA: Customer = {
  id: ID,
  kind: 'company',
  companyName: 'Firma Testowa sp. z o.o.',
  taxId: '5260250274',
  contactPersonName: 'Ewa Kontaktowa',
  phone: '+48600000002',
  postalAddress: { street: 'ul. Testowa', buildingNumber: '7', apartmentNumber: '3', postalCode: '00-001', city: 'Warszawa' },
  displayName: 'Firma Testowa sp. z o.o.',
  version: 1,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

function order(index: number, overrides: Partial<WorkOrderListItem> = {}): WorkOrderListItem {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    number: `ZL-2026-${String(index).padStart(4, '0')}`,
    title: `Garaż — pełny proces ${String(index)}`,
    status: 'in_progress',
    coordinator: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

const orders =
  (items: WorkOrderListItem[] = [], nextCursor: string | null = null): Handler =>
  () =>
    json(200, { items, nextCursor });
const roleSession = (role: 'administrator' | 'editor' | 'read_only'): CurrentSession => ({
  ...ACTIVE_SESSION,
  user: { ...ACTIVE_SESSION.user, role },
});

function detailsApi(
  read: Handler = () => json(200, JAN, { ETag: '"3"' }),
  history: Handler = orders(),
  role: 'administrator' | 'editor' | 'read_only' = 'administrator',
  extra: Record<string, Handler> = {},
) {
  return activeSessionApi({ [SESSION_ROUTE]: () => json(200, roleSession(role)), [READ]: read, [ORDERS]: history, ...extra });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const card = (name: string) => within(screen.getByRole('region', { name }));

describe('W-14 the details of a customer (EVM-039 AC2)', () => {
  it('EVM-039 AC2 a person: the name, the kind, the telephone and the e-mail as links, the notes; the tab title has no name', async () => {
    await renderPanel(PATH, detailsApi());
    expect(await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeTruthy();
    expect(screen.getByText('Osoba')).toBeTruthy();
    const data = card('Dane klienta');
    expect(data.getByRole('link', { name: '+48 600 000 001' }).getAttribute('href')).toBe('tel:+48600000001');
    expect(data.getByRole('link', { name: 'jan.przykladowy@example.com' }).getAttribute('href')).toBe(
      'mailto:jan.przykladowy%40example.com',
    );
    expect(data.getByText('Kontakt najlepiej po 16:00.')).toBeTruthy();
    expect(data.getByText('Adres korespondencyjny').nextElementSibling?.textContent).toBe('—');
    expect(document.title).toBe('Klient · EVia Manager');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });

  it('EVM-039 AC2 a company: the company name, the NIP, the contact person and the postal address', async () => {
    await renderPanel(
      PATH,
      detailsApi(() => json(200, FIRMA, { ETag: '"1"' })),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Firma Testowa sp. z o.o.' })).toBeTruthy();
    const data = card('Dane klienta');
    const value = (label: string) => data.getByText(label).nextElementSibling?.textContent;
    expect(value('Nazwa firmy')).toBe('Firma Testowa sp. z o.o.');
    expect(value('NIP')).toBe('5260250274');
    expect(value('Osoba kontaktowa')).toBe('Ewa Kontaktowa');
    expect(value('Adres korespondencyjny')).toBe('ul. Testowa 7/3, 00-001 Warszawa');
    expect(value('E-mail')).toBe('—');
  });

  it('EVM-039 AC2 the links of the contact data are built from the encoded value and values from the data are text only', async () => {
    const odd: Customer = {
      ...JAN,
      email: 'a@example.com?cc=b@example.com',
      notes: '<img src=x onerror=alert(1)> [x](javascript:alert(1))',
    };
    await renderPanel(
      PATH,
      detailsApi(() => json(200, odd, { ETag: '"3"' })),
    );
    await screen.findByRole('heading', { level: 1 });
    const mail = card('Dane klienta').getByRole('link', { name: 'a@example.com?cc=b@example.com' });
    expect(mail.getAttribute('href')).toBe('mailto:a%40example.com%3Fcc%3Db%40example.com');
    expect(document.querySelector('main img')).toBeNull();
    expect(card('Dane klienta').getAllByRole('link')).toHaveLength(2);
  });

  it('EVM-039 AC2 "Historia zleceń (3)" lists the orders of the customer from the list of work orders with the filter customerId, newest first, as links to W-06', async () => {
    const api = detailsApi(
      undefined,
      orders([
        order(3, { status: 'new', createdAt: '2026-09-28T10:00:00.000Z' }),
        order(2, { status: 'in_progress', createdAt: '2026-09-01T10:00:00.000Z' }),
        order(1, { status: 'settled', createdAt: '2026-01-15T10:00:00.000Z' }),
      ]),
    );
    await renderPanel(PATH, api);
    expect(await screen.findByRole('heading', { level: 2, name: 'Historia zleceń (3)' })).toBeTruthy();
    const query = api.calls(ORDERS).at(-1)?.query ?? new URLSearchParams();
    expect(query.get('customerId')).toBe(ID);
    expect(query.get('sort')).toBe('-createdAt');
    expect(query.get('limit')).toBe('25');
    expect(query.has('view')).toBe(false);
    const table = screen.getByRole('table', { name: 'Historia zleceń klienta' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Zlecenie', 'Status', 'Utworzono']);
    const link = within(table).getByRole('link', { name: 'ZL-2026-0002, Garaż — pełny proces 2, W realizacji, utworzono 01.09.2026' });
    expect(link.getAttribute('href')).toBe('/work-orders/00000000-0000-4000-8000-000000000002');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
  });

  it('EVM-039 AC2 "Przejdź do klienta" in W-06 leads here and the way back from the history leads to W-06', async () => {
    const api = detailsApi(undefined, orders([order(2)]), 'administrator', {
      'GET /api/v1/work-orders/00000000-0000-4000-8000-000000000002': () => problem(404, 'not_found'),
    });
    const { history } = await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('link', { name: /ZL-2026-0002/ }));
    expect(history.location.pathname).toBe('/work-orders/00000000-0000-4000-8000-000000000002');
  });

  it('EVM-039 AC2 a customer without orders says "Klient nie ma zleceń."', async () => {
    await renderPanel(PATH, detailsApi());
    expect(await screen.findByText('Klient nie ma zleceń.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Historia zleceń (0)' })).toBeTruthy();
  });

  it('EVM-039 AC2 the history has pages of 25: "(25+)" while there is a next page, the cursor goes in the query and the focus moves to the heading', async () => {
    const api = detailsApi(undefined, (request) =>
      request.query.get('cursor') === 'c2'
        ? json(200, { items: [order(26)], nextCursor: null })
        : json(200, { items: [order(1)], nextCursor: 'c2' }),
    );
    await renderPanel(PATH, api);
    expect(await screen.findByRole('heading', { level: 2, name: 'Historia zleceń (1+)' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByRole('link', { name: /ZL-2026-0026/ })).toBeTruthy();
    expect(api.calls(ORDERS).at(-1)?.query.get('cursor')).toBe('c2');
    expect(screen.getByRole('heading', { level: 2, name: 'Historia zleceń (26)' })).toBeTruthy();
    expect(screen.getByText('Wczytano następną stronę zleceń klienta.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Historia zleceń (26)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Poprzednia strona' }));
    expect(await screen.findByRole('link', { name: /ZL-2026-0001/ })).toBeTruthy();
  });

  it('EVM-039 AC2 an error of the history is inside its section, with a retry; the data of the customer stays', async () => {
    let failing = true;
    const api = detailsApi(undefined, () =>
      failing ? problem(500, 'internal_error') : json(200, { items: [order(1)], nextCursor: null }),
    );
    await renderPanel(PATH, api);
    expect(await screen.findByText('Nie udało się wczytać historii zleceń.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeTruthy();
    expect(card('Dane klienta').getByText('Kontakt najlepiej po 16:00.')).toBeTruthy();
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('link', { name: /ZL-2026-0001/ })).toBeTruthy();
  });

  it('EVM-039 AC2 the details pass axe, with the history and with the menu open', async () => {
    await renderPanel(
      PATH,
      detailsApi(undefined, orders([order(1), order(2, { status: 'a_status_from_a_newer_api' as WorkOrderListItem['status'] })], 'c2')),
    );
    await screen.findByRole('table', { name: 'Historia zleceń klienta' });
    expect(screen.getByText('Nieznany status', { exact: false })).toBeTruthy();
    expect(document.body.textContent).not.toContain('a_status_from_a_newer_api');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('W-14 states and roles of the details (EVM-039 AC6, AC7, AC8)', () => {
  it.each(['administrator', 'editor', 'read_only'] as const)(
    'EVM-039 AC6 %s: a customer that does not exist, is deleted or is not theirs is ONE screen "Nie znaleziono klienta." with no data of the customer',
    async (role) => {
      const api = detailsApi(() => problem(404, 'not_found'), orders(), role);
      await renderPanel(PATH, api);
      expect(await screen.findByRole('heading', { level: 1, name: 'Nie znaleziono klienta.' })).toBeTruthy();
      expect(screen.getByText('Mógł zostać usunięty albo nie masz do niego dostępu.')).toBeTruthy();
      expect(document.title).toBe('Nie znaleziono · EVia Manager');
      expect(screen.queryByText('Jan Przykładowy')).toBeNull();
      expect(screen.queryByRole('button', { name: /Akcje klienta/ })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    },
  );

  it('EVM-039 AC6 "Wróć do listy klientów" leads to the list', async () => {
    const api = detailsApi(() => problem(404, 'not_found'), orders(), 'editor', {
      'GET /api/v1/customers': () => json(200, { items: [], nextCursor: null }),
    });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Wróć do listy klientów' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Klienci' })).toBeTruthy();
  });

  it('EVM-039 AC6 a customer deleted while the page is open: the data is gone from the memory of the tab at once', async () => {
    const queryClient = createQueryClient();
    let gone = false;
    const api = detailsApi(() => (gone ? problem(404, 'not_found') : json(200, JAN, { ETag: '"3"' })));
    await renderPanel(PATH, api, { queryClient });
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    gone = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['customer', ID] });
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie znaleziono klienta.' })).toBeTruthy();
    expect(queryClient.getQueryData(['customer', ID])).toBeUndefined();
    expect(screen.queryByText('Jan Przykładowy')).toBeNull();
  });

  it.each([
    ['administrator', true],
    ['editor', true],
    ['read_only', false],
  ] as const)('EVM-039 AC7 %s: the menu "Akcje klienta" with "Edytuj dane klienta…" is shown: %s', async (role, shown) => {
    await renderPanel(PATH, detailsApi(undefined, orders(), role));
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    expect(screen.queryByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }) !== null).toBe(shown);
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('EVM-039 AC7 a 401 on the details clears the data of the customer from the memory of the tab and sends the tab to the login page', async () => {
    const queryClient = createQueryClient();
    let expired = false;
    const api = detailsApi(
      () => (expired ? problem(401, 'session_expired') : json(200, JAN, { ETag: '"3"' })),
      orders([order(1)]),
      'administrator',
      {},
    );
    api.set(SESSION_ROUTE, () => (expired ? problem(401, 'session_expired') : json(200, ACTIVE_SESSION)));
    const { history } = await renderPanel(PATH, api, { queryClient });
    await screen.findByRole('link', { name: /ZL-2026-0001/ });
    expired = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['customer', ID] }).catch(() => undefined);
    });
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(queryClient.getQueryData(['customer', ID])).toBeUndefined();
    expect(queryClient.getQueryCache().findAll({ queryKey: ['customer-orders'] })).toHaveLength(0);
    expect(screen.queryByText('Jan Przykładowy')).toBeNull();
  });

  it('EVM-039 AC7 logout drops the customer and the history from the memory of the tab and leaves for the login page', async () => {
    const queryClient = createQueryClient();
    const api = detailsApi(undefined, orders([order(1)]));
    api.set('POST /api/v1/auth/logout', () => new Response(null, { status: 204 }));
    const { history } = await renderPanel(PATH, api, { queryClient });
    await screen.findByRole('link', { name: /ZL-2026-0001/ });
    await userEvent.click(screen.getByRole('button', { name: /Konto:/ }));
    api.set(SESSION_ROUTE, () => problem(401, 'unauthenticated'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Wyloguj' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(queryClient.getQueryCache().findAll({ queryKey: ['customer'] })).toHaveLength(0);
    expect(queryClient.getQueryCache().findAll({ queryKey: ['customer-orders'] })).toHaveLength(0);
    expect(screen.queryByText('Jan Przykładowy')).toBeNull();
  });

  it('EVM-039 AC8 loading is a Skeleton with a status; then the heading comes first', async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    await renderPanel(
      PATH,
      detailsApi(() => pending),
      { heading: false },
    );
    expect(await screen.findByText('Ładowanie klienta…')).toBeTruthy();
    expect(screen.getByText('Ładowanie klienta…').closest('[aria-busy="true"]')).not.toBeNull();
    release(json(200, JAN, { ETag: '"3"' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeTruthy();
  });

  it('EVM-039 AC8 an error shows "Nie udało się wczytać klienta." with a retry; a 429 says how long to wait', async () => {
    let state: 'error' | 'limited' | 'ok' = 'error';
    const api = detailsApi(() =>
      state === 'error'
        ? problem(500, 'internal_error')
        : state === 'limited'
          ? problem(429, 'rate_limited', {}, { 'Retry-After': '120' })
          : json(200, JAN, { ETag: '"3"' }),
    );
    await renderPanel(PATH, api);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie udało się wczytać klienta.' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('internal_error');
    state = 'limited';
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 2 min.')).toBeTruthy();
    state = 'ok';
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeTruthy();
  });

  it('EVM-039 AC8 offline: the data stays under "Dane mogą być nieaktualne (z …)" and "Edytuj dane klienta…" says it can be changed after the connection returns', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:05:00.000Z'));
    await renderPanel(PATH, detailsApi(undefined, orders([order(1)])));
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('Dane mogą być nieaktualne (z 14:05)')).toBeTruthy();
    expect(card('Dane klienta').getByText('Kontakt najlepiej po 16:00.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }));
    const item = screen.getByRole('menuitem', { name: /Edytuj dane klienta…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Zmienisz po powrocie połączenia.');
    await userEvent.click(item);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });
});
