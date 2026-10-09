import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const STAGE = 'Warunki przyłączenia';

async function createOrder(page: Page): Promise<void> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
}

test.describe('accessibility of the status of a stage in the browser, with colour contrast (EVM-032 AC1–AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-032 AC1 AC2 AC3 the badge, the menu, the dialogs, the waiting for more than 14 days and a block at ${px} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrder(page);
      const badge = (status: string) => page.getByRole('button', { name: `Status etapu ${STAGE}: ${status}. Zmień status` });
      expect(await violations(page)).toEqual([]);
      await badge('Do zrobienia').click();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('menuitem', { name: 'Czekamy na…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
      await dialog.getByRole('radio', { name: 'Stronę' }).check();
      await dialog.getByRole('button', { name: 'Zapisz' }).click();
      await expect(dialog.getByText('Wybierz stronę, na którą czekamy.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('combobox', { name: 'Strona' }).fill('Operator');
      await page.getByRole('option', { name: /Operator Testowy/ }).click();
      await dialog.getByLabel('Od kiedy').fill('2026-09-18');
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Zapisz' }).click();
      await expect(page.getByText(/Czekamy na: Operator Testowy · od \d+ dni/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await badge('Czekamy na…').click();
      await page.getByRole('menuitem', { name: 'Zmień, na kogo czekamy…' }).click();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('dialog').getByRole('button', { name: 'Anuluj' }).click();
      await badge('Czekamy na…').click();
      await page.getByRole('menuitem', { name: 'Zablokuj…' }).click();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('dialog').getByLabel('Powód').fill('Brak zgody wspólnoty');
      await page.getByRole('dialog').getByRole('button', { name: 'Zablokuj etap' }).click();
      await expect(page.getByText('Powód blokady: Brak zgody wspólnoty')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
