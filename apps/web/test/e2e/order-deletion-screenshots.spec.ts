import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-060 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-060 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirDeletion']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

async function createOrder(page: Page): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — montaż ładowarki/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe('UX review screenshots (EVM-060) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-060 W-06 the menu, the confirmation, and W-10 "Usunięte" at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      await page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }).click();
      await shot(`w06-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Usuń zlecenie…' }).click();
      await shot(`w06-confirm-${px}`);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Usuń zlecenie' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
      await page.getByRole('button', { name: 'Usunięte' }).click();
      await expect(page.getByRole('table', { name: 'Usunięte zlecenia' })).toBeVisible();
      await shot(`w10-deleted-${px}`);
      await page.getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0042' }).click();
      await expect(page.getByText('Brak usuniętych zleceń.')).toBeVisible();
      await shot(`w10-deleted-empty-${px}`);
      // the Editor: the item is disabled with the reason
      api.role = 'editor';
      await page.goto(path);
      await page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }).click();
      await shot(`w06-editor-${px}`);
    });
  }
});
