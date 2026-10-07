import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-021 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-021 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirLocations']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('UX review screenshots (EVM-021) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-021 W-05 section "2. Lokalizacja": search, results, no results, offline, chosen site at ${px} px`, async ({
      page,
      context,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders/new');
      const field = page.getByRole('combobox', { name: 'Lokalizacja' });
      await expect(field).toBeVisible();
      await shot(`w05-site-empty-${px}`);
      await field.fill('te');
      await expect(page.getByText('Wpisz co najmniej 3 znaki, aby wyszukać.')).toBeVisible();
      await shot(`w05-site-short-${px}`);
      await field.fill('testowa');
      await expect(page.getByRole('option', { name: /ul\. Testowa 7/ })).toBeVisible();
      await shot(`w05-site-results-${px}`);
      await field.fill('Nigdzie');
      await expect(page.getByText('Brak wyników dla „Nigdzie”.')).toBeVisible();
      await shot(`w05-site-no-results-${px}`);
      await context.setOffline(true);
      await field.fill('Offline');
      await expect(page.getByText('Wyszukiwanie wymaga połączenia.')).toBeVisible();
      await shot(`w05-site-offline-${px}`);
      await context.setOffline(false);
      await field.fill('testowa');
      await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
      await expect(page.getByText(/miejsce 15/)).toBeVisible();
      await shot(`w05-site-chosen-${px}`);
    });

    test(`EVM-021 W-05 new site: empty, errors, garage, parties chosen, offline at ${px} px`, async ({ page, context, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders/new');
      await page.getByRole('radio', { name: 'Nowa lokalizacja' }).check();
      await shot(`w05-new-empty-${px}`);
      await page.getByRole('button', { name: 'Zapisz lokalizację' }).click();
      await expect(page.getByText('Uzupełnij to pole.').first()).toBeVisible();
      await shot(`w05-new-errors-${px}`);
      await page.getByRole('combobox', { name: 'Typ obiektu' }).selectOption({ label: 'Garaż w budynku wielorodzinnym' });
      await page.getByRole('textbox', { name: 'Ulica' }).fill('ul. Testowa');
      await page.getByRole('textbox', { name: 'Nr budynku' }).fill('7');
      await page.getByRole('textbox', { name: 'Kod pocztowy' }).fill('00-001');
      await page.getByRole('textbox', { name: 'Miasto' }).fill('Warszawa');
      await page.getByRole('textbox', { name: 'Nr miejsca postojowego (opcjonalnie)' }).fill('15');
      await page.getByRole('textbox', { name: 'Poziom (opcjonalnie)' }).fill('-1');
      await page.getByRole('textbox', { name: 'Moc przyłączeniowa (opcjonalnie)' }).fill('11');
      await page.getByRole('combobox', { name: 'OSD (opcjonalnie)' }).fill('Testow');
      await expect(page.getByRole('option', { name: /Operator Testowy/ })).toBeVisible();
      await shot(`w05-new-garage-osd-results-${px}`);
      await page.getByRole('option', { name: /Operator Testowy/ }).click();
      await page.getByRole('combobox', { name: 'Zarządca / administracja (opcjonalnie)' }).fill('Brak takiej');
      await expect(page.getByText('Brak wyników dla „Brak takiej”.')).toBeVisible();
      await shot(`w05-new-garage-manager-no-results-${px}`);
      await context.setOffline(true);
      await expect(page.getByText('Brak połączenia. Zapiszesz lokalizację po powrocie połączenia — wpisane dane zostają.')).toBeVisible();
      await shot(`w05-new-offline-${px}`);
      await context.setOffline(false);
    });

    test(`EVM-021 W-05 dialog "Dodaj stronę": organization, natural person, errors, offline at ${px} px`, async ({
      page,
      context,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders/new');
      await page.getByRole('radio', { name: 'Nowa lokalizacja' }).check();
      await page.getByRole('button', { name: 'Dodaj stronę: OSD' }).click();
      const dialog = page.getByRole('dialog', { name: 'Dodaj stronę' });
      await expect(dialog).toBeVisible();
      await shot(`w05-party-dialog-${px}`);
      await dialog.getByRole('button', { name: 'Dodaj stronę' }).click();
      await expect(dialog.getByText('Uzupełnij to pole.')).toBeVisible();
      await shot(`w05-party-dialog-errors-${px}`);
      await dialog.getByRole('radio', { name: 'Osoba fizyczna' }).check();
      await dialog.getByRole('textbox', { name: 'Imię i nazwisko' }).fill('Jan Przykładowy');
      await shot(`w05-party-dialog-person-${px}`);
      await context.setOffline(true);
      await expect(dialog.getByText('Brak połączenia. Dodasz stronę po powrocie połączenia — wpisane dane zostają.')).toBeVisible();
      await shot(`w05-party-dialog-offline-${px}`);
      await context.setOffline(false);
    });
  }
});
