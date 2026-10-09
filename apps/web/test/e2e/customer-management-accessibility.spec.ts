import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const JAN_PATH = '/customers/01968f3e-0000-7000-8000-00000000aaa1';

async function createOrderFor(page: Page): Promise<void> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
}

test.describe('accessibility of W-14 "Klienci" in the browser, with colour contrast (EVM-039 AC1, AC2, AC3, AC6, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-039 AC1 AC8 the list, a search, no results, no customers, a 429 and the offline banner at ${px} px`, async ({
      page,
      api,
      context,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/customers');
      await expect(page.getByRole('table', { name: 'Klienci' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('searchbox', { name: 'Szukaj klientów' }).fill('Lodz');
      await expect(page.getByRole('link', { name: /Przykładowy Jan/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('searchbox', { name: 'Szukaj klientów' }).fill('Zzzz');
      await expect(page.getByRole('heading', { level: 2, name: 'Brak klientów spełniających kryteria.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.failNext.set('POST /api/v1/customers/search', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
      await page.getByRole('searchbox', { name: 'Szukaj klientów' }).fill('Przy');
      await expect(page.getByRole('alert').filter({ hasText: 'Zbyt wiele zapytań' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.goto('/customers');
      await expect(page.getByRole('table', { name: 'Klienci' })).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByText(/Dane mogą być nieaktualne/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await context.setOffline(false);
      api.customers.length = 0;
      await page.goto('/customers');
      await expect(page.getByRole('heading', { level: 2, name: 'Nie masz jeszcze klientów.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-039 AC2 AC3 AC6 the details with a history, the edit dialog, a conflict, the discard question and not found at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrderFor(page);
      await page.goto(JAN_PATH);
      await expect(page.getByRole('heading', { level: 2, name: 'Historia zleceń (1)' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
      await expect(page.getByRole('menuitem', { name: 'Edytuj dane klienta…' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('menuitem', { name: 'Edytuj dane klienta…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Edytuj dane klienta' });
      await expect(dialog).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('textbox', { name: 'Telefon' }).fill('600 000 008');
      const jan = api.customers[0];
      if (jan === undefined) throw new Error('the seed customer is missing');
      jan.phone = '+48600000009';
      jan.version = 2;
      await dialog.getByRole('button', { name: 'Zapisz dane klienta' }).click();
      await expect(dialog.getByText('Aktualnie: +48 600 000 009')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Anuluj' }).click();
      await expect(page.getByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Odrzuć zmiany' }).click();
      jan.deleted = true;
      await page.goto(JAN_PATH);
      await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono klienta.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
