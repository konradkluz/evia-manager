import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { DISPLAY_NAME } from './mock-api.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('accessibility of W-19 in the browser, with colour contrast (EVM-063 AC6; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    test.describe(`at ${String(width)} px`, () => {
      test(`EVM-063 AC6 W-19 before logging in, clauses closed and open, has no axe violations at ${String(width)} px`, async ({
        page,
        api,
      }) => {
        api.session = 'none';
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/privacy');
        await expect(page.getByRole('heading', { level: 2, name: 'Pomoc' })).toBeVisible();
        expect(await violations(page)).toEqual([]);
        for (const toggle of await page.getByRole('button', { name: /^Klauzula/ }).all()) await toggle.click();
        await expect(page.getByRole('heading', { level: 4, name: 'Twoje prawa' }).first()).toBeVisible();
        expect(await violations(page)).toEqual([]);
      });

      test(`EVM-063 AC6 W-19 in the panel and the footer of W-01 have no axe violations at ${String(width)} px`, async ({ page, api }) => {
        api.session = 'active';
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/work-orders');
        await page.getByRole('button', { name: `Konto: ${DISPLAY_NAME}` }).click();
        await expect(page.getByRole('menuitem', { name: 'Prywatność i pomoc' })).toBeVisible();
        expect(await violations(page)).toEqual([]);
        await page.getByRole('menuitem', { name: 'Prywatność i pomoc' }).click();
        await expect(page.getByRole('heading', { level: 2, name: 'Prywatność' })).toBeVisible();
        expect(await violations(page)).toEqual([]);
        api.session = 'none';
        await page.goto('/login');
        await expect(page.getByRole('navigation', { name: 'Prywatność i pomoc' })).toBeVisible();
        expect(await violations(page)).toEqual([]);
      });
    });
  }
});
