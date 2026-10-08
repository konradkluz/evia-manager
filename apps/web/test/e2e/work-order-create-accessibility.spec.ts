import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('accessibility of W-05 "3. Szablon", "4. Zlecenie" and W-06 in the browser, with colour contrast (EVM-022 AC1, AC3, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-022 AC1 AC3 the form: empty, with the summary of errors, with a template chosen, and the header W-06 at ${px} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/work-orders/new');
      await expect(page.getByRole('radio', { name: 'Puste zlecenie (bez szablonu)' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
      await expect(page.getByText('Popraw zaznaczone pola, aby utworzyć zlecenie.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
      await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
      await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
      await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
      if (width < 1280) await page.getByRole('button', { name: 'Pokaż szczegóły szablonu' }).click();
      await expect(page.getByRole('heading', { name: 'Zakres (9 pozycji)' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
