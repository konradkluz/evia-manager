import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-020 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-020 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirCustomers']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('UX review screenshots (EVM-020) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-020 W-05 section "1. Klient": form, hint, results, no results, offline, chosen customer at ${px} px`, async ({
      page,
      context,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders/new');
      const field = page.getByRole('combobox', { name: 'Klient' });
      await expect(field).toBeVisible();
      await shot(`w05-empty-${px}`);
      await field.fill('pr');
      await expect(page.getByText('Wpisz co najmniej 3 znaki, aby wyszukać.')).toBeVisible();
      await shot(`w05-short-${px}`);
      await field.fill('Lodz');
      await expect(page.getByRole('option', { name: /Jan Przykładowy/ })).toBeVisible();
      await shot(`w05-results-${px}`);
      await field.fill('Kowalski');
      await expect(page.getByText('Brak wyników dla „Kowalski”.')).toBeVisible();
      await shot(`w05-no-results-${px}`);
      await context.setOffline(true);
      await field.fill('Nowak');
      await expect(page.getByText('Wyszukiwanie wymaga połączenia.')).toBeVisible();
      await shot(`w05-offline-${px}`);
      await context.setOffline(false);
      await field.fill('przykl');
      await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await expect(page.getByText(/^Szkic w tej karcie/)).toBeVisible();
      await shot(`w05-chosen-${px}`);
    });

    test(`EVM-020 W-05 dialog "Dodaj klienta": person, company, address, errors, similar customer, offline at ${px} px`, async ({
      page,
      context,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders/new');
      await page.getByRole('combobox', { name: 'Klient' }).fill('Kowalski');
      await page.getByRole('button', { name: 'Dodaj klienta' }).click();
      const dialog = page.getByRole('dialog', { name: 'Dodaj klienta' });
      await expect(dialog).toBeVisible();
      await shot(`w05-dialog-person-${px}`);
      await dialog.getByRole('button', { name: 'Dodaj klienta' }).click();
      await expect(dialog.getByText('Uzupełnij to pole.').first()).toBeVisible();
      await shot(`w05-dialog-errors-${px}`);
      await dialog.getByRole('textbox', { name: 'Imię' }).fill('Jan');
      await dialog.getByRole('textbox', { name: 'Nazwisko' }).fill('Przykładowy');
      await dialog.getByRole('textbox', { name: 'Telefon' }).fill('+48 600 000 001');
      await expect(dialog.getByText('Podobny klient: Jan Przykładowy · +48 600 000 001')).toBeVisible();
      await dialog.getByRole('button', { name: /Adres korespondencyjny/ }).click();
      await shot(`w05-dialog-similar-address-${px}`);
      await dialog.getByRole('radio', { name: 'Firma' }).check();
      await shot(`w05-dialog-company-${px}`);
      await context.setOffline(true);
      await expect(
        dialog.getByText('Brak połączenia. Dodasz klienta po powrocie połączenia — wpisane dane zostają.').first(),
      ).toBeVisible();
      await shot(`w05-dialog-offline-${px}`);
      await context.setOffline(false);
    });

    test(`EVM-020 W-05 without the right to create at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      api.role = 'read_only';
      await page.goto('/work-orders/new');
      await expect(page.getByRole('heading', { level: 1, name: 'Nie możesz tworzyć zleceń.' })).toBeVisible();
      await shot(`w05-denied-${px}`);
    });
  }
});
