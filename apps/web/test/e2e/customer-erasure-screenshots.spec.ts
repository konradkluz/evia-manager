import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-041 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-041 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirCustomerErase']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const JAN_PATH = '/customers/01968f3e-0000-7000-8000-00000000aaa1';

const customerAt = <T>(list: readonly T[], index: number): T => {
  const found = list[index];
  if (found === undefined) throw new Error('no such customer');
  return found;
};

test.describe('UX review screenshots (EVM-041) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-041 W-14 deleted view, deleted customer, dialog of the anonymization and anonymized customer at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      api.stepUp = 'fresh';
      customerAt(api.customers, 1).deleted = true;
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/customers');
      await page.getByRole('button', { name: 'Usunięci' }).click();
      await expect(page.getByText('Usunięty', { exact: true })).toBeVisible();
      await shot(`w14-deleted-view-${px}`);

      await page.goto(JAN_PATH);
      await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
      await shot(`w14-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Usuń klienta' }).click();
      await expect(page.getByText('Klient jest usunięty — widzi go tylko administrator.')).toBeVisible();
      await shot(`w14-deleted-customer-${px}`);

      await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
      await page.getByRole('menuitem', { name: 'Anonimizuj klienta…' }).click();
      const dialog = page.getByRole('alertdialog');
      await dialog.getByRole('button', { name: 'Anonimizuj klienta' }).click();
      await shot(`w14-anonymize-dialog-${px}`);
      await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Anonimizuj klienta' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Klient zanonimizowany' })).toBeVisible();
      await shot(`w14-anonymized-${px}`);
    });
  }
});
