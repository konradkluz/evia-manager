import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-022 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-022 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirOrders']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('UX review screenshots (EVM-022) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-022 W-05 sections 3 and 4: empty, summary, template chosen, offline, retired template, and W-06 at ${px} px`, async ({
      page,
      api,
      context,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/work-orders/new');
      await expect(page.getByRole('radio', { name: 'Puste zlecenie (bez szablonu)' })).toBeVisible();
      await shot(`w05-template-empty-${px}`);
      await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
      await expect(page.getByText('Popraw zaznaczone pola, aby utworzyć zlecenie.')).toBeVisible();
      await shot(`w05-summary-${px}`);
      await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
      await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
      await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
      await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
      if (width < 1280) await page.getByRole('button', { name: 'Pokaż szczegóły szablonu' }).click();
      await expect(page.getByRole('heading', { name: 'Zakres (9 pozycji)' })).toBeVisible();
      await shot(`w05-template-chosen-${px}`);
      await context.setOffline(true);
      await expect(page.getByText('Utworzenie zlecenia wymaga połączenia.')).toBeVisible();
      await shot(`w05-offline-${px}`);
      await context.setOffline(false);
      const retired = api.orders.templates[0];
      if (retired !== undefined) api.orders.templates[0] = { ...retired, isActive: false };
      await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
      await expect(page.getByText(/został wycofany/)).toBeVisible();
      await shot(`w05-template-retired-${px}`);
      if (retired !== undefined) api.orders.templates[0] = retired;
      await page.reload();
      await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
      await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
      await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
      await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
      await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
      await shot(`w06-header-${px}`);
    });
  }
});
