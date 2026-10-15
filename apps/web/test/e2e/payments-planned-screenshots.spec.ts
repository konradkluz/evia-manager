import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures.ts';
import { answerPlanned, planned } from './mock-planned.ts';

// Screenshots for the UX review of EVM-059 (evidence, ADR-0015) in the directory `uxReviewDirPlanned` of the config (PNG ignored by git);
// run: pnpm --filter @evia/web run e2e:screenshots
test.use({ session: 'active' });

test.describe('UX review screenshots (EVM-059) @screenshots', () => {
  for (const width of [360, 768, 1280, 1440]) {
    test(`EVM-059 W-11 "Do wystawienia" and its empty state at ${String(width)} px`, async ({ page }, testInfo) => {
      const dir = String(testInfo.project.metadata['uxReviewDirPlanned']);
      mkdirSync(dir, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await answerPlanned(page, [planned(1), planned(2, { name: 'Płatność końcowa', sharePercent: null, amount: null })]);
      await page.goto('/payments?view=planned');
      await expect(page.getByRole('table', { name: 'Transze do wystawienia faktury' })).toBeVisible();
      await page.screenshot({ path: join(dir, `w11-planned-${String(width)}.png`), fullPage: true });
      await page.unroute('**/api/v1/payment-milestones?*view=planned*');
      await answerPlanned(page, []);
      await page.goto('/payments?view=planned');
      await expect(page.getByRole('heading', { level: 2, name: 'Wszystkie transze mają wystawione faktury.' })).toBeVisible();
      await page.screenshot({ path: join(dir, `w11-planned-empty-${String(width)}.png`), fullPage: true });
    });
  }
});
