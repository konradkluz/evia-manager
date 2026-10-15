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

const rowOf = (page: Page, name: string) =>
  page.getByRole('region', { name: 'Płatności', exact: true }).getByRole('row', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) });

test.describe('accessibility of the actions of the instalments, with colour contrast (EVM-054 AC1–AC5, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-054 AC1 AC2 AC3 AC4 AC5 the buttons of the rows, the menus and the dialogs with their errors at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      await rowOf(page, 'Zaliczka (20%)').getByRole('button', { name: 'Wystaw fakturę…' }).click();
      const invoice = page.getByRole('dialog', { name: 'Wystawić fakturę dla transzy „Zaliczka”?' });
      await invoice.getByRole('button', { name: 'Wystaw fakturę' }).click();
      await expect(invoice.getByText('Popraw zaznaczone pola, aby wystawić fakturę.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await invoice.getByRole('textbox', { name: 'Kwota' }).fill('1230');
      await invoice.getByRole('textbox', { name: 'Nr faktury lub proformy' }).fill('FV/TEST/0021/2026');
      await invoice.getByRole('button', { name: 'Wystaw fakturę' }).click();
      await expect(page.getByText(/Wystawiono fakturę FV\/TEST\/0021\/2026/)).toBeVisible();

      await rowOf(page, 'Zaliczka (20%)').getByRole('button', { name: 'Odnotuj wpłatę…' }).click();
      const payment = page.getByRole('alertdialog');
      await payment.getByLabel('Data wpłaty').fill('2099-01-01');
      await payment.getByRole('button', { name: 'Odnotuj wpłatę' }).click();
      await expect(payment.getByText('Data wpłaty nie może być późniejsza niż dziś.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await payment.getByRole('button', { name: 'Anuluj' }).click();

      await page.getByRole('button', { name: 'Akcje transzy: Po uzyskaniu zgód (30%)' }).click();
      await page.getByRole('menuitem', { name: 'Anuluj transzę…' }).click();
      const cancel = page.getByRole('dialog', { name: 'Anulować transzę „Po uzyskaniu zgód”?' });
      await cancel.getByRole('button', { name: 'Anuluj transzę' }).click();
      await expect(cancel.getByText('Podaj powód anulowania.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await cancel.getByRole('button', { name: 'Anuluj', exact: true }).click();

      await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
      await page.getByRole('menuitem', { name: 'Popraw dane faktury…' }).click();
      await expect(page.getByRole('dialog', { name: 'Popraw dane faktury' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('dialog').getByRole('button', { name: 'Anuluj' }).click();

      api.role = 'editor';
      await page.goto(path);
      await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
      await expect(page.getByRole('menuitem', { name: /Wycofaj fakturę…/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
