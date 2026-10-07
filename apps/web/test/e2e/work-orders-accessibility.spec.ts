import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('accessibility of W-10 in the browser, with colour contrast (EVM-017 AC1, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-017 AC1 AC2 the list and a filter have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      api.workOrders = 60;
      await page.goto('/work-orders');
      await expect(page.getByRole('table')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Rozliczone' }).click();
      await expect(page.getByRole('button', { name: 'Usuń filtr Status: Rozliczone' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-017 AC8 the states empty, no results and error have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      api.workOrders = 0;
      await page.goto('/work-orders');
      await expect(page.getByRole('heading', { level: 2, name: 'Nie masz jeszcze zleceń.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Moje' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń spełniających filtry.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.failNext.set('GET /api/v1/work-orders', { status: 500, code: 'internal_error' });
      await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Nowe' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Nie udało się wczytać zleceń.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
