import type { CurrentSession } from '@evia/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts } from '../src/session/draft-store.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { CUSTOMER, SITE, workOrderRoutes } from './work-order-api.ts';

// No pause between keystrokes: typing many characters per test would otherwise run close to the 5 s limit on a slow CI runner.
const userEvent = userEventDefault.setup({ delay: null });
const CUSTOMER_SEARCH = 'POST /api/v1/customers/search';
const SITE_SEARCH = 'POST /api/v1/sites/search';
const TEMPLATES = 'GET /api/v1/catalog/work-order-templates';
const USERS = 'GET /api/v1/users/assignable';
const CREATE = 'POST /api/v1/work-orders';
const NEW = '/work-orders/new';
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ME = '11111111-1111-4111-8111-111111111111';
const PIOTR = '22222222-2222-4222-8222-222222222222';
const JAN = { id: '01968f3e-0000-7000-8000-00000000aaaa', displayName: 'Jan Przykładowy', phone: '+48600000001' };
const GARAGE = {
  id: '01968f3e-0000-7000-8000-00000000bbbb',
  siteType: 'multi_family_garage',
  street: 'ul. Testowa',
  buildingNumber: '7',
  postalCode: '00-001',
  city: 'Warszawa',
};
const FULL_ID = '01968f3e-0000-7000-8000-00000000f001';
const INSTALL_ID = '01968f3e-0000-7000-8000-00000000f002';
const HOUSE_ID = '01968f3e-0000-7000-8000-00000000f003';

const itemNames = [
  'Zgody administracji / wspólnoty',
  'Ekspertyza techniczna',
  'Opinia ppoż',
  'Projekt instalacji',
  'Uzgodnienia z OSD',
  'Instalacja zasilająca',
  'Dostawa ładowarki (z oferty)',
  'Montaż i uruchomienie',
  'Pomiary i odbiór',
];
const template = (id: string, name: string, siteTypeHint: string | null, names: string[]) => ({
  id,
  code: `code_${id.slice(-3)}`,
  name,
  siteTypeHint,
  isActive: true,
  items: names.map((item, index) => ({
    code: `item_${String(index)}`,
    name: item,
    position: index + 1,
    defaultQuantity: 1,
    parameterSetCode: null,
    defaultParameters: {},
  })),
  // The API still sends them (EVM-019); the card and the preview must not show them (EVM-031, EVM-053).
  procedures: [{ code: 'osd', name: 'Uzgodnienia z OSD', stageCount: 7 }],
  paymentMilestones: [
    { code: 'advance', name: 'Zaliczka', position: 1, sharePercent: 20, invoiceHint: 'Po akceptacji', paymentTermDays: 7 },
  ],
});
const FULL = template(FULL_ID, 'Garaż — pełny proces', 'multi_family_garage', itemNames);
const INSTALL = template(INSTALL_ID, 'Garaż — sama instalacja', 'multi_family_garage', itemNames.slice(0, 7));
const HOUSE = template(HOUSE_ID, 'Dom — montaż ładowarki', 'single_family_house', itemNames.slice(0, 2));

const order = (body: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: body['id'],
  number: 'ZL-2026-0042',
  title: typeof body['title'] === 'string' ? body['title'] : 'Garaż — pełny proces',
  status: 'new',
  customer: { id: JAN.id, displayName: JAN.displayName },
  site: GARAGE,
  coordinator: { id: ME, displayName: 'Anna Testowa' },
  scopeItems: [],
  version: 1,
  createdAt: '2026-10-07T10:00:00.000Z',
  ...extra,
});

const items =
  (...found: object[]): Handler =>
  () =>
    json(200, { items: found, nextCursor: null });

const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } });

/** Registers the four reads of W-06 (EVM-018) for the order just created, so the page opened after the creation can ask for them. */
function registerReads(api: ReturnType<typeof activeSessionApi>, created: Record<string, unknown>) {
  const header = Object.fromEntries(Object.entries(created).filter(([key]) => key !== 'scopeItems'));
  const routes = workOrderRoutes(String(created['id']), {
    header: () => json(200, header, { ETag: '"1"' }),
    scope: () => json(200, { items: [] }),
    customer: () => json(200, { ...CUSTOMER, displayName: JAN.displayName }),
    site: () => json(200, SITE),
  });
  for (const [route, handler] of Object.entries(routes)) api.set(route, handler);
}

function orderApi(routes: Record<string, Handler> = {}, session: CurrentSession = ACTIVE_SESSION) {
  const api: ReturnType<typeof activeSessionApi> = activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    [CUSTOMER_SEARCH]: items(JAN),
    [SITE_SEARCH]: items(GARAGE),
    [TEMPLATES]: () => json(200, { items: [FULL, INSTALL, HOUSE], nextCursor: null }),
    [USERS]: items({ id: ME, displayName: 'Anna Testowa' }, { id: PIOTR, displayName: 'Piotr Testowy' }),
    [CREATE]: (request) => {
      const created = order(parseBody(request.body) as Record<string, unknown>);
      registerReads(api, created);
      return json(201, created, { ETag: '"1"' });
    },
    ...routes,
  });
  return api;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearDrafts();
});

async function pickCustomer() {
  await userEvent.type(screen.getByRole('combobox', { name: 'Klient' }), 'przyk');
  await screen.findByRole('option', { name: /Jan Przykładowy/ });
  await userEvent.keyboard('{ArrowDown}{Enter}');
}

async function pickSite() {
  await userEvent.type(screen.getByRole('combobox', { name: 'Lokalizacja' }), 'testowa');
  await screen.findByRole('option', { name: /ul\. Testowa 7/ });
  await userEvent.keyboard('{ArrowDown}{Enter}');
}

const card = (name: string | RegExp) => screen.findByRole('radio', { name });
/** The summary of errors of the form (the field messages are alerts too, so the summary is found by its sentence). */
const summaryOf = () =>
  screen.getByText('Popraw zaznaczone pola, aby utworzyć zlecenie.').closest<HTMLElement>('[role="alert"]') as HTMLElement;
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Utwórz zlecenie' }));

async function fillAndChoose(name: string | RegExp = /Garaż — pełny proces/) {
  await pickCustomer();
  await pickSite();
  await userEvent.click(await card(name));
}

describe('W-05 section "3. Szablon" (EVM-022 AC1, AC2)', () => {
  it('EVM-022 AC1 the cards of templates for the type of the object show only the scope — "9 pozycji" — and "Pokaż wszystkie" takes the filter off', async () => {
    const api = orderApi();
    await renderPanel(NEW, api);
    expect(await card(/Garaż — pełny proces/)).toBeTruthy();
    // before a site is chosen there is no type to filter by
    expect(screen.getByRole('radio', { name: /Dom — montaż ładowarki/ })).toBeTruthy();
    await pickSite();
    expect(screen.getByText('Szablony dla typu: Garaż w budynku wielorodzinnym.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Garaż — pełny proces 9 pozycji' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Garaż — sama instalacja 7 pozycji' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Dom — montaż ładowarki/ })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Puste zlecenie (bez szablonu)' })).toBeTruthy();
    // nothing the system does not create yet: no processes, no instalments, no payment plan
    const section = screen.getByRole('region', { name: '3. Szablon' });
    expect(section.textContent).not.toMatch(/procesów|procesy|transz|Plan płatności|Kwoty transz/i);
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż wszystkie' }));
    expect(screen.getByRole('radio', { name: 'Dom — montaż ładowarki 2 pozycje' })).toBeTruthy();
    expect(screen.getByText('Wszystkie aktywne szablony.')).toBeTruthy();
    expect(api.calls(TEMPLATES)).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż tylko dla typu obiektu' }));
    expect(screen.queryByRole('radio', { name: /Dom — montaż ładowarki/ })).toBeNull();
  });

  it('EVM-022 AC1 the chosen template shows its preview "Zakres (9 pozycji)" in a Disclosure — the names of items only, no processes, instalments or payment plan', async () => {
    await renderPanel(NEW, orderApi());
    await pickSite();
    expect(screen.queryByRole('button', { name: 'Pokaż szczegóły szablonu' })).toBeNull();
    await userEvent.click(await card(/Garaż — pełny proces/));
    const toggle = screen.getByRole('button', { name: 'Pokaż szczegóły szablonu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(screen.getByRole('heading', { name: 'Zakres (9 pozycji)' })).toBeTruthy();
    expect(screen.getByText('Pomiary i odbiór')).toBeTruthy();
    expect(screen.getByText('Typ obiektu: Garaż w budynku wielorodzinnym')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Procesy|procesów|transz|Plan płatności|Kwoty transz|Zaliczka/);
  });

  it('EVM-022 AC1 at breakpoint.expanded the preview stands on the right (announced politely), without the Disclosure, and follows the choice', async () => {
    const original = globalThis.getComputedStyle.bind(globalThis);
    // The stylesheet is not loaded in jsdom: the probe of the layout (hidden by `expanded:hidden`) answers as at 1280 px.
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) =>
      element.classList.contains('expanded:hidden') ? ({ display: 'none' } as CSSStyleDeclaration) : original(element, pseudo),
    );
    await renderPanel(NEW, orderApi());
    await pickSite();
    const aside = screen.getByRole('complementary', { name: 'Podgląd szablonu' });
    expect(aside.getAttribute('aria-live')).toBe('polite');
    expect(within(aside).queryByRole('heading', { name: /Zakres/ })).toBeNull();
    await userEvent.click(await card(/Garaż — pełny proces/));
    expect(screen.queryByRole('button', { name: 'Pokaż szczegóły szablonu' })).toBeNull();
    expect(within(aside).getByRole('heading', { name: 'Zakres (9 pozycji)' })).toBeTruthy();
    expect(within(aside).getByRole('heading', { name: 'Podgląd szablonu' })).toBeTruthy();
    expect(within(aside).getByText('Garaż — pełny proces')).toBeTruthy();
    await userEvent.click(await card(/sama instalacja/));
    expect(within(aside).getByRole('heading', { name: 'Zakres (7 pozycji)' })).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-022 AC1 the title shows the name of the template until the person types, then the typed text', async () => {
    const api = orderApi();
    await renderPanel(NEW, api);
    await pickCustomer();
    await pickSite();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Tytuł' }).value).toBe('');
    await userEvent.click(await card(/sama instalacja/));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Tytuł' }).value).toBe('Garaż — sama instalacja');
    await userEvent.click(await card(/pełny proces/));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Tytuł' }).value).toBe('Garaż — pełny proces');
    await userEvent.type(screen.getByRole('textbox', { name: 'Tytuł' }), ' dla wspólnoty');
    await userEvent.click(await card(/sama instalacja/));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Tytuł' }).value).toBe('Garaż — pełny proces dla wspólnoty');
  });

  it('EVM-022 AC2 "Puste zlecenie (bez szablonu)" sends templateId null and the title "Nowe zlecenie"', async () => {
    const api = orderApi();
    await renderPanel(NEW, api);
    await pickCustomer();
    await pickSite();
    await userEvent.click(screen.getByRole('radio', { name: 'Puste zlecenie (bez szablonu)' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Tytuł' }).value).toBe('Nowe zlecenie');
    await submit();
    await waitFor(() => {
      expect(api.calls(CREATE)).toHaveLength(1);
    });
    const body = parseBody(api.calls(CREATE)[0]?.body ?? '') as Record<string, unknown>;
    expect(body['templateId']).toBeNull();
    expect(body).not.toHaveProperty('title');
  });

  it('EVM-022 AC2 without any active template the section says so and offers the empty order', async () => {
    await renderPanel(NEW, orderApi({ [TEMPLATES]: items() }));
    expect(await screen.findByText('Brak aktywnych szablonów. Utwórz puste zlecenie i dodaj pozycje w zleceniu.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Puste zlecenie (bez szablonu)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pokaż wszystkie' })).toBeNull();
  });

  it('EVM-022 AC2 no template for the type of the object: the section says so and "Pokaż wszystkie" brings the others', async () => {
    await renderPanel(NEW, orderApi({ [TEMPLATES]: items(HOUSE), [SITE_SEARCH]: items(GARAGE) }));
    await pickSite();
    expect(await screen.findByText('Brak szablonów dla tego typu obiektu.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż wszystkie' }));
    expect(screen.getByRole('radio', { name: /Dom — montaż ładowarki/ })).toBeTruthy();
  });

  it('EVM-022 AC8 while the templates load the section shows skeleton cards and announces the loading', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderPanel(
      NEW,
      orderApi({
        [TEMPLATES]: async () => {
          await gate;
          return json(200, { items: [FULL], nextCursor: null });
        },
      }),
    );
    const section = screen.getByRole('region', { name: '3. Szablon' });
    expect(within(section).getByText('Wczytujemy szablony…')).toBeTruthy();
    expect(section.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
    release();
    expect(await card(/Garaż — pełny proces/)).toBeTruthy();
    expect(within(section).queryByText('Wczytujemy szablony…')).toBeNull();
  });

  it('EVM-022 AC8 a failed read of the templates leaves the empty order possible and "Spróbuj ponownie" reads again', async () => {
    let fail = true;
    const api = orderApi({
      [TEMPLATES]: () => (fail ? problem(500, 'internal_error') : json(200, { items: [FULL], nextCursor: null })),
    });
    await renderPanel(NEW, api);
    expect(await screen.findByText(/Nie udało się wczytać szablonów/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Puste zlecenie (bez szablonu)' })).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await card(/Garaż — pełny proces/)).toBeTruthy();
  });
});

describe('W-05 "Utwórz zlecenie" (EVM-022 AC1, AC3, AC4)', () => {
  it('EVM-022 AC1 the body has the identifiers; the defaults (title, coordinator) are absent; 201 shows the toast and the header W-06 and the list asks again', async () => {
    const api = orderApi({
      'GET /api/v1/work-orders': () => json(200, { items: [], nextCursor: null }),
    });
    const { history } = await renderPanel(NEW, api);
    await fillAndChoose();
    await submit();
    expect(await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeTruthy();
    const [call, ...others] = api.calls(CREATE);
    expect(others).toEqual([]);
    const body = parseBody(call?.body ?? '') as Record<string, unknown>;
    expect(body).toEqual({ id: expect.stringMatching(UUIDV7) as string, customerId: JAN.id, siteId: GARAGE.id, templateId: FULL_ID });
    expect(call?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    expect(call?.headers.get('X-CSRF-Token')).toBe('csrf-active');
    expect(history.location.pathname).toBe(`/work-orders/${String(body['id'])}`);
    expect(screen.getByText('Utworzono zlecenie ZL-2026-0042.')).toBeTruthy();
    // W-06: number, title, status, customer, address of the site, coordinator, date of creation
    expect(screen.getByText('Garaż — pełny proces')).toBeTruthy();
    expect(screen.getByText('Nowe')).toBeTruthy();
    const main = within(screen.getByRole('main'));
    expect(main.getAllByText('Jan Przykładowy').length).toBeGreaterThan(0);
    expect(main.getAllByText('ul. Testowa 7, 00-001 Warszawa').length).toBeGreaterThan(0);
    expect(main.getByText('Anna Testowa')).toBeTruthy();
    expect(main.getByText('07.10.2026')).toBeTruthy();
    // EVM-018 AC5: the tab title is the number of the order and never a name or an address
    expect(document.title).toBe('ZL-2026-0042 · EVia Manager');
    expect(screen.queryByText(/Szkic w tej karcie/)).toBeNull();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-022 AC1 a chosen coordinator, planned date and description travel in the body, trimmed; an emptied optional field is absent', async () => {
    const api = orderApi();
    await renderPanel(NEW, api);
    await fillAndChoose();
    await userEvent.type(screen.getByRole('textbox', { name: 'Tytuł' }), ' — etap 1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Opiekun' }), 'Piotr Testowy');
    await userEvent.type(screen.getByLabelText('Planowana data (opcjonalnie)'), '2026-11-03');
    await userEvent.type(screen.getByRole('textbox', { name: 'Opis (opcjonalnie)' }), '  Parter, klatka B  ');
    await submit();
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    expect(parseBody(api.calls(CREATE)[0]?.body ?? '')).toEqual({
      id: expect.stringMatching(UUIDV7) as string,
      customerId: JAN.id,
      siteId: GARAGE.id,
      templateId: FULL_ID,
      title: 'Garaż — pełny proces — etap 1',
      assigneeUserId: PIOTR,
      plannedDate: '2026-11-03',
      description: 'Parter, klatka B',
    });
  });

  it('EVM-022 AC1 the coordinator defaults to the logged in person, who is first among the users even before the list arrives', async () => {
    await renderPanel(NEW, orderApi());
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Opiekun' });
    expect(select.value).toBe(ME);
    expect(within(select).getByRole('option', { name: 'Anna Testowa' })).toBeTruthy();
    expect(await within(select).findByRole('option', { name: 'Piotr Testowy' })).toBeTruthy();
    expect(select.value).toBe(ME);
  });

  it('EVM-022 AC3 nothing chosen: the summary of errors on top with links to the fields takes the focus, the messages stand by the fields, nothing is sent', async () => {
    const api = orderApi();
    await renderPanel(NEW, api);
    await submit();
    const summary = summaryOf();
    expect(summary.textContent).toContain('Popraw zaznaczone pola, aby utworzyć zlecenie.');
    expect(document.activeElement).toBe(summary);
    const links = within(summary).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Wybierz klienta.',
      'Wybierz lokalizację albo zapisz nową.',
      'Wybierz szablon albo „Puste zlecenie”.',
    ]);
    expect(screen.getAllByText('Wybierz szablon albo „Puste zlecenie”.')).toHaveLength(2);
    expect(api.calls(CREATE)).toHaveLength(0);
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(links[2] as HTMLElement);
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /Garaż — pełny proces/ }));
    await userEvent.click(links[0] as HTMLElement);
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Klient' }));
    // choosing something clears the message of that field, and its link in the summary
    await userEvent.click(screen.getByRole('radio', { name: /Garaż — pełny proces/ }));
    expect(screen.queryByText('Wybierz szablon albo „Puste zlecenie”.')).toBeNull();
  });

  it('EVM-022 AC3 a new site that is typed but not saved is not a chosen site', async () => {
    const api = orderApi();
    await renderPanel(NEW, api);
    await userEvent.click(screen.getByRole('radio', { name: 'Nowa lokalizacja' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Typ obiektu' }), 'Dom jednorodzinny');
    await pickCustomer();
    await userEvent.click(await card(/Dom — montaż ładowarki/));
    await submit();
    expect(screen.getByRole('link', { name: 'Wybierz lokalizację albo zapisz nową.' })).toBeTruthy();
    expect(api.calls(CREATE)).toHaveLength(0);
  });

  it('EVM-022 AC3 404: the messages of the customer and of the site stand by their fields (the API does not say which is gone) and the data stay', async () => {
    const api = orderApi({ [CREATE]: () => problem(404, 'not_found') });
    await renderPanel(NEW, api);
    await fillAndChoose();
    await submit();
    await screen.findAllByText('Nie znaleziono wybranego klienta. Wybierz innego.');
    expect(screen.getAllByText('Nie znaleziono wybranej lokalizacji. Wybierz inną.').length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(summaryOf());
    expect(screen.getByText(/Jan Przykładowy · /)).toBeTruthy();
    // choosing another customer clears its message
    await userEvent.click(screen.getByRole('button', { name: 'Zmień klienta' }));
    expect(screen.queryAllByText('Nie znaleziono wybranego klienta. Wybierz innego.')).toHaveLength(0);
    expect(screen.getAllByText('Nie znaleziono wybranej lokalizacji. Wybierz inną.').length).toBeGreaterThan(0);
  });

  it('EVM-022 AC3 422 template_unavailable: an alert by the section "Szablon" with the name, the choice is dropped, the list is read again and the focus is on the alert', async () => {
    let retired = false;
    const api = orderApi({
      [CREATE]: () => problem(422, 'template_unavailable'),
      [TEMPLATES]: () => json(200, { items: retired ? [INSTALL] : [FULL, INSTALL], nextCursor: null }),
    });
    await renderPanel(NEW, api);
    await fillAndChoose();
    retired = true;
    await submit();
    const alert = await screen.findByText('Szablon „Garaż — pełny proces” został wycofany. Wybierz inny szablon.');
    expect(alert.closest('[role="alert"]')).toBe(document.activeElement);
    await waitFor(() => {
      expect(screen.queryByRole('radio', { name: /pełny proces/ })).toBeNull();
    });
    expect((await card(/sama instalacja/)).getAttribute('checked')).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /sama instalacja/ }).checked).toBe(false);
    await userEvent.click(screen.getByRole('radio', { name: /sama instalacja/ }));
    expect(screen.queryByText(/został wycofany/)).toBeNull();
  });

  it('EVM-022 AC3 400 from the server: the codes of the fields become sentences by the fields and never show the value', async () => {
    const api = orderApi({
      [CREATE]: () =>
        problem(400, 'validation_failed', {
          errors: [
            { pointer: '/title', code: 'too_long' },
            { pointer: '/plannedDate', code: 'out_of_range' },
            { pointer: '/assigneeUserId', code: 'assignee_unavailable' },
          ],
        }),
    });
    await renderPanel(NEW, api);
    await fillAndChoose();
    await submit();
    await screen.findByText('Popraw zaznaczone pola, aby utworzyć zlecenie.');
    const summary = summaryOf();
    expect(
      within(summary)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Wpisano za dużo znaków.', 'Ten opiekun jest niedostępny. Wybierz innego.', 'Sprawdź wartość w tym polu.']);
    expect(document.activeElement).toBe(summary);
    await userEvent.click(within(summary).getByRole('link', { name: 'Ten opiekun jest niedostępny. Wybierz innego.' }));
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Opiekun' }));
    await waitFor(() => {
      expect(api.calls(USERS).length).toBeGreaterThan(1);
    });
  });

  it('EVM-022 AC4 a lost answer: the message, the data stay, and the retry sends the same id and Idempotency-Key — one order', async () => {
    let attempts = 0;
    const api = orderApi({
      [CREATE]: (request) => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('network down');
        return json(201, order(parseBody(request.body) as Record<string, unknown>), { ETag: '"1"', 'Idempotent-Replayed': 'true' });
      },
    });
    await renderPanel(NEW, api);
    await fillAndChoose();
    await submit();
    const alert = await screen.findByText('Nie udało się utworzyć zlecenia. Spróbuj ponownie — nie utworzymy go dwa razy.');
    expect(alert.closest('[role="alert"]')).toBe(document.activeElement);
    expect(screen.getByText(/Jan Przykładowy · /)).toBeTruthy();
    await submit();
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    const [first, second] = api.calls(CREATE);
    expect(second?.body).toBe(first?.body);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
  });

  it('EVM-022 AC4 changed content is a new request (a new id and key); a refused pair is renewed', async () => {
    let attempts = 0;
    const api = orderApi({
      [CREATE]: (request) => {
        attempts += 1;
        return attempts === 1 ? problem(409, 'id_conflict') : json(201, order(parseBody(request.body) as Record<string, unknown>));
      },
    });
    await renderPanel(NEW, api);
    await fillAndChoose();
    await submit();
    await screen.findByText(/Nie udało się utworzyć zlecenia/);
    await submit();
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    const [first, second] = api.calls(CREATE);
    expect(parseBody(second?.body ?? '')).not.toEqual(parseBody(first?.body ?? ''));
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
  });

  it('EVM-022 AC3 the other failures each have their sentence: 403, 409 in progress, 429 and an unexpected problem with its trace', async () => {
    const answers = [
      [problem(403, 'forbidden'), 'Nie możesz tworzyć zleceń. Poproś administratora o uprawnienia.'],
      [problem(409, 'idempotency_in_progress'), 'Zapis tego zlecenia jeszcze trwa. Spróbuj ponownie za chwilę.'],
      [problem(429, 'rate_limited', {}, { 'Retry-After': '30' }), 'Zbyt wiele zapytań. Spróbuj ponownie za 30 s.'],
      [
        problem(422, 'unexpected_problem'),
        'Nie udało się utworzyć zlecenia. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: abcdef01).',
      ],
    ] as const;
    let index = 0;
    const api = orderApi({ [CREATE]: () => answers[index]?.[0] ?? problem(500, 'internal_error') });
    await renderPanel(NEW, api);
    await fillAndChoose();
    for (index = 0; index < answers.length; index += 1) {
      await submit();
      const text = answers[index]?.[1] ?? '';
      expect(await screen.findByText(text)).toBeTruthy();
    }
  });

  it('EVM-022 AC8 while the request is awaited the button is in the loading state and the form is blocked', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = orderApi({
      [CREATE]: async (request) => {
        await gate;
        return json(201, order(parseBody(request.body) as Record<string, unknown>));
      },
    });
    await renderPanel(NEW, api);
    await fillAndChoose();
    await submit();
    const button = screen.getByRole('button', { name: 'Utwórz zlecenie' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Tytuł' }).matches(':disabled')).toBe(true);
    await userEvent.click(button);
    release();
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    expect(api.calls(CREATE)).toHaveLength(1);
  });
});

describe('W-05 draft and states (EVM-022 AC8)', () => {
  it('EVM-022 AC8 the template and the fields of the order are a draft in the memory of the tab only — back after leaving and returning, never in a browser store', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { history } = await renderPanel(NEW, orderApi());
    await fillAndChoose(/sama instalacja/);
    await userEvent.type(screen.getByRole('textbox', { name: 'Opis (opcjonalnie)' }), 'Klatka B');
    expect(screen.getByText(/Szkic w tej karcie · \d{2}:\d{2}/)).toBeTruthy();
    act(() => {
      history.push('/work-orders');
    });
    await screen.findByRole('heading', { level: 1, name: 'Zlecenia' });
    act(() => {
      history.push(NEW);
    });
    await screen.findByRole('heading', { level: 1, name: 'Nowe zlecenie' });
    expect((await card(/sama instalacja/)) as HTMLInputElement).toHaveProperty('checked', true);
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Opis (opcjonalnie)' }).value).toBe('Klatka B');
    expect(setItem).not.toHaveBeenCalled();
    expect(globalThis.localStorage.length).toBe(0);
    expect(globalThis.sessionStorage.length).toBe(0);
  });

  it('EVM-022 AC8 "Anuluj" of a form with only a template chosen asks; "Odrzuć zmiany" leaves', async () => {
    const { history } = await renderPanel(NEW, orderApi());
    await userEvent.click(await card('Puste zlecenie (bez szablonu)'));
    await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Odrzucić nowe zlecenie?' });
    expect(dialog.textContent).toContain('Wpisane dane znikną.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Odrzuć zmiany' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/work-orders');
    });
  });

  it('EVM-022 AC8 offline: the banner, the data stay and the button is disabled with an explanation; nothing is sent', async () => {
    const api = orderApi();
    await renderPanel(NEW, api);
    await fillAndChoose();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(
      screen.getAllByText('Brak połączenia. Wpisane dane zostają w tej karcie — zapisz je, gdy połączenie wróci.').length,
    ).toBeGreaterThan(0);
    const button = screen.getByRole('button', { name: 'Utwórz zlecenie' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe('work-order-offline-hint');
    expect(screen.getByText('Utworzenie zlecenia wymaga połączenia.')).toBeTruthy();
    await userEvent.click(button);
    expect(api.calls(CREATE)).toHaveLength(0);
    expect(screen.getByText(/Jan Przykładowy · /)).toBeTruthy();
  });

  it('EVM-022 AC8 the whole screen has no accessibility violations (axe) with a chosen template', async () => {
    await renderPanel(NEW, orderApi());
    await fillAndChoose();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('W-05 and W-06 permissions and the page of the order (EVM-022 AC1, AC7)', () => {
  it('EVM-022 AC7 Tylko odczyt opening the link sees "Nie możesz tworzyć zleceń." and the page asks for nothing', async () => {
    const api = orderApi({}, roleSession('read_only'));
    await renderPanel(NEW, api);
    expect(screen.getByRole('heading', { level: 1, name: 'Nie możesz tworzyć zleceń.' })).toBeTruthy();
    expect(screen.getByText('Poproś administratora o uprawnienia.')).toBeTruthy();
    expect(api.calls(TEMPLATES)).toHaveLength(0);
    expect(api.calls(USERS)).toHaveLength(0);
  });

  it('EVM-022 AC7 Edytor creates like Administrator', async () => {
    const api = orderApi({}, roleSession('editor'));
    await renderPanel(NEW, api);
    await fillAndChoose();
    await submit();
    expect(await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeTruthy();
  });

  it('EVM-018 AC3 an address of an order the API does not know (it replaced the placeholder of EVM-022) says "Nie znaleziono zlecenia." and leads back to the list', async () => {
    const id = '01968f3e-0000-7000-8000-00000000f009';
    const gone = () => problem(404, 'not_found');
    const { history } = await renderPanel(
      `/work-orders/${id}`,
      orderApi(workOrderRoutes(id, { header: gone, scope: gone, customer: gone, site: gone })),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Wróć do listy' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/work-orders');
    });
  });

  it('EVM-022 AC1 the free texts of the order are shown as text, never as markup', async () => {
    const api: ReturnType<typeof orderApi> = orderApi({
      [CREATE]: (request) => {
        const created = order(parseBody(request.body) as Record<string, unknown>, { title: '<img src=x onerror=alert(1)> Zlecenie' });
        registerReads(api, created);
        return json(201, created);
      },
    });
    await renderPanel(NEW, api);
    await fillAndChoose();
    await submit();
    expect(await screen.findByText('<img src=x onerror=alert(1)> Zlecenie')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });
});
