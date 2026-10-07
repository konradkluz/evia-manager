import { expect, test } from './fixtures.ts';

// W-05 section "2. Lokalizacja" in a real browser against the synthetic API (EVM-021 AC1–AC4, AC7; SR-WEB-05, SR-API-04).
// The full stack (API and database) is covered by the API integration tests and the QA run; here the target is the tab.
test.use({ session: 'active' });

const PATH = '/work-orders/new';
const GARAGE = 'ul. Testowa 7, 00-001 Warszawa · Garaż w budynku wielorodzinnym · miejsce 15, poziom -1';

test.describe('location in a new work order W-05 (EVM-021)', () => {
  test('EVM-021 AC1 "Lodz" finds the site in Łódź; the phrase travels in the body of a POST, never in the address or the title', async ({
    page,
    api,
  }) => {
    await page.goto(PATH);
    const field = page.getByRole('combobox', { name: 'Lokalizacja' });
    await field.fill('te');
    await expect(page.getByText('Wpisz co najmniej 3 znaki, aby wyszukać.')).toBeVisible();
    await field.fill('Lodz');
    await expect(page.getByRole('option', { name: /ul\. Przykładowa 2, 90-001 Łódź/ })).toContainText('Dom jednorodzinny');
    await field.fill('testowa 7');
    const option = page.getByRole('option', { name: /ul\. Testowa 7/ });
    await expect(option).toContainText('Garaż w budynku wielorodzinnym · miejsce 15, poziom -1');
    const searches = api.seen.filter((entry) => entry.url.endsWith('/api/v1/sites/search'));
    expect(searches.map((entry) => entry.postData)).toEqual([JSON.stringify({ query: 'Lodz' }), JSON.stringify({ query: 'testowa 7' })]);
    expect(searches[0]?.headers['x-csrf-token']).toBe('csrf-active');
    expect(page.url()).not.toContain('testowa');
    await expect(page).toHaveTitle('Nowe zlecenie · EVia Manager');
    await field.press('ArrowDown');
    await field.press('Enter');
    await expect(page.getByText(GARAGE)).toBeFocused();
  });

  test('EVM-021 AC2 a new house is saved with its own request: one site, no customer, chosen afterwards', async ({ page, api }) => {
    await page.goto(PATH);
    await page.getByRole('radio', { name: 'Nowa lokalizacja' }).check();
    await page.getByRole('button', { name: 'Zapisz lokalizację' }).click();
    await expect(page.getByText('Uzupełnij to pole.')).toHaveCount(5);
    await expect(page.getByRole('combobox', { name: 'Typ obiektu' })).toBeFocused();
    await page.getByRole('combobox', { name: 'Typ obiektu' }).selectOption({ label: 'Dom jednorodzinny' });
    await page.getByRole('textbox', { name: 'Ulica' }).fill('ul. Nowa');
    await page.getByRole('textbox', { name: 'Nr budynku' }).fill('3');
    await page.getByRole('textbox', { name: 'Kod pocztowy' }).fill('00001');
    await page.getByRole('textbox', { name: 'Miasto' }).fill('Gdańsk');
    await page.getByRole('textbox', { name: 'Moc przyłączeniowa (opcjonalnie)' }).fill('11,5');
    await expect(
      page.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów. Notatki zobaczą technicy w aplikacji.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Zapisz lokalizację' }).click();
    await expect(page.getByText('Podaj kod pocztowy w formacie 00-000.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Kod pocztowy' })).toBeFocused();
    await page.getByRole('textbox', { name: 'Kod pocztowy' }).fill('80-001');
    await page.getByRole('button', { name: 'Zapisz lokalizację' }).click();
    await expect(page.getByText('ul. Nowa 3, 80-001 Gdańsk · Dom jednorodzinny')).toBeVisible();
    await expect(page.getByText('Dodano lokalizację.')).toBeVisible();
    const saves = api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/api/v1/sites'));
    expect(saves).toHaveLength(1);
    expect(saves[0]?.postData).not.toContain('customerId');
    expect(JSON.parse(saves[0]?.postData ?? '{}')).toMatchObject({ siteType: 'single_family_house', connectionPowerKw: 11.5 });
    expect(saves[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(api.sites.filter((entry) => entry.street === 'ul. Nowa')).toHaveLength(1);
  });

  test('EVM-021 AC2 AC4 a garage with the OSD added from the empty result: the dialog suggests the kind, the party is chosen and saved once even when the answer is lost', async ({
    page,
    api,
  }) => {
    await page.goto(PATH);
    await page.getByRole('radio', { name: 'Nowa lokalizacja' }).check();
    await page.getByRole('combobox', { name: 'Typ obiektu' }).selectOption({ label: 'Garaż w budynku wielorodzinnym' });
    await page.getByRole('textbox', { name: 'Nr miejsca postojowego (opcjonalnie)' }).fill('15');
    await page.getByRole('textbox', { name: 'Poziom (opcjonalnie)' }).fill('-1');
    await page.getByRole('combobox', { name: 'OSD (opcjonalnie)' }).fill('Stoen');
    await expect(page.getByText('Brak wyników dla „Stoen”.')).toBeVisible();
    await page.getByRole('button', { name: 'Dodaj stronę: OSD' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Dodaj stronę' });
    await expect(dialog.getByRole('combobox', { name: 'Rodzaj strony' })).toHaveValue('distribution_system_operator');
    await expect(dialog.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Nazwa' }).fill('Stoen Operator');
    await dialog.getByRole('textbox', { name: 'Telefon (opcjonalnie)' }).fill('12');
    await dialog.getByRole('button', { name: 'Dodaj stronę' }).click();
    await expect(dialog.getByText('Podaj poprawny numer telefonu, np. +48 600 000 001.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Telefon (opcjonalnie)' }).fill('600 000 002');
    api.dropResponseNext.add('POST /api/v1/parties');
    await dialog.getByRole('button', { name: 'Dodaj stronę' }).click();
    await expect(dialog.getByText('Nie udało się dodać strony. Spróbuj ponownie — nie dodamy jej dwa razy.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Dodaj stronę' }).click();
    await expect(page.getByText('Stoen Operator · OSD')).toBeVisible();
    await expect(dialog).toBeHidden();
    const saves = api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/api/v1/parties'));
    expect(saves).toHaveLength(3);
    expect(saves[2]?.postData).toBe(saves[1]?.postData);
    expect(saves[2]?.headers['idempotency-key']).toBe(saves[1]?.headers['idempotency-key']);
    expect(api.parties.filter((entry) => entry.displayName === 'Stoen Operator')).toHaveLength(1);
    await page.getByRole('textbox', { name: 'Ulica' }).fill('ul. Garażowa');
    await page.getByRole('textbox', { name: 'Nr budynku' }).fill('9');
    await page.getByRole('textbox', { name: 'Kod pocztowy' }).fill('00-002');
    await page.getByRole('textbox', { name: 'Miasto' }).fill('Warszawa');
    await page.getByRole('button', { name: 'Zapisz lokalizację' }).click();
    await expect(page.getByText('ul. Garażowa 9, 00-002 Warszawa · Garaż w budynku wielorodzinnym · miejsce 15, poziom -1')).toBeVisible();
    const site = api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/api/v1/sites')).at(-1);
    expect(JSON.parse(site?.postData ?? '{}')).toMatchObject({ distributionSystemOperatorPartyId: api.parties.at(-1)?.id });
  });

  test('EVM-021 AC3 the OSD combobox offers OSD only and the manager combobox the managers only', async ({ page, api }) => {
    await page.goto(PATH);
    await page.getByRole('radio', { name: 'Nowa lokalizacja' }).check();
    await page.getByRole('combobox', { name: 'OSD (opcjonalnie)' }).fill('Testow');
    await expect(page.getByRole('option', { name: /Operator Testowy/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Wspólnota Testowa/ })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Zarządca / administracja (opcjonalnie)' }).fill('Testow');
    await expect(page.getByRole('option', { name: /Wspólnota Testowa/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Operator Testowy/ })).toHaveCount(0);
    const searches = api.seen
      .filter((entry) => entry.url.endsWith('/api/v1/parties/search'))
      .map((entry) => JSON.parse(entry.postData ?? '{}') as unknown);
    expect(searches).toEqual([
      { query: 'Testow', kinds: ['distribution_system_operator'] },
      { query: 'Testow', kinds: ['building_administration', 'property_manager', 'housing_community'] },
    ]);
  });

  test('EVM-021 AC7 offline: the search says it needs a connection, the typed data stay and the save is disabled', async ({
    page,
    context,
  }) => {
    await page.goto(PATH);
    await page.getByRole('radio', { name: 'Nowa lokalizacja' }).check();
    await page.getByRole('textbox', { name: 'Ulica' }).fill('ul. Offline');
    await context.setOffline(true);
    await expect(page.getByText('Brak połączenia. Zapiszesz lokalizację po powrocie połączenia — wpisane dane zostają.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zapisz lokalizację' })).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('combobox', { name: 'OSD (opcjonalnie)' }).fill('Operator');
    await expect(page.getByText('Wyszukiwanie wymaga połączenia.')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole('textbox', { name: 'Ulica' })).toHaveValue('ul. Offline');
  });

  test('EVM-021 AC7 the typed data live in the memory of the tab: not in any storage, and a refresh drops them', async ({ page }) => {
    await page.goto(PATH);
    await page.getByRole('radio', { name: 'Nowa lokalizacja' }).check();
    await page.getByRole('textbox', { name: 'Ulica' }).fill('ul. Szkicowa');
    await page.getByRole('textbox', { name: 'Notatki do lokalizacji (opcjonalnie)' }).fill('Notatka testowa.');
    await expect(page.getByText(/^Szkic w tej karcie/)).toBeVisible();
    const stores = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
    expect(stores).toEqual({ local: 0, session: 0 });
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Lokalizacja' })).toBeVisible();
    await expect(page.getByText(/^Szkic w tej karcie/)).toHaveCount(0);
  });

  test('EVM-021 AC6 Administrator and Edytor see the section; Tylko odczyt gets the state without a right', async ({ page, api }) => {
    for (const role of ['administrator', 'editor'] as const) {
      api.role = role;
      await page.goto(PATH);
      await expect(page.getByRole('group', { name: '2. Lokalizacja' })).toBeVisible();
    }
    api.role = 'read_only';
    await page.goto(PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Nie możesz tworzyć zleceń.' })).toBeVisible();
    await expect(page.getByRole('group', { name: '2. Lokalizacja' })).toHaveCount(0);
  });
});
