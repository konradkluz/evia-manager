import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

async function createAndDelete(page: Page): Promise<void> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — montaż ładowarki/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  await page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }).click();
  expect(await violations(page)).toEqual([]);
  await page.getByRole('menuitem', { name: 'Usuń zlecenie…' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Usunąć zlecenie ZL-2026-0042?' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
}

test.describe('accessibility of deleting and restoring an order in the browser, with colour contrast (EVM-060; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-060 AC1 the menu, the confirmation and the view "Usunięte" with "Przywróć" at ${px} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await createAndDelete(page);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Usuń zlecenie' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
      await page.getByRole('button', { name: 'Usunięte' }).click();
      await expect(page.getByRole('table', { name: 'Usunięte zlecenia' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
