import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review (EVM-008 AC6; styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target directory from the project metadata (playwright.config.ts → docs/ux/reviews/EVM-008, PNG ignored by git);
// run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string, fullPage?: boolean) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDir']);
    await use(async (name, fullPage = true) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage });
    });
  },
});

test.describe('UX review screenshots (EVM-008 AC6) @screenshots', () => {
  for (const width of [360, 768, 1280, 1440]) {
    test(`EVM-008 AC6 shell at ${String(width)} px`, async ({ page, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders');
      await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń' })).toBeVisible();
      await shot(`shell-${String(width)}`);
    });
  }

  test('EVM-008 AC6 drawer at 360 px', async ({ page, shot }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/work-orders');
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot('shell-360-menu', false);
  });

  test('EVM-008 AC6 collapsed sidebar tooltip at 768 px (keyboard focus)', async ({ page, shot }) => {
    await page.setViewportSize({ width: 768, height: 800 });
    await page.goto('/work-orders');
    await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń' })).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Zlecenia' })).toBeFocused();
    await shot('shell-768-tooltip', false);
  });

  for (const width of [360, 1280]) {
    test(`EVM-008 AC6 offline at ${String(width)} px`, async ({ page, context, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders');
      await context.setOffline(true);
      await expect(page.getByText('Brak połączenia. Panel działa po jego powrocie.')).toBeVisible();
      await shot(`shell-${String(width)}-offline`);
    });
  }
});
