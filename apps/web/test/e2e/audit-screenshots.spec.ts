import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-029 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-029 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirAudit']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const AUDIT = '/administration/audit';
const TITLE = 'Potwierdź tożsamość, aby przejrzeć dziennik audytu';

test.describe('UX review screenshots (EVM-029) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-029 W-04 and the state before the confirmation at ${px} px`, async ({ page, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(AUDIT);
      await expect(page.getByRole('alertdialog', { name: TITLE })).toBeVisible();
      await shot(`w04-dialog-${px}`);
      await page.getByRole('button', { name: 'Anuluj' }).click();
      await expect(page.getByRole('heading', { name: 'Potwierdź tożsamość, aby zobaczyć dziennik audytu.' })).toBeVisible();
      await shot(`w18-confirm-${px}`);
    });

    test(`EVM-029 W-18 log, filters, empty, error, 429 and offline at ${px} px`, async ({ page, api, context, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(AUDIT);
      await expect(page.getByRole('table')).toBeVisible();
      await shot(`w18-log-${px}`);
      await page.getByRole('combobox', { name: 'Wynik' }).selectOption({ label: 'Odmowa' });
      await expect(page.getByRole('button', { name: 'Usuń filtr Wynik: Odmowa' })).toBeVisible();
      await shot(`w18-filtered-${px}`);
      api.auditEvents = 0;
      await page.getByRole('button', { name: 'Usuń filtr Wynik: Odmowa' }).click();
      await expect(page.getByRole('heading', { name: 'Brak zdarzeń w wybranym okresie.' })).toBeVisible();
      await shot(`w18-empty-${px}`);
      api.failNext.set('GET /api/v1/audit/events', { status: 500, code: 'internal_error' });
      await page.getByRole('combobox', { name: 'Wynik' }).selectOption({ label: 'Udane' });
      await expect(page.getByRole('heading', { name: 'Nie udało się wczytać dziennika.' })).toBeVisible();
      await shot(`w18-error-${px}`);
      api.failNext.set('GET /api/v1/audit/events', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
      await page.getByRole('combobox', { name: 'Wynik' }).selectOption({ label: 'Błąd' });
      await expect(page.getByRole('alert')).toContainText('Zbyt wiele zapytań');
      await shot(`w18-429-${px}`);
      api.auditEvents = 40;
      await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
      await expect(page.getByRole('table')).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByText('Brak połączenia. Panel działa po jego powrocie.')).toBeVisible();
      await shot(`w18-offline-${px}`);
      await context.setOffline(false);
    });

    test(`EVM-029 W-04 offline and W-18 "Brak dostępu" at ${px} px`, async ({ page, api, context, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(AUDIT);
      await expect(page.getByRole('alertdialog', { name: TITLE })).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByText('Brak połączenia. Potwierdzenie wymaga połączenia z internetem.')).toBeVisible();
      await shot(`w04-offline-${px}`);
      await context.setOffline(false);
      api.role = 'editor';
      await page.goto(AUDIT);
      await expect(page.getByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeVisible();
      await shot(`w18-denied-${px}`);
    });
  }
});
