import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-017 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-017 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirWorkOrders']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('UX review screenshots (EVM-017) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-017 W-10 list, filters, states and offline at ${px} px`, async ({ page, api, context, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      api.workOrders = 60;
      await page.goto('/work-orders');
      await expect(page.getByRole('table')).toBeVisible();
      await shot(`w10-list-${px}`);
      await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Wycena' }).click();
      await page.getByRole('combobox', { name: 'Opiekun' }).selectOption({ label: 'Jan Przykładowy' });
      await expect(page.getByRole('button', { name: 'Usuń filtr Opiekun: Jan Przykładowy' })).toBeVisible();
      await shot(`w10-filtered-${px}`);
      await page.getByRole('button', { name: 'Moje' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń spełniających filtry.' })).toBeVisible();
      await shot(`w10-no-results-${px}`);
      api.failNext.set('GET /api/v1/work-orders', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '120' } });
      await page.getByRole('button', { name: 'Wyczyść filtry' }).last().click();
      await expect(page.getByRole('alert')).toContainText('Zbyt wiele zapytań');
      await shot(`w10-429-${px}`);
      api.failNext.set('GET /api/v1/work-orders', { status: 500, code: 'internal_error' });
      await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Nie udało się wczytać zleceń.' })).toBeVisible();
      await shot(`w10-error-${px}`);
      await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
      await expect(page.getByRole('table')).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByText(/^Dane mogą być nieaktualne/)).toBeVisible();
      await shot(`w10-offline-${px}`);
      await context.setOffline(false);
    });

    test(`EVM-017 W-10 empty state at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      api.workOrders = 0;
      await page.goto('/work-orders');
      await expect(page.getByRole('heading', { level: 2, name: 'Nie masz jeszcze zleceń.' })).toBeVisible();
      await shot(`w10-empty-${px}`);
    });
  }
});
