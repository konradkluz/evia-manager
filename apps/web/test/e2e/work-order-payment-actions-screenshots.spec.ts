import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-054 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-054 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirPaymentActions']);
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

const rowOf = (page: Page, name: string) =>
  page.getByRole('region', { name: 'Płatności', exact: true }).getByRole('row', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) });

test.describe('UX review screenshots (EVM-054) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-054 W-06 Płatności: the actions, the dialogs, their errors, the corrections of the Editor and AC6 at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      const orderId = path.split('/').at(-1) ?? '';
      const section = page.getByRole('region', { name: 'Płatności', exact: true });
      await section.scrollIntoViewIfNeeded();
      await shot(`w06-actions-planned-${px}`);

      await rowOf(page, 'Zaliczka (20%)').getByRole('button', { name: 'Wystaw fakturę…' }).click();
      const invoice = page.getByRole('dialog', { name: 'Wystawić fakturę dla transzy „Zaliczka”?' });
      await shot(`w06-invoice-dialog-empty-${px}`);
      await invoice.getByRole('button', { name: 'Wystaw fakturę' }).click();
      await shot(`w06-invoice-dialog-errors-${px}`);
      await invoice.getByRole('textbox', { name: 'Kwota' }).fill('1230');
      await invoice.getByRole('textbox', { name: 'Nr faktury lub proformy' }).fill('FV/TEST/0021/2026');
      await invoice.getByLabel('Data wystawienia').fill('2026-10-03');
      await shot(`w06-invoice-dialog-filled-${px}`);
      api.failNext.set(`POST /api/v1${path}/payment-milestones/${orderId.slice(0, -6)}e00000/transitions`, {
        status: 412,
        code: 'version_conflict',
      });
      await invoice.getByRole('button', { name: 'Wystaw fakturę' }).click();
      await expect(invoice.getByText(/Tę transzę zmieniono w międzyczasie/)).toBeVisible();
      await shot(`w06-invoice-dialog-conflict-${px}`);
      await invoice.getByRole('button', { name: 'Odśwież' }).click();
      await invoice.getByRole('button', { name: 'Wystaw fakturę' }).click();
      await expect(page.getByText(/Wystawiono fakturę FV\/TEST\/0021\/2026/)).toBeVisible();
      await shot(`w06-invoiced-toast-${px}`);

      await rowOf(page, 'Zaliczka (20%)').getByRole('button', { name: 'Odnotuj wpłatę…' }).click();
      const payment = page.getByRole('alertdialog', { name: 'Odnotować wpłatę za transzę „Zaliczka”?' });
      await shot(`w06-payment-dialog-${px}`);
      await payment.getByLabel('Data wpłaty').fill('2099-01-01');
      await payment.getByRole('button', { name: 'Odnotuj wpłatę' }).click();
      await expect(payment.getByText('Data wpłaty nie może być późniejsza niż dziś.')).toBeVisible();
      await shot(`w06-payment-dialog-future-${px}`);
      await payment.getByRole('button', { name: 'Anuluj' }).click();

      await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
      await shot(`w06-menu-invoiced-admin-${px}`);
      await page.getByRole('menuitem', { name: 'Popraw dane faktury…' }).click();
      await shot(`w06-details-dialog-${px}`);
      await page.getByRole('dialog', { name: 'Popraw dane faktury' }).getByRole('button', { name: 'Anuluj' }).click();

      await page.getByRole('button', { name: 'Akcje transzy: Płatność końcowa (20%)' }).click();
      await shot(`w06-menu-planned-admin-${px}`);
      await page.getByRole('menuitem', { name: 'Anuluj transzę…' }).click();
      const cancel = page.getByRole('dialog', { name: 'Anulować transzę „Płatność końcowa”?' });
      await cancel.getByRole('button', { name: 'Anuluj transzę' }).click();
      await shot(`w06-cancel-dialog-error-${px}`);
      await cancel.getByRole('textbox', { name: 'Powód anulowania' }).fill('Klient zrezygnował z tej transzy');
      await cancel.getByRole('button', { name: 'Anuluj transzę' }).click();
      await expect(page.getByText('Anulowano transzę „Płatność końcowa”.')).toBeVisible();

      api.role = 'editor';
      await page.reload();
      await section.scrollIntoViewIfNeeded();
      await shot(`w06-actions-mixed-editor-${px}`);
      await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
      await shot(`w06-menu-invoiced-editor-${px}`);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Akcje transzy: Po uzyskaniu zgód (30%)' }).click();
      await shot(`w06-menu-planned-editor-${px}`);
      await page.keyboard.press('Escape');

      api.orders.states.set(orderId, { status: 'on_hold', version: 7 });
      await page.reload();
      await page.getByRole('button', { name: 'Status zlecenia: Wstrzymane. Zmień status' }).click();
      await page.getByRole('menuitem', { name: 'Anuluj zlecenie…' }).click();
      const order = page.getByRole('dialog', { name: 'Anuluj zlecenie ZL-2026-0042' });
      await order.getByRole('textbox', { name: 'Powód anulowania' }).fill('Klient zrezygnował');
      await order.getByRole('button', { name: 'Anuluj zlecenie' }).click();
      await expect(order.getByRole('alert')).toBeVisible();
      await shot(`w06-cancel-order-invoiced-${px}`);
    });

    test(`EVM-054 W-06 Płatności: paid and the correction of the day of the payment, Tylko odczyt at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      await rowOf(page, 'Zaliczka (20%)').getByRole('button', { name: 'Wystaw fakturę…' }).click();
      const invoice = page.getByRole('dialog');
      await invoice.getByRole('textbox', { name: 'Kwota' }).fill('1230');
      await invoice.getByRole('textbox', { name: 'Nr faktury lub proformy' }).fill('FV/TEST/0021/2026');
      await invoice.getByLabel('Data wystawienia').fill('2026-09-01');
      await invoice.getByRole('button', { name: 'Wystaw fakturę' }).click();
      await expect(page.getByText(/Wystawiono fakturę/)).toBeVisible();
      await page.reload();
      await page.getByRole('region', { name: 'Płatności', exact: true }).scrollIntoViewIfNeeded();
      await shot(`w06-overdue-${px}`);
      await rowOf(page, 'Zaliczka (20%)').getByRole('button', { name: 'Odnotuj wpłatę…' }).click();
      await shot(`w06-payment-dialog-overdue-${px}`);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Odnotuj wpłatę' }).click();
      await expect(page.getByText(/Odnotowano wpłatę/)).toBeVisible();
      await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
      await page.getByRole('menuitem', { name: 'Popraw datę wpłaty…' }).click();
      await shot(`w06-paid-on-dialog-${px}`);
      await page.getByRole('dialog').getByRole('button', { name: 'Anuluj' }).click();
      api.role = 'read_only';
      await page.goto(path);
      await page.getByRole('region', { name: 'Płatności', exact: true }).scrollIntoViewIfNeeded();
      await shot(`w06-read-only-${px}`);
    });
  }
});
