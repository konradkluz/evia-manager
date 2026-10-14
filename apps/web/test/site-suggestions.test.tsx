import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts } from '../src/session/draft-store.ts';
import { axeViolations } from './a11y.ts';
import { json, problem, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';

const userEvent = userEventDefault.setup({ delay: null });
const NEW = '/work-orders/new';
const CUSTOMER_SEARCH = 'POST /api/v1/customers/search';
const SITE_SEARCH = 'POST /api/v1/sites/search';
const LIST = 'GET /api/v1/work-orders';
const SITE = (id: string) => `GET /api/v1/sites/${id}`;

const JAN = { id: '01968f3e-0000-7000-8000-00000000aaaa', displayName: 'Jan Przykładowy', phone: '+48600000001' };
const EWA = { id: '01968f3e-0000-7000-8000-00000000abab', displayName: 'Ewa Testowa', phone: '+48600000002' };
const GARAGE_ID = '01968f3e-0000-7000-8000-00000000bbbb';
const HOUSE_ID = '01968f3e-0000-7000-8000-00000000cccc';
const GARAGE_LINE = { id: GARAGE_ID, siteType: 'multi_family_garage', city: 'Warszawa', street: 'ul. Testowa', buildingNumber: '7' };
const HOUSE_LINE = { id: HOUSE_ID, siteType: 'single_family_house', city: 'Łódź', street: 'ul. Przykładowa', buildingNumber: '2' };
const GARAGE_CARD = {
  ...GARAGE_LINE,
  postalCode: '00-001',
  parkingSpotNumber: '15',
  garageLevel: '-1',
  notes: 'Notatka testowa',
  connectionPowerKw: 11,
  version: 1,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

const order = (index: number, site: object | null, customer: object | null = { id: JAN.id, displayName: JAN.displayName }) => ({
  id: `01968f3e-0000-7000-8000-0000000100${String(index).padStart(2, '0')}`,
  number: `ZL-2026-00${String(index).padStart(2, '0')}`,
  title: 'Montaż wallboxa',
  status: 'new',
  coordinator: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  customer,
  site,
});
const page =
  (...items: object[]): Handler =>
  () =>
    json(200, { items, nextCursor: null });

/** The orders of Jan: newest first — two in the garage, one in the house. */
const JAN_ORDERS = [order(3, GARAGE_LINE), order(2, HOUSE_LINE), order(1, GARAGE_LINE)];

function suggestionApi(routes: Record<string, Handler> = {}) {
  return activeSessionApi({
    [CUSTOMER_SEARCH]: page(JAN, EWA),
    [SITE_SEARCH]: page(),
    'POST /api/v1/parties/search': page(),
    [LIST]: page(...JAN_ORDERS),
    [SITE(GARAGE_ID)]: () => json(200, GARAGE_CARD, { ETag: '"1"' }),
    ...routes,
  });
}
const suggestionCalls = (api: ReturnType<typeof suggestionApi>) => api.calls(LIST).filter((call) => call.query.has('customerId'));

async function chooseCustomer(name: string) {
  await userEvent.type(screen.getByRole('combobox', { name: 'Klient' }), name.slice(0, 3));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}
const heading = (count: number) => screen.findByRole('heading', { name: `Lokalizacje z poprzednich zleceń klienta (${String(count)})` });

afterEach(() => {
  vi.restoreAllMocks();
  clearDrafts();
});

describe('W-05 "2. Lokalizacja": the locations of the earlier orders of the customer (EVM-043)', () => {
  it('EVM-043 AC1 a customer with orders in two locations: "(2)", the address and the type of each, the choice sets "Istniejąca lokalizacja"; ONE list and ONE site read; nothing in the stores of the browser', async () => {
    const api = suggestionApi();
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    await heading(2);
    const list = screen.getByRole('list', { name: 'Lokalizacje z poprzednich zleceń klienta (2)' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'ul. Testowa 7, Warszawa · Garaż w budynku wielorodzinnymWybierz',
      'ul. Przykładowa 2, Łódź · Dom jednorodzinnyWybierz',
    ]);
    expect(await axeViolations(document.body)).toEqual([]);

    const [call, ...others] = suggestionCalls(api);
    expect(others).toEqual([]);
    expect(Object.fromEntries(call?.query ?? [])).toEqual({ customerId: JAN.id, sort: '-createdAt', limit: '100' });

    await userEvent.click(screen.getByRole('button', { name: 'Wybierz lokalizację: ul. Testowa 7, Warszawa' }));
    expect(await screen.findByText('ul. Testowa 7, 00-001 Warszawa · Garaż w budynku wielorodzinnym · miejsce 15, poziom -1')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Istniejąca lokalizacja' }).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Zmień lokalizację' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Lokalizacje z poprzednich zleceń/ })).toBeNull();
    expect(api.calls(SITE(GARAGE_ID))).toHaveLength(1);
    expect(JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)])).not.toMatch(/Testowa|Notatka|00-001/);

    // "Zmień lokalizację" and the other mode show the list again WITHOUT reading it again (limit 300/min).
    await userEvent.click(screen.getByRole('button', { name: 'Zmień lokalizację' }));
    await heading(2);
    await userEvent.click(screen.getByRole('radio', { name: 'Nowa lokalizacja' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Istniejąca lokalizacja' }));
    await heading(2);
    expect(suggestionCalls(api)).toHaveLength(1);
  });

  it('EVM-043 AC1 the card of the site gives the form ONLY the fields of a chosen site — no notes, no power', async () => {
    const api = suggestionApi();
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    await userEvent.click(await screen.findByRole('button', { name: 'Wybierz lokalizację: ul. Testowa 7, Warszawa' }));
    await screen.findByRole('button', { name: 'Zmień lokalizację' });
    const stored = JSON.stringify([...Object.entries(sessionStorage), ...Object.entries(localStorage)]);
    expect(stored).not.toContain('Notatka testowa');
    expect(stored).not.toContain('connectionPowerKw');
  });

  it('EVM-043 AC2 a customer without orders: no suggestion and no message — the section works as in EVM-021', async () => {
    const api = suggestionApi({ [LIST]: page() });
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    await waitFor(() => {
      expect(suggestionCalls(api)).toHaveLength(1);
    });
    expect(screen.queryByText(/poprzednich zleceń/)).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Lokalizacja' })).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: 'Nowa lokalizacja' }));
    expect(screen.getByRole('combobox', { name: 'Typ obiektu' })).toBeTruthy();
  });

  it('EVM-043 AC3 an order without a visible site or with a deleted customer is not a suggestion; a site of several orders appears once, in the order of the newest order', async () => {
    const api = suggestionApi({
      [LIST]: page(
        order(5, null),
        order(4, GARAGE_LINE, { deleted: true }),
        order(3, HOUSE_LINE),
        order(2, GARAGE_LINE),
        order(1, HOUSE_LINE),
      ),
    });
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    await heading(2);
    const rows = within(screen.getByRole('list', { name: /Lokalizacje z poprzednich zleceń/ })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent.split(' · ')[0])).toEqual(['ul. Przykładowa 2, Łódź', 'ul. Testowa 7, Warszawa']);
  });

  it('EVM-043 AC3 a site that is gone meanwhile (404 of the read): a message, the list is read again, no site is set', async () => {
    let reads = 0;
    const api = suggestionApi({
      [LIST]: () => json(200, { items: reads++ === 0 ? JAN_ORDERS : [order(2, HOUSE_LINE)], nextCursor: null }),
      [SITE(GARAGE_ID)]: () => problem(404, 'not_found'),
    });
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    await userEvent.click(await screen.findByRole('button', { name: 'Wybierz lokalizację: ul. Testowa 7, Warszawa' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Ta lokalizacja nie jest już dostępna');
    await heading(1);
    expect(suggestionCalls(api)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Zmień lokalizację' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Lokalizacja' })).toBeTruthy();
  });

  it('EVM-043 AC4 offline: the suggestion is unavailable (a notice, nothing sent) and the form works as in EVM-021; the connection back shows the list without a new read', async () => {
    const api = suggestionApi();
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    await heading(2);
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(await screen.findByText('Podpowiedź lokalizacji jest niedostępna bez połączenia.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: /Lokalizacje z poprzednich zleceń/ })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Lokalizacja' })).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
    onLine.mockReturnValue(true);
    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });
    await heading(2);
    expect(suggestionCalls(api)).toHaveLength(1);
    expect(api.calls(SITE(GARAGE_ID))).toHaveLength(0);
  });

  it('EVM-043 AC4 a 5xx of the list: a notice and no automatic repeat; the button "Spróbuj ponownie" reads once more', async () => {
    let attempts = 0;
    const api = suggestionApi({
      [LIST]: () => (attempts++ === 0 ? problem(500, 'internal_error') : json(200, { items: JAN_ORDERS, nextCursor: null })),
    });
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nie udało się wczytać lokalizacji z poprzednich zleceń klienta.');
    expect(suggestionCalls(api)).toHaveLength(1);
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }));
    await heading(2);
    expect(suggestionCalls(api)).toHaveLength(2);
  });

  it('EVM-043 AC4 a 429 of the list is quiet: no repeat, no button, no text of the server', async () => {
    const api = suggestionApi({
      [LIST]: () => problem(429, 'rate_limited', { detail: 'tajny szczegół serwera' }, { 'Retry-After': '30' }),
    });
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    expect(await screen.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeTruthy();
    expect(suggestionCalls(api)).toHaveLength(1);
    expect(screen.queryByText(/tajny szczegół/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Spróbuj ponownie' })).toBeNull();
  });

  it('EVM-043 AC4 a 403 of the list: nothing is shown and the form works', async () => {
    const api = suggestionApi({ [LIST]: () => problem(403, 'forbidden') });
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    await waitFor(() => {
      expect(suggestionCalls(api)).toHaveLength(1);
    });
    expect(screen.queryByText(/poprzednich zleceń/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Lokalizacja' })).toBeTruthy();
  });

  it('EVM-043 AC1 a double click on "Wybierz" is ONE read and the buttons are blocked meanwhile', async () => {
    let release: (response: Response) => void = () => undefined;
    const api = suggestionApi({
      [SITE(GARAGE_ID)]: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    const choose = await screen.findByRole('button', { name: 'Wybierz lokalizację: ul. Testowa 7, Warszawa' });
    await userEvent.dblClick(choose);
    await waitFor(() => {
      expect(api.calls(SITE(GARAGE_ID))).toHaveLength(1);
    });
    expect(screen.getByRole('button', { name: 'Wybierz lokalizację: ul. Przykładowa 2, Łódź' }).getAttribute('aria-disabled')).toBe('true');
    release(json(200, GARAGE_CARD, { ETag: '"1"' }));
    await screen.findByRole('button', { name: 'Zmień lokalizację' });
    expect(api.calls(SITE(GARAGE_ID))).toHaveLength(1);
  });

  it('EVM-043 AC1 the loading state: a status for assistive technology and no list yet', async () => {
    let release: (response: Response) => void = () => undefined;
    const api = suggestionApi({
      [LIST]: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    expect(await screen.findByText('Wczytujemy lokalizacje z poprzednich zleceń klienta…')).toBeTruthy();
    expect(screen.queryByRole('list', { name: /Lokalizacje z poprzednich zleceń/ })).toBeNull();
    expect(await axeViolations(document.body)).toEqual([]);
    release(json(200, { items: JAN_ORDERS, nextCursor: null }));
    await heading(2);
  });

  it('EVM-043 AC1 another customer: ITS list is read (one request each) and the first one is not shown', async () => {
    const api = suggestionApi({
      [LIST]: (request) =>
        json(200, {
          items:
            request.query.get('customerId') === JAN.id ? JAN_ORDERS : [order(9, HOUSE_LINE, { id: EWA.id, displayName: EWA.displayName })],
          nextCursor: null,
        }),
    });
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    await heading(2);
    await userEvent.click(screen.getByRole('button', { name: 'Zmień klienta' }));
    await chooseCustomer('Ewa Testowa');
    await heading(1);
    expect(suggestionCalls(api).map((call) => call.query.get('customerId'))).toEqual([JAN.id, EWA.id]);
    expect(screen.queryByText(/ul\. Testowa 7/)).toBeNull();
  });
  it('EVM-043 AC4 a 429 or a failure of the site read: a message, no site is set, no automatic repeat; the next click reads once more', async () => {
    let attempts = 0;
    const api = suggestionApi({
      [SITE(GARAGE_ID)]: () => {
        attempts += 1;
        if (attempts === 1) return problem(429, 'rate_limited', {}, { 'Retry-After': '20' });
        if (attempts === 2) return problem(500, 'internal_error');
        return json(200, GARAGE_CARD, { ETag: '"1"' });
      },
    });
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    const choose = () => screen.findByRole('button', { name: 'Wybierz lokalizację: ul. Testowa 7, Warszawa' });
    await userEvent.click(await choose());
    expect((await screen.findByRole('alert')).textContent).toContain('Zbyt wiele zapytań. Spróbuj ponownie za 20 s.');
    expect(api.calls(SITE(GARAGE_ID))).toHaveLength(1);
    await userEvent.click(await choose());
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Nie udało się wybrać lokalizacji.');
    });
    expect(screen.queryByRole('button', { name: 'Zmień lokalizację' })).toBeNull();
    await userEvent.click(await choose());
    await screen.findByRole('button', { name: 'Zmień lokalizację' });
    expect(api.calls(SITE(GARAGE_ID))).toHaveLength(3);
  });

  it('EVM-043 AC1 the apartment and an unknown type of the object: the chosen site keeps the apartment, the list shows a neutral label — never the raw code', async () => {
    const api = suggestionApi({
      [LIST]: page(order(1, { ...HOUSE_LINE, siteType: 'castle' })),
      [SITE(HOUSE_ID)]: () =>
        json(200, {
          ...HOUSE_LINE,
          siteType: 'single_family_house',
          apartmentNumber: '4',
          postalCode: '90-001',
          version: 1,
          createdAt: 'x',
          updatedAt: 'x',
        }),
    });
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    await heading(1);
    expect(screen.getByText('ul. Przykładowa 2, Łódź · Typ obiektu nieznany')).toBeTruthy();
    expect(screen.queryByText(/castle/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Wybierz lokalizację: ul. Przykładowa 2, Łódź' }));
    expect(await screen.findByText('ul. Przykładowa 2/4, 90-001 Łódź · Dom jednorodzinny')).toBeTruthy();
  });

  it('EVM-043 AC1 leaving the section while a site is read: the answer is ignored and sets nothing', async () => {
    let release: (response: Response) => void = () => undefined;
    const api = suggestionApi({
      [SITE(GARAGE_ID)]: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    await renderPanel(NEW, api);
    await chooseCustomer('Jan Przykładowy');
    await userEvent.click(await screen.findByRole('button', { name: 'Wybierz lokalizację: ul. Testowa 7, Warszawa' }));
    await waitFor(() => {
      expect(api.calls(SITE(GARAGE_ID))).toHaveLength(1);
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Nowa lokalizacja' }));
    release(json(200, GARAGE_CARD, { ETag: '"1"' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Istniejąca lokalizacja' }));
    await heading(2);
    expect(screen.queryByRole('button', { name: 'Zmień lokalizację' })).toBeNull();
  });
});
