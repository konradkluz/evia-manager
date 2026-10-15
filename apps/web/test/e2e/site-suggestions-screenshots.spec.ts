import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';
import { GARAGE_ID, seedJanOrders } from './site-suggestions-seed.ts';

// Screenshots for the UX review of EVM-043 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-043 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirSuggestions']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const STATE_WIDTHS = [360, 1280];

test.describe('UX review screenshots (EVM-043) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-043 W-05 suggestion of locations: list, chosen, empty, offline and error at ${px} px`, async ({
      page,
      api,
      context,
      shot,
    }) => {
      seedJanOrders(api);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/work-orders/new');
      await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
      await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await expect(page.getByRole('heading', { name: 'Lokalizacje z poprzednich zleceń klienta (2)' })).toBeVisible();
      await shot(`w05-suggestions-list-${px}`);
      await context.setOffline(true);
      await expect(page.getByText('Podpowiedź lokalizacji jest niedostępna bez połączenia.')).toBeVisible();
      await shot(`w05-suggestions-offline-${px}`);
      await context.setOffline(false);
      await page.getByRole('button', { name: 'Wybierz lokalizację: ul. Testowa 7, Warszawa' }).click();
      await expect(page.getByRole('button', { name: 'Zmień lokalizację' })).toBeVisible();
      await shot(`w05-suggestions-chosen-${px}`);
      await page.getByRole('button', { name: 'Zmień lokalizację' }).click();
      await page.getByRole('button', { name: 'Zmień klienta' }).click();
      await page.getByRole('combobox', { name: 'Klient' }).fill('Firma');
      await page.getByRole('option', { name: /Firma Testowa/ }).click();
      await expect(page.getByRole('combobox', { name: 'Lokalizacja' })).toBeVisible();
      await expect(page.getByText(/Lokalizacje z poprzednich zleceń/)).toBeHidden();
      await shot(`w05-suggestions-none-${px}`);
    });
  }

  for (const width of STATE_WIDTHS) {
    const px = String(width);

    test(`EVM-043 W-05 suggestion of locations: loading skeleton at ${px} px`, async ({ page, api, shot }) => {
      seedJanOrders(api);
      await page.setViewportSize({ width, height: 900 });
      // The list is held by a promise, not by a timeout: it is released only after the screenshot.
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(
        (url) => url.pathname === '/api/v1/work-orders' && url.searchParams.has('customerId'),
        async (route) => {
          await gate;
          await route.fallback();
        },
      );
      await page.goto('/work-orders/new');
      await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
      await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await expect(page.getByText('Wczytujemy lokalizacje z poprzednich zleceń klienta…')).toBeAttached();
      await shot(`w05-suggestions-loading-${px}`);
      release();
      await expect(page.getByRole('heading', { name: 'Lokalizacje z poprzednich zleceń klienta (2)' })).toBeVisible();
    });

    test(`EVM-043 W-05 suggestion of locations: failure of the list and a gone site at ${px} px`, async ({ page, api, shot }) => {
      seedJanOrders(api);
      await page.setViewportSize({ width, height: 900 });
      api.failNext.set('GET /api/v1/work-orders', { status: 500, code: 'internal_error' });
      await page.goto('/work-orders/new');
      await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
      await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
      const alert = page.getByRole('alert').filter({ hasText: 'Nie udało się wczytać lokalizacji' });
      await expect(alert.getByRole('button', { name: 'Spróbuj ponownie' })).toBeVisible();
      await shot(`w05-suggestions-error-${px}`);
      await alert.getByRole('button', { name: 'Spróbuj ponownie' }).click();
      await expect(page.getByRole('heading', { name: 'Lokalizacje z poprzednich zleceń klienta (2)' })).toBeVisible();
      api.failNext.set(`GET /api/v1/sites/${GARAGE_ID}`, { status: 404, code: 'not_found' });
      await page.getByRole('button', { name: 'Wybierz lokalizację: ul. Testowa 7, Warszawa' }).click();
      await expect(page.getByText('Ta lokalizacja nie jest już dostępna')).toBeVisible();
      await shot(`w05-suggestions-gone-${px}`);
    });
  }
});
