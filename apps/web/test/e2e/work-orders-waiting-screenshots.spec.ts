import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-034 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-034 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirWaitingList']);
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

test.describe('UX review screenshots (EVM-034) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-034 W-10 list with "Czekamy na" and "Termin", the filter, the view and the sorts at ${px} px`, async ({
      page,
      api,
      context,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      api.workOrders = 30;
      await page.goto('/work-orders');
      await expect(page.getByRole('table')).toBeVisible();
      await shot(`w10-waiting-list-${px}`);
      await page.getByRole('combobox', { name: 'Czekamy na' }).selectOption({ label: 'OSD' });
      await expect(page.getByRole('button', { name: 'Usuń filtr Czekamy na: OSD > 14 dni' })).toBeVisible();
      await shot(`w10-waiting-filter-${px}`);
      await page.getByRole('textbox', { name: 'Dłużej niż' }).fill('0');
      await expect(page.getByText('Podaj liczbę dni od 1 do 365.')).toBeVisible();
      await shot(`w10-waiting-days-error-${px}`);
      await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
      await page.getByRole('combobox', { name: 'Sortuj' }).selectOption({ label: 'Najdłużej czekamy' });
      await expect(page.getByRole('columnheader', { name: 'Czekamy na' })).toHaveAttribute('aria-sort', 'ascending');
      await shot(`w10-waiting-sort-longest-${px}`);
      await page.getByRole('combobox', { name: 'Sortuj' }).selectOption({ label: 'Termin' });
      await expect(page.getByRole('columnheader', { name: 'Termin' })).toHaveAttribute('aria-sort', 'ascending');
      await shot(`w10-waiting-sort-due-${px}`);
      await page.getByRole('button', { name: 'Czekamy na OSD > 14 dni' }).click();
      await expect(page).toHaveURL(/view=waiting_on_dso_over_14_days/);
      await shot(`w10-waiting-view-${px}`);
      await context.setOffline(true);
      await expect(page.getByText(/^Dane mogą być nieaktualne/)).toBeVisible();
      await shot(`w10-waiting-offline-${px}`);
      await context.setOffline(false);
    });

    test(`EVM-034 W-10 saved view with no results at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      api.workOrders = 6;
      api.waits = false;
      await page.goto('/work-orders?view=waiting_on_dso_over_14_days');
      await expect(page.getByRole('heading', { level: 2, name: 'Nie czekamy na OSD dłużej niż 14 dni. Dobra wiadomość.' })).toBeVisible();
      await shot(`w10-waiting-view-empty-${px}`);
    });

    test(`EVM-034 W-06 summary card: stages, waits, due dates and a failed tile at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'editor';
      await createOrder(page);
      await shot(`w06-summary-start-${px}`);
      await page.getByRole('button', { name: /^Status etapu Pełnomocnictwo od klienta: Do zrobienia\. Zmień status$/ }).click();
      await page.getByRole('menuitem', { name: 'Czekamy na…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
      await dialog.getByRole('radio', { name: 'Stronę' }).check();
      await dialog.getByRole('combobox', { name: 'Strona' }).fill('Operator');
      await page.getByRole('option', { name: /Operator Testowy/ }).click();
      await dialog.getByLabel('Od kiedy').fill('2026-09-18');
      await dialog.getByRole('button', { name: 'Zapisz' }).click();
      await page.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }).click();
      await page.getByRole('menuitem', { name: 'Zmień osobę odpowiedzialną i termin…' }).click();
      const edit = page.getByRole('dialog', { name: 'Zmień etap: Wniosek do OSD' });
      await edit.getByLabel('Termin').fill('2020-01-02');
      await edit.getByRole('button', { name: 'Zapisz zmiany' }).click();
      await expect(page.getByRole('region', { name: 'Terminy' }).getByText('Wniosek do OSD — 02.01.2020')).toBeVisible();
      await shot(`w06-summary-waits-${px}`);
      const path = new URL(page.url()).pathname;
      api.failNext.set(`GET /api/v1${path}/procedures`, { status: 500, code: 'internal_error' });
      await page.reload();
      await expect(page.getByText('Nie udało się wczytać tego kafla.')).toHaveCount(3);
      await shot(`w06-summary-error-${px}`);
    });
  }
});
