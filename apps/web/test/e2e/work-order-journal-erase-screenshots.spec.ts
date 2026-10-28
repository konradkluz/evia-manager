import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';
import { seedJournal } from './mock-journal.ts';

// Screenshots for the UX review of EVM-040 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-040 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirErase']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

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

test.describe('UX review screenshots (EVM-040) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-040 W-08 the menu of an entry, the deleted entry with the toast and the dialog of the redaction at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openJournal(page, (id) => {
        seedJournal(api.journal, id, 3, (n) => (n === 1 ? CANARY : `Wpis numer ${String(n)}`));
      });
      const entry = page.locator('li[data-entry-id]').filter({ hasText: CANARY });
      await entry.getByRole('button', { name: /^Akcje wpisu/ }).click();
      await shot(`w08-menu-administrator-${px}`);
      await page.getByRole('menuitem', { name: 'Usuń wpis' }).click();
      await expect(page.getByText('Usunięto wpis.')).toBeVisible();
      await shot(`w08-deleted-toast-${px}`);
      await entry.getByRole('button', { name: /^Akcje wpisu/ }).click();
      await shot(`w08-menu-deleted-${px}`);
      await page.getByRole('menuitem', { name: /^Zredaguj treść/ }).click();
      await expect(page.getByRole('alertdialog', { name: 'Zredagować treść wpisu?' })).toBeVisible();
      await shot(`w08-redact-dialog-${px}`);
    });

    test(`EVM-040 W-08 the menu of the Editor with the items disabled at ${px} px`, async ({ page, api, shot }) => {
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
      await shot(`w08-menu-editor-${px}`);
    });
  }
});
