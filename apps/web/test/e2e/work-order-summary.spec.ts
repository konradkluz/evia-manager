import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

// The card "Podsumowanie" of W-06 in a real browser against the synthetic API (EVM-034 AC5, AC7, AC8): "Na jakim etapie", "Na kogo czekamy"
// and "Terminy" put together from the processes of the order. The days and the overdue flags are the server's; the clock of the tab is fixed.
test.use({ session: 'active' });

/** Creates the order ZL-2026-0042 through W-05 (the template with nine items brings nine processes) and returns its address. */
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

const summary = (page: Page) => page.getByRole('region', { name: /^Podsumowanie/ });
const tile = (page: Page, name: string) => summary(page).getByRole('region', { name });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-03T10:00:00+02:00'));
});

test.describe('summary of a work order W-06 (EVM-034)', () => {
  test('EVM-034 AC5 nine processes: the current stage of three and "+ 6 procesów", which leads to the section of the processes', async ({
    page,
  }) => {
    await createOrder(page);
    const stages = tile(page, 'Na jakim etapie');
    await expect(stages.getByRole('listitem')).toHaveCount(3);
    await expect(stages.getByText('Pełnomocnictwo od klienta')).toBeVisible();
    await expect(stages.getByText('Uzgodnienia z OSD')).toBeVisible();
    await expect(stages.getByText('Do zrobienia')).toHaveCount(3);
    await stages.getByRole('button', { name: '+ 6 procesów' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Procesy i etapy (9)' })).toBeFocused();
  });

  test('EVM-034 AC5 nobody to wait for: "Piłka po naszej stronie"; after a wait the tile lists it and the empty sentence goes', async ({
    page,
  }) => {
    await createOrder(page);
    const waits = tile(page, 'Na kogo czekamy');
    await expect(waits.getByText('Piłka po naszej stronie — nie czekamy na nikogo.')).toBeVisible();
    await page.getByRole('button', { name: /^Status etapu Pełnomocnictwo od klienta: Do zrobienia\. Zmień status$/ }).click();
    await page.getByRole('menuitem', { name: 'Czekamy na…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
    await dialog.getByRole('radio', { name: 'Klienta' }).check();
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    // the synthetic server counts the days from its own clock (the panel sends the fixed day of the tab): the number is not the point here
    await expect(waits.getByText(/^Czekamy na: klient · od /)).toBeVisible();
    await expect(waits.getByText('Piłka po naszej stronie — nie czekamy na nikogo.')).toHaveCount(0);
    // no row for the parties that nobody waits for (PO-3)
    await expect(waits.getByRole('listitem')).toHaveCount(1);
    // the tile "Na jakim etapie" shows the new status of the current stage
    await expect(tile(page, 'Na jakim etapie').getByText('Czekamy na…').first()).toBeVisible();
  });

  test('EVM-034 AC5 a due date in the past is under "Po terminie" with alarm-clock; a later one is "Najbliższy"', async ({ page, api }) => {
    api.role = 'editor';
    await createOrder(page);
    const due = tile(page, 'Terminy');
    await expect(due.getByText('Najbliższy: brak')).toBeVisible();
    await expect(due.getByText('Po terminie: brak')).toBeVisible();
    await page.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }).click();
    await page.getByRole('menuitem', { name: 'Zmień osobę odpowiedzialną i termin…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zmień etap: Wniosek do OSD' });
    await dialog.getByLabel('Termin').fill('2020-01-02');
    await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(due.getByText('Wniosek do OSD — 02.01.2020')).toBeVisible();
    await expect(due.getByText('Po terminie:')).toBeVisible();
    await page.getByRole('button', { name: 'Akcje etapu: Pełnomocnictwo od klienta' }).click();
    await page.getByRole('menuitem', { name: 'Zmień osobę odpowiedzialną i termin…' }).click();
    const second = page.getByRole('dialog', { name: 'Zmień etap: Pełnomocnictwo od klienta' });
    await second.getByLabel('Termin').fill('2099-01-02');
    await second.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(due.getByText('Najbliższy: 02.01.2099 — Pełnomocnictwo od klienta')).toBeVisible();
  });

  test('EVM-034 AC7 Tylko odczyt sees the three tiles', async ({ page, api }) => {
    await createOrder(page);
    api.role = 'read_only';
    await page.reload();
    await expect(tile(page, 'Na jakim etapie')).toBeVisible();
    await expect(tile(page, 'Na kogo czekamy')).toBeVisible();
    await expect(tile(page, 'Terminy')).toBeVisible();
  });

  test('EVM-034 AC8 a failed read is an alert in every tile with its own retry; the header and the cards work', async ({ page, api }) => {
    const path = await createOrder(page);
    api.failNext.set(`GET /api/v1${path}/procedures`, { status: 500, code: 'internal_error' });
    await page.reload();
    await expect(summary(page).getByText('Nie udało się wczytać tego kafla.')).toHaveCount(3);
    await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Klient' }).getByText('Jan Przykładowy')).toBeVisible();
    await tile(page, 'Terminy').getByRole('button', { name: 'Wczytaj kafel ponownie' }).click();
    await expect(tile(page, 'Na jakim etapie').getByRole('listitem')).toHaveCount(3);
    await expect(summary(page).getByText('Nie udało się wczytać tego kafla.')).toHaveCount(0);
  });

  test('EVM-034 AC8 offline the card stays from the memory of the tab under the banner; nothing reaches the stores of the browser', async ({
    page,
    context,
  }) => {
    await createOrder(page);
    await expect(tile(page, 'Na jakim etapie').getByRole('listitem')).toHaveCount(3);
    await context.setOffline(true);
    await expect(page.getByText(/^Dane mogą być nieaktualne/)).toBeVisible();
    await expect(tile(page, 'Na jakim etapie').getByRole('listitem')).toHaveCount(3);
    const stores = await page.evaluate(async () => ({
      local: globalThis.localStorage.length,
      session: globalThis.sessionStorage.length,
      databases: (await globalThis.indexedDB.databases()).length,
      caches: (await globalThis.caches.keys()).length,
    }));
    expect(stores).toEqual({ local: 0, session: 0, databases: 0, caches: 0 });
    await context.setOffline(false);
  });
});
