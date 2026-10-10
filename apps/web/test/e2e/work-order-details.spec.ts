import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';

// W-06 "Przegląd" in a real browser against the synthetic API (EVM-018 AC1–AC7; SR-AUTHZ-02, SR-WEB-03, SR-WEB-05, TM-10). The full stack
// (API and database) is covered by the API integration tests and the role matrix; here the target is the tab.
test.use({ session: 'active' });

const UNKNOWN_ID = '01968f3e-0000-7000-8000-00000000dead';

/** Creates the order ZL-2026-0042 through W-05 and returns its address (the synthetic API has no other order to read). */
async function createOrder(page: Page): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

const idOf = (path: string): string => path.split('/').at(-1) ?? '';

const browserStores = (page: Page) =>
  page.evaluate(async () => ({
    local: globalThis.localStorage.length,
    session: globalThis.sessionStorage.length,
    databases: (await globalThis.indexedDB.databases()).length,
    cookies: document.cookie,
    caches: (await globalThis.caches.keys()).length,
  }));

const reads = (api: MockApi) =>
  api.seen.filter((entry) => entry.method === 'GET' && /\/api\/v1\/work-orders\/[0-9a-f-]{36}/.test(entry.url));

test.describe('details of a work order W-06 (EVM-018)', () => {
  test('EVM-018 AC1 AC2 AC5 an order opened from a link (a fresh tab) shows the header, the tab, the cards and the scope with Polish parameters; the tab title is the number', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
    await expect(page).toHaveTitle('ZL-2026-0042 · EVia Manager');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    const main = page.getByRole('main');
    await expect(main.getByText('Garaż — pełny proces')).toBeVisible();
    await expect(main.getByText('Nowe', { exact: true })).toBeVisible();
    await expect(main.getByRole('tab', { name: 'Przegląd', selected: true })).toBeVisible();
    const customer = main.getByRole('region', { name: 'Klient' });
    await expect(customer.getByText('Jan Przykładowy')).toBeVisible();
    await expect(customer.getByRole('link', { name: 'jan.przykladowy@example.com' })).toHaveAttribute(
      'href',
      'mailto:jan.przykladowy%40example.com',
    );
    const site = main.getByRole('region', { name: 'Lokalizacja' });
    await expect(site.getByText('Garaż w budynku wielorodzinnym')).toBeVisible();
    await expect(site.getByText('miejsce 15, poziom -1')).toBeVisible();
    await expect(site.getByText('Operator Testowy')).toBeVisible();
    await expect(site.getByText('40 kW')).toBeVisible();
    await expect(site.getByText('PL-TEST-0001')).toBeVisible();
    await expect(main.getByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeVisible();
    await expect(main.getByText('AC, 11 kW, 3 fazy')).toBeVisible();
    // AC5: six reads anchored in the order (EVM-036 added the other orders of the site, EVM-031 the processes), only the identifier in the path, nothing in the query string
    const mine = reads(api).filter((entry) => entry.url.includes(idOf(path)));
    expect(new Set(mine.map((entry) => new URL(entry.url).pathname.replace(idOf(path), '{id}')))).toEqual(
      new Set([
        '/api/v1/work-orders/{id}',
        '/api/v1/work-orders/{id}/scope-items',
        '/api/v1/work-orders/{id}/procedures',
        '/api/v1/work-orders/{id}/customer',
        '/api/v1/work-orders/{id}/site',
        '/api/v1/work-orders/{id}/site-orders',
      ]),
    );
    for (const entry of mine) expect(new URL(entry.url).search).toBe('');
  });

  test('EVM-018 AC3 a deleted order and one that never existed are the same screen "Nie znaleziono zlecenia." with no data and the title "Nie znaleziono · EVia Manager"', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    api.orders.gone.add(idOf(path));
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeVisible();
    await expect(page.getByText('Mogło zostać usunięte albo nie masz do niego dostępu.')).toBeVisible();
    await expect(page).toHaveTitle('Nie znaleziono · EVia Manager');
    await expect(page.getByText(/ZL-2026-0042|Jan Przykładowy|Operator Testowy/)).toHaveCount(0);
    const deleted = await page.getByRole('main').innerText();
    await page.goto(`/work-orders/${UNKNOWN_ID}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeVisible();
    expect(await page.getByRole('main').innerText()).toBe(deleted);
    await page.getByRole('button', { name: 'Wróć do listy' }).click();
    await expect(page).toHaveURL(/\/work-orders(\?.*)?$/);
  });

  test('EVM-018 AC4 <script> and javascript: in the notes are text, nothing runs, no dialog opens; https, tel and mailto are links', async ({
    page,
    api,
  }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    api.orders.notes =
      '<script>alert(1)</script> javascript:alert(1) https://example.invalid/mapa tel:+48600000002 mailto:biuro@example.invalid';
    const path = await createOrder(page);
    await page.goto(path);
    const site = page.getByRole('region', { name: 'Lokalizacja' });
    await expect(site.getByText(/<script>alert\(1\)<\/script> javascript:alert\(1\)/)).toBeVisible();
    await expect(site.getByRole('link')).toHaveCount(3);
    expect(await site.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual([
      'https://example.invalid/mapa',
      'tel:+48600000002',
      'mailto:biuro@example.invalid',
    ]);
    expect(await page.locator('script:not([src])').count()).toBe(0);
    expect(await page.locator('a[href^="javascript"]').count()).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('EVM-018 AC7 a section that fails shows its own alert and "Spróbuj ponownie"; the other sections work and the retry reads only that section', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    api.failNext.set(`GET /api/v1${path}/scope-items`, { status: 500, code: 'internal_error' });
    await page.goto(path);
    const alert = page.getByRole('alert').filter({ hasText: 'Nie udało się wczytać zakresu zlecenia.' });
    await expect(alert).toBeVisible();
    await expect(page.getByRole('region', { name: 'Klient' }).getByText('Jan Przykładowy')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Lokalizacja' }).getByText('Operator Testowy')).toBeVisible();
    const before = reads(api).length;
    await alert.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeVisible();
    expect(
      reads(api)
        .slice(before)
        .map((entry) => new URL(entry.url).pathname),
    ).toEqual([`/api/v1${path}/scope-items`]);
  });

  test('EVM-018 AC7 the whole order that cannot be read says "Nie udało się wczytać zlecenia."; offline the data stays under the banner "Dane mogą być nieaktualne"', async ({
    page,
    api,
    context,
  }) => {
    const path = await createOrder(page);
    api.failNext.set(`GET /api/v1${path}`, { status: 500, code: 'internal_error' });
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Nie udało się wczytać zlecenia.' })).toBeVisible();
    await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText(/Dane mogą być nieaktualne \(z \d{2}:\d{2}\)/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Klient' }).getByText('Jan Przykładowy')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText(/Dane mogą być nieaktualne/)).toBeHidden();
  });

  test('EVM-018 AC5 AC6 the data of the order is in the memory of the tab only: no localStorage, sessionStorage, IndexedDB, cache or cookie — also after the offline view', async ({
    page,
    context,
  }) => {
    const path = await createOrder(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Lokalizacja' }).getByText('Operator Testowy')).toBeVisible();
    expect(await browserStores(page)).toEqual({ local: 0, session: 0, databases: 0, cookies: '', caches: 0 });
    await context.setOffline(true);
    await expect(page.getByText(/Dane mogą być nieaktualne/)).toBeVisible();
    expect(await browserStores(page)).toEqual({ local: 0, session: 0, databases: 0, cookies: '', caches: 0 });
    await context.setOffline(false);
  });

  for (const role of ['editor', 'read_only'] as const) {
    test(`EVM-018 AC6 ${role} sees all sections and no action that changes anything`, async ({ page, api }) => {
      const path = await createOrder(page);
      api.role = role;
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Klient' }).getByText('Jan Przykładowy')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Lokalizacja' }).getByText('Operator Testowy')).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeVisible();
      // the controls that change something are the badge of the status (EVM-030), from EVM-036 "Edytuj lokalizację" with the two menus of the
      // parties and from EVM-031 the menu of every visible stage: Tylko odczyt has none. The nine headers of the processes and "Rozwiń wszystkie"
      // only open and close sections; the first process is open, so three stages show their menus and, from EVM-032, their status badges.
      const reading = 10;
      await expect(page.getByRole('main').getByRole('button')).toHaveCount(role === 'editor' ? 4 + reading + 3 + 3 : reading);
      await expect(page.getByRole('button', { name: /^Akcje etapu/ })).toHaveCount(role === 'editor' ? 3 : 0);
      await expect(page.getByRole('button', { name: /^Status etapu .*Zmień status$/ })).toHaveCount(role === 'editor' ? 3 : 0);
    });
  }

  test('EVM-018 AC1 the tab list is reachable by the keyboard: Tab leads to the tab, then to the panel', async ({ page }) => {
    const path = await createOrder(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeVisible();
    await page.getByRole('heading', { level: 1 }).focus();
    // the badge of the status is a button now (EVM-030) and comes first
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /^Status zlecenia: .*Zmień status$/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tab', { name: 'Przegląd' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Przegląd' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tabpanel', { name: 'Przegląd' })).toBeFocused();
  });
});
