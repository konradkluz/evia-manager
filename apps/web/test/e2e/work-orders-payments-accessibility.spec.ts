import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { freezeServerDay, seedMilestones } from './mock-payments.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

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

test.describe('accessibility of the payments on W-10 and W-06, with colour contrast (EVM-056 AC1–AC4, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-056 AC1 AC2 AC3 the column "Płatność", the views and "Najpilniejsze" have no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      api.workOrders = 30;
      await page.goto('/work-orders');
      await expect(page.getByRole('table')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Po terminie' }).click();
      await expect(page).toHaveURL(/view=overdue_payments/);
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Nieopłacone' }).click();
      await expect(page).toHaveURL(/view=unpaid/);
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-056 AC2 the empty payment views have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      api.workOrders = 0;
      await page.goto('/work-orders?view=overdue_payments');
      await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń z płatnością po terminie. Dobra wiadomość.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-056 AC4 AC8 the tile "Płatności" and its error have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      const id = await createOrder(page);
      seedMilestones(api.orders, id, [
        { status: 'invoiced', amountMinor: 360_000, invoiceNumber: 'FV/TEST/0042/2026', invoicedOn: '2026-09-30', dueDate: '2026-10-07' },
      ]);
      freezeServerDay(api.orders, '2026-10-12');
      await page.reload();
      const tile = page.getByRole('region', { name: /^Podsumowanie/ }).getByRole('group', { name: 'Płatności' });
      await expect(tile.getByText('5 dni')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await tile.getByRole('link').focus();
      expect(await violations(page)).toEqual([]);
      api.failNext.set(`GET /api/v1/work-orders/${id}/payment-milestones`, { status: 500, code: 'internal_error' });
      await page.reload();
      await expect(tile.getByRole('alert')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
