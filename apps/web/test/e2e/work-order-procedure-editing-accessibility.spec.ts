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

test.describe('accessibility of adding and removing processes and stages, with colour contrast (EVM-042; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-042 AC1 AC2 AC3 the section, the menus, the dialogs and the deleted ones at ${px} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrder(page);
      const section = page.getByRole('region', { name: /^Procesy i etapy/ });
      expect(await violations(page)).toEqual([]);

      await section.getByRole('button', { name: 'Akcje procesu: Opinia ppoż' }).click();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('menuitem', { name: 'Usuń proces…' }).click();
      const removeProcess = page.getByRole('alertdialog', { name: 'Usunąć proces „Opinia ppoż”?' });
      await expect(removeProcess).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await removeProcess.getByRole('button', { name: 'Usuń proces' }).click();
      await expect(page.getByText('Usunięto proces „Opinia ppoż”.')).toBeVisible();

      await section.getByRole('button', { name: 'Usunięte procesy i etapy (1)' }).click();
      expect(await violations(page)).toEqual([]);

      await section.getByRole('button', { name: 'Dodaj proces…' }).click();
      const addProcess = page.getByRole('dialog', { name: 'Dodaj proces' });
      await expect(addProcess.getByRole('option', { name: 'Uzgodnienia z OSD — już jest w zleceniu' })).toBeDisabled();
      expect(await violations(page)).toEqual([]);
      await addProcess.getByRole('button', { name: 'Anuluj' }).click();

      await section.getByRole('button', { name: 'Akcje procesu: Uzgodnienia z OSD' }).click();
      await page.getByRole('menuitem', { name: 'Dodaj etap…' }).click();
      const addStage = page.getByRole('dialog', { name: 'Dodaj etap' });
      await addStage.getByRole('button', { name: 'Dodaj etap' }).click();
      await expect(addStage.getByText('Podaj nazwę etapu.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await addStage.getByRole('button', { name: 'Anuluj' }).click();

      await section.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }).click();
      await page.getByRole('menuitem', { name: 'Usuń etap…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Usunąć etap „Wniosek do OSD”?' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
