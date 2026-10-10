import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-032 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-032 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirStages']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const STAGE = 'Warunki przyłączenia';

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

test.describe('UX review screenshots (EVM-032) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-032 W-06 W-07 the badge, the menu, the dialogs, the waiting for more than 14 days, the block, the toast and the states at ${px} px`, async ({
      page,
      api,
      shot,
      context,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      const badge = (status: string) => page.getByRole('button', { name: `Status etapu ${STAGE}: ${status}. Zmień status` });
      await expect(badge('Do zrobienia')).toBeVisible();
      await shot(`w06-stage-badges-${px}`);

      await badge('Do zrobienia').click();
      await shot(`w07-menu-todo-${px}`);
      await page.getByRole('menuitem', { name: 'Czekamy na…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
      await dialog.getByRole('radio', { name: 'Stronę' }).check();
      await dialog.getByRole('button', { name: 'Zapisz' }).click();
      await shot(`w07-dialog-waiting-error-${px}`);
      await dialog.getByRole('combobox', { name: 'Strona' }).fill('Operator');
      await expect(page.getByRole('option', { name: /Operator Testowy/ })).toBeVisible();
      await shot(`w07-dialog-waiting-search-${px}`);
      await page.getByRole('option', { name: /Operator Testowy/ }).click();
      await dialog.getByLabel('Od kiedy').fill('2026-09-18');
      await shot(`w07-dialog-waiting-${px}`);
      await dialog.getByRole('button', { name: 'Zapisz' }).click();
      await expect(page.getByText(/Czekamy na: Operator Testowy · od \d+ dni/)).toBeVisible();
      await shot(`w07-waiting-toast-${px}`);

      await badge('Czekamy na…').click();
      await shot(`w07-menu-waiting-${px}`);
      await page.getByRole('menuitem', { name: 'Zmień, na kogo czekamy…' }).click();
      await shot(`w07-dialog-change-waiting-${px}`);
      await page.getByRole('dialog').getByRole('button', { name: 'Anuluj' }).click();

      await badge('Czekamy na…').click();
      await page.getByRole('menuitem', { name: 'Zablokuj…' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Zablokuj etap' }).click();
      await shot(`w07-dialog-block-error-${px}`);
      await page.getByRole('dialog').getByLabel('Powód').fill('Brak zgody wspólnoty');
      await page.getByRole('dialog').getByRole('button', { name: 'Zablokuj etap' }).click();
      await expect(page.getByText('Powód blokady: Brak zgody wspólnoty')).toBeVisible();
      await shot(`w07-blocked-${px}`);

      await badge('Zablokowany').click();
      await page.getByRole('menuitem', { name: 'Odblokuj' }).click();
      await badge('W toku').click();
      await page.getByRole('menuitem', { name: 'Zakończ…' }).click();
      await shot(`w07-dialog-finish-${px}`);
      await page.getByRole('dialog').getByRole('button', { name: 'Zakończ etap' }).click();
      await expect(badge('Zakończony')).toBeVisible();
      await shot(`w07-done-${px}`);

      await context.setOffline(true);
      await expect(badge('Zakończony')).toHaveAttribute('aria-disabled', 'true');
      await shot(`w07-offline-${px}`);
      await context.setOffline(false);

      const id = path.split('/').at(-1) ?? '';
      api.orders.states.set(id, { status: 'settled', version: 9, closedAt: '2026-10-08T10:00:00.000Z' });
      await page.goto(path);
      await expect(badge('Zakończony')).toHaveAttribute('aria-disabled', 'true');
      await shot(`w07-closed-order-${px}`);

      api.role = 'read_only';
      await page.goto(path);
      await expect(page.getByRole('region', { name: 'Procesy i etapy (9)' })).toBeVisible();
      await shot(`w07-read-only-${px}`);
    });
  }
});
