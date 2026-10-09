import type { CurrentSession } from '@evia/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../src/app.tsx';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { CUSTOMER, HEADER, ORDER_ID, SCOPE_ITEMS, SITE, scopeItem, workOrderRoutes, type ReadHandlers } from './work-order-api.ts';

const userEvent = userEventDefault.setup({ delay: null });
const PATH = `/work-orders/${ORDER_ID}`;
const BASE = `/api/v1/work-orders/${ORDER_ID}`;

const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } });

function detailsApi(reads: Partial<ReadHandlers> = {}, session: CurrentSession = ACTIVE_SESSION, extra: Record<string, Handler> = {}) {
  return activeSessionApi({ [SESSION_ROUTE]: () => json(200, session), ...workOrderRoutes(ORDER_ID, reads), ...extra });
}

/** An answer that arrives when the test says so (the loading states of AC7). */
function deferred() {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const main = () => within(screen.getByRole('main'));
const card = (name: string) => within(screen.getByRole('region', { name }));

describe('W-06 "Przegląd" (EVM-018 AC1)', () => {
  it('EVM-018 AC1 the header has the number, the title, the status, the customer, the address, the keeper and the date; the tab "Przegląd" is the active one', async () => {
    await renderPanel(PATH, detailsApi());
    expect(await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeTruthy();
    const page = main();
    expect(page.getByText('Garaż — pełny proces')).toBeTruthy();
    expect(page.getByText('W realizacji')).toBeTruthy();
    expect(page.getAllByText('Jan Przykładowy').length).toBeGreaterThan(0);
    expect(page.getAllByText('ul. Testowa 7, 00-001 Warszawa · miejsce 15, poziom -1').length).toBeGreaterThan(0);
    expect(page.getByText('Anna Testowa')).toBeTruthy();
    expect(page.getByText('01.09.2026')).toBeTruthy();
    const tab = page.getByRole('tab', { name: 'Przegląd' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(page.getAllByRole('tab')).toHaveLength(1);
  });

  it('EVM-018 AC1 the card "Klient" has the name, the telephone and the e-mail as links; the card "Lokalizacja" has the type, the address, the spot, the OSD, the manager, the power, the PPE and the notes', async () => {
    await renderPanel(PATH, detailsApi());
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    const customer = await waitFor(() => {
      const found = card('Klient');
      expect(found.getByText('Jan Przykładowy')).toBeTruthy();
      return found;
    });
    expect(customer.getByRole('link', { name: '+48 600 000 001' }).getAttribute('href')).toBe('tel:+48600000001');
    expect(customer.getByRole('link', { name: 'jan.przykladowy@example.com' }).getAttribute('href')).toBe(
      'mailto:jan.przykladowy%40example.com',
    );
    const site = await waitFor(() => {
      const found = card('Lokalizacja');
      expect(found.getByText('Garaż w budynku wielorodzinnym')).toBeTruthy();
      return found;
    });
    expect(site.getByText('ul. Testowa 7, 00-001 Warszawa')).toBeTruthy();
    expect(site.getByText('miejsce 15, poziom -1')).toBeTruthy();
    expect(site.getByText('Operator Testowy')).toBeTruthy();
    expect(site.getByText('Wspólnota Testowa')).toBeTruthy();
    expect(site.getByText('40 kW')).toBeTruthy();
    expect(site.getByText('PL-TEST-0001')).toBeTruthy();
    expect(site.getByText('Wjazd od ul. Fikcyjnej, klucz u administratora.')).toBeTruthy();
    for (const term of ['Typ obiektu', 'Adres', 'Miejsce i poziom', 'OSD', 'Zarządca', 'Moc przyłączeniowa', 'PPE', 'Notatki']) {
      expect(site.getByText(term)).toBeTruthy();
    }
  });

  it('EVM-018 AC1 a card without optional data shows what there is: no e-mail, no PPE, no parties', async () => {
    await renderPanel(
      PATH,
      detailsApi({
        customer: () => json(200, { ...CUSTOMER, email: null }),
        site: () =>
          json(200, {
            siteType: 'single_family_house',
            street: 'ul. Testowa',
            buildingNumber: '7',
            apartmentNumber: '3',
            postalCode: '00-001',
            city: 'Warszawa',
            distributionSystemOperator: null,
            manager: null,
          }),
      }),
    );
    expect(await screen.findByText('Brak adresu e-mail')).toBeTruthy();
    expect(await screen.findByText('Dom jednorodzinny')).toBeTruthy();
    const site = card('Lokalizacja');
    expect(site.getByText('ul. Testowa 7/3, 00-001 Warszawa')).toBeTruthy();
    for (const absent of ['OSD', 'Zarządca', 'PPE', 'Notatki', 'Moc przyłączeniowa', 'Miejsce i poziom'])
      expect(site.queryByText(absent)).toBeNull();
  });

  it('EVM-018 AC1 a customer or a site that is gone leaves "Brak danych" in the header and a message in the card', async () => {
    const gone = () => problem(404, 'not_found');
    await renderPanel(
      PATH,
      detailsApi({
        header: () => json(200, { ...HEADER, customer: null, site: null, coordinator: null }),
        customer: gone,
        site: gone,
      }),
    );
    expect(await screen.findByText('Nie znaleziono danych klienta.')).toBeTruthy();
    expect(await screen.findByText('Nie znaleziono danych lokalizacji.')).toBeTruthy();
    expect(main().getAllByText('Brak danych')).toHaveLength(3);
    expect(screen.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeTruthy();
  });

  it('EVM-018 AC1 a status this panel does not know is the badge of an unknown value, never the raw code', async () => {
    await renderPanel(PATH, detailsApi({ header: () => json(200, { ...HEADER, status: 'future_status' }) }));
    expect(await screen.findByText('Nieznany status')).toBeTruthy();
    expect(document.body.textContent).not.toContain('future_status');
  });

  it('EVM-018 AC1 the page is reachable by keyboard and has no accessibility violations', async () => {
    await renderPanel(PATH, detailsApi());
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    await screen.findByText('Operator Testowy');
    await screen.findByText('Instalacja zasilająca');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'ZL-2026-0042' }));
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });
});

describe('scope (EVM-018 AC2)', () => {
  it('EVM-018 AC2 "Zakres (9 pozycji)" lists every item with its name and its parameters in Polish', async () => {
    await renderPanel(PATH, detailsApi());
    expect(await screen.findByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Zakres (9 pozycji)' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(9);
    expect(within(list).getByText('Dostawa ładowarki (z oferty)')).toBeTruthy();
    expect(within(list).getByText('AC, 11 kW, 3 fazy')).toBeTruthy();
    expect(within(list).getByText('obwód dedykowany, z WLZ')).toBeTruthy();
    expect(within(list).queryByText('Nieznany status')).toBeNull();
  });

  it('EVM-018 AC2 an unknown set, an unknown value and an unknown key show the badge of an unknown value and never the raw value', async () => {
    const items = [
      scopeItem(1, { id: 'a1', parameters: { currentType: 'hydrogen', powerKw: 11, phases: 3 } }),
      scopeItem(2, { id: 'a2', parameterSetCode: 'future_set', parameters: { secretCode: 'tajne-123' } }),
      scopeItem(3, { id: 'a3', quantity: 2 }),
    ];
    await renderPanel(PATH, detailsApi({ scope: () => json(200, { items }) }));
    const list = await screen.findByRole('list', { name: 'Zakres (3 pozycje)' });
    expect(within(list).getAllByText('Nieznany status')).toHaveLength(2);
    expect(within(list).getByText('11 kW, 3 fazy')).toBeTruthy();
    expect(within(list).getByText('ilość: 2')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/hydrogen|future_set|tajne-123|secretCode/);
  });

  it('EVM-018 AC7 an order without items says so', async () => {
    await renderPanel(PATH, detailsApi({ scope: () => json(200, { items: [] }) }));
    expect(await screen.findByText('Zlecenie nie ma jeszcze pozycji zakresu.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Zakres (0 pozycji)' })).toBeTruthy();
  });
});

describe('not found (EVM-018 AC3; SR-AUTHZ-02, TM-10)', () => {
  it('EVM-018 AC3 a missing order is ONE screen with the tab title "Nie znaleziono · EVia Manager", no data and a way back to the list', async () => {
    const gone = () => problem(404, 'not_found');
    const { history } = await renderPanel(PATH, detailsApi({ header: gone, scope: gone, customer: gone, site: gone }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeTruthy();
    expect(screen.getByText('Mogło zostać usunięte albo nie masz do niego dostępu.')).toBeTruthy();
    expect(document.title).toBe('Nie znaleziono · EVia Manager');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' }));
    expect(document.body.textContent).not.toMatch(/ZL-2026-0042|Jan Przykładowy|ul. Testowa/);
    await userEvent.click(screen.getByRole('button', { name: 'Wróć do listy' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/work-orders');
    });
  });

  it('EVM-018 AC3 an order that was shown and is then gone (deleted meanwhile) shows nothing of it, and the four entries leave the memory of the tab', async () => {
    let gone = false;
    const queryClient = createQueryClient();
    const api = detailsApi({
      header: () => (gone ? problem(404, 'not_found') : json(200, HEADER)),
      scope: () => (gone ? problem(404, 'not_found') : json(200, { items: SCOPE_ITEMS })),
    });
    await renderPanel(PATH, api, { queryClient });
    await screen.findByText('Instalacja zasilająca');
    await screen.findByText('Operator Testowy');
    const keys = queryClient.getQueryCache().findAll({ predicate: (query) => query.queryKey[1] === ORDER_ID });
    expect(keys).toHaveLength(4);

    gone = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['work-order-header', ORDER_ID] });
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/ZL-2026-0042|Jan Przykładowy|Operator Testowy|Instalacja zasilająca/);
    await waitFor(() => {
      const left = queryClient
        .getQueryCache()
        .findAll({ predicate: (query) => query.queryKey[1] === ORDER_ID && query.state.data !== undefined });
      expect(left).toEqual([]);
    });
  });

  it('EVM-018 AC3 a scope that is 404 (an item of another order asked through this one never is) takes the whole order down', async () => {
    await renderPanel(PATH, detailsApi({ scope: () => problem(404, 'not_found') }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeTruthy();
  });
});

describe('notes as text (EVM-018 AC4; SR-WEB-03)', () => {
  it('EVM-018 AC4 <script> and javascript: stay text and nothing runs; https, tel and mailto are links', async () => {
    const alert = vi.spyOn(globalThis, 'alert').mockImplementation(() => undefined);
    await renderPanel(
      PATH,
      detailsApi({
        site: () =>
          json(200, {
            ...SITE,
            notes:
              '<script>alert(1)</script> javascript:alert(1) https://example.invalid/mapa tel:+48600000002 mailto:biuro@example.invalid',
          }),
      }),
    );
    const site = await waitFor(() => {
      const found = card('Lokalizacja');
      expect(found.getByText(/javascript:alert\(1\)/)).toBeTruthy();
      return found;
    });
    expect(document.querySelector('script')).toBeNull();
    expect(site.getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy();
    const hrefs = site.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.invalid/mapa', 'tel:+48600000002', 'mailto:biuro@example.invalid']);
    for (const link of site.getAllByRole('link')) expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(alert).not.toHaveBeenCalled();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it('EVM-018 AC4 the free texts of the order, the customer and the scope are text too', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    await renderPanel(
      PATH,
      detailsApi({
        header: () => json(200, { ...HEADER, title: markup, customer: { ...HEADER.customer, displayName: markup } }),
        customer: () => json(200, { ...CUSTOMER, displayName: markup, email: 'a@example.invalid?cc=x@example.invalid' }),
        scope: () => json(200, { items: [scopeItem(3, { name: markup })] }),
      }),
    );
    await screen.findByRole('list', { name: 'Zakres (1 pozycja)' });
    await screen.findByRole('link', { name: /a@example.invalid/ });
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getAllByText(markup).length).toBeGreaterThan(2);
    expect(screen.getByRole('link', { name: /a@example.invalid/ }).getAttribute('href')).not.toContain('?');
  });
});

describe('minimisation (EVM-018 AC5; SR-DATA-03, SR-WEB-05)', () => {
  it('EVM-018 AC5 the page asks for exactly four reads anchored in the order — only the UUID in the path, nothing in the query — and the tab title is the number', async () => {
    const api = detailsApi();
    await renderPanel(PATH, api);
    await screen.findByText('Instalacja zasilająca');
    await screen.findByText('Operator Testowy');
    const reads = api.requests.filter((request) => request.path.startsWith('/api/v1/work-orders/'));
    expect(reads.map((request) => `${request.method} ${request.path}`).sort()).toEqual(
      [`GET ${BASE}`, `GET ${BASE}/customer`, `GET ${BASE}/scope-items`, `GET ${BASE}/site`].sort(),
    );
    for (const request of reads) expect(request.query.size).toBe(0);
    expect(document.title).toBe('ZL-2026-0042 · EVia Manager');
    expect(document.title).not.toMatch(/Jan|Przykładowy|Testowa|Warszawa/);
  });

  it('EVM-018 AC5 nothing of the order reaches a store of the browser', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    await renderPanel(PATH, detailsApi());
    await screen.findByText('Operator Testowy');
    await screen.findByText('Instalacja zasilająca');
    expect(local).not.toHaveBeenCalled();
    expect(globalThis.localStorage.length).toBe(0);
    expect(globalThis.sessionStorage.length).toBe(0);
  });
});

describe('roles (EVM-018 AC6; SR-AUTHZ-05)', () => {
  it.each([
    ['administrator', ACTIVE_SESSION],
    ['editor', roleSession('editor')],
    ['read_only', roleSession('read_only')],
  ] as const)('EVM-018 AC6 %s sees all sections and the page has no action that changes anything', async (_role, session) => {
    await renderPanel(PATH, detailsApi({}, session));
    expect(await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeTruthy();
    await screen.findByText('Operator Testowy');
    await screen.findByText('Instalacja zasilająca');
    expect(card('Klient').getByText('Jan Przykładowy')).toBeTruthy();
    expect(card('Lokalizacja').getByText('PL-TEST-0001')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Zakres (9 pozycji)' })).toBeTruthy();
    // no "Edytuj", "Dodaj" — those arrive with other stories; Read-only never sees actions
    expect(screen.queryAllByRole('button').map((button) => button.textContent)).not.toContain('Edytuj');
    expect(screen.queryByRole('button', { name: /Edytuj|Dodaj|Usuń|Przejdź do klienta/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Edytuj/ })).toBeNull();
    // "Przejdź do klienta" (EVM-039 AC2) is navigation, not a change: all three roles have it, built from the identifier only
    expect(card('Klient').getByRole('link', { name: 'Przejdź do klienta' }).getAttribute('href')).toBe(
      '/customers/01968f3e-0000-7000-8000-00000000aaaa',
    );
  });

  it('EVM-018 AC6 a 401 (the session ended) clears the data of the order from the memory of the tab and sends the tab to the login page', async () => {
    const queryClient = createQueryClient();
    let expired = false;
    const api = detailsApi(
      { scope: () => (expired ? problem(401, 'session_expired') : json(200, { items: SCOPE_ITEMS })) },
      ACTIVE_SESSION,
      {},
    );
    api.set(SESSION_ROUTE, () => (expired ? problem(401, 'session_expired') : json(200, ACTIVE_SESSION)));
    await renderPanel(PATH, api, { queryClient });
    await screen.findByText('Instalacja zasilająca');
    expired = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['work-order-scope', ORDER_ID] }).catch(() => undefined);
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeTruthy();
    expect(
      queryClient.getQueryCache().findAll({ predicate: (query) => query.queryKey[1] === ORDER_ID && query.state.data !== undefined }),
    ).toEqual([]);
    expect(document.body.textContent).not.toMatch(/Jan Przykładowy|Operator Testowy/);
  });
});

describe('states (EVM-018 AC7)', () => {
  it('EVM-018 AC7 loading: the header first (a skeleton with a status), then the header and the skeletons of the sections', async () => {
    const header = deferred();
    const scope = deferred();
    const customer = deferred();
    const site = deferred();
    await renderPanel(
      PATH,
      detailsApi({ header: () => header.promise, scope: () => scope.promise, customer: () => customer.promise, site: () => site.promise }),
      { heading: false },
    );
    const status = await screen.findByText('Wczytujemy zlecenie…');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.closest('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(document.title).toBe('Zlecenie · EVia Manager');

    await act(async () => {
      header.resolve(json(200, HEADER));
      await Promise.resolve();
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeTruthy();
    expect(screen.getAllByText('Wczytujemy sekcję…').length).toBe(3);
    expect(document.querySelectorAll('[aria-busy="true"]').length).toBe(3);

    await act(async () => {
      scope.resolve(json(200, { items: SCOPE_ITEMS }));
      customer.resolve(json(200, CUSTOMER));
      site.resolve(json(200, SITE));
      await Promise.resolve();
    });
    expect(await screen.findByText('Operator Testowy')).toBeTruthy();
    expect(document.querySelectorAll('[aria-busy="true"]').length).toBe(0);
  });

  it('EVM-018 AC7 a section that fails shows an alert with "Spróbuj ponownie" inside itself; the other sections work; the retry reads only that section', async () => {
    let fail = true;
    const api = detailsApi({ scope: () => (fail ? problem(500, 'internal_error') : json(200, { items: SCOPE_ITEMS })) });
    await renderPanel(PATH, api);
    const alert = await screen.findByText('Nie udało się wczytać zakresu zlecenia.');
    expect(alert.closest('[role="alert"]')).toBeTruthy();
    expect(card('Klient').getByText('Jan Przykładowy')).toBeTruthy();
    expect(await screen.findByText('Operator Testowy')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeTruthy();
    fail = false;
    const before = api.requests.length;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeTruthy();
    const after = api.requests.slice(before).map((request) => `${request.method} ${request.path}`);
    expect(after).toEqual([`GET ${BASE}/scope-items`]);
  });

  it('EVM-018 AC7 the cards fail on their own as well, each with its own retry', async () => {
    let fail = true;
    const api = detailsApi({
      customer: () => (fail ? problem(500, 'internal_error') : json(200, CUSTOMER)),
      site: () => (fail ? problem(500, 'internal_error') : json(200, SITE)),
    });
    await renderPanel(PATH, api);
    expect(await screen.findByText('Nie udało się wczytać danych klienta.')).toBeTruthy();
    expect(await screen.findByText('Nie udało się wczytać danych lokalizacji.')).toBeTruthy();
    fail = false;
    await userEvent.click(within(screen.getByRole('region', { name: 'Klient' })).getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await within(screen.getByRole('region', { name: 'Klient' })).findByText('Jan Przykładowy')).toBeTruthy();
    await userEvent.click(within(screen.getByRole('region', { name: 'Lokalizacja' })).getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await within(screen.getByRole('region', { name: 'Lokalizacja' })).findByText('Operator Testowy')).toBeTruthy();
  });

  it('EVM-018 AC7 the whole order that cannot be read says "Nie udało się wczytać zlecenia." with "Spróbuj ponownie"', async () => {
    let fail = true;
    const api = detailsApi({ header: () => (fail ? problem(500, 'internal_error') : json(200, HEADER)) });
    await renderPanel(PATH, api);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie udało się wczytać zlecenia.' })).toBeTruthy();
    expect(document.title).toBe('Zlecenie · EVia Manager');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeTruthy();
  });

  it('EVM-018 AC7 offline the data of the tab stays under the banner "Dane mogą być nieaktualne (z 14:05)"; when the connection returns a failed section is read again', async () => {
    let offline = false;
    const api = detailsApi({
      scope: () => {
        if (offline) throw new TypeError('Failed to fetch');
        return json(200, { items: SCOPE_ITEMS });
      },
    });
    const { container } = await renderPanel(PATH, api);
    await screen.findByText('Instalacja zasilająca');
    expect(screen.queryByText(/Dane mogą być nieaktualne/)).toBeNull();

    offline = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await act(async () => {
      globalThis.dispatchEvent(new Event('offline'));
      await Promise.resolve();
    });
    const banner = await screen.findByText(/Dane mogą być nieaktualne \(z \d{2}:\d{2}\)/);
    expect(banner.closest('[role="status"]')).toBeTruthy();
    expect(screen.getByText('Instalacja zasilająca')).toBeTruthy();
    expect(card('Klient').getByText('Jan Przykładowy')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);

    offline = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await act(async () => {
      globalThis.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByText(/Dane mogą być nieaktualne/)).toBeNull();
    });
  });

  it('EVM-018 AC7 offline with nothing in the memory of the tab, the whole-order error is shown (there is no data to show)', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const down = () => {
      throw new TypeError('Failed to fetch');
    };
    await renderPanel(PATH, detailsApi({ header: down, scope: down, customer: down, site: down }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie udało się wczytać zlecenia.' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
  });
});
