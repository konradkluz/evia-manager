import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { seedJournal } from './mock-journal.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const CANARY = 'Numer dowodu ABC000000 wpisany omyłkowo';

async function openJournal(page: Page, seed: (id: string) => void): Promise<void> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  seed(new URL(page.url()).pathname.split('/').at(-1) ?? '');
  await page.reload();
  await page.getByRole('tab', { name: 'Dziennik' }).click();
  await expect(page.getByText(CANARY)).toBeVisible();
}

test.describe('accessibility of deleting and redacting an entry, with colour contrast (EVM-040; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-040 AC1 AC2 the open menu, the deleted entry with the toast and the dialog of the redaction at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openJournal(page, (id) => {
        seedJournal(api.journal, id, 3, (n) => (n === 1 ? CANARY : `Wpis numer ${String(n)}`));
      });
      const entry = page.locator('li[data-entry-id]').filter({ hasText: CANARY });
      await entry.getByRole('button', { name: /^Akcje wpisu/ }).click();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('menuitem', { name: 'Usuń wpis' }).click();
      await expect(page.getByText('Usunięto wpis.')).toBeVisible();
      await expect(entry.getByText('Usunięty')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await entry.getByRole('button', { name: /^Akcje wpisu/ }).click();
      await page.getByRole('menuitem', { name: /^Zredaguj treść/ }).click();
      await expect(page.getByRole('alertdialog', { name: 'Zredagować treść wpisu?' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-040 AC6 the menu of the Editor with the items disabled at ${px} px`, async ({ page, api }) => {
      api.role = 'editor';
      await page.setViewportSize({ width, height: 900 });
      await openJournal(page, (id) => {
        seedJournal(api.journal, id, 3, (n) => (n === 1 ? CANARY : `Wpis numer ${String(n)}`));
      });
      await page
        .locator('li[data-entry-id]')
        .filter({ hasText: CANARY })
        .getByRole('button', { name: /^Akcje wpisu/ })
        .click();
      expect(await violations(page)).toEqual([]);
    });
  }
});
