import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-031 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-031 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirProcedures']);
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
  if (template) await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  else await page.getByRole('radio', { name: 'Puste zlecenie (bez szablonu)' }).check();
  return await submitOrder(page);
}

async function submitOrder(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe('UX review screenshots (EVM-031) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-031 W-05 the card and the preview of the template with the processes at ${px} px`, async ({ page, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/work-orders/new');
      await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
      await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
      await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
      await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
      const toggle = page.getByRole('button', { name: 'Pokaż szczegóły szablonu' });
      if (await toggle.isVisible()) await toggle.click();
      await expect(page.getByRole('heading', { name: 'Procesy (9)' })).toBeVisible();
      await shot(`w05-template-processes-${px}`);
    });

    test(`EVM-031 W-06 Procesy i etapy: the sections, the menu, the dialog, the stage after the due date, the warning of "Zakończ" and the states at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      await expect(page.getByRole('region', { name: 'Procesy i etapy (9)' })).toBeVisible();
      await shot(`w06-procedures-${px}`);

      await page.getByRole('region', { name: 'Procesy i etapy (9)' }).getByRole('button', { name: 'Rozwiń wszystkie' }).click();
      await shot(`w06-procedures-expanded-${px}`);

      await page.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }).click();
      await shot(`w06-stage-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Zmień osobę odpowiedzialną i termin…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Zmień etap: Wniosek do OSD' });
      await dialog.getByLabel('Osoba odpowiedzialna').selectOption({ label: 'Piotr Testowy' });
      await dialog.getByLabel('Termin').fill('2020-01-02');
      await shot(`w06-stage-dialog-${px}`);
      await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
      await expect(page.getByText('· po terminie')).toBeVisible();
      await shot(`w06-stage-overdue-${px}`);

      await page.getByRole('button', { name: 'Status zlecenia: Nowe. Zmień status' }).click();
      await page.getByRole('menuitem', { name: 'Zaakceptuj bez wyceny' }).click();
      await page.getByRole('button', { name: 'Status zlecenia: Zaakceptowane. Zmień status' }).click();
      await page.getByRole('menuitem', { name: 'Rozpocznij realizację' }).click();
      await page.getByRole('button', { name: 'Status zlecenia: W realizacji. Zmień status' }).click();
      await page.getByRole('menuitem', { name: 'Zakończ' }).click();
      await expect(page.getByText(/Zlecenie ma jeszcze 17 otwartych etapów/)).toBeVisible();
      await shot(`w06-complete-warning-${px}`);
      await page.getByRole('button', { name: 'Anuluj' }).click();

      const id = path.split('/').at(-1) ?? '';
      api.orders.states.set(id, { status: 'settled', version: 9, closedAt: '2026-10-08T10:00:00.000Z' });
      await page.goto(path);
      await page.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }).click();
      await expect(page.getByRole('menuitem', { name: /^Zmień osobę odpowiedzialną i termin…/ })).toHaveAttribute('aria-disabled', 'true');
      await shot(`w06-closed-${px}`);

      api.role = 'read_only';
      await page.goto(path);
      await expect(page.getByRole('region', { name: 'Procesy i etapy (9)' })).toBeVisible();
      await shot(`w06-read-only-${px}`);
    });

    test(`EVM-031 W-06 Procesy i etapy: no processes, a failed read at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page, false);
      await expect(page.getByText('Zlecenie nie ma jeszcze procesów.')).toBeVisible();
      await shot(`w06-procedures-empty-${px}`);
      api.failNext.set(`GET /api/v1${path}/procedures`, { status: 500, code: 'internal_error' });
      await page.goto(path);
      await expect(page.getByText('Nie udało się wczytać procesów i etapów.')).toBeVisible();
      await shot(`w06-procedures-error-${px}`);
    });
  }
});
