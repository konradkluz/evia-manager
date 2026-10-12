import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-033 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-033 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirWaiting']);
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

test.describe('UX review screenshots (EVM-033) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-033 W-07 the suggestions from the location, the default, "Dodaj stronę", the way back and the states at ${px} px`, async ({
      page,
      api,
      shot,
      context,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrder(page);
      await page.getByRole('region', { name: 'Procesy i etapy (9)' }).getByRole('button', { name: 'Rozwiń wszystkie' }).click();
      const open = async (stage: string) => {
        await page.getByRole('button', { name: `Status etapu ${stage}: Do zrobienia. Zmień status` }).click();
        await page.getByRole('menuitem', { name: 'Czekamy na…' }).click();
        return page.getByRole('dialog', { name: 'Na kogo czekamy?' });
      };

      const dialog = await open('Wniosek do OSD');
      await expect(dialog.getByRole('group', { name: 'Podpowiedzi z lokalizacji' })).toBeVisible();
      await shot(`w07-suggestions-default-osd-${px}`);
      await dialog.getByRole('button', { name: 'Zmień stronę' }).click();
      await shot(`w07-suggestions-search-${px}`);
      await dialog.getByRole('button', { name: 'Dodaj stronę: Strona' }).click();
      const adding = page.getByRole('dialog', { name: 'Na kogo czekamy? › Dodaj stronę' });
      await shot(`w07-add-party-${px}`);
      await adding.getByRole('button', { name: 'Dodaj stronę' }).click();
      await shot(`w07-add-party-error-${px}`);
      await adding.getByRole('textbox', { name: 'Nazwa' }).fill('Rzeczoznawca Testowy');
      await adding.getByRole('button', { name: 'Dodaj stronę' }).click();
      await expect(page.getByRole('dialog', { name: 'Na kogo czekamy?' }).getByText(/Dodano stronę/)).toBeVisible();
      await shot(`w07-party-added-${px}`);
      await context.setOffline(true);
      await expect(page.getByRole('dialog', { name: 'Na kogo czekamy?' }).getByRole('button', { name: 'Zapisz' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await shot(`w07-offline-${px}`);
      await context.setOffline(false);
      await page.getByRole('dialog').getByRole('button', { name: 'Anuluj' }).click();

      await open('Pełnomocnictwo od klienta');
      await shot(`w07-default-customer-${px}`);
      await page.getByRole('dialog').getByRole('button', { name: 'Anuluj' }).click();

      api.parties.length = 0;
      await page.reload();
      await page.getByRole('region', { name: 'Procesy i etapy (9)' }).getByRole('button', { name: 'Rozwiń wszystkie' }).click();
      const another = await open('Warunki przyłączenia');
      await another.getByRole('radio', { name: 'Stronę' }).check();
      await shot(`w07-no-suggestions-${px}`);
    });
  }
});
