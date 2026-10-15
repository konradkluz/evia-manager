import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';
import { freezeServerDay, seedMilestones } from './mock-payments.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T10:00:00+02:00'));
});

async function seededOrder(page: Page, api: MockApi): Promise<void> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  seedMilestones(api.orders, new URL(page.url()).pathname.split('/').at(-1) ?? '', [
    { status: 'invoiced', amountMinor: 360_000, invoiceNumber: 'FV/TEST/0007/2026', invoicedOn: '2026-10-03', dueDate: '2026-10-10' },
    {
      status: 'paid',
      amountMinor: 540_000,
      invoiceNumber: 'FV/TEST/0008/2026',
      invoicedOn: '2026-09-20',
      dueDate: '2026-09-27',
      paidOn: '2026-10-03',
    },
    { amountMinor: 540_000 },
    { status: 'cancelled' },
  ]);
  freezeServerDay(api.orders, '2026-10-14');
  await page.reload();
  await expect(page.getByRole('table', { name: 'Transze płatności zlecenia' })).toBeVisible();
}

async function choose(page: Page, name: string, item: string) {
  const trigger = page.getByRole('button', { name: `Akcje transzy: ${name}` });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe('accessibility of the corrections of payments, with colour contrast (EVM-057 AC1–AC5, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-057 AC1 AC3 AC4 AC5 the menu, the dialogs K1, K3, K4, K6, W-04 and "Nie wykonano korekty." at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await seededOrder(page, api);
      await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
      await expect(page.getByRole('menuitem', { name: 'Wycofaj fakturę…' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press('Escape');

      await choose(page, 'Zaliczka (20%)', 'Wycofaj fakturę…');
      const k1 = page.getByRole('alertdialog', { name: 'Wycofać fakturę FV/TEST/0007/2026?' });
      await expect(k1).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await k1.getByRole('button', { name: 'Wycofaj fakturę' }).click();
      const stepUp = page.getByRole('alertdialog', { name: 'Potwierdź tożsamość, aby skorygować płatność' });
      await expect(stepUp).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await stepUp.getByRole('button', { name: 'Anuluj' }).click();
      await expect(k1.getByRole('alert')).toHaveText('Nie wykonano korekty.');
      expect(await violations(page)).toEqual([]);
      await k1.getByRole('button', { name: 'Anuluj', exact: true }).click();

      await choose(page, 'Po uzyskaniu zgód (30%)', 'Cofnij wpłatę…');
      await expect(page.getByRole('alertdialog')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Anuluj', exact: true }).click();

      await choose(page, 'Zaliczka (20%)', 'Zmień kwotę…');
      const k4 = page.getByRole('dialog', { name: 'Zmienić kwotę transzy „Zaliczka”?' });
      await k4.getByRole('textbox', { name: 'Nowa kwota' }).fill('3690');
      await expect(k4.getByRole('button', { name: 'Zmień kwotę' })).not.toHaveAttribute('aria-disabled', 'true');
      expect(await violations(page)).toEqual([]);
      await k4.getByRole('button', { name: 'Anuluj' }).click();

      await choose(page, 'Płatność końcowa (20%)', 'Usuń transzę…');
      await expect(page.getByRole('alertdialog')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
