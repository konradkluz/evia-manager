import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

async function createOrder(page: Page, template: RegExp | string = /Garaż — pełny proces/): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: template }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe('accessibility of "Płatności" in the browser, with colour contrast (EVM-053 AC2–AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-053 AC2 AC3 AC4 the instalments, the menu and both dialogs with their errors at ${px} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrder(page);
      const section = page.getByRole('region', { name: 'Płatności', exact: true });
      await expect(section.getByRole('table', { name: 'Transze płatności zlecenia' })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
      await expect(page.getByRole('menuitem', { name: 'Zmień kwotę…' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('menuitem', { name: 'Zmień kwotę…' }).click();
      const amount = page.getByRole('dialog', { name: 'Zmień kwotę transzy' });
      await amount.getByRole('textbox', { name: 'Kwota' }).fill('12,345');
      await amount.getByRole('button', { name: 'Zapisz kwotę' }).click();
      await expect(amount.getByText('Kwota może mieć najwyżej 2 miejsca po przecinku.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await amount.getByRole('textbox', { name: 'Kwota' }).fill('3600');
      await amount.getByRole('button', { name: 'Zapisz kwotę' }).click();
      await expect(page.getByText('Zmieniono kwotę transzy „Zaliczka”: 3 600,00 zł.')).toBeVisible();

      await section.getByRole('button', { name: 'Dodaj transzę' }).click();
      const add = page.getByRole('dialog', { name: 'Dodaj transzę' });
      await add.getByRole('button', { name: 'Dodaj transzę' }).click();
      await expect(add.getByText('Podaj nazwę transzy.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-053 AC8 AC5 no instalments, a settled order and the offline state at ${px} px`, async ({ page, api, context }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page, 'Puste zlecenie (bez szablonu)');
      await expect(page.getByRole('region', { name: 'Płatności', exact: true }).getByText('Brak transz.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.orders.states.set(path.split('/').at(-1) ?? '', { status: 'settled', version: 9 });
      await page.reload();
      await expect(
        page.getByRole('region', { name: 'Płatności', exact: true }).getByRole('button', { name: 'Dodaj transzę' }),
      ).toHaveAttribute('aria-disabled', 'true');
      expect(await violations(page)).toEqual([]);
      await context.setOffline(true);
      await expect(page.getByText(/Dane mogą być nieaktualne/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await context.setOffline(false);
    });
  }
});
