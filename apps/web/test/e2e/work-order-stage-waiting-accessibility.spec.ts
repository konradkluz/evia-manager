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

test.describe('accessibility of the suggestions and "Dodaj stronę" in the browser, with colour contrast (EVM-033 AC1–AC4, AC6; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-033 AC1 AC2 AC3 the window with the suggestions, the form of a party and the way back at ${px} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrder(page);
      await page.getByRole('button', { name: 'Status etapu Wniosek do OSD: Do zrobienia. Zmień status' }).click();
      await page.getByRole('menuitem', { name: 'Czekamy na…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
      await expect(dialog.getByRole('group', { name: 'Podpowiedzi z lokalizacji' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Zmień stronę' }).click();
      await expect(dialog.getByRole('combobox', { name: 'Strona' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Dodaj stronę: Strona' }).click();
      const adding = page.getByRole('dialog', { name: 'Na kogo czekamy? › Dodaj stronę' });
      await expect(adding).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await adding.getByRole('button', { name: 'Dodaj stronę' }).click();
      await expect(adding.getByText('Uzupełnij to pole.').first()).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await adding.getByRole('textbox', { name: 'Nazwa' }).fill('Rzeczoznawca Testowy');
      await adding.getByRole('button', { name: 'Dodaj stronę' }).click();
      await expect(page.getByRole('dialog', { name: 'Na kogo czekamy?' }).getByText(/Dodano stronę/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
