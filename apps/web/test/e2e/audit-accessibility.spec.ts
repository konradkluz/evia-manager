import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const AUDIT = '/administration/audit';
const TITLE = 'Potwierdź tożsamość, aby przejrzeć dziennik audytu';

test.describe('accessibility of W-04 and W-18 in the browser, with colour contrast (EVM-029; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-029 AC1 AC4 W-04 and the state "Potwierdź tożsamość" have no axe violations at ${px} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(AUDIT);
      await expect(page.getByRole('alertdialog', { name: TITLE })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Anuluj' }).click();
      await expect(page.getByRole('heading', { name: 'Potwierdź tożsamość, aby zobaczyć dziennik audytu.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-029 AC5 AC8 the log, a filter, an empty period and an error have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(AUDIT);
      await expect(page.getByRole('table')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('combobox', { name: 'Wynik' }).selectOption({ label: 'Odmowa' });
      await expect(page.getByRole('button', { name: 'Usuń filtr Wynik: Odmowa' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.auditEvents = 0;
      await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
      await expect(page.getByRole('heading', { name: 'Brak zdarzeń w wybranym okresie.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.failNext.set('GET /api/v1/audit/events', { status: 500, code: 'internal_error' });
      await page.getByRole('combobox', { name: 'Wynik' }).selectOption({ label: 'Udane' });
      await expect(page.getByRole('heading', { name: 'Nie udało się wczytać dziennika.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-029 AC7 "Brak dostępu" of an Edytor has no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      api.role = 'editor';
      await page.goto(AUDIT);
      await expect(page.getByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
