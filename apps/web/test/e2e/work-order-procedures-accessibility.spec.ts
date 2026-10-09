import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

async function createOrder(page: Page, template = true): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: template ? /Garaż — pełny proces/ : 'Puste zlecenie (bez szablonu)' }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe('accessibility of "Procesy i etapy" in the browser, with colour contrast (EVM-031 AC2, AC3, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-031 AC2 AC3 the nine processes (all open, one stage after the due date), the menu and the dialog at ${px} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrder(page);
      const section = page.getByRole('region', { name: 'Procesy i etapy (9)' });
      await section.getByRole('button', { name: 'Rozwiń wszystkie' }).click();
      await page.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }).click();
      await page.getByRole('menuitem', { name: 'Zmień osobę odpowiedzialną i termin…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Zmień etap: Wniosek do OSD' });
      await dialog.getByLabel('Osoba odpowiedzialna').selectOption({ label: 'Piotr Testowy' });
      await dialog.getByLabel('Termin').fill('2020-01-02');
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
      await expect(page.getByText('· po terminie')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-031 AC8 an order without processes, a failed read and the offline state at ${px} px`, async ({ page, api, context }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page, false);
      await expect(page.getByText('Zlecenie nie ma jeszcze procesów.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.failNext.set(`GET /api/v1${path}/procedures`, { status: 500, code: 'internal_error' });
      await page.goto(path);
      await expect(page.getByText('Nie udało się wczytać procesów i etapów.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.goto(path);
      await expect(page.getByText('Zlecenie nie ma jeszcze procesów.')).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByText(/Dane mogą być nieaktualne/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await context.setOffline(false);
    });
  }
});
