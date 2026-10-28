import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const JAN_PATH = '/customers/01968f3e-0000-7000-8000-00000000aaa1';

const customerAt = <T>(list: readonly T[], index: number): T => {
  const found = list[index];
  if (found === undefined) throw new Error('no such customer');
  return found;
};

test.describe('accessibility of the erase states of W-14 in the browser, with colour contrast (EVM-041 AC1, AC3, AC4, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-041 AC3 AC4 the deleted view, the banner, the dialog of the anonymization and the anonymized customer at ${px} px`, async ({
      page,
      api,
    }) => {
      api.stepUp = 'fresh';
      customerAt(api.customers, 1).deleted = true;
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/customers');
      await page.getByRole('button', { name: 'Usunięci' }).click();
      await expect(page.getByText('Usunięty', { exact: true })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.goto(JAN_PATH);
      await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('menuitem', { name: 'Usuń klienta' }).click();
      await expect(page.getByText('Klient jest usunięty — widzi go tylko administrator.')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
      await page.getByRole('menuitem', { name: 'Anonimizuj klienta…' }).click();
      const dialog = page.getByRole('alertdialog');
      await dialog.getByRole('button', { name: 'Anonimizuj klienta' }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Anonimizuj klienta' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Klient zanonimizowany' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
