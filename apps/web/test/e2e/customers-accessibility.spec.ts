import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('accessibility of W-05 "1. Klient" in the browser, with colour contrast (EVM-020 AC1, AC2, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-020 AC1 AC8 the form, the results, the empty result and a chosen customer have no axe violations at ${px} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders/new');
      const field = page.getByRole('combobox', { name: 'Klient' });
      await expect(field).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await field.fill('pr');
      await expect(page.getByText('Wpisz co najmniej 3 znaki, aby wyszukać.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await field.fill('Lodz');
      await expect(page.getByRole('option', { name: /Jan Przykładowy/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await field.fill('Kowalski');
      await expect(page.getByText('Brak wyników dla „Kowalski”.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await field.fill('przykl');
      await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await expect(page.getByText(/^Szkic w tej karcie/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-020 AC2 AC3 the dialog "Dodaj klienta" (person, company, address, errors, similar customer) has no axe violations at ${px} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders/new');
      await page.getByRole('combobox', { name: 'Klient' }).fill('Kowalski');
      await page.getByRole('button', { name: 'Dodaj klienta' }).click();
      const dialog = page.getByRole('dialog', { name: 'Dodaj klienta' });
      await expect(dialog).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('button', { name: /Adres korespondencyjny/ }).click();
      await dialog.getByRole('textbox', { name: 'Ulica' }).fill('ul. Testowa');
      await dialog.getByRole('button', { name: 'Dodaj klienta' }).click();
      await expect(dialog.getByText('Uzupełnij to pole.').first()).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('textbox', { name: 'Telefon' }).fill('+48 600 000 001');
      await expect(dialog.getByText('Podobny klient: Jan Przykładowy · +48 600 000 001')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('radio', { name: 'Firma' }).check();
      await expect(dialog.getByRole('textbox', { name: 'Nazwa firmy' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
