import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { seedJanOrders } from './site-suggestions-seed.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('accessibility of the suggestion of locations in W-05, with colour contrast (EVM-043; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-043 AC1 AC4 the suggestion list and the offline notice have no axe violations at ${px} px`, async ({
      page,
      api,
      context,
    }) => {
      seedJanOrders(api);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/work-orders/new');
      await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
      await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await expect(page.getByRole('heading', { name: 'Lokalizacje z poprzednich zleceń klienta (2)' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await context.setOffline(true);
      await expect(page.getByText('Podpowiedź lokalizacji jest niedostępna bez połączenia.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
