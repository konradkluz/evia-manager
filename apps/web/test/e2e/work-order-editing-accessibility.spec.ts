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
  await page.getByRole('radio', { name: /Garaż — montaż ładowarki/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe('accessibility of the editing of the data and of the scope in the browser, with colour contrast (EVM-035; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-035 AC1 the menu of the order and the dialog "Edytuj dane zlecenia", with a conflict, at ${px} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }).click();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('menuitem', { name: 'Edytuj dane zlecenia…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Edytuj dane zlecenia' });
      await dialog.getByLabel('Opis (opcjonalnie)').fill('Trasa kabla przez szacht B.');
      expect(await violations(page)).toEqual([]);
      // a conflict: another tab changes the planned date; the alert and "Aktualnie: …" are checked too
      await page.evaluate(async (target) => {
        await fetch(`/api/v1${target}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'If-Match': '"1"', 'X-CSRF-Token': 'csrf-active' },
          body: JSON.stringify({ plannedDate: '2026-11-15' }),
        });
      }, path);
      await dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(dialog.getByText('Aktualnie: 15.11.2026')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-035 AC2 AC3 AC4 the mode of editing, the dialogs of adding and of parameters and the confirmation at ${px} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrder(page);
      await page.getByRole('button', { name: 'Edytuj zakres' }).click();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('button', { name: 'Dodaj pozycję…' }).click();
      const add = page.getByRole('dialog', { name: 'Dodaj pozycję zakresu' });
      await add.getByLabel('Pozycja z katalogu').selectOption({ label: 'Instalacja zasilająca' });
      await add.getByRole('group', { name: 'Obwód dedykowany' }).getByRole('radio', { name: 'Tak' }).check();
      expect(await violations(page)).toEqual([]);
      await add.getByLabel('Długość kabla (opcjonalnie)').fill('0');
      await add.getByRole('button', { name: 'Dodaj pozycję' }).click();
      await expect(add.getByText(/Wartość spoza zakresu/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await add.getByLabel('Pozycja z katalogu').selectOption({ label: 'Inna usługa (opis w zleceniu)' });
      expect(await violations(page)).toEqual([]);
      await add.getByRole('button', { name: 'Anuluj' }).click();
      await page.getByRole('button', { name: 'Odrzuć zmiany' }).click();

      await page.getByRole('button', { name: 'Akcje pozycji: Pozycja 1' }).click();
      await page.getByRole('menuitem', { name: 'Edytuj parametry…' }).click();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Anuluj' }).click();

      await page.getByRole('button', { name: 'Akcje pozycji: Pozycja 2' }).click();
      await page.getByRole('menuitem', { name: 'Usuń pozycję…' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-035 AC6 a closed order and the offline state at ${px} px`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrder(page);
      await page.getByRole('button', { name: /^Status zlecenia: .*Zmień status$/ }).click();
      await page.getByRole('menuitem', { name: 'Anuluj zlecenie…' }).click();
      const cancel = page.getByRole('dialog', { name: 'Anuluj zlecenie ZL-2026-0042' });
      await cancel.getByLabel('Powód anulowania').fill('Rezygnacja klienta');
      await cancel.getByRole('button', { name: 'Anuluj zlecenie' }).click();
      await expect(page.getByRole('button', { name: 'Edytuj zakres' })).toHaveAttribute('aria-disabled', 'true');
      expect(await violations(page)).toEqual([]);
      await context.setOffline(true);
      await expect(page.getByText(/Dane mogą być nieaktualne/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await context.setOffline(false);
    });
  }
});
