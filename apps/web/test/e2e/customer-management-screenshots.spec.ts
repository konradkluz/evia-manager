import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-039 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-039 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirClients']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

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

test.describe('UX review screenshots (EVM-039) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-039 W-14 list: loaded, search, no results, no customers, 429 and offline at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/customers');
      await expect(page.getByRole('table', { name: 'Klienci' })).toBeVisible();
      await shot(`w14-list-${px}`);
      await page.getByRole('searchbox', { name: 'Szukaj klientów' }).fill('Lodz');
      await expect(page.getByRole('link', { name: /Przykładowy Jan/ })).toBeVisible();
      await shot(`w14-search-${px}`);
      await page.getByRole('searchbox', { name: 'Szukaj klientów' }).fill('Zzzz');
      await expect(page.getByRole('heading', { level: 2, name: 'Brak klientów spełniających kryteria.' })).toBeVisible();
      await shot(`w14-no-results-${px}`);
      api.failNext.set('POST /api/v1/customers/search', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
      await page.getByRole('searchbox', { name: 'Szukaj klientów' }).fill('Przy');
      await expect(page.getByRole('alert').filter({ hasText: 'Zbyt wiele zapytań' })).toBeVisible();
      await shot(`w14-rate-limited-${px}`);
      api.customers.length = 0;
      await page.goto('/customers');
      await expect(page.getByRole('heading', { level: 2, name: 'Nie masz jeszcze klientów.' })).toBeVisible();
      await shot(`w14-empty-${px}`);
      api.failNext.set('GET /api/v1/customers', { status: 500, code: 'internal_error' });
      await page.goto('/customers');
      await expect(page.getByRole('heading', { level: 2, name: 'Nie udało się wczytać klientów.' })).toBeVisible();
      await shot(`w14-error-${px}`);
    });

    test(`EVM-039 W-14 list: offline banner at ${px} px`, async ({ page, context, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/customers');
      await expect(page.getByRole('table', { name: 'Klienci' })).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByText(/Dane mogą być nieaktualne/)).toBeVisible();
      await shot(`w14-offline-${px}`);
      await context.setOffline(false);
    });

    test(`EVM-039 W-14 details: loaded, menu, edit dialog, conflict, discard question and not found at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrderFor(page);
      await page.goto(JAN_PATH);
      await expect(page.getByRole('heading', { level: 2, name: 'Historia zleceń (1)' })).toBeVisible();
      await shot(`w14-details-${px}`);
      await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
      await expect(page.getByRole('menuitem', { name: 'Edytuj dane klienta…' })).toBeVisible();
      await shot(`w14-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Edytuj dane klienta…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Edytuj dane klienta' });
      await expect(dialog).toBeVisible();
      await shot(`w14-edit-${px}`);
      await dialog.getByRole('textbox', { name: 'Telefon' }).fill('12');
      await dialog.getByRole('button', { name: 'Zapisz dane klienta' }).click();
      await expect(dialog.getByText('Podaj poprawny numer telefonu, np. +48 600 000 001.')).toBeVisible();
      await shot(`w14-edit-validation-${px}`);
      await dialog.getByRole('textbox', { name: 'Telefon' }).fill('600 000 008');
      const jan = api.customers[0];
      if (jan === undefined) throw new Error('the seed customer is missing');
      jan.phone = '+48600000009';
      jan.version = 2;
      await dialog.getByRole('button', { name: 'Zapisz dane klienta' }).click();
      await expect(dialog.getByText('Aktualnie: +48 600 000 009')).toBeVisible();
      await shot(`w14-edit-conflict-${px}`);
      await dialog.getByRole('button', { name: 'Anuluj' }).click();
      await expect(page.getByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeVisible();
      await shot(`w14-discard-${px}`);
      await page.getByRole('button', { name: 'Odrzuć zmiany' }).click();
      jan.deleted = true;
      await page.goto(JAN_PATH);
      await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono klienta.' })).toBeVisible();
      await shot(`w14-not-found-${px}`);
    });

    test(`EVM-039 W-14 details of a company and for Tylko odczyt at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/customers/01968f3e-0000-7000-8000-00000000aaa2');
      await expect(page.getByRole('heading', { level: 1, name: 'Firma Testowa sp. z o.o.' })).toBeVisible();
      await shot(`w14-company-${px}`);
      api.role = 'read_only';
      await page.goto(JAN_PATH);
      await expect(page.getByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeVisible();
      await shot(`w14-read-only-${px}`);
    });
  }
});
