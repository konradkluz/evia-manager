import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';
import { openDocuments, sendOffer } from './survey-offer-support.ts';

// Screenshots for the UX review of EVM-148 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-148 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirSurveyOffer']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

for (const width of [360, 768, 1280, 1440]) {
  const px = String(width);
  test(`EVM-148 the offer form, the refusals and the rejected survey at ${px} px @screenshots`, async ({ page, api, shot }) => {
    await page.setViewportSize({ width, height: 900 });
    await openDocuments(page);
    await shot(`w09-survey-empty-${px}`);
    await page.getByRole('button', { name: 'Dodaj dokument' }).click();
    await expect(page.getByRole('dialog', { name: 'Dodaj dokument' }).getByText('Dane osobowe w ofercie')).toBeVisible();
    await shot(`w09-offer-form-${px}`);
    await page.getByRole('button', { name: 'Anuluj' }).click();
    api.surveys.documentRefusal = 'customer_required';
    await sendOffer(page);
    await expect(page.getByRole('alert').filter({ hasText: 'Najpierw przypisz klienta' })).toBeVisible();
    await shot(`w09-customer-required-${px}`);
    api.surveys.status = 'cancelled';
    await page.reload();
    await page.getByRole('tab', { name: 'Media i dokumenty' }).click();
    await expect(page.getByRole('button', { name: 'Dodaj dokument' })).toHaveAttribute('aria-disabled', 'true');
    await shot(`w09-rejected-${px}`);
  });
}
