import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-055 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-055 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirUnpaid']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('UX review screenshots (EVM-055) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-055 W-11 the list, the filters, the dialog of the payment and its conflict at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/payments');
      await expect(page.getByRole('table', { name: 'Nieopłacone transze' })).toBeVisible();
      await shot(`w11-list-${px}`);

      await page.getByRole('button', { name: 'Po terminie', exact: true }).click();
      await expect(page.getByRole('table', { name: 'Nieopłacone transze' }).getByRole('row')).toHaveCount(5);
      await shot(`w11-overdue-${px}`);

      await page.getByRole('combobox', { name: 'Klient' }).fill('Przykładowy');
      await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await expect(page.getByRole('button', { name: 'Usuń filtr: klient Jan Przykładowy' })).toBeVisible();
      await shot(`w11-filters-customer-${px}`);

      await page.getByRole('button', { name: 'Akcje transzy: Płatność końcowa, ZL-2026-0031' }).click();
      await expect(page.getByRole('menuitem', { name: 'Popraw dane faktury…' })).toBeVisible();
      await shot(`w11-menu-${px}`);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Odnotuj wpłatę: Płatność końcowa, ZL-2026-0031' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await shot(`w11-payment-dialog-${px}`);
      const row = api.unpaid.rows[0];
      if (row === undefined) throw new Error('no row');
      row.status = 'paid';
      row.version = 4;
      await page.getByRole('alertdialog').getByRole('button', { name: 'Odnotuj wpłatę' }).click();
      await expect(page.getByRole('alertdialog').getByText(/teraz: «Opłacona»/)).toBeVisible();
      await shot(`w11-payment-dialog-conflict-${px}`);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Odśwież' }).click();
      await expect(page.getByRole('row', { name: /ZL-2026-0031/ })).toHaveCount(0);
      await shot(`w11-after-conflict-${px}`);
    });

    test(`EVM-055 W-11 the states no result, empty, error and offline at ${px} px`, async ({ page, api, context, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/payments?view=overdue');
      await expect(page.getByRole('table', { name: 'Nieopłacone transze' })).toBeVisible();
      await page.getByLabel('Termin do').fill('2026-01-01');
      await expect(page.getByRole('heading', { level: 2, name: 'Brak transz spełniających filtry.' })).toBeVisible();
      await shot(`w11-no-result-${px}`);
      await page.getByLabel('Termin do').fill('');
      await expect(page.getByRole('table', { name: 'Nieopłacone transze' })).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByText(/^Dane mogą być nieaktualne/)).toBeVisible();
      await shot(`w11-offline-${px}`);
      await context.setOffline(false);
      api.failNext.set('GET /api/v1/payment-milestones', { status: 500, code: 'internal_error' });
      await page.getByRole('button', { name: 'Wszystkie wystawione', exact: true }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Nie udało się wczytać płatności.' })).toBeVisible();
      await shot(`w11-error-${px}`);
      api.failNext.set('GET /api/v1/payment-milestones', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '600' } });
      await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
      await expect(page.getByText('Zbyt wiele zapytań. Spróbuj ponownie za 10 min.')).toBeVisible();
      await shot(`w11-rate-limited-${px}`);
      for (const row of api.unpaid.rows) row.status = 'paid';
      await page.goto('/payments');
      await expect(page.getByRole('heading', { level: 2, name: 'Wszystkie wystawione faktury są opłacone.' })).toBeVisible();
      await shot(`w11-empty-${px}`);
    });

    test(`EVM-055 W-11 Tylko odczyt: the amounts, the numbers and the terms without actions at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'read_only';
      await page.goto('/payments');
      await expect(page.getByRole('table', { name: 'Nieopłacone transze' })).toBeVisible();
      await shot(`w11-read-only-${px}`);
    });
  }
});
