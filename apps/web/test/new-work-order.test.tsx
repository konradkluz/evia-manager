import type { CurrentSession } from '@evia/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts } from '../src/session/draft-store.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';

// No pause between keystrokes: typing ~100 characters per test would otherwise run close to the 5 s limit on a slow CI runner.
const userEvent = userEventDefault.setup({ delay: null });
const SEARCH = 'POST /api/v1/customers/search';
const CREATE = 'POST /api/v1/customers';
const NEW = '/work-orders/new';
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const JAN = { id: '01968f3e-0000-7000-8000-00000000aaaa', displayName: 'Jan Przykładowy', phone: '+48600000001' };
const JAN_TEXT = 'Jan Przykładowy · +48 600 000 001';

const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } });

const found =
  (...items: Array<typeof JAN>): Handler =>
  () =>
    json(200, { items, nextCursor: null });

function customerApi(routes: Record<string, Handler> = {}, session: CurrentSession = ACTIVE_SESSION) {
  return activeSessionApi({ [SESSION_ROUTE]: () => json(200, session), [SEARCH]: found(), ...routes });
}

/** The answer of the API to a saved customer: E.164 phone and the name made by the server. */
function savedCustomer(body: string): Response {
  const sent = parseBody(body) as { id: string; firstName?: string; lastName?: string; companyName?: string };
  return json(
    201,
    {
      id: sent.id,
      kind: sent.companyName === undefined ? 'person' : 'company',
      phone: '+48600000001',
      displayName: sent.companyName ?? `${sent.firstName ?? ''} ${sent.lastName ?? ''}`,
      version: 1,
      createdAt: '2026-10-07T10:00:00.000Z',
      updatedAt: '2026-10-07T10:00:00.000Z',
    },
    { ETag: '"1"' },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  clearDrafts();
});

const combobox = () => screen.getByRole('combobox', { name: 'Klient' });
const dialog = () => screen.getByRole('dialog', { name: 'Dodaj klienta' });

/** Types a phrase without results and opens the dialog "Dodaj klienta" from the empty result. */
async function openDialog() {
  await userEvent.type(combobox(), 'xyz');
  await userEvent.click(await screen.findByRole('button', { name: 'Dodaj klienta' }));
  return within(dialog());
}

type Form = Awaited<ReturnType<typeof openDialog>>;

async function fillPerson(form: Form, values = { first: 'Jan', last: 'Przykładowy', phone: '+48 600 000 001' }) {
  await userEvent.type(form.getByRole('textbox', { name: 'Imię' }), values.first);
  await userEvent.type(form.getByRole('textbox', { name: 'Nazwisko' }), values.last);
  await userEvent.type(form.getByRole('textbox', { name: 'Telefon' }), values.phone);
}

const submit = (form: Form) => userEvent.click(form.getByRole('button', { name: 'Dodaj klienta' }));

describe('W-05 section "1. Klient": search (EVM-020 AC1)', () => {
  it('EVM-020 AC1 the phrase goes in the body of a POST with the CSRF token — not in the address, the title of the tab or the console', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const api = customerApi({ [SEARCH]: found(JAN) });
    const { history } = await renderPanel(NEW, api);
    expect(document.title).toBe('Nowe zlecenie · EVia Manager');
    await userEvent.type(combobox(), 'Lodz');
    const option = await screen.findByRole('option', { name: /Jan Przykładowy/ });
    expect(option.textContent).toBe('Jan Przykładowy+48 600 000 001');
    const [call, ...others] = api.calls(SEARCH);
    expect(others).toEqual([]);
    expect(call?.path).toBe('/api/v1/customers/search');
    expect(call?.query.size).toBe(0);
    expect(parseBody(call?.body ?? '')).toEqual({ query: 'Lodz' });
    expect(call?.headers.get('X-CSRF-Token')).toBe('csrf-active');
    expect(history.location.href).toBe(NEW);
    expect(document.title).not.toContain('Lodz');
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toContain('Lodz');
  });

  it('EVM-020 AC1 a phrase shorter than 3 characters is not sent and the field says why; the 3rd character starts the search', async () => {
    const api = customerApi({ [SEARCH]: found(JAN) });
    await renderPanel(NEW, api);
    await userEvent.type(combobox(), 'pr');
    expect(screen.getByText('Wpisz co najmniej 3 znaki, aby wyszukać.')).toBeTruthy();
    expect(api.calls(SEARCH)).toHaveLength(0);
    await userEvent.type(combobox(), 'z');
    await screen.findByRole('option', { name: /Jan Przykładowy/ });
    expect(api.calls(SEARCH).map((call) => (parseBody(call.body) as { query: string }).query)).toEqual(['prz']);
    expect(screen.queryByText('Wpisz co najmniej 3 znaki, aby wyszukać.')).toBeNull();
  });

  it('EVM-020 AC1 a phrase of more than 100 characters is not sent either', async () => {
    const api = customerApi();
    await renderPanel(NEW, api);
    fireEvent.change(combobox(), { target: { value: 'a'.repeat(101) } });
    expect(screen.getByText('Fraza może mieć najwyżej 100 znaków.')).toBeTruthy();
    expect(api.calls(SEARCH)).toHaveLength(0);
  });

  it('EVM-020 AC1 choosing a customer shows the name and the phone, moves the focus there and "Zmień klienta" brings the field back', async () => {
    const api = customerApi({ [SEARCH]: found(JAN) });
    await renderPanel(NEW, api);
    await userEvent.type(combobox(), 'przykl');
    await userEvent.click(await screen.findByRole('option', { name: /Jan Przykładowy/ }));
    expect(screen.queryByRole('combobox', { name: 'Klient' })).toBeNull();
    const line = screen.getByText(JAN_TEXT);
    expect(document.activeElement).toBe(line);
    await userEvent.click(screen.getByRole('button', { name: 'Zmień klienta' }));
    expect(document.activeElement).toBe(combobox());
    expect(screen.queryByText(JAN_TEXT)).toBeNull();
  });

  it('EVM-020 AC1 the keyboard works: arrows, Enter choose the customer without the mouse', async () => {
    await renderPanel(NEW, customerApi({ [SEARCH]: found(JAN) }));
    await userEvent.type(combobox(), 'przykl');
    await screen.findByRole('option', { name: /Jan Przykładowy/ });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByText(JAN_TEXT)).toBeTruthy();
  });

  it('EVM-020 AC1 the screen with results has no accessibility violations', async () => {
    await renderPanel(NEW, customerApi({ [SEARCH]: found(JAN) }));
    await userEvent.type(combobox(), 'przykl');
    await screen.findByRole('option', { name: /Jan Przykładowy/ });
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('W-05 states of the search (EVM-020 AC8, AC6)', () => {
  it('EVM-020 AC8 while the answer is awaited the popup shows 3 skeleton rows and announces the search', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = customerApi({
      [SEARCH]: async () => {
        await gate;
        return json(200, { items: [JAN], nextCursor: null });
      },
    });
    await renderPanel(NEW, api);
    await userEvent.type(combobox(), 'abc');
    const popup = document.getElementById(combobox().getAttribute('aria-controls') ?? '');
    expect(popup?.getAttribute('aria-busy')).toBe('true');
    expect(popup?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
    expect(screen.getAllByRole('status').some((status) => status.textContent === 'Szukamy klientów…')).toBe(true);
    release();
    await screen.findByRole('option', { name: /Jan Przykładowy/ });
    expect(screen.getAllByRole('status').some((status) => status.textContent === 'Wyniki wyszukiwania: 1.')).toBe(true);
  });

  it('EVM-020 AC8 no results: "Brak wyników dla „…”." with the action "Dodaj klienta"', async () => {
    await renderPanel(NEW, customerApi());
    await userEvent.type(combobox(), 'Przykł');
    expect(await screen.findByText('Brak wyników dla „Przykł”.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dodaj klienta' })).toBeTruthy();
  });

  it('EVM-020 AC8 offline: "Wyszukiwanie wymaga połączenia." and nothing is sent', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const api = customerApi();
    await renderPanel(NEW, api);
    await userEvent.type(combobox(), 'abc');
    expect(await screen.findByText('Wyszukiwanie wymaga połączenia.')).toBeTruthy();
    expect(api.calls(SEARCH)).toHaveLength(0);
  });

  it('EVM-020 AC6 and AC8 429: "Zbyt wiele zapytań…" with the time from Retry-After', async () => {
    const api = customerApi({ [SEARCH]: () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }) });
    await renderPanel(NEW, api);
    await userEvent.type(combobox(), 'abc');
    expect(await screen.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeTruthy();
  });

  it('EVM-020 AC8 a server error says so and "Spróbuj ponownie" asks again', async () => {
    let calls = 0;
    const api = customerApi({
      [SEARCH]: () => {
        calls += 1;
        return calls === 1 ? problem(500, 'internal_error') : json(200, { items: [JAN], nextCursor: null });
      },
    });
    await renderPanel(NEW, api);
    await userEvent.type(combobox(), 'abc');
    expect(await screen.findByText('Nie udało się wyszukać klientów. Spróbuj ponownie.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('option', { name: /Jan Przykładowy/ })).toBeTruthy();
    expect(api.calls(SEARCH)).toHaveLength(2);
  });
});

describe('dialog "Dodaj klienta" (EVM-020 AC2, AC5)', () => {
  it('EVM-020 AC2 a person is saved with a UUIDv7 and an Idempotency-Key, the new customer is chosen and a toast says so', async () => {
    const api = customerApi({ [CREATE]: (request) => savedCustomer(request.body) });
    await renderPanel(NEW, api);
    const form = await openDialog();
    expect(form.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeTruthy();
    await fillPerson(form);
    await submit(form);
    expect(await screen.findByText('Jan Przykładowy · +48 600 000 001')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Dodano klienta.')).toBeTruthy();
    const [call] = api.calls(CREATE);
    expect(parseBody(call?.body ?? '')).toEqual({
      id: expect.stringMatching(UUIDV7) as string,
      kind: 'person',
      firstName: 'Jan',
      lastName: 'Przykładowy',
      phone: '+48 600 000 001',
    });
    expect(call?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    expect(call?.headers.get('X-CSRF-Token')).toBe('csrf-active');
    expect(screen.getByText('Szkic w tej karcie', { exact: false })).toBeTruthy();
  });

  it('EVM-020 AC2 a company has its name, an optional NIP and contact person, and nothing of a person is sent', async () => {
    const api = customerApi({ [CREATE]: (request) => savedCustomer(request.body) });
    await renderPanel(NEW, api);
    const form = await openDialog();
    await userEvent.type(form.getByRole('textbox', { name: 'Imię' }), 'Zostaje');
    await userEvent.click(form.getByRole('radio', { name: 'Firma' }));
    expect(form.queryByRole('textbox', { name: 'Imię' })).toBeNull();
    await userEvent.type(form.getByRole('textbox', { name: 'Nazwa firmy' }), 'Firma Testowa sp. z o.o.');
    await userEvent.type(form.getByRole('textbox', { name: 'NIP (opcjonalnie)' }), 'PL 526-000-12-46');
    await userEvent.type(form.getByRole('textbox', { name: 'Osoba kontaktowa (opcjonalnie)' }), 'Anna Testowa');
    await userEvent.type(form.getByRole('textbox', { name: 'Telefon' }), '600000001');
    await userEvent.type(form.getByRole('textbox', { name: 'E-mail (opcjonalnie)' }), 'Biuro@Example.test');
    await userEvent.type(form.getByRole('textbox', { name: 'Notatki (opcjonalnie)' }), 'Dzwonić po 15.');
    await submit(form);
    await screen.findByText('Firma Testowa sp. z o.o. · +48 600 000 001');
    expect(parseBody(api.calls(CREATE)[0]?.body ?? '')).toEqual({
      id: expect.stringMatching(UUIDV7) as string,
      kind: 'company',
      companyName: 'Firma Testowa sp. z o.o.',
      taxId: 'PL 526-000-12-46',
      contactPersonName: 'Anna Testowa',
      phone: '600000001',
      email: 'Biuro@Example.test',
      notes: 'Dzwonić po 15.',
    });
  });

  it('EVM-020 AC2 the postal address opens from a section, is sent as one object and a half-filled one asks for the rest under the fields', async () => {
    const api = customerApi({ [CREATE]: (request) => savedCustomer(request.body) });
    await renderPanel(NEW, api);
    const form = await openDialog();
    await fillPerson(form);
    expect(form.queryByRole('textbox', { name: 'Ulica' })).toBeNull();
    await userEvent.click(form.getByRole('button', { name: /Adres korespondencyjny/ }));
    await userEvent.type(form.getByRole('textbox', { name: 'Ulica' }), 'ul. Testowa');
    await submit(form);
    expect(api.calls(CREATE)).toHaveLength(0);
    expect(form.getByRole('textbox', { name: 'Nr budynku' }).getAttribute('aria-invalid')).toBe('true');
    expect(form.getAllByText('Uzupełnij to pole.')).toHaveLength(3);
    await userEvent.type(form.getByRole('textbox', { name: 'Nr budynku' }), '7');
    await userEvent.type(form.getByRole('textbox', { name: 'Kod pocztowy' }), '00-001');
    await userEvent.type(form.getByRole('textbox', { name: 'Miasto' }), 'Warszawa');
    await submit(form);
    await screen.findByText(JAN_TEXT);
    expect((parseBody(api.calls(CREATE)[0]?.body ?? '') as { postalAddress: unknown }).postalAddress).toEqual({
      street: 'ul. Testowa',
      buildingNumber: '7',
      postalCode: '00-001',
      city: 'Warszawa',
    });
  });

  it('EVM-020 AC2 empty required fields are named under the fields, nothing is sent and the focus goes to the first of them', async () => {
    const api = customerApi();
    await renderPanel(NEW, api);
    const form = await openDialog();
    await submit(form);
    expect(api.calls(CREATE)).toHaveLength(0);
    expect(form.getAllByText('Uzupełnij to pole.')).toHaveLength(3);
    expect(document.activeElement).toBe(form.getByRole('textbox', { name: 'Imię' }));
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.type(form.getByRole('textbox', { name: 'Imię' }), 'J');
    expect(form.getAllByText('Uzupełnij to pole.')).toHaveLength(2);
    expect(document.activeElement).toBe(form.getByRole('textbox', { name: 'Imię' }));
  });

  it('EVM-020 AC2 and AC5 errors of the server appear under the fields they point at, with no value in them, and the focus goes to the first field', async () => {
    const api = customerApi({
      [CREATE]: () =>
        problem(400, 'validation_failed', {
          errors: [
            { pointer: '/phone', code: 'invalid_format' },
            { pointer: '/lastName', code: 'too_long' },
            { pointer: '/postalAddress/postalCode', code: 'invalid_format' },
            { pointer: '/email', code: 'invalid_format' },
            { pointer: '/notes', code: 'invalid_characters' },
            { pointer: '/kind', code: 'required' },
          ],
        }),
    });
    await renderPanel(NEW, api);
    const form = await openDialog();
    await fillPerson(form, { first: 'Jan', last: 'Przykładowy', phone: '12' });
    await submit(form);
    expect(await form.findByText('Podaj poprawny numer telefonu, np. +48 600 000 001.')).toBeTruthy();
    expect(form.getByText('Wpisano za dużo znaków.')).toBeTruthy();
    expect(form.getByText('Podaj kod pocztowy w formacie 00-000.')).toBeTruthy();
    expect(form.getByText('Podaj poprawny adres e-mail.')).toBeTruthy();
    expect(form.getByText('Usuń niedozwolone znaki.')).toBeTruthy();
    expect(form.getByText('Popraw zaznaczone pola.')).toBeTruthy();
    expect(document.activeElement).toBe(form.getByRole('textbox', { name: 'Nazwisko' }));
    expect(form.getByRole('textbox', { name: 'Kod pocztowy' }).getAttribute('aria-invalid')).toBe('true');
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-020 AC5 other codes of a field fall back to a general text and a tax id has its own', async () => {
    const api = customerApi({
      [CREATE]: () =>
        problem(400, 'validation_failed', {
          errors: [
            { pointer: '/taxId', code: 'invalid_format' },
            { pointer: '/companyName', code: 'not_allowed_for_kind' },
            { pointer: '/contactPersonName', code: 'invalid_format' },
          ],
        }),
    });
    await renderPanel(NEW, api);
    const form = await openDialog();
    await userEvent.click(form.getByRole('radio', { name: 'Firma' }));
    await userEvent.type(form.getByRole('textbox', { name: 'Nazwa firmy' }), 'Firma');
    await userEvent.type(form.getByRole('textbox', { name: 'Telefon' }), '600000001');
    await submit(form);
    expect(await form.findByText('Podaj poprawny NIP (10 cyfr).')).toBeTruthy();
    expect(form.getAllByText('Sprawdź wartość w tym polu.')).toHaveLength(2);
  });

  it('EVM-020 AC2 Esc and the x close the dialog and keep what was typed; "Anuluj" discards it', async () => {
    await renderPanel(NEW, customerApi());
    const form = await openDialog();
    await userEvent.type(form.getByRole('textbox', { name: 'Imię' }), 'Jan');
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await userEvent.click(combobox());
    await userEvent.click(await screen.findByRole('button', { name: 'Dodaj klienta' }));
    const again = within(dialog());
    expect(again.getByRole<HTMLInputElement>('textbox', { name: 'Imię' }).value).toBe('Jan');
    await userEvent.click(again.getByRole('button', { name: 'Zamknij okno' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(combobox());
    await userEvent.click(await screen.findByRole('button', { name: 'Dodaj klienta' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(combobox());
    await userEvent.click(await screen.findByRole('button', { name: 'Dodaj klienta' }));
    expect(within(dialog()).getByRole<HTMLInputElement>('textbox', { name: 'Imię' }).value).toBe('');
  });

  it('EVM-020 AC8 offline the data of the dialog stays and the save is disabled with an explanation', async () => {
    const api = customerApi();
    await renderPanel(NEW, api);
    const form = await openDialog();
    await fillPerson(form);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(form.getAllByText('Brak połączenia. Dodasz klienta po powrocie połączenia — wpisane dane zostają.').length).toBeGreaterThan(0);
    const button = form.getByRole('button', { name: 'Dodaj klienta' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(button);
    expect(api.calls(CREATE)).toHaveLength(0);
    expect(form.getByRole<HTMLInputElement>('textbox', { name: 'Nazwisko' }).value).toBe('Przykładowy');
  });
});

describe('retry without a duplicate (EVM-020 AC4)', () => {
  it('EVM-020 AC4 after a network error the retry sends the same id and the same Idempotency-Key', async () => {
    let calls = 0;
    const api = customerApi({
      [CREATE]: (request) => {
        calls += 1;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return savedCustomer(request.body);
      },
    });
    await renderPanel(NEW, api);
    const form = await openDialog();
    await fillPerson(form);
    await submit(form);
    expect(await form.findByText('Nie udało się dodać klienta. Spróbuj ponownie — nie dodamy go dwa razy.')).toBeTruthy();
    expect(document.activeElement?.textContent).toContain('Nie udało się dodać klienta.');
    expect(form.getByRole<HTMLInputElement>('textbox', { name: 'Nazwisko' }).value).toBe('Przykładowy');
    await submit(form);
    await screen.findByText(JAN_TEXT);
    const [first, second] = api.calls(CREATE);
    expect(api.calls(CREATE)).toHaveLength(2);
    expect((parseBody(second?.body ?? '') as { id: string }).id).toBe((parseBody(first?.body ?? '') as { id: string }).id);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect(second?.body).toBe(first?.body);
  });

  it('EVM-020 AC4 a server error counts as such a failure; changed content is a new request with a new id and key', async () => {
    let calls = 0;
    const api = customerApi({
      [CREATE]: (request) => {
        calls += 1;
        return calls === 1 ? problem(503, 'unavailable') : savedCustomer(request.body);
      },
    });
    await renderPanel(NEW, api);
    const form = await openDialog();
    await fillPerson(form);
    await submit(form);
    await form.findByText('Nie udało się dodać klienta. Spróbuj ponownie — nie dodamy go dwa razy.');
    await userEvent.type(form.getByRole('textbox', { name: 'Nazwisko' }), 'x');
    await submit(form);
    await screen.findByText('Jan Przykładowyx · +48 600 000 001');
    const [first, second] = api.calls(CREATE);
    expect((parseBody(second?.body ?? '') as { id: string }).id).not.toBe((parseBody(first?.body ?? '') as { id: string }).id);
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
  });

  it('EVM-020 AC4 a parallel request (409 idempotency_in_progress) is told to wait a moment and the same pair is kept', async () => {
    let calls = 0;
    const api = customerApi({
      [CREATE]: (request) => {
        calls += 1;
        return calls === 1 ? problem(409, 'idempotency_in_progress', {}, { 'Retry-After': '1' }) : savedCustomer(request.body);
      },
    });
    await renderPanel(NEW, api);
    const form = await openDialog();
    await fillPerson(form);
    await submit(form);
    expect(await form.findByText('Zapis tego klienta jeszcze trwa. Spróbuj ponownie za chwilę.')).toBeTruthy();
    await submit(form);
    await screen.findByText(JAN_TEXT);
    const [first, second] = api.calls(CREATE);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
  });

  it('EVM-020 AC4 a refused identifier or key (id_conflict, idempotency_mismatch) is replaced by a fresh pair on the next try', async () => {
    let calls = 0;
    const api = customerApi({
      [CREATE]: (request) => {
        calls += 1;
        if (calls === 1) return problem(409, 'id_conflict');
        if (calls === 2) return problem(422, 'idempotency_mismatch');
        return savedCustomer(request.body);
      },
    });
    await renderPanel(NEW, api);
    const form = await openDialog();
    await fillPerson(form);
    await submit(form);
    await form.findByText('Nie udało się dodać klienta. Spróbuj ponownie — nie dodamy go dwa razy.');
    await submit(form);
    await waitFor(() => {
      expect(api.calls(CREATE)).toHaveLength(2);
    });
    await form.findByText('Nie udało się dodać klienta. Spróbuj ponownie — nie dodamy go dwa razy.');
    await submit(form);
    await screen.findByText(JAN_TEXT);
    const keys = api.calls(CREATE).map((call) => call.headers.get('Idempotency-Key'));
    expect(new Set(keys).size).toBe(3);
  });

  it('EVM-020 AC7 a 403 of the server (a role without the right) and a 429 are told in the dialog; any other answer carries the trace code', async () => {
    const answers = [
      problem(403, 'forbidden'),
      problem(429, 'rate_limited', {}, { 'Retry-After': '20' }),
      problem(418, 'teapot', { traceId: 'abcdef0123456789' }),
    ];
    const api = customerApi({ [CREATE]: () => answers.shift() ?? problem(500, 'x') });
    await renderPanel(NEW, api);
    const form = await openDialog();
    await fillPerson(form);
    await submit(form);
    expect(await form.findByText('Nie możesz dodawać klientów. Poproś administratora o uprawnienia.')).toBeTruthy();
    await submit(form);
    expect(await form.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 20 s.')).toBeTruthy();
    await submit(form);
    expect(
      await form.findByText(
        'Nie udało się dodać klienta. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: abcdef01).',
      ),
    ).toBeTruthy();
  });
});

describe('"Podobny klient" (EVM-020 AC3)', () => {
  const bySearch: Handler = (request) => {
    const { query } = parseBody(request.body) as { query: string };
    return json(200, { items: query === 'xyz' ? [] : [JAN], nextCursor: null });
  };

  it('EVM-020 AC3 the same phone shows "Podobny klient: … [Wybierz tego klienta]" and choosing it selects that customer without saving', async () => {
    const api = customerApi({ [SEARCH]: bySearch });
    await renderPanel(NEW, api);
    const form = await openDialog();
    await userEvent.type(form.getByRole('textbox', { name: 'Telefon' }), '+48 600 000 001');
    expect(await form.findByText(`Podobny klient: ${JAN_TEXT}`)).toBeTruthy();
    expect(api.calls(SEARCH).some((call) => (parseBody(call.body) as { query: string }).query === '+48 600 000 001')).toBe(true);
    await userEvent.click(form.getByRole('button', { name: 'Wybierz tego klienta' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(JAN_TEXT)).toBeTruthy();
    expect(api.calls(CREATE)).toHaveLength(0);
  });

  it('EVM-020 AC3 the same surname (and for a company its name) shows the hint, and the same customer from both is shown once', async () => {
    const api = customerApi({ [SEARCH]: bySearch });
    await renderPanel(NEW, api);
    const form = await openDialog();
    await userEvent.type(form.getByRole('textbox', { name: 'Nazwisko' }), 'Przykładowy');
    await userEvent.type(form.getByRole('textbox', { name: 'Telefon' }), '600000001');
    await form.findByText(`Podobny klient: ${JAN_TEXT}`);
    await waitFor(() => {
      expect(api.calls(SEARCH).length).toBeGreaterThanOrEqual(3);
    });
    expect(form.getAllByText(`Podobny klient: ${JAN_TEXT}`)).toHaveLength(1);
    await userEvent.click(form.getByRole('radio', { name: 'Firma' }));
    await userEvent.type(form.getByRole('textbox', { name: 'Nazwa firmy' }), 'Firma Testowa');
    expect(await form.findByText(`Podobny klient: ${JAN_TEXT}`)).toBeTruthy();
  });

  it('EVM-020 AC3 a failing similar search shows nothing and does not stop the save', async () => {
    const api = customerApi({
      [SEARCH]: (request) =>
        (parseBody(request.body) as { query: string }).query === 'xyz' ? json(200, { items: [], nextCursor: null }) : problem(500, 'x'),
      [CREATE]: (request) => savedCustomer(request.body),
    });
    await renderPanel(NEW, api);
    const form = await openDialog();
    await fillPerson(form);
    await waitFor(() => {
      expect(api.calls(SEARCH).length).toBeGreaterThan(1);
    });
    expect(form.queryByText(/Podobny klient/)).toBeNull();
    await submit(form);
    await screen.findByText(JAN_TEXT);
  });
});

describe('draft in the memory of the tab and "Anuluj" (EVM-020 AC8)', () => {
  it('EVM-020 AC8 the chosen customer is a draft "Szkic w tej karcie · hh:mm" kept in the memory only and back after leaving and returning', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const api = customerApi({ [SEARCH]: found(JAN) });
    const { history } = await renderPanel(NEW, api);
    expect(screen.queryByText(/Szkic w tej karcie/)).toBeNull();
    await userEvent.type(combobox(), 'przykl');
    await userEvent.click(await screen.findByRole('option', { name: /Jan Przykładowy/ }));
    expect(screen.getByText(/Szkic w tej karcie · \d{2}:\d{2}/)).toBeTruthy();
    expect(screen.getByText('Szkic znika po zamknięciu karty lub wylogowaniu.')).toBeTruthy();
    await act(async () => {
      history.push('/work-orders');
      await Promise.resolve();
    });
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    await userEvent.click(screen.getByRole('button', { name: 'Nowe zlecenie' }));
    expect(await screen.findByText(JAN_TEXT)).toBeTruthy();
    expect(history.location.pathname).toBe(NEW);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('EVM-020 AC8 a broken draft is no draft', async () => {
    const { saveDraft } = await import('../src/session/draft-store.ts');
    saveDraft(ACTIVE_SESSION.user.id, 'work-order-new', '{not json');
    const first = await renderPanel(NEW, customerApi());
    expect(combobox()).toBeTruthy();
    first.unmount();
    saveDraft(ACTIVE_SESSION.user.id, 'work-order-new', JSON.stringify({ customer: { id: 1 }, savedAt: 1 }));
    await renderPanel(NEW, customerApi());
    expect(combobox()).toBeTruthy();
  });

  it('EVM-020 AC8 "Anuluj" of an empty form leaves at once; with a customer it asks, "Wróć do formularza" stays and "Odrzuć zmiany" leaves and drops the draft', async () => {
    const api = customerApi({ [SEARCH]: found(JAN) });
    const { history } = await renderPanel(NEW, api);
    await userEvent.type(combobox(), 'przykl');
    await userEvent.click(await screen.findByRole('option', { name: /Jan Przykładowy/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Odrzucić nowe zlecenie?' });
    expect(within(confirm).getByText('Wpisane dane znikną.')).toBeTruthy();
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Wróć do formularza' }));
    await userEvent.click(within(confirm).getByRole('button', { name: 'Wróć do formularza' }));
    expect(history.location.pathname).toBe(NEW);
    await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(screen.getByRole('button', { name: 'Odrzuć zmiany' }));
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    expect(history.location.pathname).toBe('/work-orders');
    await userEvent.click(screen.getByRole('button', { name: 'Nowe zlecenie' }));
    expect(await screen.findByRole('combobox', { name: 'Klient' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
  });
});

describe('who creates work orders (EVM-020 AC7)', () => {
  it('EVM-020 AC7 Tylko odczyt has no "Nowe zlecenie" on the list and gets "Nie możesz tworzyć zleceń." from a link, without any customer request', async () => {
    const api = customerApi({}, roleSession('read_only'));
    const { history } = await renderPanel('/work-orders', api);
    expect(screen.queryByRole('button', { name: 'Nowe zlecenie' })).toBeNull();
    await act(async () => {
      history.push(NEW);
      await Promise.resolve();
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie możesz tworzyć zleceń.' })).toBeTruthy();
    expect(screen.getByText('Poproś administratora o uprawnienia.')).toBeTruthy();
    expect(document.title).toBe('Brak dostępu · EVia Manager');
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Wróć do listy' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zlecenia' })).toBeTruthy();
    expect(api.calls(SEARCH)).toHaveLength(0);
    expect(api.calls(CREATE)).toHaveLength(0);
  });

  it('EVM-020 AC7 Administrator and Edytor see "Nowe zlecenie" on the list and it opens W-05', async () => {
    for (const session of [ACTIVE_SESSION, roleSession('editor')]) {
      const { history, unmount } = await renderPanel('/work-orders', customerApi({}, session));
      await userEvent.click(screen.getByRole('button', { name: 'Nowe zlecenie' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Nowe zlecenie' })).toBeTruthy();
      expect(history.location.pathname).toBe(NEW);
      expect(screen.getByText('Numer zlecenia nadamy po zapisie.')).toBeTruthy();
      expect(screen.getByRole('group', { name: '1. Klient' })).toBeTruthy();
      expect(await axeViolations(document.body)).toEqual([]);
      unmount();
    }
  });
});
