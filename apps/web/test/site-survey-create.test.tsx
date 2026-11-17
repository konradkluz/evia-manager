import type { CurrentSession } from '@evia/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts, readDraft } from '../src/session/draft-store.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { browserStorageText, surveyOrder } from './site-survey-api.ts';
import { userEvent } from './user.ts';
import { workOrderRoutes } from './work-order-api.ts';

// EVM-138 AC2: the light form of a site survey in W-05 "Nowe zlecenie".
const SITE_SEARCH = 'POST /api/v1/sites/search';
const SITE_CREATE = 'POST /api/v1/sites';
const USERS = 'GET /api/v1/users/assignable';
const CREATE = 'POST /api/v1/site-surveys';
const NEW_SURVEY = '/work-orders/new?rodzaj=wizja';
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PHONE = '600 123 456';
const anyUuid = expect.stringMatching(UUIDV7) as string;

const ME = '11111111-1111-4111-8111-111111111111';
const PIOTR = '22222222-2222-4222-8222-222222222222';
const GARAGE = {
  id: '01968f3e-0000-7000-8000-00000000bbbb',
  siteType: 'multi_family_garage',
  street: 'ul. Testowa',
  buildingNumber: '7',
  postalCode: '00-001',
  city: 'Warszawa',
};

const surveysOn = (role: 'administrator' | 'editor' | 'read_only' = 'administrator', on = true): CurrentSession => ({
  ...ACTIVE_SESSION,
  user: { ...ACTIVE_SESSION.user, role },
  features: { siteSurveys: on },
});

const items =
  (...found: object[]): Handler =>
  () =>
    json(200, { items: found, nextCursor: null });

/** The creation answers `201` with the survey of the id the panel sent, and registers the reads of its W-06. */
function surveyCreateApi(routes: Record<string, Handler> = {}, session: CurrentSession = surveysOn()) {
  const api: ReturnType<typeof activeSessionApi> = activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    [SITE_SEARCH]: items(GARAGE),
    [USERS]: items({ id: ME, displayName: 'Anna Testowa' }, { id: PIOTR, displayName: 'Piotr Testowy' }),
    [CREATE]: (request) => {
      const body = parseBody(request.body) as { id: string };
      const created = surveyOrder({ id: body.id, number: 'ZL-2026-0051' });
      for (const [route, handler] of Object.entries(workOrderRoutes(body.id, { header: () => json(200, created, { ETag: '"5"' }) }))) {
        api.set(route, handler);
      }
      return json(201, created, { ETag: '"5"', Location: `/api/v1/work-orders/${body.id}` });
    },
    ...routes,
  });
  return api;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearDrafts();
});

async function pickSite() {
  await userEvent.type(screen.getByRole('combobox', { name: 'Lokalizacja' }), 'testowa');
  await screen.findByRole('option', { name: /ul\. Testowa 7/ });
  await userEvent.keyboard('{ArrowDown}{Enter}');
}
const phoneField = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Telefon zamawiającego (opcjonalnie)' });
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Załóż wizję lokalną' }));
const summaryOf = () => screen.getByText('Popraw te pola, aby założyć wizję lokalną').closest<HTMLElement>('[role="alert"]') as HTMLElement;

describe('W-05 "Wizja lokalna" — the form (EVM-138 AC2)', () => {
  it('EVM-138 AC2 the form has the location, the phone of the requester and the keeper — and none of the sections of an order or of a site (no OSD, manager, power, notes)', async () => {
    await renderPanel(NEW_SURVEY, surveyCreateApi());
    expect(screen.getByRole('heading', { level: 1, name: 'Nowe zlecenie' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '1. Lokalizacja' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '2. Zamawiający' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '3. Opiekun' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Załóż wizję lokalną' })).toBeTruthy();
    // an order: no customer, no template, no title, no planned date, no description
    for (const name of ['Klient', 'Tytuł', 'Opis'])
      expect(screen.queryByRole('combobox', { name }) ?? screen.queryByRole('textbox', { name })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Puste zlecenie/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Utwórz zlecenie' })).toBeNull();
    // a new site is light: the type, the address and the spot only
    await userEvent.click(screen.getByRole('radio', { name: 'Nowa lokalizacja' }));
    expect(screen.getByRole('combobox', { name: 'Typ obiektu' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Ulica' })).toBeTruthy();
    for (const label of [/^OSD/, /^Zarządca/, /^Moc przyłączeniowa/, /^PPE/, /^Notatki do lokalizacji/]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('EVM-138 AC2 the hints: "Tylko numer — nie wpisuj imion w opisach." and the keeper one that follows the choice (a polite status)', async () => {
    await renderPanel(NEW_SURVEY, surveyCreateApi());
    expect(phoneField().getAttribute('type')).toBe('tel');
    expect(phoneField().getAttribute('autocomplete')).toBe('off');
    expect(screen.getByText('Tylko numer — nie wpisuj imion w opisach.')).toBeTruthy();
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Opiekun' });
    // the person who is logged in is the default keeper
    expect(select.value).toBe(ME);
    const status = screen.getByText('Wizja będzie widoczna na telefonie opiekuna.').closest('[role="status"]') as HTMLElement;
    await userEvent.selectOptions(select, 'Bez opiekuna');
    expect(within(status).getByText('Bez opiekuna wizja nie będzie widoczna na żadnym telefonie.')).toBeTruthy();
    expect(screen.queryByText('Wizja będzie widoczna na telefonie opiekuna.')).toBeNull();
  });

  it('EVM-138 AC2 "Załóż wizję lokalną" sends POST /site-surveys with the site, the phone and the keeper (no title, no customer, no template), an id and a key of UUIDv7, goes to W-06 with the number and the toast', async () => {
    const api = surveyCreateApi();
    const { history } = await renderPanel(NEW_SURVEY, api);
    await pickSite();
    await userEvent.type(phoneField(), PHONE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Opiekun' }), 'Piotr Testowy');
    await submit();
    expect(await screen.findByRole('heading', { level: 1, name: /ZL-2026-0051/ })).toBeTruthy();
    const [call] = api.calls(CREATE);
    expect(call?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    expect(call?.headers.get('X-CSRF-Token')).toBe('csrf-active');
    const body = parseBody(call?.body ?? '') as Record<string, unknown>;
    expect(body).toEqual({ id: anyUuid, siteId: GARAGE.id, requesterPhone: PHONE, assigneeUserId: PIOTR });
    expect(history.location.pathname).toBe(`/work-orders/${String(body['id'])}`);
    expect(await screen.findByText('Utworzono wizję lokalną ZL-2026-0051.')).toBeTruthy();
    expect(document.title).toBe('ZL-2026-0051 · EVia Manager');
  });

  it('EVM-138 AC2 an empty phone is absent; the default keeper is the person who is logged in; "Bez opiekuna" sends no keeper', async () => {
    const api = surveyCreateApi();
    await renderPanel(NEW_SURVEY, api);
    await pickSite();
    await submit();
    await waitFor(() => {
      expect(api.calls(CREATE)).toHaveLength(1);
    });
    expect(parseBody(api.calls(CREATE)[0]?.body ?? '')).toEqual({ id: anyUuid, siteId: GARAGE.id, assigneeUserId: ME });
  });

  it('EVM-138 AC2 "Bez opiekuna" is a survey without a keeper: no assigneeUserId in the body', async () => {
    const api = surveyCreateApi();
    await renderPanel(NEW_SURVEY, api);
    await pickSite();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Opiekun' }), 'Bez opiekuna');
    await submit();
    await waitFor(() => {
      expect(api.calls(CREATE)).toHaveLength(1);
    });
    expect(parseBody(api.calls(CREATE)[0]?.body ?? '')).toEqual({ id: anyUuid, siteId: GARAGE.id });
  });

  it('EVM-138 AC2 a new site is saved first (POST /sites, as in the order), then the survey is created for it', async () => {
    const api = surveyCreateApi({
      [SITE_CREATE]: (request) =>
        json(
          201,
          {
            ...(parseBody(request.body) as object),
            version: 1,
            createdAt: '2026-10-07T10:00:00.000Z',
            updatedAt: '2026-10-07T10:00:00.000Z',
          },
          { ETag: '"1"' },
        ),
    });
    await renderPanel(NEW_SURVEY, api);
    await userEvent.click(screen.getByRole('radio', { name: 'Nowa lokalizacja' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'Dom jednorodzinny');
    await userEvent.type(screen.getByRole('textbox', { name: 'Ulica' }), 'ul. Nowa');
    await userEvent.type(screen.getByRole('textbox', { name: 'Nr budynku' }), '3');
    await userEvent.type(screen.getByRole('textbox', { name: 'Kod pocztowy' }), '00-002');
    await userEvent.type(screen.getByRole('textbox', { name: 'Miasto' }), 'Warszawa');
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz lokalizację' }));
    await screen.findByText(/ul\. Nowa 3/);
    const saved = parseBody(api.calls(SITE_CREATE)[0]?.body ?? '') as { id: string; osd?: unknown; manager?: unknown };
    expect(saved.osd).toBeUndefined();
    await submit();
    await waitFor(() => {
      expect(api.calls(CREATE)).toHaveLength(1);
    });
    expect((parseBody(api.calls(CREATE)[0]?.body ?? '') as { siteId: string }).siteId).toBe(saved.id);
  });
});

describe('W-05 "Wizja lokalna" — validation and errors (EVM-138 AC2)', () => {
  it('EVM-138 AC2 without a site: the summary of errors gets the focus, the field says "Podaj adres lokalizacji." and nothing is sent', async () => {
    const api = surveyCreateApi();
    await renderPanel(NEW_SURVEY, api);
    await submit();
    expect(document.activeElement).toBe(summaryOf());
    expect(within(summaryOf()).getByText('Podaj adres lokalizacji.')).toBeTruthy();
    expect(api.calls(CREATE)).toHaveLength(0);
  });

  it('EVM-138 AC2 a phone that is not a phone: "Podaj numer telefonu, np. 600 123 456." under the field, aria-invalid, no request; correcting it clears the message', async () => {
    const api = surveyCreateApi();
    await renderPanel(NEW_SURVEY, api);
    await pickSite();
    await userEvent.type(phoneField(), 'abc');
    await submit();
    expect(within(summaryOf()).getByText('Podaj numer telefonu, np. 600 123 456.')).toBeTruthy();
    expect(phoneField().getAttribute('aria-invalid')).toBe('true');
    expect(api.calls(CREATE)).toHaveLength(0);
    await userEvent.click(within(summaryOf()).getByText('Podaj numer telefonu, np. 600 123 456.'));
    expect(document.activeElement).toBe(phoneField());
    await userEvent.clear(phoneField());
    await userEvent.type(phoneField(), PHONE);
    expect(screen.queryByText('Podaj numer telefonu, np. 600 123 456.')).toBeNull();
  });

  it('EVM-138 AC2 the errors of the server point at the fields: /requesterPhone invalid_format and /assigneeUserId assignee_unavailable (the list of keepers is read again)', async () => {
    const api = surveyCreateApi({
      [CREATE]: () =>
        problem(400, 'validation_failed', {
          errors: [
            { pointer: '/requesterPhone', code: 'invalid_format' },
            { pointer: '/assigneeUserId', code: 'assignee_unavailable' },
          ],
        }),
    });
    await renderPanel(NEW_SURVEY, api);
    await pickSite();
    await userEvent.type(phoneField(), '1234567');
    await submit();
    expect((await screen.findAllByText('Ta osoba nie może być opiekunem. Wybierz inną.')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Podaj numer telefonu, np. 600 123 456.').length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(summaryOf());
    await waitFor(() => {
      expect(api.calls(USERS).length).toBeGreaterThan(1);
    });
  });

  it('EVM-138 AC2 404: one neutral message (the function is off or the site is not available), the session is read again and the form stays with its data', async () => {
    const api = surveyCreateApi({ [CREATE]: () => problem(404, 'not_found') });
    await renderPanel(NEW_SURVEY, api);
    await pickSite();
    await userEvent.type(phoneField(), PHONE);
    await submit();
    const alert = await screen.findByText(/lokalizacja jest niedostępna albo wizje lokalne są teraz wyłączone/);
    expect(document.activeElement).toBe(alert.closest('[role="alert"]'));
    await waitFor(() => {
      expect(api.calls(SESSION_ROUTE).length).toBeGreaterThan(1);
    });
    expect(phoneField().value).toBe(PHONE);
  });

  it('EVM-138 AC2 404 while the function was switched off: the session says so, the choice "Rodzaj" goes, the order form is shown and the message stays', async () => {
    const api = surveyCreateApi({ [CREATE]: () => problem(404, 'not_found') });
    await renderPanel(NEW_SURVEY, api);
    await pickSite();
    api.set(SESSION_ROUTE, () => json(200, surveysOn('administrator', false)));
    await submit();
    expect(await screen.findByRole('button', { name: 'Utwórz zlecenie' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Rodzaj' })).toBeNull();
    expect(screen.getByText(/lokalizacja jest niedostępna albo wizje lokalne są teraz wyłączone/)).toBeTruthy();
  });

  it('EVM-138 AC2 a lost answer (5xx) is retried with the same id and key — nothing is created twice; a refused id (409 id_conflict) starts a new pair', async () => {
    let answers = 0;
    const api = surveyCreateApi({
      [CREATE]: (request) => {
        answers += 1;
        if (answers === 1) return problem(503, 'unavailable');
        if (answers === 2) return problem(409, 'id_conflict');
        return json(201, surveyOrder({ id: (parseBody(request.body) as { id: string }).id }), { ETag: '"5"' });
      },
    });
    await renderPanel(NEW_SURVEY, api);
    await pickSite();
    await submit();
    expect(await screen.findByText(/Nie udało się założyć wizji\. Spróbuj ponownie — nie założymy jej dwa razy\./)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByText(/Nie udało się założyć wizji/).closest('[role="alert"]'));
    await submit();
    await waitFor(() => {
      expect(api.calls(CREATE)).toHaveLength(2);
    });
    const [first, second] = api.calls(CREATE);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect((parseBody(second?.body ?? '') as { id: string }).id).toBe((parseBody(first?.body ?? '') as { id: string }).id);
    // 409 id_conflict: the next try is a new pair
    await screen.findByText(/Nie udało się założyć wizji/);
    await submit();
    await waitFor(() => {
      expect(api.calls(CREATE)).toHaveLength(3);
    });
    expect(api.calls(CREATE)[2]?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
  });

  it('EVM-138 AC2 429 names the seconds to wait; 403 says "Nie możesz zakładać wizji lokalnych."', async () => {
    let status = 429;
    const api = surveyCreateApi({
      [CREATE]: () => (status === 429 ? problem(429, 'rate_limited', {}, { 'Retry-After': '17' }) : problem(403, 'forbidden')),
    });
    await renderPanel(NEW_SURVEY, api);
    await pickSite();
    await submit();
    expect(await screen.findByText('Zbyt wiele prób. Spróbuj ponownie za 17 s.')).toBeTruthy();
    status = 403;
    await submit();
    expect(await screen.findByText('Nie możesz zakładać wizji lokalnych. Poproś administratora.')).toBeTruthy();
  });

  it('EVM-138 AC2 offline: the banner, the data stay, the button is disabled with an explanation, nothing is sent', async () => {
    const api = surveyCreateApi();
    await renderPanel(NEW_SURVEY, api);
    await pickSite();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(
      screen.getAllByText('Brak połączenia. Wpisane dane zostają w tej karcie — zapisz je, gdy połączenie wróci.').length,
    ).toBeGreaterThan(0);
    const button = screen.getByRole('button', { name: 'Załóż wizję lokalną' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe('survey-offline-hint');
    expect(screen.getByText('Zapiszesz po powrocie połączenia.')).toBeTruthy();
    await userEvent.click(button);
    expect(api.calls(CREATE)).toHaveLength(0);
  });

  it('EVM-138 AC2 loading: the button is in the loading state and the form is blocked until the answer', async () => {
    let release: (() => void) | undefined;
    const api = surveyCreateApi({
      [CREATE]: async (request) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return json(201, surveyOrder({ id: (parseBody(request.body) as { id: string }).id }), { ETag: '"5"' });
      },
    });
    await renderPanel(NEW_SURVEY, api);
    await pickSite();
    await submit();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Załóż wizję lokalną/ }).getAttribute('aria-busy')).toBe('true');
    });
    expect(phoneField().matches(':disabled')).toBe(true);
    act(() => {
      release?.();
    });
  });
});

describe('W-05 "Wizja lokalna" — the phone is personal data (EVM-138 AC2)', () => {
  it('EVM-138 AC2 the phone of the requester is never in the draft, the address, the title of the tab, the browser storage or the cache — and not in the console', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const api = surveyCreateApi({ [CREATE]: () => problem(503, 'unavailable') });
    const { history } = await renderPanel(NEW_SURVEY, api);
    await pickSite();
    await userEvent.type(phoneField(), PHONE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Opiekun' }), 'Piotr Testowy');
    await submit();
    await screen.findByText(/Nie udało się założyć wizji/);
    // the draft holds what the form restores (the site, the keeper) — not the phone
    const draft = readDraft(ME, 'work-order-new-survey') ?? '';
    expect(draft).toContain(GARAGE.id);
    expect(draft).toContain(PIOTR);
    for (const place of [draft, history.location.href, document.title, browserStorageText()]) {
      expect(place).not.toContain('600');
      expect(place).not.toContain('123 456');
    }
    expect(JSON.stringify([log.mock.calls, error.mock.calls, warn.mock.calls])).not.toContain('123 456');
    expect(history.location.search).toBe('?rodzaj=wizja');
  });

  it('EVM-138 AC2 "Anuluj" asks before it drops the draft; "Odrzuć zmiany" leaves for the list and the draft is gone', async () => {
    const api = surveyCreateApi();
    const { history } = await renderPanel(NEW_SURVEY, api);
    await pickSite();
    await userEvent.type(phoneField(), PHONE);
    await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(await screen.findByRole('alertdialog', { name: 'Odrzucić szkic wizji lokalnej?' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Odrzuć zmiany' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/work-orders');
    });
    expect(readDraft(ME, 'work-order-new-survey')).toBeUndefined();
  });
});

describe('W-05 "Wizja lokalna" — accessibility (EVM-138 AC2, AC6)', () => {
  it('EVM-138 AC6 the whole form has no accessibility violations (axe), also with errors', async () => {
    await renderPanel(NEW_SURVEY, surveyCreateApi());
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.type(phoneField(), 'abc');
    await submit();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
