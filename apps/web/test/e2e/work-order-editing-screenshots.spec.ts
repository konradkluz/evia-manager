import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-035 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-035 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirEditing']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

async function createOrder(page: Page, template = /Garaż — montaż ładowarki/): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: template }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe('UX review screenshots (EVM-035) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-035 W-06 (a) Edytuj dane zlecenia: the menu, the dialog and the conflict at ${px} px`, async ({ page, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      await page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }).click();
      await shot(`w06a-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Edytuj dane zlecenia…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Edytuj dane zlecenia' });
      await dialog.getByLabel('Opis (opcjonalnie)').fill('Trasa kabla przez szacht B, rozdzielnica na poziomie −1.');
      await dialog.getByLabel('Planowana data (opcjonalnie)').fill('2026-11-03');
      await shot(`w06a-dialog-${px}`);
      await page.evaluate(async (target) => {
        await fetch(`/api/v1${target}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'If-Match': '"1"', 'X-CSRF-Token': 'csrf-active' },
          body: JSON.stringify({ plannedDate: '2026-10-27' }),
        });
      }, path);
      await dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await shot(`w06a-conflict-${px}`);
    });

    test(`EVM-035 W-06 (c) Edytuj zakres: the mode, adding with the processes, the parameters, the confirmation at ${px} px`, async ({
      page,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrder(page);
      await shot(`w06c-view-${px}`);
      await page.getByRole('button', { name: 'Edytuj zakres' }).click();
      await shot(`w06c-mode-${px}`);

      await page.getByRole('button', { name: 'Dodaj pozycję…' }).click();
      const add = page.getByRole('dialog', { name: 'Dodaj pozycję zakresu' });
      await add.getByLabel('Pozycja z katalogu').selectOption({ label: 'Instalacja zasilająca' });
      await add.getByRole('group', { name: 'Obwód dedykowany' }).getByRole('radio', { name: 'Tak' }).check();
      await add.getByLabel('Długość kabla (opcjonalnie)').fill('18');
      await shot(`w06c-add-${px}`);
      await add.getByLabel('Pozycja z katalogu').selectOption({ label: 'Inna usługa (opis w zleceniu)' });
      await shot(`w06c-add-custom-${px}`);
      await add.getByLabel('Pozycja z katalogu').selectOption({ label: 'Instalacja zasilająca' });
      await add.getByRole('group', { name: 'Obwód dedykowany' }).getByRole('radio', { name: 'Tak' }).check();
      await add.getByRole('button', { name: 'Dodaj pozycję' }).click();
      await expect(page.getByText('Dodano pozycję „Instalacja zasilająca”', { exact: false })).toBeVisible();
      await shot(`w06c-added-${px}`);

      await page.getByRole('button', { name: 'Akcje pozycji: Pozycja 1' }).click();
      await page.getByRole('menuitem', { name: 'Edytuj parametry…' }).click();
      await page.getByLabel('Moc ładowarki').fill('1500');
      await page.getByRole('button', { name: 'Zapisz parametry' }).click();
      await expect(page.getByText(/Wartość spoza zakresu/)).toBeVisible();
      await shot(`w06c-parameters-error-${px}`);
      await page.getByRole('button', { name: 'Anuluj' }).click();
      await page.getByRole('button', { name: 'Odrzuć zmiany' }).click();

      await page.getByRole('button', { name: 'Akcje pozycji: Instalacja zasilająca' }).click();
      await page.getByRole('menuitem', { name: 'Usuń pozycję…' }).click();
      await expect(page.getByRole('alertdialog')).toContainText('Procesy dodane z tą pozycją zostają: Instalacja zasilająca (3 etapy).');
      await shot(`w06c-remove-${px}`);
    });

    test(`EVM-035 W-06 (b) a closed order and the empty scope at ${px} px`, async ({ page, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/work-orders/new');
      await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
      await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
      await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
      await page.getByRole('radio', { name: 'Puste zlecenie (bez szablonu)' }).check();
      await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
      await expect(page.getByText('Zlecenie nie ma jeszcze pozycji zakresu.')).toBeVisible();
      await shot(`w06c-empty-${px}`);
      await page.getByRole('button', { name: /^Status zlecenia: .*Zmień status$/ }).click();
      await page.getByRole('menuitem', { name: 'Anuluj zlecenie…' }).click();
      const cancel = page.getByRole('dialog', { name: 'Anuluj zlecenie ZL-2026-0042' });
      await cancel.getByLabel('Powód anulowania').fill('Rezygnacja klienta');
      await cancel.getByRole('button', { name: 'Anuluj zlecenie' }).click();
      await expect(page.getByRole('button', { name: 'Edytuj zakres' })).toHaveAttribute('aria-disabled', 'true');
      await shot(`w06b-closed-${px}`);
    });
  }
});
