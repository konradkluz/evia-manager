import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { seedJournal } from './mock-journal.ts';

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
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

test.describe('accessibility of the journal in the browser, with colour contrast (EVM-037 AC1–AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-037 AC1 AC6 the empty journal, the field with a draft, the timeline with the days and the correction dialog at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const id = await createOrder(page);
      await page.getByRole('tab', { name: 'Dziennik' }).click();
      await expect(page.getByText('Brak wpisów. Dodaj pierwszą notatkę.')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('textbox', { name: 'Treść' }).fill('Szkic wpisu.');
      await expect(page.getByText(/Szkic w tej karcie/)).toBeVisible();
      expect(await violations(page)).toEqual([]);

      seedJournal(api.journal, id, 60, (n) =>
        n === 2 ? 'Link https://example.invalid/mapa i tel:+48600000001' : `Wpis numer ${String(n)}`,
      );
      await page.reload();
      await page.getByRole('tab', { name: 'Dziennik' }).click();
      await expect(page.locator('li[data-entry-id]')).toHaveCount(25);
      expect(await violations(page)).toEqual([]);

      await page
        .getByRole('button', { name: /^Akcje wpisu/ })
        .first()
        .click();
      await page.getByRole('menuitem', { name: 'Popraw wpis' }).click();
      await expect(page.getByRole('dialog', { name: 'Popraw wpis' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-037 AC8 a failed read, the field over the limit, Tylko odczyt and the offline state at ${px} px`, async ({
      page,
      api,
      context,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const id = await createOrder(page);
      seedJournal(api.journal, id, 3);
      api.failNext.set(`GET /api/v1/work-orders/${id}/timeline`, { status: 500, code: 'internal_error' });
      await page.getByRole('tab', { name: 'Dziennik' }).click();
      await expect(page.getByText('Nie udało się wczytać dziennika.')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
      await expect(page.locator('li[data-entry-id]')).toHaveCount(3);
      await page.getByRole('textbox', { name: 'Treść' }).fill('a'.repeat(10_001));
      await expect(page.getByText(/Treść może mieć najwyżej/)).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await context.setOffline(true);
      await expect(page.getByText('Dodasz wpis po powrocie połączenia.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await context.setOffline(false);

      api.role = 'read_only';
      await page.reload();
      await page.getByRole('tab', { name: 'Dziennik' }).click();
      await expect(page.locator('li[data-entry-id]')).toHaveCount(3);
      expect(await violations(page)).toEqual([]);
    });
  }
});
