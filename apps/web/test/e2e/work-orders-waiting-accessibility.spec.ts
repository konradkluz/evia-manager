import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

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

test.describe('accessibility of "Czekamy na…" in the browser, with colour contrast (EVM-034 AC1–AC5, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-034 AC1 AC2 AC3 AC4 the list with the waits, the filter, the view and the sorts has no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      api.workOrders = 30;
      await page.goto('/work-orders');
      await expect(page.getByRole('table')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('combobox', { name: 'Czekamy na' }).selectOption({ label: 'OSD' });
      await expect(page.getByRole('button', { name: 'Usuń filtr Czekamy na: OSD > 14 dni' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('textbox', { name: 'Dłużej niż' }).fill('0');
      await expect(page.getByText('Podaj liczbę dni od 1 do 365.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('textbox', { name: 'Dłużej niż' }).fill('14');
      await page.getByRole('combobox', { name: 'Sortuj' }).selectOption({ label: 'Termin' });
      // the column "Termin" starts at `expanded` (1024 px); below it the sort is seen in the control (styleguide § 3.6, width budget)
      if (width >= 1024) await expect(page.getByRole('columnheader', { name: 'Termin' })).toHaveAttribute('aria-sort', 'ascending');
      else await expect(page.getByRole('combobox', { name: 'Sortuj' })).toHaveValue('nextDueDate');
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Czekamy na OSD > 14 dni' }).click();
      await expect(page).toHaveURL(/view=waiting_on_dso_over_14_days/);
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-034 AC3 the good news of the empty view has no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      api.workOrders = 6;
      api.waits = false;
      await page.goto('/work-orders?view=waiting_on_dso_over_14_days');
      await expect(page.getByRole('heading', { level: 2, name: 'Nie czekamy na OSD dłużej niż 14 dni. Dobra wiadomość.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-034 AC5 AC8 the summary of the order, its waits and its failed tiles have no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'editor';
      await createOrder(page);
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: /^Status etapu Pełnomocnictwo od klienta: Do zrobienia\. Zmień status$/ }).click();
      await page.getByRole('menuitem', { name: 'Czekamy na…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
      await dialog.getByRole('radio', { name: 'Stronę' }).check();
      await dialog.getByRole('combobox', { name: 'Strona' }).fill('Operator');
      await page.getByRole('option', { name: /Operator Testowy/ }).click();
      await dialog.getByLabel('Od kiedy').fill('2026-09-18');
      await dialog.getByRole('button', { name: 'Zapisz' }).click();
      const waits = page.getByRole('region', { name: /^Podsumowanie/ }).getByRole('region', { name: 'Na kogo czekamy' });
      await expect(waits.getByText(/Czekamy na: Operator Testowy · od \d+ dni/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
      const path = new URL(page.url()).pathname;
      api.failNext.set(`GET /api/v1${path}/procedures`, { status: 500, code: 'internal_error' });
      await page.reload();
      await expect(page.getByText('Nie udało się wczytać tego kafla.')).toHaveCount(3);
      expect(await violations(page)).toEqual([]);
    });
  }
});
