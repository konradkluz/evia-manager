import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const FIELD = 'Szukaj: numer, tytuł, klient, adres…';

test.describe('accessibility of the search of work orders, with colour contrast (EVM-072 AC1, AC2, AC4, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-072 AC1 AC2 AC4 the list with customer and location, a result, the open panel and the filters have no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      api.workOrders = 60;
      await page.goto('/work-orders');
      await expect(page.getByRole('table')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('searchbox', { name: FIELD }).fill('przykladowy');
      await expect(page.getByRole('table')).not.toContainText('Firma Testowa');
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Więcej filtrów' }).click();
      await page.getByRole('combobox', { name: 'Typ obiektu' }).selectOption({ label: 'Dom jednorodzinny' });
      await expect(page.getByRole('button', { name: 'Więcej filtrów (1)' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-072 AC8 no results, 429 and the failed list of templates have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      api.workOrders = 10;
      await page.goto('/work-orders');
      await expect(page.getByRole('table')).toBeVisible();
      await page.getByRole('searchbox', { name: FIELD }).fill('zzzzzz');
      await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń spełniających filtry.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.failNext.set('POST /api/v1/work-orders/search', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
      await page.getByRole('searchbox', { name: FIELD }).fill('zzzzzzz');
      await expect(page.getByRole('alert')).toContainText('Zbyt wiele zapytań');
      expect(await violations(page)).toEqual([]);
      api.failNext.set('GET /api/v1/catalog/work-order-templates', { status: 500, code: 'internal_error' });
      await page.getByRole('button', { name: 'Więcej filtrów' }).click();
      await expect(page.getByText('Nie udało się wczytać szablonów.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
