import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-072 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-072 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirSearch']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const FIELD = 'Szukaj: numer, tytuł, klient, adres…';

test.describe('UX review screenshots (EVM-072) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-072 W-10 customer and location, search, "Więcej filtrów" and states at ${px} px`, async ({ page, api, context, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      api.workOrders = 60;
      await page.goto('/work-orders');
      await expect(page.getByRole('table')).toBeVisible();
      await shot(`w10-customer-location-${px}`);
      await page.getByRole('searchbox', { name: FIELD }).fill('przykladowy');
      await expect(page.getByRole('table')).not.toContainText('Firma Testowa');
      await shot(`w10-search-${px}`);
      await page.getByRole('button', { name: 'Więcej filtrów' }).click();
      await page.getByRole('combobox', { name: 'Typ obiektu' }).selectOption({ label: 'Dom jednorodzinny' });
      await expect(page.getByRole('button', { name: 'Więcej filtrów (1)' })).toBeVisible();
      await shot(`w10-more-filters-${px}`);
      await page.getByRole('searchbox', { name: FIELD }).fill('zzzzzz');
      await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń spełniających filtry.' })).toBeVisible();
      await shot(`w10-no-results-${px}`);
      api.failNext.set('POST /api/v1/work-orders/search', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
      await page.getByRole('searchbox', { name: FIELD }).fill('zzzzzzz');
      await expect(page.getByRole('alert')).toContainText('Zbyt wiele zapytań');
      await shot(`w10-429-${px}`);
      await page.getByRole('button', { name: 'Wyczyść filtry' }).last().click();
      await expect(page.getByRole('table')).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByRole('searchbox', { name: FIELD })).toHaveAttribute('aria-disabled', 'true');
      await shot(`w10-offline-${px}`);
      await context.setOffline(false);
    });
  }
});
