import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-036 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-036 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirSites']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

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

test.describe('UX review screenshots (EVM-036) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-036 W-06 Lokalizacja and W-20 Edytuj lokalizację: card, dialog, Dodaj stronę, conflict, discard, offline at ${px} px`, async ({
      page,
      api,
      context,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      api.orders.otherOrders = [settledOrder];
      await page.goto(path);
      await expect(page.getByRole('link', { name: 'ZL-2026-0017' })).toBeVisible();
      await shot(`w06-site-card-${px}`);

      await page.getByRole('button', { name: 'Edytuj lokalizację' }).click();
      const dialog = page.getByRole('dialog', { name: 'Edytuj lokalizację' });
      await expect(dialog.getByRole('textbox', { name: 'PPE (opcjonalnie)' })).toBeVisible();
      await shot(`w20-edit-site-${px}`);

      await dialog.getByRole('button', { name: 'Zmień OSD' }).click();
      await dialog.getByRole('button', { name: 'Dodaj stronę: OSD' }).click();
      await expect(page.getByRole('dialog', { name: 'Edytuj lokalizację › Dodaj stronę' })).toBeVisible();
      await shot(`w20-add-party-view-${px}`);
      await page.getByRole('button', { name: 'Wróć do lokalizacji' }).click();

      await dialog.getByRole('textbox', { name: 'PPE (opcjonalnie)' }).fill('PL-TEST-0002');
      api.orders.siteEdits.set(SITE_ID, { fields: { meteringPointId: 'PL-TEST-0009' }, version: 2 });
      await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
      await expect(dialog.getByText('Aktualnie: PL-TEST-0009')).toBeVisible();
      await shot(`w20-conflict-${px}`);

      await dialog.getByRole('button', { name: 'Anuluj' }).click();
      await expect(page.getByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeVisible();
      await shot(`w20-discard-${px}`);
      await page.getByRole('button', { name: 'Odrzuć zmiany' }).click();

      await context.setOffline(true);
      await expect(page.getByRole('button', { name: 'Edytuj lokalizację' })).toHaveAttribute('aria-disabled', 'true');
      await shot(`w06-site-card-offline-${px}`);
      await context.setOffline(false);
    });

    test(`EVM-036 W-20 Edytuj stronę: menu, dialog, errors and 429 at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      await page.goto(path);
      await page.getByRole('button', { name: 'Akcje strony: Operator Testowy (OSD)' }).click();
      await expect(page.getByRole('menuitem', { name: 'Edytuj stronę…' })).toBeVisible();
      await shot(`w06-party-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Edytuj stronę…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Edytuj stronę' });
      await expect(dialog.getByRole('textbox', { name: 'Nazwa' })).toBeVisible();
      await shot(`w20-edit-party-${px}`);
      await dialog.getByRole('textbox', { name: 'Nazwa' }).fill('');
      await dialog.getByRole('button', { name: 'Zapisz zmiany strony' }).click();
      await expect(dialog.getByText('Uzupełnij to pole.')).toBeVisible();
      await shot(`w20-edit-party-errors-${px}`);
      await dialog.getByRole('textbox', { name: 'Nazwa' }).fill('Operator Nowy');
      api.failNext.set(`PATCH /api/v1/parties/${OSD_ID}`, { status: 429, code: 'rate_limited', headers: { 'Retry-After': '30' } });
      await dialog.getByRole('button', { name: 'Zapisz zmiany strony' }).click();
      await expect(dialog.getByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeVisible();
      await shot(`w20-edit-party-429-${px}`);
    });
  }
});
