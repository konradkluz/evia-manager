import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';
import { freezeServerDay, seedMilestones } from './mock-payments.ts';

// Screenshots for the UX review of EVM-057 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-057 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirPaymentCorrections']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.beforeEach(async ({ page }) => {
  // the clock of the tab is frozen; the day of the synthetic server is frozen separately (it counts "Po terminie")
  await page.clock.setFixedTime(new Date('2026-10-01T10:00:00+02:00'));
});

/** ZL-2026-0042 with an invoiced (after the due date), a paid, a planned and a cancelled instalment (as in the E2E of EVM-057). */
async function seededOrder(page: Page, api: MockApi): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  const path = new URL(page.url()).pathname;
  seedMilestones(api.orders, path.split('/').at(-1) ?? '', [
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
  return path;
}

async function choose(page: Page, name: string, item: string) {
  const trigger = page.getByRole('button', { name: `Akcje transzy: ${name}` });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe('UX review screenshots (EVM-057) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-057 W-06 corrections K1–K6, W-04, the failures and the menus at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await seededOrder(page, api);
      const orderId = path.split('/').at(-1) ?? '';
      await page.getByRole('region', { name: 'Płatności', exact: true }).scrollIntoViewIfNeeded();
      await shot(`w06-corrections-list-${px}`);

      const trigger = page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await shot(`w06-menu-administrator-invoiced-${px}`);
      await page.keyboard.press('Escape');

      // K1 → W-04 → "Anuluj" → "Nie wykonano korekty."
      await choose(page, 'Zaliczka (20%)', 'Wycofaj fakturę…');
      const k1 = page.getByRole('alertdialog', { name: 'Wycofać fakturę FV/TEST/0007/2026?' });
      await expect(k1).toBeVisible();
      await shot(`k1-withdraw-invoice-${px}`);
      await k1.getByRole('button', { name: 'Wycofaj fakturę' }).click();
      const stepUp = page.getByRole('alertdialog', { name: 'Potwierdź tożsamość, aby skorygować płatność' });
      await expect(stepUp).toBeVisible();
      await shot(`w04-correction-${px}`);
      await stepUp.getByRole('button', { name: 'Anuluj' }).click();
      await expect(k1.getByRole('alert')).toBeVisible();
      await shot(`k1-not-corrected-${px}`);
      await k1.getByRole('button', { name: 'Anuluj', exact: true }).click();

      api.stepUp = 'fresh';
      await choose(page, 'Zaliczka (20%)', 'Anuluj fakturę…');
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await shot(`k2-cancel-invoice-${px}`);
      api.orders.states.set(orderId, { status: 'settled', version: 7 });
      await page.getByRole('alertdialog').getByRole('button', { name: 'Anuluj fakturę' }).click();
      await expect(page.getByRole('alertdialog').getByRole('alert')).toBeVisible();
      await shot(`k2-closed-order-${px}`);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Anuluj', exact: true }).click();
      api.orders.states.set(orderId, { status: 'in_progress', version: 8 });
      await page.reload();
      await expect(page.getByRole('table', { name: 'Transze płatności zlecenia' })).toBeVisible();

      await choose(page, 'Po uzyskaniu zgód (30%)', 'Cofnij wpłatę…');
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await shot(`k3-undo-payment-${px}`);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Anuluj', exact: true }).click();

      await choose(page, 'Zaliczka (20%)', 'Zmień kwotę…');
      const k4 = page.getByRole('dialog', { name: 'Zmienić kwotę transzy „Zaliczka”?' });
      await shot(`k4-amount-unchanged-${px}`);
      await k4.getByRole('textbox', { name: 'Nowa kwota' }).fill('3690');
      await shot(`k4-amount-changed-${px}`);
      await k4.getByRole('button', { name: 'Anuluj' }).click();

      await choose(page, 'Płatność końcowa (20%)', 'Przywróć transzę…');
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await shot(`k5-restore-${px}`);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Anuluj', exact: true }).click();

      await choose(page, 'Zaliczka (20%)', 'Usuń transzę…');
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await shot(`k6-delete-${px}`);
      seedMilestones(api.orders, orderId, [{ status: 'paid', paidOn: '2026-10-13' }]);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Usuń transzę' }).click();
      await expect(page.getByRole('alertdialog').getByText(/Tę transzę zmieniono w międzyczasie/)).toBeVisible();
      await shot(`k6-conflict-${px}`);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Odśwież' }).click();

      await choose(page, 'Po uzyskaniu zgód (30%)', 'Cofnij wpłatę…');
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cofnij wpłatę' }).click();
      await expect(page.getByText(/Cofnięto wpłatę za fakturę FV\/TEST\/0008\/2026/)).toBeVisible();
      await shot(`w06-after-undo-overdue-toast-${px}`);

      api.role = 'editor';
      await page.goto(path);
      const editorTrigger = page.getByRole('button', { name: 'Akcje transzy: Płatność końcowa (20%)' });
      await editorTrigger.scrollIntoViewIfNeeded();
      await editorTrigger.click();
      await expect(page.getByRole('menuitem', { name: /Przywróć transzę…/ })).toHaveAttribute('aria-disabled', 'true');
      await shot(`w06-menu-editor-cancelled-${px}`);
    });
  }
});
