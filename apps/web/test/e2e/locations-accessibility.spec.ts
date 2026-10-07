import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('accessibility of W-05 "2. Lokalizacja" in the browser, with colour contrast (EVM-021 AC1–AC4, AC7; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-021 AC1 AC7 the search of sites (short phrase, results, no results, chosen) has no axe violations at ${px} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders/new');
      const field = page.getByRole('combobox', { name: 'Lokalizacja' });
      await expect(field).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await field.fill('te');
      await expect(page.getByText('Wpisz co najmniej 3 znaki, aby wyszukać.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await field.fill('testowa');
      await expect(page.getByRole('option', { name: /ul\. Testowa 7/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await field.fill('Nigdzie');
      await expect(page.getByText('Brak wyników dla „Nigdzie”.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await field.fill('testowa');
      await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
      await expect(page.getByText(/miejsce 15/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-021 AC2 AC3 the form of a new site (garage, errors, parties) and the dialog "Dodaj stronę" have no axe violations at ${px} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders/new');
      await page.getByRole('radio', { name: 'Nowa lokalizacja' }).check();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Zapisz lokalizację' }).click();
      await expect(page.getByText('Uzupełnij to pole.').first()).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('combobox', { name: 'Typ obiektu' }).selectOption({ label: 'Garaż w budynku wielorodzinnym' });
      await expect(page.getByRole('textbox', { name: 'Poziom (opcjonalnie)' })).toBeVisible();
      await page.getByRole('combobox', { name: 'OSD (opcjonalnie)' }).fill('Testow');
      await page.getByRole('option', { name: /Operator Testowy/ }).click();
      await expect(page.getByText('Operator Testowy · OSD')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Dodaj stronę: zarządca / administracja' }).click();
      const dialog = page.getByRole('dialog', { name: 'Dodaj stronę' });
      await expect(dialog).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Dodaj stronę' }).click();
      await expect(dialog.getByText('Uzupełnij to pole.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('radio', { name: 'Osoba fizyczna' }).check();
      expect(await violations(page)).toEqual([]);
    });
  }
});
