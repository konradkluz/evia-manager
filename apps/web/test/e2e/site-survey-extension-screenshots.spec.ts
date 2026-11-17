import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';
import { SURVEY_NUMBER, SURVEY_PATH } from './mock-site-surveys.ts';

// Screenshots for the UX review of EVM-140 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-140 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirSurveyExtension']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 1280];
const BANNER = 'Wizja lokalna — brak klienta';
const EXTEND = 'Przedłuż o 90 dni';

test.describe('UX review screenshots (EVM-140) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-140 W-06 the survey: the action, the dialog, the last extension, the error and the disabled action at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(SURVEY_PATH);
      await expect(page.getByRole('heading', { level: 1, name: SURVEY_NUMBER })).toBeVisible();
      const banner = page.getByRole('region', { name: BANNER });
      await expect(banner.getByRole('button', { name: EXTEND })).toBeVisible();
      await shot(`w06-extend-banner-${px}`);
      await banner.getByRole('button', { name: EXTEND }).click();
      const dialog = page.getByRole('alertdialog', { name: 'Przedłuż wizję o 90 dni' });
      await expect(dialog).toBeVisible();
      await shot(`w06-extend-dialog-${px}`);
      await dialog.getByRole('button', { name: EXTEND }).click();
      await expect(dialog.getByText('Wybierz powód przedłużenia.')).toBeVisible();
      await shot(`w06-extend-reason-required-${px}`);
      // the server says the limit is reached while the page still shows the counter 1
      api.surveys.extensionCount = 1;
      await page.reload();
      await banner.getByRole('button', { name: EXTEND }).click();
      await expect(dialog.getByText('To ostatnie przedłużenie — potem zostaje przypisanie klienta albo odrzucenie wizji.')).toBeVisible();
      await shot(`w06-extend-last-${px}`);
      api.surveys.extensionCount = 2;
      await dialog.getByRole('radio', { name: 'Wymaga drugiej wizyty' }).check();
      await dialog.getByRole('button', { name: EXTEND }).click();
      await expect(dialog.getByRole('alert')).toContainText('Ta wizja była już dwukrotnie przedłużona.');
      await shot(`w06-extend-limit-error-${px}`);
      await dialog.getByRole('button', { name: 'Anuluj' }).click();
      await expect(banner.getByRole('button', { name: EXTEND })).toHaveAttribute('aria-disabled', 'true');
      await shot(`w06-extend-disabled-${px}`);
    });
  }
});
