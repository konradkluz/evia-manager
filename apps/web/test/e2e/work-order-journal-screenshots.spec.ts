import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';
import { seedJournal } from './mock-journal.ts';

// Screenshots for the UX review of EVM-037 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-037 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirJournal']);
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

test.describe('UX review screenshots (EVM-037) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-037 W-08 Dziennik: the empty journal, the field, the timeline, the menu, the correction and the states at ${px} px`, async ({
      page,
      api,
      context,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const id = await createOrder(page);
      await page.getByRole('tab', { name: 'Dziennik' }).click();
      await expect(page.getByText('Brak wpisów. Dodaj pierwszą notatkę.')).toBeVisible();
      await shot(`w08-empty-${px}`);

      await page.getByRole('button', { name: 'Rozmowa telefoniczna' }).click();
      await page.getByLabel('Etap (opcjonalnie)').selectOption({ label: 'Wniosek do OSD' });
      await page.getByRole('textbox', { name: 'Treść' }).fill('Uzgodniono z klientem podpisanie pełnomocnictwa w biurze w piątek.');
      await shot(`w08-field-draft-${px}`);
      await page.getByRole('button', { name: 'Dodaj wpis' }).click();
      await expect(page.getByText('Dodano wpis.')).toBeVisible();
      await shot(`w08-entry-added-${px}`);

      await page.getByRole('radio', { name: 'Komentarz' }).check();
      await page
        .getByRole('textbox', { name: 'Treść' })
        .fill('Proszę o potwierdzenie terminu montażu z administracją. Zobacz https://example.invalid/mapa.');
      await page.getByRole('button', { name: 'Dodaj komentarz' }).click();
      await expect(page.locator('li[data-entry-id]')).toHaveCount(2);

      await page
        .getByRole('button', { name: /^Akcje wpisu/ })
        .first()
        .click();
      await shot(`w08-entry-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Popraw wpis' }).click();
      const dialog = page.getByRole('dialog', { name: 'Popraw wpis' });
      await dialog.getByRole('textbox', { name: 'Treść poprawki' }).fill('Proszę o potwierdzenie terminu montażu z administracją budynku.');
      await shot(`w08-correction-dialog-${px}`);
      await dialog.getByRole('button', { name: 'Zapisz poprawkę' }).click();
      await expect(page.locator('li[data-entry-id]')).toHaveCount(3);
      await shot(`w08-corrected-${px}`);
      await page.getByRole('button', { name: 'Pokaż treść' }).click();
      await shot(`w08-corrected-shown-${px}`);

      seedJournal(api.journal, id, 60);
      await page.reload();
      await page.getByRole('tab', { name: 'Dziennik' }).click();
      await expect(page.locator('li[data-entry-id]')).toHaveCount(25);
      await shot(`w08-timeline-${px}`);
      await page.getByRole('button', { name: 'Komentarze' }).click();
      await expect(page.locator('li[data-entry-id]')).toHaveCount(12);
      await shot(`w08-filter-comments-${px}`);

      await page.getByRole('textbox', { name: 'Treść' }).fill('a'.repeat(10_001));
      await shot(`w08-too-long-${px}`);
      await page.getByRole('textbox', { name: 'Treść' }).fill('Tekst bez zasięgu.');
      await context.setOffline(true);
      await expect(page.getByText('Dodasz wpis po powrocie połączenia.')).toBeVisible();
      await shot(`w08-offline-${px}`);
      await context.setOffline(false);

      api.role = 'read_only';
      await page.reload();
      await page.getByRole('tab', { name: 'Dziennik' }).click();
      await expect(page.locator('li[data-entry-id]')).toHaveCount(25);
      await shot(`w08-read-only-${px}`);

      api.failNext.set(`GET /api/v1/work-orders/${id}/timeline`, { status: 500, code: 'internal_error' });
      await page.reload();
      await page.getByRole('tab', { name: 'Dziennik' }).click();
      await expect(page.getByText('Nie udało się wczytać dziennika.')).toBeVisible();
      await shot(`w08-error-${px}`);
    });
  }
});
