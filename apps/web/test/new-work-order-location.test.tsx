import type { CurrentSession } from '@evia/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts } from '../src/session/draft-store.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';

// No pause between keystrokes: typing many characters per test would otherwise run close to the 5 s limit on a slow CI runner.
const userEvent = userEventDefault.setup({ delay: null });
const SITE_SEARCH = 'POST /api/v1/sites/search';
const SITE_CREATE = 'POST /api/v1/sites';
const PARTY_SEARCH = 'POST /api/v1/parties/search';
const PARTY_CREATE = 'POST /api/v1/parties';
const NEW = '/work-orders/new';
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOTES_WARNING = 'Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów. Notatki zobaczą technicy w aplikacji.';

const GARAGE = {
  id: '01968f3e-0000-7000-8000-00000000bbbb',
  siteType: 'multi_family_garage',
  street: 'ul. Testowa',
  buildingNumber: '7',
  postalCode: '00-001',
  city: 'Warszawa',
  parkingSpotNumber: '15',
  garageLevel: '-1',
};
const GARAGE_LINE = 'ul. Testowa 7, 00-001 Warszawa · Garaż w budynku wielorodzinnym · miejsce 15, poziom -1';
const HOUSE = {
  id: '01968f3e-0000-7000-8000-00000000cccc',
  siteType: 'single_family_house',
  street: 'ul. Przykładowa',
  buildingNumber: '2',
  apartmentNumber: '4',
  postalCode: '90-001',
  city: 'Łódź',
};
const OSD = {
  id: '01968f3e-0000-7000-8000-00000000dddd',
  kind: 'distribution_system_operator',
  legalForm: 'organization',
  displayName: 'Operator Testowy',
};
const MANAGER = {
  id: '01968f3e-0000-7000-8000-00000000eeee',
  kind: 'housing_community',
  legalForm: 'organization',
  displayName: 'Wspólnota Testowa',
};

const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } });

const items =
  (...found: object[]): Handler =>
  () =>
    json(200, { items: found, nextCursor: null });

function locationApi(routes: Record<string, Handler> = {}, session: CurrentSession = ACTIVE_SESSION) {
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    [SITE_SEARCH]: items(),
    [PARTY_SEARCH]: items(),
    ...routes,
  });
}

/** The answer of the API to a saved site: what was sent plus the fields of the server. */
function savedSite(body: string): Response {
  const sent = parseBody(body) as Record<string, unknown>;
  return json(201, { ...sent, version: 1, createdAt: '2026-10-07T10:00:00.000Z', updatedAt: '2026-10-07T10:00:00.000Z' }, { ETag: '"1"' });
}

function savedParty(body: string): Response {
  const sent = parseBody(body) as Record<string, unknown>;
  return json(201, { ...sent, version: 1, createdAt: '2026-10-07T10:00:00.000Z', updatedAt: '2026-10-07T10:00:00.000Z' }, { ETag: '"1"' });
}

afterEach(() => {
  vi.restoreAllMocks();
  clearDrafts();
});

const siteField = () => screen.getByRole('combobox', { name: 'Lokalizacja' });
const queryOf = (call: { body: string } | undefined) => (parseBody(call?.body ?? '') as { query: string }).query;

async function chooseNewSite() {
  await userEvent.click(screen.getByRole('radio', { name: 'Nowa lokalizacja' }));
}

const textbox = (name: string) => screen.getByRole<HTMLInputElement>('textbox', { name });

async function fillHouse(values = { street: 'ul. Testowa', building: '7', postal: '00-001', city: 'Warszawa' }) {
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'Dom jednorodzinny');
  await userEvent.type(textbox('Ulica'), values.street);
  await userEvent.type(textbox('Nr budynku'), values.building);
  await userEvent.type(textbox('Kod pocztowy'), values.postal);
  await userEvent.type(textbox('Miasto'), values.city);
}

const saveSite = () => userEvent.click(screen.getByRole('button', { name: 'Zapisz lokalizację' }));

describe('W-05 section "2. Lokalizacja": existing site (EVM-021 AC1)', () => {
  it('EVM-021 AC1 the phrase goes in the body of a POST with the CSRF token — not in the address, the title of the tab or the console — and the result shows the type, the address and the parking spot', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const api = locationApi({ [SITE_SEARCH]: items(GARAGE) });
    const { history } = await renderPanel(NEW, api);
    expect(screen.getByRole('group', { name: '2. Lokalizacja' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Istniejąca lokalizacja' }).checked).toBe(true);
    await userEvent.type(siteField(), 'testowa 7');
    const option = await screen.findByRole('option', { name: /ul\. Testowa 7/ });
    expect(option.textContent).toBe('ul. Testowa 7, 00-001 WarszawaGaraż w budynku wielorodzinnym · miejsce 15, poziom -1');
    const [call, ...others] = api.calls(SITE_SEARCH);
    expect(others).toEqual([]);
    expect(call?.path).toBe('/api/v1/sites/search');
    expect(call?.query.size).toBe(0);
    expect(parseBody(call?.body ?? '')).toEqual({ query: 'testowa 7' });
    expect(call?.headers.get('X-CSRF-Token')).toBe('csrf-active');
    expect(history.location.href).toBe(NEW);
    expect(document.title).toBe('Nowe zlecenie · EVia Manager');
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toContain('testowa');
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-021 AC1 polish letters and case are not changed by the panel — "Lodz" is sent as typed and the site in Łódź is found', async () => {
    const api = locationApi({
      [SITE_SEARCH]: (request) => json(200, { items: queryOf(request) === 'Lodz' ? [HOUSE] : [], nextCursor: null }),
    });
    await renderPanel(NEW, api);
    await userEvent.type(siteField(), 'Lodz');
    const option = await screen.findByRole('option', { name: /ul\. Przykładowa 2\/4, 90-001 Łódź/ });
    expect(option.textContent).toContain('Dom jednorodzinny');
    expect(option.textContent).not.toContain('miejsce');
    expect(api.calls(SITE_SEARCH).map(queryOf)).toEqual(['Lodz']);
  });

  it('EVM-021 AC1 a phrase shorter than 3 characters is not sent and the field says why; one of more than 100 is not sent either', async () => {
    const api = locationApi({ [SITE_SEARCH]: items(GARAGE) });
    await renderPanel(NEW, api);
    await userEvent.type(siteField(), 'te');
    expect(screen.getByText('Wpisz co najmniej 3 znaki, aby wyszukać.')).toBeTruthy();
    expect(api.calls(SITE_SEARCH)).toHaveLength(0);
    await userEvent.type(siteField(), 's');
    await screen.findByRole('option', { name: /ul\. Testowa 7/ });
    expect(api.calls(SITE_SEARCH).map(queryOf)).toEqual(['tes']);
    fireEvent.change(siteField(), { target: { value: 'a'.repeat(101) } });
    expect(screen.getByText('Fraza może mieć najwyżej 100 znaków.')).toBeTruthy();
    expect(api.calls(SITE_SEARCH)).toHaveLength(1);
  });

  it('EVM-021 AC1 choosing a site shows it, moves the focus there and "Zmień lokalizację" brings the field back; the keyboard works too', async () => {
    await renderPanel(NEW, locationApi({ [SITE_SEARCH]: items(GARAGE) }));
    await userEvent.type(siteField(), 'testowa');
    await screen.findByRole('option', { name: /ul\. Testowa 7/ });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('combobox', { name: 'Lokalizacja' })).toBeNull();
    const line = screen.getByText(GARAGE_LINE);
    expect(document.activeElement).toBe(line);
    expect(screen.getByText(/Szkic w tej karcie · \d{2}:\d{2}/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Zmień lokalizację' }));
    expect(document.activeElement).toBe(siteField());
    expect(screen.queryByText(GARAGE_LINE)).toBeNull();
  });
});

describe('W-05 states of the search of sites (EVM-021 AC7)', () => {
  it('EVM-021 AC7 while the answer is awaited the popup shows 3 skeleton rows and announces the search', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = locationApi({
      [SITE_SEARCH]: async () => {
        await gate;
        return json(200, { items: [GARAGE], nextCursor: null });
      },
    });
    await renderPanel(NEW, api);
    await userEvent.type(siteField(), 'abc');
    const popup = document.getElementById(siteField().getAttribute('aria-controls') ?? '');
    expect(popup?.getAttribute('aria-busy')).toBe('true');
    expect(popup?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
    expect(screen.getAllByRole('status').some((status) => status.textContent === 'Szukamy lokalizacji…')).toBe(true);
    release();
    await screen.findByRole('option', { name: /ul\. Testowa 7/ });
    expect(screen.getAllByRole('status').some((status) => status.textContent === 'Wyniki wyszukiwania: 1.')).toBe(true);
  });

  it('EVM-021 AC7 no results: "Brak wyników dla „…”." with the action "Nowa lokalizacja" that opens the form of a new site', async () => {
    await renderPanel(NEW, locationApi());
    await userEvent.type(siteField(), 'Nigdzie');
    expect(await screen.findByText('Brak wyników dla „Nigdzie”.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Nowa lokalizacja' }));
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Nowa lokalizacja' }).checked).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Typ obiektu' })).toBeTruthy();
  });

  it('EVM-021 AC7 offline: "Wyszukiwanie wymaga połączenia." and nothing is sent', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const api = locationApi();
    await renderPanel(NEW, api);
    await userEvent.type(siteField(), 'abc');
    expect(await screen.findByText('Wyszukiwanie wymaga połączenia.')).toBeTruthy();
    expect(api.calls(SITE_SEARCH)).toHaveLength(0);
  });

  it('EVM-021 AC7 429: "Zbyt wiele zapytań…" with the time from Retry-After', async () => {
    const api = locationApi({ [SITE_SEARCH]: () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }) });
    await renderPanel(NEW, api);
    await userEvent.type(siteField(), 'abc');
    expect(await screen.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeTruthy();
  });

  it('EVM-021 AC7 a server error says so and "Spróbuj ponownie" asks again', async () => {
    let calls = 0;
    const api = locationApi({
      [SITE_SEARCH]: () => {
        calls += 1;
        return calls === 1 ? problem(500, 'internal_error') : json(200, { items: [GARAGE], nextCursor: null });
      },
    });
    await renderPanel(NEW, api);
    await userEvent.type(siteField(), 'abc');
    expect(await screen.findByText('Nie udało się wyszukać lokalizacji. Spróbuj ponownie.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('option', { name: /ul\. Testowa 7/ })).toBeTruthy();
    expect(api.calls(SITE_SEARCH)).toHaveLength(2);
  });
});

describe('W-05 new site (EVM-021 AC2)', () => {
  it('EVM-021 AC2 a house is saved with its own request: UUIDv7, Idempotency-Key, no customer — and chosen, with a toast', async () => {
    const api = locationApi({ [SITE_CREATE]: (request) => savedSite(request.body) });
    await renderPanel(NEW, api);
    await chooseNewSite();
    expect(screen.queryByRole('textbox', { name: /Nr miejsca postojowego/ })).toBeNull();
    await fillHouse();
    await userEvent.type(textbox('Nr lokalu (opcjonalnie)'), '3');
    await userEvent.type(textbox('Moc przyłączeniowa (opcjonalnie)'), '11,5');
    await userEvent.type(textbox('PPE (opcjonalnie)'), 'PPE-TEST-0001');
    await userEvent.type(textbox('Notatki do lokalizacji (opcjonalnie)'), 'Wejście od podwórza.');
    await saveSite();
    expect(await screen.findByText('ul. Testowa 7/3, 00-001 Warszawa · Dom jednorodzinny')).toBeTruthy();
    expect(screen.getByText('Dodano lokalizację.')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Istniejąca lokalizacja' }).checked).toBe(true);
    const [call, ...others] = api.calls(SITE_CREATE);
    expect(others).toEqual([]);
    expect(parseBody(call?.body ?? '')).toEqual({
      id: expect.stringMatching(UUIDV7) as string,
      siteType: 'single_family_house',
      street: 'ul. Testowa',
      buildingNumber: '7',
      apartmentNumber: '3',
      postalCode: '00-001',
      city: 'Warszawa',
      connectionPowerKw: 11.5,
      meteringPointId: 'PPE-TEST-0001',
      notes: 'Wejście od podwórza.',
    });
    expect(call?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    expect(call?.headers.get('X-CSRF-Token')).toBe('csrf-active');
    expect(call?.body).not.toContain('customerId');
    expect(api.calls('POST /api/v1/customers')).toHaveLength(0);
  });

  it('EVM-021 AC2 a garage has the parking spot and the level; they are sent only for a garage', async () => {
    const api = locationApi({ [SITE_CREATE]: (request) => savedSite(request.body) });
    await renderPanel(NEW, api);
    await chooseNewSite();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'Garaż w budynku wielorodzinnym');
    await userEvent.type(textbox('Nr miejsca postojowego (opcjonalnie)'), '15');
    await userEvent.type(textbox('Poziom (opcjonalnie)'), '-1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'Obiekt komercyjny');
    expect(screen.queryByRole('textbox', { name: 'Poziom (opcjonalnie)' })).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'Garaż w budynku wielorodzinnym');
    expect(textbox('Poziom (opcjonalnie)').value).toBe('-1');
    await userEvent.type(textbox('Ulica'), 'ul. Testowa');
    await userEvent.type(textbox('Nr budynku'), '7');
    await userEvent.type(textbox('Kod pocztowy'), '00-001');
    await userEvent.type(textbox('Miasto'), 'Warszawa');
    await saveSite();
    await screen.findByText(GARAGE_LINE);
    expect(parseBody(api.calls(SITE_CREATE)[0]?.body ?? '')).toMatchObject({
      siteType: 'multi_family_garage',
      parkingSpotNumber: '15',
      garageLevel: '-1',
    });
  });

  it('EVM-021 AC2 the garage fields typed before the type was changed are not sent for another type', async () => {
    const api = locationApi({ [SITE_CREATE]: (request) => savedSite(request.body) });
    await renderPanel(NEW, api);
    await chooseNewSite();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'Garaż w budynku wielorodzinnym');
    await userEvent.type(textbox('Nr miejsca postojowego (opcjonalnie)'), '15');
    await fillHouse();
    await saveSite();
    await screen.findByText('ul. Testowa 7, 00-001 Warszawa · Dom jednorodzinny');
    const body = api.calls(SITE_CREATE)[0]?.body ?? '';
    expect(body).not.toContain('parkingSpotNumber');
  });

  it('EVM-021 AC2 the power has the unit "kW" after the field, the notes carry the warning, and the form has no accessibility violations', async () => {
    await renderPanel(NEW, locationApi());
    await chooseNewSite();
    const power = textbox('Moc przyłączeniowa (opcjonalnie)');
    expect(screen.getByText('kW')).toBeTruthy();
    expect(power.getAttribute('inputmode')).toBe('decimal');
    expect(textbox('Notatki do lokalizacji (opcjonalnie)').getAttribute('aria-describedby')).toBe(screen.getByText(NOTES_WARNING).id);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-021 AC2 empty required fields and a wrong postal code or power are named under the fields, nothing is sent and the focus goes to the first of them', async () => {
    const api = locationApi();
    await renderPanel(NEW, api);
    await chooseNewSite();
    await saveSite();
    expect(api.calls(SITE_CREATE)).toHaveLength(0);
    expect(screen.getAllByText('Uzupełnij to pole.')).toHaveLength(5);
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Typ obiektu' }));
    expect(screen.getByRole('combobox', { name: 'Typ obiektu' }).getAttribute('aria-invalid')).toBe('true');
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'Inny');
    expect(screen.getAllByText('Uzupełnij to pole.')).toHaveLength(4);
    await userEvent.type(textbox('Ulica'), 'ul. Testowa');
    await userEvent.type(textbox('Nr budynku'), '7');
    await userEvent.type(textbox('Kod pocztowy'), '00001');
    await userEvent.type(textbox('Miasto'), 'Warszawa');
    await userEvent.type(textbox('Moc przyłączeniowa (opcjonalnie)'), 'dużo');
    await saveSite();
    expect(api.calls(SITE_CREATE)).toHaveLength(0);
    expect(screen.getByText('Podaj kod pocztowy w formacie 00-000.')).toBeTruthy();
    expect(screen.getByText('Podaj moc większą od 0 i najwyżej 1000 kW, z dokładnością do 2 miejsc po przecinku.')).toBeTruthy();
    expect(document.activeElement).toBe(textbox('Kod pocztowy'));
  });
});

describe('W-05 errors of the server for a new site (EVM-021 AC2, AC5, AC7)', () => {
  it('EVM-021 AC5 errors of the server appear under the fields they point at, with no value in them, and the focus goes to the first field', async () => {
    const api = locationApi({
      [SITE_CREATE]: () =>
        problem(400, 'validation_failed', {
          errors: [
            { pointer: '/city', code: 'too_long' },
            { pointer: '/postalCode', code: 'invalid_format' },
            { pointer: '/connectionPowerKw', code: 'out_of_range' },
            { pointer: '/notes', code: 'invalid_characters' },
            { pointer: '/meteringPointId', code: 'something_new' },
            { pointer: '/id', code: 'read_only_field' },
          ],
        }),
    });
    await renderPanel(NEW, api);
    await chooseNewSite();
    await fillHouse();
    await saveSite();
    expect(await screen.findByText('Wpisano za dużo znaków.')).toBeTruthy();
    expect(screen.getByText('Podaj kod pocztowy w formacie 00-000.')).toBeTruthy();
    expect(screen.getByText('Podaj moc większą od 0 i najwyżej 1000 kW, z dokładnością do 2 miejsc po przecinku.')).toBeTruthy();
    expect(screen.getByText('Usuń niedozwolone znaki.')).toBeTruthy();
    expect(screen.getByText('Sprawdź wartość w tym polu.')).toBeTruthy();
    expect(screen.getByText('Popraw zaznaczone pola.')).toBeTruthy();
    expect(document.activeElement).toBe(textbox('Kod pocztowy'));
    expect(textbox('Miasto').value).toBe('Warszawa');
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-021 AC7 a lost answer: the retry sends the same id and the same Idempotency-Key, the data stay, and a changed content is a new request', async () => {
    let calls = 0;
    const api = locationApi({
      [SITE_CREATE]: (request) => {
        calls += 1;
        if (calls === 1) throw new TypeError('Failed to fetch');
        if (calls === 2) return problem(503, 'unavailable');
        return savedSite(request.body);
      },
    });
    await renderPanel(NEW, api);
    await chooseNewSite();
    await fillHouse();
    await saveSite();
    expect(await screen.findByText('Nie udało się zapisać lokalizacji. Spróbuj ponownie — nie zapiszemy jej dwa razy.')).toBeTruthy();
    expect(document.activeElement?.textContent).toContain('Nie udało się zapisać lokalizacji.');
    expect(textbox('Ulica').value).toBe('ul. Testowa');
    await saveSite();
    await waitFor(() => {
      expect(api.calls(SITE_CREATE)).toHaveLength(2);
    });
    await screen.findByText('Nie udało się zapisać lokalizacji. Spróbuj ponownie — nie zapiszemy jej dwa razy.');
    const [first, second] = api.calls(SITE_CREATE);
    expect(second?.body).toBe(first?.body);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    await userEvent.type(textbox('Miasto'), 'x');
    await saveSite();
    await screen.findByText('ul. Testowa 7, 00-001 Warszawax · Dom jednorodzinny');
    const third = api.calls(SITE_CREATE)[2];
    expect((parseBody(third?.body ?? '') as { id: string }).id).not.toBe((parseBody(first?.body ?? '') as { id: string }).id);
    expect(third?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
  });

  it('EVM-021 AC7 the retry survives a look at "Istniejąca lokalizacja" in between: the form stays mounted, so the pair stays', async () => {
    let calls = 0;
    const api = locationApi({
      [SITE_CREATE]: (request) => {
        calls += 1;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return savedSite(request.body);
      },
    });
    await renderPanel(NEW, api);
    await chooseNewSite();
    await fillHouse();
    await saveSite();
    await screen.findByText('Nie udało się zapisać lokalizacji. Spróbuj ponownie — nie zapiszemy jej dwa razy.');
    await userEvent.click(screen.getByRole('radio', { name: 'Istniejąca lokalizacja' }));
    expect(screen.queryByRole('textbox', { name: 'Ulica' })).toBeNull();
    await chooseNewSite();
    await saveSite();
    await screen.findByText('ul. Testowa 7, 00-001 Warszawa · Dom jednorodzinny');
    const [first, second] = api.calls(SITE_CREATE);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
  });

  it('EVM-021 AC7 a parallel request, a refused pair, a missing right, 429 and an unknown answer each say what happened', async () => {
    const answers = [
      problem(409, 'idempotency_in_progress', {}, { 'Retry-After': '1' }),
      problem(409, 'id_conflict'),
      problem(422, 'idempotency_mismatch'),
      problem(403, 'forbidden'),
      problem(429, 'rate_limited', {}, { 'Retry-After': '20' }),
      problem(418, 'teapot', { traceId: 'abcdef0123456789' }),
    ];
    const api = locationApi({ [SITE_CREATE]: () => answers.shift() ?? problem(500, 'x') });
    await renderPanel(NEW, api);
    await chooseNewSite();
    await fillHouse();
    await saveSite();
    expect(await screen.findByText('Zapis tej lokalizacji jeszcze trwa. Spróbuj ponownie za chwilę.')).toBeTruthy();
    await saveSite();
    await waitFor(() => {
      expect(api.calls(SITE_CREATE)).toHaveLength(2);
    });
    await saveSite();
    await waitFor(() => {
      expect(api.calls(SITE_CREATE)).toHaveLength(3);
    });
    const keys = api.calls(SITE_CREATE).map((call) => call.headers.get('Idempotency-Key'));
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
    await saveSite();
    expect(await screen.findByText('Nie możesz dodawać lokalizacji. Poproś administratora o uprawnienia.')).toBeTruthy();
    await saveSite();
    expect(await screen.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 20 s.')).toBeTruthy();
    await saveSite();
    expect(
      await screen.findByText(
        'Nie udało się zapisać lokalizacji. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: abcdef01).',
      ),
    ).toBeTruthy();
  });

  it('EVM-021 AC7 offline the data of the form stay and the save is disabled with an explanation', async () => {
    const api = locationApi();
    await renderPanel(NEW, api);
    await chooseNewSite();
    await fillHouse();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('Brak połączenia. Zapiszesz lokalizację po powrocie połączenia — wpisane dane zostają.')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Zapisz lokalizację' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(button);
    expect(api.calls(SITE_CREATE)).toHaveLength(0);
    expect(textbox('Miasto').value).toBe('Warszawa');
  });
});

describe('W-05 OSD and manager (EVM-021 AC3)', () => {
  it('EVM-021 AC3 the OSD combobox asks only for parties of the kind OSD and the manager combobox for the three kinds of managers', async () => {
    const api = locationApi({
      [PARTY_SEARCH]: (request) => {
        const { kinds } = parseBody(request.body) as { kinds: string[] };
        return json(200, { items: kinds.length === 1 ? [OSD] : [MANAGER], nextCursor: null });
      },
    });
    await renderPanel(NEW, api);
    await chooseNewSite();
    await userEvent.type(screen.getByRole('combobox', { name: 'OSD (opcjonalnie)' }), 'oper');
    const option = await screen.findByRole('option', { name: /Operator Testowy/ });
    expect(option.textContent).toBe('Operator TestowyOSD');
    await userEvent.type(screen.getByRole('combobox', { name: 'Zarządca / administracja (opcjonalnie)' }), 'wspol');
    await screen.findByRole('option', { name: /Wspólnota Testowa/ });
    const [osd, manager] = api.calls(PARTY_SEARCH);
    expect(parseBody(osd?.body ?? '')).toEqual({ query: 'oper', kinds: ['distribution_system_operator'] });
    expect(parseBody(manager?.body ?? '')).toEqual({
      query: 'wspol',
      kinds: ['building_administration', 'property_manager', 'housing_community'],
    });
    expect(osd?.headers.get('X-CSRF-Token')).toBe('csrf-active');
    expect(osd?.query.size).toBe(0);
  });

  it('EVM-021 AC3 the chosen parties are sent as identifiers and shown with their kind; "Zmień" brings the field back', async () => {
    const api = locationApi({
      [PARTY_SEARCH]: (request) =>
        json(200, { items: (parseBody(request.body) as { kinds: string[] }).kinds.length === 1 ? [OSD] : [MANAGER], nextCursor: null }),
      [SITE_CREATE]: (request) => savedSite(request.body),
    });
    await renderPanel(NEW, api);
    await chooseNewSite();
    await fillHouse();
    await userEvent.type(screen.getByRole('combobox', { name: 'OSD (opcjonalnie)' }), 'oper');
    await userEvent.click(await screen.findByRole('option', { name: /Operator Testowy/ }));
    expect(screen.getByText('Operator Testowy · OSD')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByText('Operator Testowy · OSD'));
    await userEvent.type(screen.getByRole('combobox', { name: 'Zarządca / administracja (opcjonalnie)' }), 'wspol');
    await userEvent.click(await screen.findByRole('option', { name: /Wspólnota Testowa/ }));
    expect(screen.getByText('Wspólnota Testowa · Wspólnota / spółdzielnia')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Zmień OSD' }));
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'OSD (opcjonalnie)' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'OSD (opcjonalnie)' }), 'oper');
    await userEvent.click(await screen.findByRole('option', { name: /Operator Testowy/ }));
    await saveSite();
    await screen.findByText('ul. Testowa 7, 00-001 Warszawa · Dom jednorodzinny');
    expect(parseBody(api.calls(SITE_CREATE)[0]?.body ?? '')).toMatchObject({
      distributionSystemOperatorPartyId: OSD.id,
      managerPartyId: MANAGER.id,
    });
  });

  it('EVM-021 AC3 a party of another kind (wrong_party_kind) or a deleted one (unknown_party) is told under its field — without the kind or the id — and the other data stay', async () => {
    const api = locationApi({
      [PARTY_SEARCH]: items(OSD),
      [SITE_CREATE]: () =>
        problem(400, 'validation_failed', {
          errors: [
            { pointer: '/distributionSystemOperatorPartyId', code: 'wrong_party_kind' },
            { pointer: '/managerPartyId', code: 'unknown_party' },
          ],
        }),
    });
    await renderPanel(NEW, api);
    await chooseNewSite();
    await fillHouse();
    await userEvent.type(screen.getByRole('combobox', { name: 'OSD (opcjonalnie)' }), 'oper');
    await userEvent.click(await screen.findByRole('option', { name: /Operator Testowy/ }));
    await saveSite();
    expect(await screen.findByText('Ta strona nie pasuje do tego pola. Wybierz inną albo dodaj nową.')).toBeTruthy();
    expect(screen.getByText('Nie znaleziono wybranej strony. Wybierz ją ponownie.')).toBeTruthy();
    expect(screen.getByText('Operator Testowy · OSD')).toBeTruthy();
    expect(document.body.textContent).not.toContain(OSD.id);
    expect(document.activeElement?.textContent).toContain('Popraw zaznaczone pola.');
    expect(textbox('Ulica').value).toBe('ul. Testowa');
  });

  it('EVM-021 AC7 the search of parties has its own states: no results offers "Dodaj stronę", offline, 429 and a server error', async () => {
    const answers: Handler[] = [
      () => problem(500, 'x'),
      () => problem(429, 'rate_limited', {}, { 'Retry-After': '12' }),
      () => json(200, { items: [OSD], nextCursor: null }),
    ];
    const api = locationApi({ [PARTY_SEARCH]: (request) => (answers.shift() ?? items())(request) });
    await renderPanel(NEW, api);
    await chooseNewSite();
    const field = screen.getByRole('combobox', { name: 'OSD (opcjonalnie)' });
    await userEvent.type(field, 'ab');
    expect(screen.getByText('Wpisz co najmniej 3 znaki, aby wyszukać.')).toBeTruthy();
    expect(api.calls(PARTY_SEARCH)).toHaveLength(0);
    await userEvent.type(field, 'c');
    expect(await screen.findByText('Nie udało się wyszukać stron. Spróbuj ponownie.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 12 s.')).toBeTruthy();
    fireEvent.change(field, { target: { value: 'a'.repeat(101) } });
    expect(screen.getByText('Fraza może mieć najwyżej 100 znaków.')).toBeTruthy();
    fireEvent.change(field, { target: { value: 'abcd' } });
    expect(await screen.findByRole('option', { name: /Operator Testowy/ })).toBeTruthy();
    fireEvent.change(field, { target: { value: 'abcde' } });
    expect(await screen.findByText('Brak wyników dla „abcde”.')).toBeTruthy();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    fireEvent.change(field, { target: { value: 'abcdef' } });
    expect(await screen.findByText('Wyszukiwanie wymaga połączenia.')).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('dialog "Dodaj stronę" (EVM-021 AC4)', () => {
  const dialog = () => screen.getByRole('dialog', { name: 'Dodaj stronę' });

  /** Types a phrase without results into the OSD field and opens the dialog from its empty result. */
  async function openFromOsd() {
    await chooseNewSite();
    await userEvent.type(screen.getByRole('combobox', { name: 'OSD (opcjonalnie)' }), 'Stoen');
    await screen.findByText('Brak wyników dla „Stoen”.');
    const [fromResult] = screen.getAllByRole('button', { name: 'Dodaj stronę: OSD' });
    if (fromResult === undefined) throw new Error('no button');
    await userEvent.click(fromResult);
    return within(dialog());
  }

  it('EVM-021 AC4 from the empty result the dialog suggests the kind of the field, warns about the notes, saves the party with a UUIDv7 and a key and chooses it in the field', async () => {
    const api = locationApi({ [PARTY_CREATE]: (request) => savedParty(request.body) });
    await renderPanel(NEW, api);
    const form = await openFromOsd();
    expect(form.getByRole<HTMLSelectElement>('combobox', { name: 'Rodzaj strony' }).value).toBe('distribution_system_operator');
    expect(form.getAllByRole('option').map((option) => option.textContent)).toEqual(['OSD']);
    expect(form.getByRole<HTMLInputElement>('radio', { name: 'Firma lub instytucja' }).checked).toBe(true);
    expect(form.getByText(NOTES_WARNING)).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.type(form.getByRole('textbox', { name: 'Nazwa' }), 'Stoen Operator');
    await userEvent.type(form.getByRole('textbox', { name: 'Osoba kontaktowa (opcjonalnie)' }), 'Anna Testowa');
    await userEvent.type(form.getByRole('textbox', { name: 'Telefon (opcjonalnie)' }), '600 000 002');
    await userEvent.type(form.getByRole('textbox', { name: 'E-mail (opcjonalnie)' }), 'Biuro@Example.test');
    await userEvent.type(form.getByRole('textbox', { name: 'Notatki (opcjonalnie)' }), 'Dzwonić po 15.');
    await userEvent.click(form.getByRole('button', { name: 'Dodaj stronę' }));
    expect(await screen.findByText('Stoen Operator · OSD')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Dodano stronę.')).toBeTruthy();
    const [call] = api.calls(PARTY_CREATE);
    expect(parseBody(call?.body ?? '')).toEqual({
      id: expect.stringMatching(UUIDV7) as string,
      kind: 'distribution_system_operator',
      legalForm: 'organization',
      displayName: 'Stoen Operator',
      contactPersonName: 'Anna Testowa',
      phone: '600 000 002',
      email: 'Biuro@Example.test',
      notes: 'Dzwonić po 15.',
    });
    expect(call?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    expect(call?.headers.get('X-CSRF-Token')).toBe('csrf-active');
  });

  it('EVM-021 AC4 the manager field suggests the first of its three kinds and lets the person choose among them; a natural person is named "Imię i nazwisko"', async () => {
    const api = locationApi({ [PARTY_CREATE]: (request) => savedParty(request.body) });
    await renderPanel(NEW, api);
    await chooseNewSite();
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj stronę: zarządca / administracja' }));
    const form = within(dialog());
    expect(form.getByRole<HTMLSelectElement>('combobox', { name: 'Rodzaj strony' }).value).toBe('building_administration');
    expect(form.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Administracja',
      'Zarządca',
      'Wspólnota / spółdzielnia',
    ]);
    await userEvent.selectOptions(form.getByRole('combobox', { name: 'Rodzaj strony' }), 'Zarządca');
    await userEvent.click(form.getByRole('radio', { name: 'Osoba fizyczna' }));
    expect(form.queryByRole('textbox', { name: 'Nazwa' })).toBeNull();
    await userEvent.type(form.getByRole('textbox', { name: 'Imię i nazwisko' }), 'Jan Przykładowy');
    await userEvent.click(form.getByRole('button', { name: 'Dodaj stronę' }));
    expect(await screen.findByText('Jan Przykładowy · Zarządca')).toBeTruthy();
    expect(parseBody(api.calls(PARTY_CREATE)[0]?.body ?? '')).toEqual({
      id: expect.stringMatching(UUIDV7) as string,
      kind: 'property_manager',
      legalForm: 'natural_person',
      displayName: 'Jan Przykładowy',
    });
  });

  it('EVM-021 AC4 the name is required; the server tells a wrong phone or e-mail under the field and the focus goes there', async () => {
    const api = locationApi({
      [PARTY_CREATE]: () =>
        problem(400, 'validation_failed', {
          errors: [
            { pointer: '/phone', code: 'invalid_format' },
            { pointer: '/email', code: 'invalid_format' },
            { pointer: '/notes', code: 'too_long' },
            { pointer: '/contactPersonName', code: 'invalid_characters' },
            { pointer: '/kind', code: 'required' },
          ],
        }),
    });
    await renderPanel(NEW, api);
    const form = await openFromOsd();
    await userEvent.click(form.getByRole('button', { name: 'Dodaj stronę' }));
    expect(api.calls(PARTY_CREATE)).toHaveLength(0);
    expect(form.getByText('Uzupełnij to pole.')).toBeTruthy();
    expect(document.activeElement).toBe(form.getByRole('textbox', { name: 'Nazwa' }));
    await userEvent.type(form.getByRole('textbox', { name: 'Nazwa' }), 'Stoen');
    expect(form.queryByText('Uzupełnij to pole.')).toBeNull();
    await userEvent.type(form.getByRole('textbox', { name: 'Telefon (opcjonalnie)' }), '12');
    await userEvent.click(form.getByRole('button', { name: 'Dodaj stronę' }));
    expect(await form.findByText('Podaj poprawny numer telefonu, np. +48 600 000 001.')).toBeTruthy();
    expect(form.getByText('Podaj poprawny adres e-mail.')).toBeTruthy();
    expect(form.getByText('Wpisano za dużo znaków.')).toBeTruthy();
    expect(form.getByText('Usuń niedozwolone znaki.')).toBeTruthy();
    expect(form.getByText('Popraw zaznaczone pola.')).toBeTruthy();
    expect(document.activeElement).toBe(form.getByRole('textbox', { name: 'Osoba kontaktowa (opcjonalnie)' }));
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-021 AC4 after a lost answer the retry sends the same id and the same Idempotency-Key — one party, not two', async () => {
    let calls = 0;
    const api = locationApi({
      [PARTY_CREATE]: (request) => {
        calls += 1;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return savedParty(request.body);
      },
    });
    await renderPanel(NEW, api);
    const form = await openFromOsd();
    await userEvent.type(form.getByRole('textbox', { name: 'Nazwa' }), 'Stoen Operator');
    await userEvent.click(form.getByRole('button', { name: 'Dodaj stronę' }));
    expect(await form.findByText('Nie udało się dodać strony. Spróbuj ponownie — nie dodamy jej dwa razy.')).toBeTruthy();
    expect(document.activeElement?.textContent).toContain('Nie udało się dodać strony.');
    expect(form.getByRole<HTMLInputElement>('textbox', { name: 'Nazwa' }).value).toBe('Stoen Operator');
    await userEvent.click(form.getByRole('button', { name: 'Dodaj stronę' }));
    await screen.findByText('Stoen Operator · OSD');
    const [first, second] = api.calls(PARTY_CREATE);
    expect(api.calls(PARTY_CREATE)).toHaveLength(2);
    expect(second?.body).toBe(first?.body);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
  });

  it('EVM-021 AC4 and AC7 a missing right, 429, a parallel request, a refused pair and an unknown answer each say what happened', async () => {
    const answers = [
      problem(403, 'forbidden'),
      problem(429, 'rate_limited', {}, { 'Retry-After': '20' }),
      problem(409, 'idempotency_in_progress'),
      problem(409, 'id_conflict'),
      problem(418, 'teapot', { traceId: 'abcdef0123456789' }),
    ];
    const api = locationApi({ [PARTY_CREATE]: () => answers.shift() ?? problem(500, 'x') });
    await renderPanel(NEW, api);
    const form = await openFromOsd();
    await userEvent.type(form.getByRole('textbox', { name: 'Nazwa' }), 'Stoen');
    const submit = () => userEvent.click(form.getByRole('button', { name: 'Dodaj stronę' }));
    await submit();
    expect(await form.findByText('Nie możesz dodawać stron. Poproś administratora o uprawnienia.')).toBeTruthy();
    await submit();
    expect(await form.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 20 s.')).toBeTruthy();
    await submit();
    expect(await form.findByText('Zapis tej strony jeszcze trwa. Spróbuj ponownie za chwilę.')).toBeTruthy();
    await submit();
    expect(await form.findByText('Nie udało się dodać strony. Spróbuj ponownie — nie dodamy jej dwa razy.')).toBeTruthy();
    await submit();
    expect(
      await form.findByText(
        'Nie udało się dodać strony. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: abcdef01).',
      ),
    ).toBeTruthy();
    const keys = api.calls(PARTY_CREATE).map((call) => call.headers.get('Idempotency-Key'));
    expect(keys[2]).toBe(keys[1]);
    expect(keys[4]).not.toBe(keys[3]);
  });

  it('EVM-021 AC4 and AC7 offline the data of the dialog stay and the save is disabled with an explanation', async () => {
    const api = locationApi();
    await renderPanel(NEW, api);
    const form = await openFromOsd();
    await userEvent.type(form.getByRole('textbox', { name: 'Nazwa' }), 'Stoen');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(form.getByText('Brak połączenia. Dodasz stronę po powrocie połączenia — wpisane dane zostają.')).toBeTruthy();
    const button = form.getByRole('button', { name: 'Dodaj stronę' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(button);
    expect(api.calls(PARTY_CREATE)).toHaveLength(0);
    expect(form.getByRole<HTMLInputElement>('textbox', { name: 'Nazwa' }).value).toBe('Stoen');
  });

  it('EVM-021 AC4 Esc and the x close the dialog and keep what was typed; "Anuluj" discards it', async () => {
    await renderPanel(NEW, locationApi());
    const form = await openFromOsd();
    await userEvent.type(form.getByRole('textbox', { name: 'Nazwa' }), 'Stoen');
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj stronę: OSD' }));
    expect(within(dialog()).getByRole<HTMLInputElement>('textbox', { name: 'Nazwa' }).value).toBe('Stoen');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Zamknij okno' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj stronę: OSD' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj stronę: OSD' }));
    expect(within(dialog()).getByRole<HTMLInputElement>('textbox', { name: 'Nazwa' }).value).toBe('');
  });
});

describe('who sees the section and what stays in the tab (EVM-021 AC6, AC7)', () => {
  it('EVM-021 AC6 Edytor sees the section like Administrator; Tylko odczyt gets no form and sends no request about sites or parties', async () => {
    const editor = locationApi({}, roleSession('editor'));
    const first = await renderPanel(NEW, editor);
    expect(screen.getByRole('group', { name: '2. Lokalizacja' })).toBeTruthy();
    first.unmount();
    const readOnly = locationApi({}, roleSession('read_only'));
    await renderPanel(NEW, readOnly);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie możesz tworzyć zleceń.' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: '2. Lokalizacja' })).toBeNull();
    for (const route of [SITE_SEARCH, SITE_CREATE, PARTY_SEARCH, PARTY_CREATE]) expect(readOnly.calls(route)).toHaveLength(0);
  });

  it('EVM-021 AC7 what is typed is a draft in the memory of the tab only: back after leaving and returning, never in the storage of the browser; "Anuluj" asks', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { history } = await renderPanel(NEW, locationApi());
    await chooseNewSite();
    await userEvent.type(textbox('Ulica'), 'ul. Testowa');
    await userEvent.type(textbox('Notatki do lokalizacji (opcjonalnie)'), 'Notatka testowa.');
    expect(screen.getByText(/Szkic w tej karcie · \d{2}:\d{2}/)).toBeTruthy();
    await act(async () => {
      history.push('/work-orders');
      await Promise.resolve();
    });
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    await userEvent.click(screen.getByRole('button', { name: 'Nowe zlecenie' }));
    expect(await screen.findByRole('radio', { name: 'Nowa lokalizacja' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Nowa lokalizacja' }).checked).toBe(true);
    expect(textbox('Ulica').value).toBe('ul. Testowa');
    expect(textbox('Notatki do lokalizacji (opcjonalnie)').value).toBe('Notatka testowa.');
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(screen.getByRole('alertdialog', { name: 'Odrzucić nowe zlecenie?' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Odrzuć zmiany' }));
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    await userEvent.click(screen.getByRole('button', { name: 'Nowe zlecenie' }));
    expect(await screen.findByRole('radio', { name: 'Istniejąca lokalizacja' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Istniejąca lokalizacja' }).checked).toBe(true);
  });

  it('EVM-021 AC7 a chosen site and the chosen parties come back with the draft; a broken location of a draft is no draft', async () => {
    const { saveDraft } = await import('../src/session/draft-store.ts');
    const user = ACTIVE_SESSION.user.id;
    const complete = {
      customer: null,
      savedAt: 1,
      location: {
        mode: 'existing',
        site: GARAGE,
        osd: OSD,
        manager: null,
        form: {
          siteType: '',
          street: '',
          buildingNumber: '',
          apartmentNumber: '',
          postalCode: '',
          city: '',
          parkingSpotNumber: '',
          garageLevel: '',
          connectionPowerKw: '',
          meteringPointId: '',
          notes: '',
        },
      },
    };
    saveDraft(user, 'work-order-new', JSON.stringify(complete));
    const first = await renderPanel(NEW, locationApi());
    expect(screen.getByText(GARAGE_LINE)).toBeTruthy();
    first.unmount();
    for (const location of [
      { ...complete.location, mode: 'sideways' },
      { ...complete.location, form: { street: 1 } },
      { ...complete.location, site: { id: 5 } },
      'text',
    ]) {
      saveDraft(user, 'work-order-new', JSON.stringify({ ...complete, location }));
      const again = await renderPanel(NEW, locationApi());
      expect(screen.queryByText(GARAGE_LINE)).toBeNull();
      expect(siteField()).toBeTruthy();
      again.unmount();
    }
    saveDraft(user, 'work-order-new', JSON.stringify({ customer: null, savedAt: 1 }));
    await renderPanel(NEW, locationApi());
    expect(siteField()).toBeTruthy();
  });
});
