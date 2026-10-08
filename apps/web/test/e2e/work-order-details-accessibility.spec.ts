import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

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

test.describe('accessibility of W-06 "Przegląd" in the browser, with colour contrast (EVM-018 AC1, AC3, AC7; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-018 AC1 AC2 AC4 the loaded page, with notes that contain markup, at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      api.orders.notes = '<script>alert(1)</script> javascript:alert(1) https://example.invalid/mapa';
      const path = await createOrder(page);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeVisible();
      await expect(
        page.getByRole('region', { name: 'Lokalizacja' }).getByRole('link', { name: 'https://example.invalid/mapa' }),
      ).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-018 AC3 AC7 not found, a section that failed, the whole order that failed and the offline banner at ${px} px`, async ({
      page,
      api,
      context,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      await page.goto(`/work-orders/01968f3e-0000-7000-8000-00000000dead`);
      await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.failNext.set(`GET /api/v1${path}/scope-items`, { status: 500, code: 'internal_error' });
      await page.goto(path);
      await expect(page.getByText('Nie udało się wczytać zakresu zlecenia.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.failNext.set(`GET /api/v1${path}`, { status: 500, code: 'internal_error' });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Nie udało się wczytać zlecenia.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByText(/Dane mogą być nieaktualne/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await context.setOffline(false);
    });
  }
});
