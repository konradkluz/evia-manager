import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';
import { seedJanOrders } from './site-suggestions-seed.ts';

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
});
