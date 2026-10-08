import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-030 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-030 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirStatus']);
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
  return new URL(page.url()).pathname;
}

const badge = (page: Page, status: string) => page.getByRole('button', { name: `Status zlecenia: ${status}. Zmień status` });

test.describe('UX review screenshots (EVM-030) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-030 W-06 status: menu, dialogs, toast, conflict, closed order for each role and offline at ${px} px`, async ({
      page,
      api,
      context,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      await page.goto(path);
      await expect(badge(page, 'Nowe')).toBeVisible();

      await badge(page, 'Nowe').click();
      await expect(page.getByRole('menu')).toBeVisible();
      await shot(`w06-status-menu-new-${px}`);

      await page.getByRole('menuitem', { name: 'Zaakceptuj bez wyceny' }).click();
      await expect(page.getByText('Zaakceptowano zlecenie.')).toBeVisible();
      await shot(`w06-status-toast-${px}`);

      await badge(page, 'Zaakceptowane').click();
      await page.getByRole('menuitem', { name: 'Rozpocznij realizację' }).click();
      await expect(badge(page, 'W realizacji')).toBeVisible();

      await badge(page, 'W realizacji').click();
      await page.getByRole('menuitem', { name: 'Wstrzymaj…' }).click();
      const hold = page.getByRole('dialog', { name: 'Wstrzymaj zlecenie ZL-2026-0042' });
      await hold.getByRole('button', { name: 'Wstrzymaj zlecenie' }).click();
      await expect(hold.getByText('Wpisz powód.')).toBeVisible();
      await shot(`w06-status-hold-dialog-error-${px}`);

      api.failNext.set(`POST /api/v1${path}/transitions`, { status: 412, code: 'version_conflict' });
      await hold.getByLabel('Powód wstrzymania').fill('Czekamy na decyzję klienta');
      await hold.getByRole('button', { name: 'Wstrzymaj zlecenie' }).click();
      await expect(hold.getByRole('alert')).toBeVisible();
      await shot(`w06-status-hold-dialog-conflict-${px}`);
      await hold.getByRole('button', { name: 'Anuluj' }).click();

      await badge(page, 'W realizacji').click();
      await page.getByRole('menuitem', { name: 'Zakończ' }).click();
      await shot(`w06-status-complete-dialog-${px}`);
      await page.getByRole('dialog').getByRole('button', { name: 'Zakończ zlecenie' }).click();
      await expect(badge(page, 'Zakończone')).toBeVisible();

      await badge(page, 'Zakończone').click();
      await page.getByRole('menuitem', { name: 'Rozlicz…' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await shot(`w06-status-settle-dialog-${px}`);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Rozlicz zlecenie' }).click();
      await expect(page.getByRole('region', { name: 'Stan zlecenia' })).toBeVisible();
      await shot(`w06-status-closed-administrator-${px}`);

      await badge(page, 'Rozliczone').click();
      await shot(`w06-status-menu-restore-${px}`);
      await page.keyboard.press('Escape');

      api.role = 'editor';
      await page.goto(path);
      await badge(page, 'Rozliczone').click();
      await expect(page.getByRole('menuitem', { name: /Przywróć zlecenie…/ })).toBeFocused();
      await shot(`w06-status-menu-restore-editor-${px}`);
      await page.keyboard.press('Escape');
      await shot(`w06-status-closed-editor-${px}`);

      api.role = 'read_only';
      await page.goto(path);
      await expect(page.getByRole('region', { name: 'Stan zlecenia' })).toBeVisible();
      await shot(`w06-status-closed-read-only-${px}`);

      api.role = 'administrator';
      await page.goto(path);
      await expect(badge(page, 'Rozliczone')).toBeVisible();
      await context.setOffline(true);
      await expect(badge(page, 'Rozliczone')).toHaveAttribute('aria-disabled', 'true');
      await shot(`w06-status-offline-${px}`);
      await context.setOffline(false);
    });
  }
});
