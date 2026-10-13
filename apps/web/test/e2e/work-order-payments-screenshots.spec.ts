import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-053 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-053 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirPayments']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

async function pickCustomerAndSite(page: Page) {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
}

async function createOrder(page: Page, template: RegExp | string = /Garaż — pełny proces/): Promise<string> {
  await pickCustomerAndSite(page);
  await page.getByRole('radio', { name: template }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe('UX review screenshots (EVM-053) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-053 W-05 the cards with the instalments and the preview "Plan płatności" at ${px} px`, async ({ page, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      await pickCustomerAndSite(page);
      await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
      const toggle = page.getByRole('button', { name: 'Pokaż szczegóły szablonu' });
      if (await toggle.isVisible()) await toggle.click();
      await expect(page.getByRole('heading', { name: 'Plan płatności' })).toBeVisible();
      await shot(`w05-payment-plan-${px}`);
    });

    test(`EVM-053 W-06 Płatności: the section, the dialogs, 412, a settled order, no instalments and offline at ${px} px`, async ({
      page,
      api,
      context,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      const section = page.getByRole('region', { name: 'Płatności', exact: true });
      await expect(section.getByRole('table', { name: 'Transze płatności zlecenia' })).toBeVisible();
      await section.scrollIntoViewIfNeeded();
      await shot(`w06-payments-${px}`);

      await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
      await shot(`w06-payments-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Zmień kwotę…' }).click();
      const amount = page.getByRole('dialog', { name: 'Zmień kwotę transzy' });
      await amount.getByRole('textbox', { name: 'Kwota' }).fill('5400');
      await shot(`w06-payments-amount-dialog-${px}`);
      // the first instalment of the synthetic order (mock-payments.ts names them after the order)
      const orderId = path.split('/').at(-1) ?? '';
      api.failNext.set(`PATCH /api/v1${path}/payment-milestones/${orderId.slice(0, -6)}e00000`, { status: 412, code: 'version_conflict' });
      await amount.getByRole('button', { name: 'Zapisz kwotę' }).click();
      await expect(amount.getByText(/Tę transzę zmieniono w międzyczasie/)).toBeVisible();
      await shot(`w06-payments-amount-conflict-${px}`);
      await amount.getByRole('button', { name: 'Zapisz kwotę' }).click();
      await expect(page.getByText(/Zmieniono kwotę transzy „Zaliczka”/)).toBeVisible();

      await section.getByRole('button', { name: 'Dodaj transzę' }).click();
      const add = page.getByRole('dialog', { name: 'Dodaj transzę' });
      await add.getByRole('textbox', { name: 'Nazwa transzy' }).fill('Dopłata za instalację zasilającą');
      await add.getByRole('textbox', { name: 'Kwota (opcjonalnie)' }).fill('1500');
      await shot(`w06-payments-add-dialog-${px}`);
      await add.getByRole('button', { name: 'Dodaj transzę' }).click();
      await expect(page.getByText('Dodano transzę „Dopłata za instalację zasilającą”.')).toBeVisible();
      await shot(`w06-payments-added-${px}`);

      api.orders.states.set(orderId, { status: 'in_progress', version: 5 });
      await page.reload();
      await page.getByRole('button', { name: 'Status zlecenia: W realizacji. Zmień status' }).click();
      await page.getByRole('menuitem', { name: 'Anuluj zlecenie…' }).click();
      // four instalments of the plan and the one added above
      await expect(page.getByText('Planowane transze (5) zostaną anulowane.')).toBeVisible();
      await shot(`w06-cancel-with-instalments-${px}`);

      api.orders.states.set(orderId, { status: 'settled', version: 9 });
      await page.reload();
      await expect(section.getByRole('button', { name: 'Dodaj transzę' })).toHaveAttribute('aria-disabled', 'true');
      await section.scrollIntoViewIfNeeded();
      await shot(`w06-payments-settled-${px}`);
      await context.setOffline(true);
      await expect(page.getByText(/Dane mogą być nieaktualne/)).toBeVisible();
      await shot(`w06-payments-offline-${px}`);
      await context.setOffline(false);
    });

    test(`EVM-053 W-06 Płatności without instalments at ${px} px`, async ({ page, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrder(page, 'Puste zlecenie (bez szablonu)');
      await expect(page.getByRole('region', { name: 'Płatności', exact: true }).getByText('Brak transz.')).toBeVisible();
      await shot(`w06-payments-empty-${px}`);
    });
  }
});
