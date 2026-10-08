import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-018 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-018 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirDetails']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

async function createOrder(page: Page): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe('UX review screenshots (EVM-018) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-018 W-06 Przegląd: loaded, notes with markup, section error, whole error, not found and offline at ${px} px`, async ({
      page,
      api,
      context,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Lokalizacja' }).getByText('Operator Testowy')).toBeVisible();
      await shot(`w06-overview-${px}`);

      api.orders.notes = '<script>alert(1)</script> javascript:alert(1) https://example.invalid/mapa tel:+48600000002';
      await page.goto(path);
      await expect(
        page.getByRole('region', { name: 'Lokalizacja' }).getByRole('link', { name: 'https://example.invalid/mapa' }),
      ).toBeVisible();
      await shot(`w06-notes-markup-${px}`);

      api.failNext.set(`GET /api/v1${path}/scope-items`, { status: 500, code: 'internal_error' });
      await page.goto(path);
      await expect(page.getByText('Nie udało się wczytać zakresu zlecenia.')).toBeVisible();
      await shot(`w06-section-error-${px}`);

      api.failNext.set(`GET /api/v1${path}`, { status: 500, code: 'internal_error' });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Nie udało się wczytać zlecenia.' })).toBeVisible();
      await shot(`w06-error-${px}`);

      await page.goto('/work-orders/01968f3e-0000-7000-8000-00000000dead');
      await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeVisible();
      await shot(`w06-not-found-${px}`);

      await page.goto(path);
      await expect(page.getByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByText(/Dane mogą być nieaktualne/)).toBeVisible();
      await shot(`w06-offline-${px}`);
      await context.setOffline(false);
    });
  }
});
