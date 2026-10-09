import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const SITE_ID = '01968f3e-0000-7000-8000-00000000bbb1';
const OSD_ID = '01968f3e-0000-7000-8000-00000000ddd1';

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

const settledOrder = {
  id: '01968f3e-0000-7000-8000-00000000d017',
  number: 'ZL-2026-0017',
  title: 'Przyłącze — garaż',
  status: 'settled',
  closedAt: '2026-09-30T12:00:00.000Z',
};

test.describe('accessibility of editing a site and a party in the browser, with colour contrast (EVM-036 AC1–AC5, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-036 AC5 AC8 the card with the other orders, the dialog "Edytuj lokalizację", its view "Dodaj stronę", the conflict and "Odrzucić zmiany?" at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      api.orders.otherOrders = [settledOrder];
      await page.goto(path);
      await expect(page.getByRole('link', { name: 'ZL-2026-0017' })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('button', { name: 'Edytuj lokalizację' }).click();
      const dialog = page.getByRole('dialog', { name: 'Edytuj lokalizację' });
      await expect(dialog.getByRole('textbox', { name: 'PPE (opcjonalnie)' })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await dialog.getByRole('button', { name: 'Zmień OSD' }).click();
      await dialog.getByRole('button', { name: 'Dodaj stronę: OSD' }).click();
      await expect(page.getByRole('dialog', { name: 'Edytuj lokalizację › Dodaj stronę' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Wróć do lokalizacji' }).click();

      await dialog.getByRole('textbox', { name: 'PPE (opcjonalnie)' }).fill('PL-TEST-0002');
      api.orders.siteEdits.set(SITE_ID, { fields: { meteringPointId: 'PL-TEST-0009' }, version: 2 });
      await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
      await expect(dialog.getByText('Aktualnie: PL-TEST-0009')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await dialog.getByRole('button', { name: 'Anuluj' }).click();
      await expect(page.getByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-036 AC3 AC8 the menu of a party, the dialog "Edytuj stronę" with errors and the 404 state at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      await page.goto(path);
      await page.getByRole('button', { name: 'Akcje strony: Operator Testowy (OSD)' }).click();
      await expect(page.getByRole('menuitem', { name: 'Edytuj stronę…' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('menuitem', { name: 'Edytuj stronę…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Edytuj stronę' });
      await dialog.getByRole('textbox', { name: 'Nazwa' }).fill('');
      await dialog.getByRole('button', { name: 'Zapisz zmiany strony' }).click();
      await expect(dialog.getByText('Uzupełnij to pole.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('textbox', { name: 'Nazwa' }).fill('Operator Testowy');
      await dialog.getByRole('textbox', { name: 'Telefon (opcjonalnie)' }).fill('abc');
      await dialog.getByRole('button', { name: 'Zapisz zmiany strony' }).click();
      await expect(dialog.getByText('Podaj poprawny numer telefonu, np. +48 600 000 001.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.orders.goneParties.add(OSD_ID);
      await dialog.getByRole('textbox', { name: 'Telefon (opcjonalnie)' }).fill('600 000 009');
      await dialog.getByRole('button', { name: 'Zapisz zmiany strony' }).click();
      await expect(page.getByText('Nie znaleziono strony. Mogła zostać usunięta.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
