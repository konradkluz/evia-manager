import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';
import { createOrder, openMediaTab } from './media-support.ts';
import { seedQuarantined } from './mock-media.ts';

// Screenshots for the UX review of EVM-049 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-049 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirQuarantine']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('UX review screenshots (EVM-049) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-049 W-09 the quarantine: Administrator, the filter and Edytor at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      const id = await createOrder(page);
      seedQuarantined(api.media, id, 'held', 'malware_detected');
      seedQuarantined(api.media, id, 'held', 'type_mismatch');
      seedQuarantined(api.media, id, 'purged');
      await page.reload();
      await openMediaTab(page);
      await expect(page.getByRole('button', { name: 'Wymaga uwagi (2)' })).toBeVisible();
      await shot(`w09-quarantine-administrator-${px}`);

      await page.getByRole('button', { name: 'Wymaga uwagi (2)' }).click();
      await expect(page.getByRole('button', { name: 'Wymaga uwagi (2)' })).toHaveAttribute('aria-pressed', 'true');
      await shot(`w09-quarantine-filter-${px}`);

      api.role = 'editor';
      await page.reload();
      await openMediaTab(page);
      await expect(page.getByText('Plik zatrzymany przez skan bezpieczeństwa.', { exact: false }).first()).toBeVisible();
      await shot(`w09-quarantine-editor-${px}`);
    });
  }
});
