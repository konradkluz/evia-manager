import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';
import { freezeServerDay, seedMilestones } from './mock-payments.ts';

// Screenshots for the UX review of EVM-056 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-056 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirPaymentSignals']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T10:00:00+02:00'));
});

async function createOrder(page: Page): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

test.describe('UX review screenshots (EVM-056) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-056 W-10 the column "Płatność", the views, "Najpilniejsze" and the states at ${px} px`, async ({
      page,
      api,
      context,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      api.workOrders = 12;
      await page.goto('/work-orders');
      await expect(page.getByRole('table')).toBeVisible();
      await shot(`w10-payments-urgency-${px}`);
      await page.getByRole('button', { name: 'Po terminie' }).click();
      await expect(page).toHaveURL(/view=overdue_payments/);
      await expect(page.getByRole('table').getByRole('row')).toHaveCount(3);
      await shot(`w10-payments-view-overdue-${px}`);
      await page.getByRole('button', { name: 'Nieopłacone' }).click();
      await expect(page.getByRole('table').getByRole('row')).toHaveCount(6);
      await shot(`w10-payments-view-unpaid-${px}`);
      await context.setOffline(true);
      await expect(page.getByText(/^Dane mogą być nieaktualne/)).toBeVisible();
      await shot(`w10-payments-offline-${px}`);
      await context.setOffline(false);
      api.workOrders = 0;
      await page.goto('/work-orders?view=overdue_payments');
      await expect(page.getByRole('heading', { level: 2, name: /^Brak zleceń z płatnością po terminie/ })).toBeVisible();
      await shot(`w10-payments-empty-overdue-${px}`);
      await page.goto('/work-orders?view=unpaid');
      await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń z nieopłaconymi transzami.' })).toBeVisible();
      await shot(`w10-payments-empty-unpaid-${px}`);
      api.failNext.set('GET /api/v1/work-orders', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
      await page.reload();
      await expect(page.getByText('Zbyt wiele zapytań. Spróbuj ponownie za 1 min.')).toBeVisible();
      await shot(`w10-payments-429-${px}`);
    });

    test(`EVM-056 W-06 the tile "Płatności", its link and its error at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      const id = await createOrder(page);
      const tile = page.getByRole('region', { name: /^Podsumowanie/ }).getByRole('group', { name: 'Płatności' });
      await expect(tile.getByText('Planowane: 4')).toBeVisible();
      await shot(`w06-payments-tile-planned-${px}`);
      seedMilestones(api.orders, id, [
        { status: 'invoiced', amountMinor: 360_000, invoiceNumber: 'FV/TEST/0042/2026', invoicedOn: '2026-09-30', dueDate: '2026-10-07' },
        { amountMinor: 540_000 },
        { amountMinor: 540_000 },
        { amountMinor: 360_000 },
      ]);
      freezeServerDay(api.orders, '2026-10-12');
      await page.reload();
      await expect(tile.getByText('5 dni')).toBeVisible();
      await shot(`w06-payments-tile-overdue-${px}`);
      await tile.getByRole('link').focus();
      await shot(`w06-payments-tile-focus-${px}`);
      api.failNext.set(`GET /api/v1/work-orders/${id}/payment-milestones`, { status: 500, code: 'internal_error' });
      await page.reload();
      await expect(tile.getByRole('alert')).toBeVisible();
      await shot(`w06-payments-tile-error-${px}`);
    });
  }
});
