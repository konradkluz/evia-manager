import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';
import { seedEvents, seedJournal } from './mock-journal.ts';
import { stageId } from './mock-procedures.ts';

// Screenshots for the UX review of EVM-038 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-038 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirHistory']);
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
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

test.describe('UX review screenshots (EVM-038) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-038 W-08 Dziennik: the automatic entries among the notes and the filter "Zmiany statusów" at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const id = await createOrder(page);
      seedJournal(api.journal, id, 3);
      seedEvents(api.journal, id, stageId(id, 1, 2), {
        id: '01968f3e-0000-7000-8000-0000000c0001',
        name: 'Stoen Operator',
        kind: 'distribution_system_operator',
      });
      await page.reload();
      await page.getByRole('tab', { name: 'Dziennik' }).click();
      await expect(page.locator('li[data-entry-id]')).toHaveCount(8);
      await shot(`w08-events-all-${px}`);
      await page.getByRole('button', { name: 'Zmiany statusów' }).click();
      await expect(page.locator('li[data-entry-id]')).toHaveCount(5);
      await shot(`w08-events-filter-${px}`);
    });
  }
});
