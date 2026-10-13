import { expect, test } from './fixtures.ts';

// Search of work orders, customer and location on W-10, "Więcej filtrów" (EVM-072 AC1–AC5, AC8; SR-API-04, SR-WEB-05, AB-16) in a
// real browser against the synthetic API. The full stack (API, database, 10 000 orders) is covered by the API integration tests.
// The synthetic orders: even index — "Jan Przykładowy", odd — "Firma Testowa sp. z o.o."; the site alternates between
// "ul. Testowa 7, Warszawa" (a garage) and "ul. Przykładowa 2, Łódź" (a house); every seventh order has a deleted customer.
test.use({ session: 'active' });

const PATH = '/work-orders';
const SEARCH = 'POST /api/v1/work-orders/search';
const FIELD = 'Szukaj: numer, tytuł, klient, adres…';
const TOP_BAR = 'Szukaj zleceń…';

test.describe('search of work orders on W-10 and in the TopBar (EVM-072)', () => {
  test('EVM-072 AC1 the column "Klient" has the name and the location; a deleted customer is "Klient usunięty" without a name', async ({
    page,
    api,
  }) => {
    api.workOrders = 60;
    await page.goto(PATH);
    const table = page.getByRole('table', { name: 'Lista zleceń' });
    await expect(table).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Klient' })).toBeVisible();
    // ZL-2026-0059: "Jan Przykładowy" in Łódź. On this width (1280 px) the location is the second line of "Klient".
    const jan = table.getByRole('row').filter({ hasText: 'ZL-2026-0059' });
    await expect(jan).toContainText('Jan Przykładowy');
    await expect(jan).toContainText('ul. Przykładowa 2, Łódź');
    // ZL-2026-0049 has a deleted customer: a word and the location, no name and no identifier.
    const deleted = table.getByRole('row').filter({ hasText: 'ZL-2026-0049' });
    await expect(deleted).toContainText('Klient usunięty');
    await expect(deleted).toContainText('ul. Testowa 7, Warszawa');
    await expect(deleted).not.toContainText('Firma Testowa');
  });

  test('EVM-072 AC2 every phrase finds its orders; the phrase travels only in the body of the POST (address, title, stores)', async ({
    page,
    api,
  }) => {
    api.workOrders = 60;
    await page.goto(PATH);
    await expect(page.getByRole('table')).toBeVisible();
    const field = page.getByRole('searchbox', { name: FIELD });

    await field.fill('0042');
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('table')).toContainText('ZL-2026-0042');

    await field.fill('Lodz');
    await expect(page.getByRole('table')).toContainText('ul. Przykładowa 2, Łódź');
    await expect(page.getByRole('table')).not.toContainText('Warszawa');

    await field.fill('przykladowy');
    await expect(page.getByRole('table')).toContainText('Jan Przykładowy');
    await expect(page.getByRole('table')).not.toContainText('Firma Testowa');

    await field.fill('Garaż — pełny');
    await expect(page.getByRole('table')).toContainText('Garaż — pełny proces');
    await expect(page.getByRole('table')).not.toContainText('Dom — pełny pakiet');

    // The phrase is in the body of the POST and nowhere else.
    const searches = api.seen.filter((entry) => `${entry.method} ${new URL(entry.url).pathname}` === SEARCH);
    expect(searches.length).toBeGreaterThanOrEqual(4);
    const phrases = searches.map((entry) => (JSON.parse(entry.postData ?? '{}') as { query: string }).query);
    expect(phrases).toEqual(expect.arrayContaining(['0042', 'Lodz', 'przykladowy', 'Garaż — pełny']));
    for (const entry of api.seen) expect(decodeURIComponent(entry.url)).not.toMatch(/0042|Lodz|przykladowy|Gara/i);
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(PATH);
    await expect(page).toHaveTitle('Zlecenia · EVia Manager');
    const stores = await page.evaluate(async () => ({
      local: globalThis.localStorage.length,
      session: globalThis.sessionStorage.length,
      databases: (await globalThis.indexedDB.databases()).length,
      caches: (await globalThis.caches.keys()).length,
      historyState: JSON.stringify(globalThis.history.state),
    }));
    expect(stores.local + stores.session + stores.databases + stores.caches).toBe(0);
    expect(stores.historyState).not.toMatch(/Lodz|przykladowy|0042/);
  });

  test('EVM-072 AC2 a phrase shorter than 3 characters is not sent', async ({ page, api }) => {
    api.workOrders = 10;
    await page.goto(PATH);
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('searchbox', { name: FIELD }).fill('ZL');
    await expect(page.getByText('Co najmniej 3 znaki: numer, tytuł, nazwisko klienta albo adres.').first()).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    expect(api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/work-orders/search'))).toHaveLength(0);
  });

  test('EVM-072 AC2 the TopBar search leads from another screen to W-10 with the phrase in both fields and nothing in the address', async ({
    page,
    api,
  }) => {
    api.workOrders = 60;
    await page.goto('/customers');
    await expect(page.getByRole('heading', { level: 1, name: 'Klienci' })).toBeVisible();
    await page.getByRole('searchbox', { name: TOP_BAR }).fill('przykladowa');
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await expect(page.getByRole('table')).toContainText('ul. Przykładowa 2, Łódź');
    await expect(page.getByRole('searchbox', { name: FIELD })).toHaveValue('przykladowa');
    await expect(page.getByRole('searchbox', { name: TOP_BAR })).toHaveValue('przykladowa');
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(PATH);
    await expect(page).toHaveTitle('Zlecenia · EVia Manager');
  });

  test('EVM-072 AC3 the phrase joins the view; pages follow with the cursor in the body; a new phrase starts again', async ({
    page,
    api,
  }) => {
    api.workOrders = 240;
    await page.goto(PATH);
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('button', { name: 'Moje' }).click();
    await page.getByRole('searchbox', { name: FIELD }).fill('pełny');
    await expect(page.getByRole('button', { name: 'Następna strona' })).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Następna strona' }).click();
    await expect(page.getByRole('button', { name: 'Poprzednia strona' })).not.toHaveAttribute('aria-disabled', 'true');
    const last = api.seen.filter((entry) => entry.url.endsWith('/work-orders/search')).at(-1);
    expect(JSON.parse(last?.postData ?? '{}')).toMatchObject({ query: 'pełny', view: 'mine', cursor: expect.any(String) });
    await page.getByRole('searchbox', { name: FIELD }).fill('pełny p');
    await expect(page.getByRole('button', { name: 'Poprzednia strona' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('EVM-072 AC4 "Więcej filtrów": the type of object and the template narrow the list and live only in the memory of the tab', async ({
    page,
    api,
  }) => {
    api.workOrders = 60;
    await page.goto(PATH);
    await expect(page.getByRole('table')).toBeVisible();
    const more = page.getByRole('button', { name: 'Więcej filtrów' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('combobox', { name: 'Typ obiektu' }).selectOption({ label: 'Dom jednorodzinny' });
    await expect(page.getByRole('button', { name: 'Więcej filtrów (1)' })).toBeVisible();
    await expect(page.getByRole('table')).toContainText('ul. Przykładowa 2, Łódź');
    await expect(page.getByRole('table')).not.toContainText('Warszawa');
    const rows = page.getByRole('table').getByRole('row');
    const withType = await rows.count();
    await page.getByRole('combobox', { name: 'Szablon' }).selectOption({ label: 'Garaż — montaż ładowarki' });
    await expect(page.getByRole('button', { name: 'Więcej filtrów (2)' })).toBeVisible();
    await expect.poll(() => rows.count()).toBeLessThan(withType);
    expect(new URL(page.url()).search).toBe('');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Więcej filtrów' })).toBeVisible();
    await expect(page.getByRole('table')).toContainText('Warszawa');
  });

  test('EVM-072 AC8 a 429 of the search keeps the phrase and offers a retry', async ({ page, api }) => {
    api.workOrders = 10;
    await page.goto(PATH);
    await expect(page.getByRole('table')).toBeVisible();
    api.failNext.set(SEARCH, { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
    await page.getByRole('searchbox', { name: FIELD }).fill('Dom');
    await expect(page.getByRole('alert')).toContainText('Zbyt wiele zapytań. Spróbuj ponownie za 1 min.');
    await expect(page.getByRole('searchbox', { name: FIELD })).toHaveValue('Dom');
    await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('EVM-072 AC8 no results say so with "Wyczyść filtry"; offline disables both fields with the reason', async ({
    page,
    api,
    context,
  }) => {
    api.workOrders = 10;
    await page.goto(PATH);
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('searchbox', { name: FIELD }).fill('zzzzzz');
    await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń spełniających filtry.' })).toBeVisible();
    await page.getByRole('button', { name: 'Wyczyść filtry' }).last().click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('searchbox', { name: FIELD })).toHaveValue('');
    await context.setOffline(true);
    await expect(page.getByRole('searchbox', { name: FIELD })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('searchbox', { name: TOP_BAR })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Wyszukasz po powrocie połączenia.')).toHaveCount(2);
    await context.setOffline(false);
  });
});
