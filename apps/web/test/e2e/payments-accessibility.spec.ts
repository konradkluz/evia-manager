import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('accessibility of W-11 in the browser, with colour contrast (EVM-055 AC1, AC2, AC5, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-055 AC1 AC2 AC3 the list, the menu and the dialog of the payment have no axe violations at ${px} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/payments');
      await expect(page.getByRole('table', { name: 'Nieopłacone transze' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Akcje transzy: Płatność końcowa, ZL-2026-0031' }).click();
      await expect(page.getByRole('menuitem', { name: 'Popraw dane faktury…' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Odnotuj wpłatę: Płatność końcowa, ZL-2026-0031' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-055 AC4 AC8 the filters, the states no result, empty and error have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/payments?view=overdue');
      await expect(page.getByRole('table', { name: 'Nieopłacone transze' })).toBeVisible();
      await page.getByLabel('Termin do').fill('2026-01-01');
      await expect(page.getByRole('heading', { level: 2, name: 'Brak transz spełniających filtry.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      for (const row of api.unpaid.rows) row.status = 'paid';
      await page.goto('/payments');
      await expect(page.getByRole('heading', { level: 2, name: 'Wszystkie wystawione faktury są opłacone.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.failNext.set('GET /api/v1/payment-milestones', { status: 500, code: 'internal_error' });
      await page.reload();
      await expect(page.getByRole('heading', { level: 2, name: 'Nie udało się wczytać płatności.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-055 AC5 the page of Tylko odczyt has no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'read_only';
      await page.goto('/payments');
      await expect(page.getByRole('table', { name: 'Nieopłacone transze' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
