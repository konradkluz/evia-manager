import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-042 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-042 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirManual']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

async function createOrder(page: Page, template = true): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: template ? /Garaż — pełny proces/ : 'Puste zlecenie (bez szablonu)' }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe('UX review screenshots (EVM-042) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-042 W-06 (d) the section with "Dodaj proces…", the menus, the dialogs and the deleted ones at ${px} px`, async ({
      page,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await createOrder(page);
      const section = page.getByRole('region', { name: /^Procesy i etapy/ });
      await shot(`w06-procedures-${px}`);

      await section.getByRole('button', { name: 'Akcje procesu: Uzgodnienia z OSD' }).click();
      await shot(`w06-process-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Dodaj etap…' }).click();
      const addStage = page.getByRole('dialog', { name: 'Dodaj etap' });
      await addStage.getByRole('textbox', { name: 'Nazwa etapu' }).fill('Uzgodnienie terminu wyłączenia zasilania');
      await addStage.getByLabel('Termin (opcjonalnie)').fill('2026-12-01');
      await addStage.getByLabel('Osoba odpowiedzialna (opcjonalnie)').selectOption({ label: 'Piotr Testowy' });
      await shot(`w06-add-stage-${px}`);
      await addStage.getByRole('button', { name: 'Dodaj etap' }).click();
      await expect(page.getByText('Dodano etap „Uzgodnienie terminu wyłączenia zasilania”.')).toBeVisible();
      await shot(`w06-stage-added-${px}`);

      await section.getByRole('button', { name: 'Akcje etapu: Uzgodnienie terminu wyłączenia zasilania' }).click();
      await shot(`w06-stage-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Usuń etap…' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await shot(`w06-remove-stage-${px}`);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Usuń etap' }).click();
      await expect(page.getByText('Usunięto etap „Uzgodnienie terminu wyłączenia zasilania”.')).toBeVisible();

      await section.getByRole('button', { name: 'Akcje procesu: Opinia ppoż' }).click();
      await page.getByRole('menuitem', { name: 'Usuń proces…' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await shot(`w06-remove-process-${px}`);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Usuń proces' }).click();
      await expect(page.getByText('Usunięto proces „Opinia ppoż”.')).toBeVisible();

      await section.getByRole('button', { name: 'Usunięte procesy i etapy (2)' }).click();
      await shot(`w06-deleted-${px}`);
      await section.getByRole('button', { name: 'Dodaj proces…' }).click();
      const addProcess = page.getByRole('dialog', { name: 'Dodaj proces' });
      await expect(addProcess.getByRole('option', { name: 'Uzgodnienia z OSD — już jest w zleceniu' })).toBeDisabled();
      await shot(`w06-add-process-${px}`);
    });

    test(`EVM-042 W-06 (d) the empty order, the closed order and Tylko odczyt at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page, false);
      await expect(page.getByRole('region', { name: /^Procesy i etapy/ }).getByText('Zlecenie nie ma jeszcze procesów.')).toBeVisible();
      await shot(`w06-empty-${px}`);

      const id = path.split('/').at(-1) ?? '';
      api.orders.states.set(id, { status: 'settled', version: 9, closedAt: '2026-10-08T10:00:00.000Z' });
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'Dodaj proces…' })).toHaveAttribute('aria-disabled', 'true');
      await shot(`w06-closed-${px}`);

      api.orders.states.delete(id);
      api.role = 'read_only';
      await page.goto(path);
      await expect(page.getByRole('region', { name: /^Procesy i etapy/ })).toBeVisible();
      await shot(`w06-read-only-${px}`);
    });
  }
});
