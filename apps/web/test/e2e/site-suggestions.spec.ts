import type { Page } from '@playwright/test';
import type { MockApi } from './mock-api.ts';
import { expect, test } from './fixtures.ts';
import { GARAGE_ID, seedJanOrders } from './site-suggestions-seed.ts';

// W-05 "2. Lokalizacja": the locations of the earlier orders of the customer in a real browser against the synthetic API
// (EVM-043 AC1, AC2, AC4; SR-WEB-05, SR-RATE). No clock of the page or of the test steers the result.
test.use({ session: 'active' });

const PATH = '/work-orders/new';

const reads = (api: MockApi, matcher: (url: URL) => boolean) =>
  api.seen.filter((entry) => entry.method === 'GET' && matcher(new URL(entry.url))).length;

async function chooseJan(page: Page) {
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
}

test.describe('suggestion of the locations of the customer in W-05 (EVM-043)', () => {
  test('EVM-043 AC1 the locations of two orders appear with the address and the type; the choice sets "Istniejąca lokalizacja" — one list, one site, nothing in the stores of the browser', async ({
    page,
    api,
  }) => {
    seedJanOrders(api);
    await page.goto(PATH);
    await chooseJan(page);
    await expect(page.getByRole('heading', { name: 'Lokalizacje z poprzednich zleceń klienta (2)' })).toBeVisible();
    const list = page.getByRole('list', { name: 'Lokalizacje z poprzednich zleceń klienta (2)' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByText('ul. Testowa 7, Warszawa · Garaż w budynku wielorodzinnym')).toBeVisible();
    await expect(list.getByText('ul. Przykładowa 2, Łódź · Dom jednorodzinny')).toBeVisible();
    await page.getByRole('button', { name: 'Wybierz lokalizację: ul. Testowa 7, Warszawa' }).click();
    await expect(page.getByText('ul. Testowa 7, 00-001 Warszawa · Garaż w budynku wielorodzinnym · miejsce 15, poziom -1')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Istniejąca lokalizacja' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Zmień lokalizację' })).toBeVisible();
    expect(reads(api, (url) => url.pathname === '/api/v1/work-orders' && url.searchParams.get('customerId') !== null)).toBe(1);
    expect(reads(api, (url) => url.pathname === `/api/v1/sites/${GARAGE_ID}`)).toBe(1);
    // "Zmień lokalizację" shows the list again without reading it again (limit 300/min)
    await page.getByRole('button', { name: 'Zmień lokalizację' }).click();
    await expect(page.getByRole('heading', { name: 'Lokalizacje z poprzednich zleceń klienta (2)' })).toBeVisible();
    expect(reads(api, (url) => url.pathname === '/api/v1/work-orders' && url.searchParams.get('customerId') !== null)).toBe(1);
    const stores = await page.evaluate(async () => ({
      local: globalThis.localStorage.length,
      session: globalThis.sessionStorage.length,
      databases: (await globalThis.indexedDB.databases()).length,
    }));
    expect(stores).toEqual({ local: 0, session: 0, databases: 0 });
  });

  test('EVM-043 AC2 a customer without orders: no suggestion, the search of EVM-021 works', async ({ page, api }) => {
    seedJanOrders(api);
    await page.goto(PATH);
    await page.getByRole('combobox', { name: 'Klient' }).fill('Firma');
    await page.getByRole('option', { name: /Firma Testowa/ }).click();
    await expect(page.getByRole('combobox', { name: 'Lokalizacja' })).toBeVisible();
    await expect.poll(() => reads(api, (url) => url.searchParams.get('customerId') !== null)).toBe(1);
    await expect(page.getByText(/Lokalizacje z poprzednich zleceń/)).toBeHidden();
    await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
    await expect(page.getByRole('option', { name: /ul\. Testowa 7/ })).toBeVisible();
  });

  test('EVM-043 AC4 offline: the suggestion is unavailable and the section still works', async ({ page, api, context }) => {
    seedJanOrders(api);
    await page.goto(PATH);
    await chooseJan(page);
    await expect(page.getByRole('heading', { name: 'Lokalizacje z poprzednich zleceń klienta (2)' })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText('Podpowiedź lokalizacji jest niedostępna bez połączenia.')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Lokalizacja' })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole('heading', { name: 'Lokalizacje z poprzednich zleceń klienta (2)' })).toBeVisible();
  });
});
