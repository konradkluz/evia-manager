import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem } from './api-fake.ts';
import {
  locationServer,
  MANAGER_ID,
  OSD_ID,
  OTHER_ORDERS,
  PARTY_CREATE,
  PARTY_SEARCH,
  PATH,
  SITE_ROUTE,
  STORED_MANAGER,
} from './location-edit-api.ts';
import { renderPanel } from './render.tsx';

// No pause between keystrokes: typing many characters per test would otherwise run close to the 5 s limit on a slow CI runner.
const userEvent = userEventDefault.setup({ delay: null });
const READ = `GET ${SITE_ROUTE}`;
const PATCH = `PATCH ${SITE_ROUTE}`;
const NOTES_WARNING = 'Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów. Notatki zobaczą technicy w aplikacji.';
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const EDIT = { name: 'Edytuj lokalizację' } as const;

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', EDIT));
  // the dialog shows a skeleton while the site and its parties are read: the form is there when the first field is
  await screen.findByRole('combobox', { name: 'Typ obiektu' });
  return screen.getByRole('dialog', EDIT);
}

const box = (dialog: HTMLElement, name: string) => within(dialog).getByRole<HTMLInputElement>('textbox', { name });
const save = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));

describe('W-20 the dialog "Edytuj lokalizację" (EVM-036 AC1)', () => {
  it('EVM-036 AC1 opens filled with the site, says the change concerns all orders of the site (2), has the notes warning and the focus on the first field', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    expect(within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Typ obiektu' }).value).toBe('multi_family_garage');
    expect(box(dialog, 'Ulica').value).toBe('ul. Testowa');
    expect(box(dialog, 'Nr budynku').value).toBe('7');
    expect(box(dialog, 'Kod pocztowy').value).toBe('00-001');
    expect(box(dialog, 'Miasto').value).toBe('Warszawa');
    expect(box(dialog, 'Nr miejsca postojowego (opcjonalnie)').value).toBe('15');
    expect(box(dialog, 'Poziom (opcjonalnie)').value).toBe('-1');
    expect(box(dialog, 'Moc przyłączeniowa (opcjonalnie)').value).toBe('40');
    expect(box(dialog, 'PPE (opcjonalnie)').value).toBe('PL-TEST-0001');
    expect(box(dialog, 'Notatki do lokalizacji (opcjonalnie)').value).toBe('Wjazd od ul. Fikcyjnej, klucz u administratora.');
    expect(within(dialog).getByText('Operator Testowy · OSD')).toBeTruthy();
    expect(within(dialog).getByText('Wspólnota Testowa · Wspólnota / spółdzielnia')).toBeTruthy();
    expect(within(dialog).getByText('Zmiana dotyczy wszystkich zleceń w tej lokalizacji (2).')).toBeTruthy();
    expect(within(dialog).getByText('ul. Testowa 7, 00-001 Warszawa · miejsce 15, poziom -1')).toBeTruthy();
    expect(within(dialog).getByText(NOTES_WARNING)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('combobox', { name: 'Typ obiektu' }));
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('EVM-036 AC1 the count is the number of other orders plus this one; when it could not be counted the sentence has no number', async () => {
    const { api } = locationServer({ orders: () => problem(500, 'internal_error') });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    expect(within(dialog).getByText('Zmiana dotyczy wszystkich zleceń w tej lokalizacji.')).toBeTruthy();
  });

  it('EVM-036 AC1 a changed PPE, power and notes are saved with If-Match of the version on screen, an Idempotency-Key and only those fields; the toast, the card and the focus follow', async () => {
    const server = locationServer();
    const { api } = server;
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.clear(box(dialog, 'PPE (opcjonalnie)'));
    await userEvent.type(box(dialog, 'PPE (opcjonalnie)'), 'PL-TEST-0002');
    await userEvent.clear(box(dialog, 'Moc przyłączeniowa (opcjonalnie)'));
    await userEvent.type(box(dialog, 'Moc przyłączeniowa (opcjonalnie)'), '22,5');
    await userEvent.clear(box(dialog, 'Notatki do lokalizacji (opcjonalnie)'));
    await userEvent.type(box(dialog, 'Notatki do lokalizacji (opcjonalnie)'), 'Klucz w recepcji.');
    await save(dialog);
    expect(await screen.findByText('Zapisano zmiany lokalizacji.')).toBeTruthy();
    const request = api.calls(PATCH).at(-1);
    expect(request?.headers.get('if-match')).toBe('"4"');
    expect(request?.headers.get('idempotency-key')).toMatch(UUIDV7);
    expect(request?.headers.get('x-csrf-token')).toBe('csrf-active');
    expect(parseBody(request?.body ?? '')).toEqual({
      meteringPointId: 'PL-TEST-0002',
      connectionPowerKw: 22.5,
      notes: 'Klucz w recepcji.',
    });
    expect(server.site.meteringPointId).toBe('PL-TEST-0002');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const card = within(screen.getByRole('region', { name: 'Lokalizacja' }));
    expect(await card.findByText('PL-TEST-0002')).toBeTruthy();
    expect(card.getByText('22,5 kW')).toBeTruthy();
    expect(card.getByText('Klucz w recepcji.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', EDIT));
  });

  it('EVM-036 AC1 nothing changed is nothing sent: "Zapisz zmiany" just closes the dialog', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await save(dialog);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls(PATCH)).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole('button', EDIT));
  });

  it('EVM-036 AC1 a change of the type away from a garage clears the spot and the level in the same request', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Typ obiektu' }), 'commercial');
    expect(within(dialog).queryByRole('textbox', { name: 'Nr miejsca postojowego (opcjonalnie)' })).toBeNull();
    await save(dialog);
    await screen.findByText('Zapisano zmiany lokalizacji.');
    expect(parseBody(api.calls(PATCH).at(-1)?.body ?? '')).toEqual({ siteType: 'commercial', parkingSpotNumber: null, garageLevel: null });
  });

  it('EVM-036 AC1 an emptied required field is told under the field, nothing is sent and the field has the focus', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.clear(box(dialog, 'Ulica'));
    await userEvent.clear(box(dialog, 'Moc przyłączeniowa (opcjonalnie)'));
    await userEvent.type(box(dialog, 'Moc przyłączeniowa (opcjonalnie)'), 'dużo');
    await save(dialog);
    expect(within(dialog).getAllByText('Uzupełnij to pole.')).toHaveLength(1);
    expect(within(dialog).getByText('Podaj moc większą od 0 i najwyżej 1000 kW, z dokładnością do 2 miejsc po przecinku.')).toBeTruthy();
    expect(api.calls(PATCH)).toHaveLength(0);
    expect(document.activeElement).toBe(box(dialog, 'Ulica'));
  });

  it('EVM-036 AC1 a server error of a field (400) is told under the field and the typed data stay', async () => {
    const { api } = locationServer({
      routes: {
        [PATCH]: () => problem(400, 'validation_failed', { errors: [{ pointer: '/meteringPointId', code: 'too_long' }] }),
      },
    });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(box(dialog, 'PPE (opcjonalnie)'), 'X');
    await save(dialog);
    expect(await within(dialog).findByText('Wpisano za dużo znaków.')).toBeTruthy();
    expect(within(dialog).getByText('Popraw zaznaczone pola.')).toBeTruthy();
    expect(box(dialog, 'PPE (opcjonalnie)').value).toBe('PL-TEST-0001X');
    expect(document.activeElement).toBe(box(dialog, 'PPE (opcjonalnie)'));
  });

  it('EVM-036 AC1 Esc with typed data asks "Odrzucić zmiany?"; "Wróć do edycji" keeps the data, "Odrzuć zmiany" closes and the focus is back on "Edytuj"', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(box(dialog, 'Miasto'), 'X');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    const ask = await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' });
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Wróć do edycji' }));
    await userEvent.click(within(ask).getByRole('button', { name: 'Wróć do edycji' }));
    const reopened = await screen.findByRole('dialog', EDIT);
    expect(box(reopened, 'Miasto').value).toBe('WarszawaX');
    fireEvent(reopened, new Event('cancel', { cancelable: true }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).getByRole('button', { name: 'Odrzuć zmiany' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls(PATCH)).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole('button', EDIT));
  });

  it('EVM-036 AC1 untouched, "Anuluj" closes at once and the focus is back on "Edytuj"', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(screen.getByRole('button', EDIT));
  });
});

describe('W-20 the OSD and the manager (EVM-036 AC2; SR-INPUT-02)', () => {
  const NEW_MANAGER = {
    ...STORED_MANAGER,
    id: '01968f3e-0000-7000-8000-00000000c003',
    displayName: 'Administracja Nowa',
    kind: 'building_administration',
  };

  it('EVM-036 AC2 a party chosen in the combobox of the manager is saved as an identifier; the OSD removed with "Zmień" and left empty is saved as null', async () => {
    const { api } = locationServer({
      routes: { [PARTY_SEARCH]: () => json(200, { items: [NEW_MANAGER], nextCursor: null }) },
    });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień zarządcę / administrację' }));
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Zarządca / administracja (opcjonalnie)' }), 'admin');
    await userEvent.click(await screen.findByRole('option', { name: /Administracja Nowa/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień OSD' }));
    await save(dialog);
    await screen.findByText('Zapisano zmiany lokalizacji.');
    expect(parseBody(api.calls(PATCH).at(-1)?.body ?? '')).toEqual({
      managerPartyId: NEW_MANAGER.id,
      distributionSystemOperatorPartyId: null,
    });
    const search = parseBody(api.calls(PARTY_SEARCH).at(-1)?.body ?? '') as { kinds?: string[] };
    expect(search.kinds).toEqual(['building_administration', 'property_manager', 'housing_community']);
  });

  it('EVM-036 AC2 a party of the wrong kind (400 wrong_party_kind) or a deleted one (unknown_party) is told under its field — without the kind or the id — and the other data stay', async () => {
    const { api } = locationServer({
      routes: {
        [PATCH]: () =>
          problem(400, 'validation_failed', {
            errors: [
              { pointer: '/distributionSystemOperatorPartyId', code: 'wrong_party_kind' },
              { pointer: '/managerPartyId', code: 'unknown_party' },
            ],
          }),
      },
    });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(box(dialog, 'PPE (opcjonalnie)'), '1');
    await save(dialog);
    expect(await within(dialog).findByText('Ta strona nie pasuje do tego pola. Wybierz inną albo dodaj nową.')).toBeTruthy();
    expect(within(dialog).getByText('Nie znaleziono wybranej strony. Wybierz ją ponownie.')).toBeTruthy();
    expect(box(dialog, 'PPE (opcjonalnie)').value).toBe('PL-TEST-00011');
    expect(dialog.textContent).not.toContain(OSD_ID);
    expect(dialog.textContent).not.toContain(MANAGER_ID);
  });

  it('EVM-036 AC2 "Dodaj stronę" is a view of the same dialog: the title says so, "Wróć do lokalizacji" keeps the data and the focus returns to the button', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(box(dialog, 'PPE (opcjonalnie)'), '7');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień OSD' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj stronę: OSD' }));
    const adding = await screen.findByRole('dialog', { name: 'Edytuj lokalizację › Dodaj stronę' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(adding).getByRole<HTMLSelectElement>('combobox', { name: 'Rodzaj strony' }).value).toBe('distribution_system_operator');
    await userEvent.click(within(adding).getByRole('button', { name: 'Wróć do lokalizacji' }));
    const back = await screen.findByRole('dialog', EDIT);
    expect(box(back, 'PPE (opcjonalnie)').value).toBe('PL-TEST-00017');
    await waitFor(() => {
      expect(document.activeElement).toBe(within(back).getByRole('button', { name: 'Dodaj stronę: OSD' }));
    });
  });

  it('EVM-036 AC2 a party added in the view is chosen in the field it was opened from, announced, focused, and assigned only after "Zapisz zmiany"', async () => {
    const { api } = locationServer({
      routes: {
        [PARTY_CREATE]: (request) => {
          const sent = parseBody(request.body) as Record<string, unknown>;
          return json(201, { ...sent, version: 1, createdAt: '2026-10-09T10:00:00.000Z', updatedAt: '2026-10-09T10:00:00.000Z' });
        },
      },
    });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień zarządcę / administrację' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj stronę: zarządca / administracja' }));
    const adding = await screen.findByRole('dialog', { name: 'Edytuj lokalizację › Dodaj stronę' });
    await userEvent.selectOptions(within(adding).getByRole('combobox', { name: 'Rodzaj strony' }), 'property_manager');
    await userEvent.type(within(adding).getByRole('textbox', { name: 'Nazwa' }), 'Zarząd Testowy');
    await userEvent.click(within(adding).getByRole('button', { name: 'Dodaj stronę' }));
    const back = await screen.findByRole('dialog', EDIT);
    expect(within(back).getByText('Zarząd Testowy · Zarządca')).toBeTruthy();
    expect(within(back).getByText('Dodano stronę „Zarząd Testowy”. Zapisz zmiany lokalizacji, aby ją przypisać.')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('Zarząd Testowy · Zarządca');
    });
    expect(api.calls(PATCH)).toHaveLength(0);
    await save(back);
    await screen.findByText('Zapisano zmiany lokalizacji.');
    const created = parseBody(api.calls(PARTY_CREATE).at(-1)?.body ?? '') as { id: string };
    expect(created.id).toMatch(UUIDV7);
    expect(parseBody(api.calls(PATCH).at(-1)?.body ?? '')).toEqual({ managerPartyId: created.id });
  });
});

describe('W-20 a conflict (EVM-036 AC4)', () => {
  it('EVM-036 AC4 somebody else changed the site: 412 shows the message, the typed data stay, "Aktualnie: …" shows the new PPE as text and the next save asks for the new version', async () => {
    const server = locationServer();
    await renderPanel(PATH, server.api);
    const dialog = await openDialog();
    await userEvent.clear(box(dialog, 'PPE (opcjonalnie)'));
    await userEvent.type(box(dialog, 'PPE (opcjonalnie)'), 'PL-TEST-0002');
    await userEvent.type(box(dialog, 'Miasto'), ' Nowe');
    server.changeSite({ meteringPointId: '<b>PL-TEST-0009</b>' });
    await save(dialog);
    expect(
      await within(dialog).findByText(
        'Lokalizację zmieniono w międzyczasie. Twoje zmiany zachowaliśmy — sprawdź aktualne wartości i zapisz ponownie.',
      ),
    ).toBeTruthy();
    expect(await within(dialog).findByText('Aktualnie: <b>PL-TEST-0009</b>')).toBeTruthy();
    expect(dialog.querySelector('b')).toBeNull();
    expect(within(dialog).getAllByText(/^Aktualnie:/)).toHaveLength(1);
    expect(box(dialog, 'PPE (opcjonalnie)').value).toBe('PL-TEST-0002');
    expect(box(dialog, 'Miasto').value).toBe('Warszawa Nowe');
    await waitFor(() => {
      expect(document.activeElement).toBe(box(dialog, 'PPE (opcjonalnie)'));
    });
    await save(dialog);
    await screen.findByText('Zapisano zmiany lokalizacji.');
    const requests = server.api.calls(PATCH);
    expect(requests.map((request) => request.headers.get('if-match'))).toEqual(['"4"', '"5"']);
    expect(server.site.meteringPointId).toBe('PL-TEST-0002');
    expect(server.site.city).toBe('Warszawa Nowe');
  });

  it('EVM-036 AC4 a site removed meanwhile (404 on save) says so and offers "Odśwież zlecenie", which reads the order again', async () => {
    const server = locationServer();
    await renderPanel(PATH, server.api);
    const dialog = await openDialog();
    await userEvent.type(box(dialog, 'Miasto'), 'X');
    server.removeSite();
    await save(dialog);
    const gone = await screen.findByRole('dialog', EDIT);
    expect(within(gone).getByText('Nie znaleziono lokalizacji. Mogła zostać usunięta.')).toBeTruthy();
    const reads = server.api.calls(`GET /api/v1/work-orders/01968f3e-0000-7000-8000-00000000d042/site`).length;
    await userEvent.click(within(gone).getByRole('button', { name: 'Odśwież zlecenie' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(server.api.calls(`GET /api/v1/work-orders/01968f3e-0000-7000-8000-00000000d042/site`).length).toBeGreaterThan(reads);
    });
  });

  it('EVM-036 AC4 a site that cannot be read: the dialog says so with "Spróbuj ponownie", which reads it again', async () => {
    let failing = true;
    const { api } = locationServer({
      routes: { [READ]: () => (failing ? problem(500, 'internal_error') : json(200, locationServer().site)) },
    });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', EDIT));
    const failed = await screen.findByRole('dialog', EDIT);
    expect(await within(failed).findByText('Nie udało się wczytać lokalizacji.')).toBeTruthy();
    failing = false;
    await userEvent.click(within(failed).getByRole('button', { name: 'Spróbuj ponownie' }));
    expect((await screen.findByRole<HTMLInputElement>('textbox', { name: 'Ulica' })).value).toBe('ul. Testowa');
  });

  it('EVM-036 AC4 while the site is read the dialog shows a skeleton with a status', async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { api } = locationServer({ routes: { [READ]: () => pending } });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', EDIT));
    const loading = await screen.findByRole('dialog', EDIT);
    expect(within(loading).getByText('Wczytujemy lokalizację…')).toBeTruthy();
    expect(loading.querySelector('[aria-busy="true"]')).toBeTruthy();
    release(json(200, locationServer().site));
    expect((await screen.findByRole<HTMLInputElement>('textbox', { name: 'Ulica' })).value).toBe('ul. Testowa');
  });
});

describe('W-20 other failures (EVM-036 AC7, AC8)', () => {
  it('EVM-036 AC8 429 on save: "Zbyt wiele zapytań" with the seconds from Retry-After, the data stay', async () => {
    const { api: fake } = locationServer({ routes: { [PATCH]: () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }) } });
    await renderPanel(PATH, fake);
    const dialog = await openDialog();
    await userEvent.type(box(dialog, 'Miasto'), 'X');
    await save(dialog);
    expect(await within(dialog).findByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeTruthy();
    expect(box(dialog, 'Miasto').value).toBe('WarszawaX');
  });

  it('EVM-036 AC7 403 on save: the message says the person may not change sites', async () => {
    const { api: fake } = locationServer({ routes: { [PATCH]: () => problem(403, 'forbidden') } });
    await renderPanel(PATH, fake);
    const dialog = await openDialog();
    await userEvent.type(box(dialog, 'Miasto'), 'X');
    await save(dialog);
    expect(await within(dialog).findByText('Nie możesz zmieniać lokalizacji. Poproś administratora o uprawnienia.')).toBeTruthy();
  });

  it('EVM-036 AC8 a lost connection while the dialog is open: the banner, "Zapisz zmiany" disabled with the hint, the typed data stay', async () => {
    const { api: fake } = locationServer();
    await renderPanel(PATH, fake);
    const dialog = await openDialog();
    await userEvent.type(box(dialog, 'Miasto'), 'X');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    expect(
      await within(dialog).findByText('Brak połączenia. Zapiszesz zmiany po powrocie połączenia — wpisane dane zostają.'),
    ).toBeTruthy();
    const submit = within(dialog).getByRole('button', { name: 'Zapisz zmiany' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(submit.getAttribute('title')).toBe('Zapiszesz po powrocie połączenia.');
    await userEvent.click(submit);
    expect(fake.calls(PATCH)).toHaveLength(0);
    expect(box(dialog, 'Miasto').value).toBe('WarszawaX');
  });

  it('EVM-036 AC8 offline "Edytuj" is disabled and says it can be changed after the connection returns', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const { api: fake } = locationServer();
    await renderPanel(PATH, fake);
    const button = await screen.findByRole('button', EDIT);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe('Zmienisz po powrocie połączenia.');
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-036 AC8 the notes are text, never markup: a note with a tag and a javascript: address stays text in the dialog and on the card', async () => {
    const markup = '<script>alert(1)</script> javascript:alert(2) https://example.test/a';
    const server = locationServer();
    server.changeSite({ notes: markup });
    await renderPanel(PATH, server.api);
    const card = within(screen.getByRole('region', { name: 'Lokalizacja' }));
    await card.findByText(/alert\(1\)/);
    expect(document.querySelector('script')).toBeNull();
    expect(card.queryByRole('link', { name: /javascript/ })).toBeNull();
    expect(card.getByRole('link', { name: 'https://example.test/a' }).getAttribute('href')).toBe('https://example.test/a');
    const dialog = await openDialog();
    expect(box(dialog, 'Notatki do lokalizacji (opcjonalnie)').value).toBe(markup);
    expect(dialog.querySelector('script')).toBeNull();
  });
});

describe('the count in the dialog (EVM-036 AC1)', () => {
  it('EVM-036 AC1 the count in the dialog follows the list: three other orders make the sentence say (4)', async () => {
    const many = {
      total: 3,
      items: ['0017', '0018', '0019'].map((number) => ({
        ...OTHER_ORDERS.items.map((item) => item)[0],
        id: `01968f3e-0000-7000-8000-00000000d${number.slice(2)}`,
        number: `ZL-2026-${number}`,
      })),
    };
    const { api: fake } = locationServer({ orders: () => json(200, many) });
    await renderPanel(PATH, fake);
    const dialog = await openDialog();
    expect(within(dialog).getByText('Zmiana dotyczy wszystkich zleceń w tej lokalizacji (4).')).toBeTruthy();
    expect(within(dialog).queryByText(/ZL-2026-0017/)).toBeNull();
  });
});
