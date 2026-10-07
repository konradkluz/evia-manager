import { expect, test } from './fixtures.ts';

// W-10 in a real browser against the synthetic API (EVM-017 AC1–AC3, AC5, AC8; SR-WEB-05). The full stack (API and
// database) is covered by the API integration tests and the QA run; here the target is the tab.
test.use({ session: 'active' });

const PATH = '/work-orders';
const NEXT = 'Następna strona';

test.describe('work orders list W-10 (EVM-017)', () => {
  test('EVM-017 AC1 AC3 the default view shows 25 open orders, newest first, and pages follow without a repeat', async ({ page, api }) => {
    api.workOrders = 60;
    await page.goto(PATH);
    const table = page.getByRole('table', { name: 'Lista zleceń' });
    await expect(table).toBeVisible();
    // 60 orders, two statuses in eight closed (settled, cancelled): 46 open ones, newest number first.
    await expect(table.getByRole('row')).toHaveCount(26);
    await expect(table.getByRole('link').first()).toContainText('ZL-2026-0060');
    await page.getByRole('button', { name: NEXT }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Lista zleceń' })).toBeFocused();
    await expect(table.getByRole('row')).toHaveCount(22);
    await expect(page.getByRole('button', { name: NEXT })).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Poprzednia strona' }).click();
    await expect(table.getByRole('link').first()).toContainText('ZL-2026-0060');
    await expect(page).toHaveTitle('Zlecenia · EVia Manager');
  });

  test('EVM-017 AC2 statuses and the view go to the address; the coordinator and the sort order do not', async ({ page, api }) => {
    api.workOrders = 60;
    await page.goto(PATH);
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Wstrzymane' }).click();
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Wycena' }).click();
    await expect(page).toHaveURL(/\?status=quoting%2Con_hold&view=all$/);
    await page.getByRole('combobox', { name: 'Opiekun' }).selectOption({ label: 'Jan Przykładowy' });
    await page.getByRole('combobox', { name: 'Sortuj' }).selectOption({ label: 'Numer — od najniższego' });
    await expect(page.getByRole('button', { name: 'Usuń filtr Opiekun: Jan Przykładowy' })).toBeVisible();
    expect(new URL(page.url()).search).toBe('?status=quoting%2Con_hold&view=all');
    // "Moje" and the coordinator Jan exclude each other (the filters join with AND): no results, the filters stay.
    await page.getByRole('button', { name: 'Moje' }).click();
    await expect(page).toHaveURL(/status=quoting%2Con_hold&view=mine$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń spełniających filtry.' })).toBeVisible();
    await page.getByRole('button', { name: 'Wyczyść filtry' }).last().click();
    await expect(page.getByRole('table')).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
  });

  test('EVM-017 AC3 a cursor the server refuses brings back the first page with the message; the filters stay', async ({ page, api }) => {
    api.workOrders = 240;
    await page.goto(`${PATH}?view=mine`);
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('button', { name: NEXT }).click();
    await expect(page.getByRole('button', { name: 'Poprzednia strona' })).not.toHaveAttribute('aria-disabled', 'true');
    api.failNext.set('GET /api/v1/work-orders', { status: 400, code: 'invalid_cursor' });
    await page.getByRole('button', { name: NEXT }).click();
    await expect(page.getByText('Lista się zmieniła — wróciliśmy na początek.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Moje' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Poprzednia strona' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('EVM-017 AC5 a 429 shows the minutes to wait; the filters stay; a retry reads the list again', async ({ page, api }) => {
    api.workOrders = 10;
    await page.goto(`${PATH}?view=mine`);
    await expect(page.getByRole('table')).toBeVisible();
    api.failNext.set('GET /api/v1/work-orders', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '90' } });
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Nowe' }).click();
    await expect(page.getByRole('alert')).toContainText('Zbyt wiele zapytań. Spróbuj ponownie za 2 min.');
    await expect(page.getByRole('button', { name: 'Usuń filtr Status: Nowe' })).toBeVisible();
    await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('EVM-017 AC8 empty, error with a retry and offline with the last page and disabled filters', async ({ page, api, context }) => {
    api.workOrders = 0;
    await page.goto(PATH);
    await expect(page.getByRole('heading', { level: 2, name: 'Nie masz jeszcze zleceń.' })).toBeVisible();
    api.workOrders = 30;
    api.failNext.set('GET /api/v1/work-orders', { status: 500, code: 'internal_error' });
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Nie udało się wczytać zleceń.' })).toBeVisible();
    await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText(/^Dane mogą być nieaktualne \(z \d\d:\d\d\)$/)).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Moje' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('combobox', { name: 'Sortuj' })).toBeDisabled();
    await context.setOffline(false);
  });

  test('EVM-017 AC8 the list never reaches the stores of the browser (SR-WEB-05); after logout nothing of it stays in the tab', async ({
    page,
    api,
  }) => {
    api.workOrders = 60;
    await page.goto(PATH);
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('button', { name: NEXT }).click();
    const stores = await page.evaluate(async () => ({
      local: globalThis.localStorage.length,
      session: globalThis.sessionStorage.length,
      databases: (await globalThis.indexedDB.databases()).length,
      caches: (await globalThis.caches.keys()).length,
      workers: (await navigator.serviceWorker.getRegistrations()).length,
    }));
    expect(stores).toEqual({ local: 0, session: 0, databases: 0, caches: 0, workers: 0 });
    await page.getByRole('button', { name: 'Konto: Anna Testowa' }).click();
    await page.getByRole('menuitem', { name: 'Wyloguj' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('ZL-2026-');
  });

  test('EVM-017 AC1 a row is one link reached with the keyboard', async ({ page, api }) => {
    api.workOrders = 5;
    await page.goto(PATH);
    const link = page.getByRole('table').getByRole('link').first();
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveAttribute('href', /^\/work-orders\/00000000-0000-4000-8000-0000000000\d\d$/);
  });
});
