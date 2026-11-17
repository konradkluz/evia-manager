import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';
import { deadlineIn, SURVEY_NUMBER, SURVEY_PATH } from './mock-site-surveys.ts';

// Screenshots for the UX review of EVM-138 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-138 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirSiteSurveys']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const BANNER = 'Wizja lokalna — brak klienta';

test.describe('UX review screenshots (EVM-138) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-138 W-06 the survey: banner, warning, disabled payments and ZIP, "Przypisz klienta", "Aby zaakceptować…" at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(SURVEY_PATH);
      await expect(page.getByRole('heading', { level: 1, name: SURVEY_NUMBER })).toBeVisible();
      await expect(page.getByRole('region', { name: BANNER })).toBeVisible();
      await shot(`w06-survey-${px}`);
      await page.getByRole('tab', { name: 'Media i dokumenty' }).click();
      await expect(page.getByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' })).toBeVisible();
      await shot(`w06-survey-media-disabled-${px}`);
      await page.getByRole('tab', { name: 'Przegląd' }).click();
      // 15 days or fewer: the warning banner
      api.surveys.expiresAt = deadlineIn(10);
      api.surveys.extensionCount = 1;
      await page.reload();
      await expect(page.getByRole('region', { name: `${BANNER}, wymaga decyzji` })).toBeVisible();
      await shot(`w06-survey-warning-${px}`);
      await page.getByRole('button', { name: 'Przypisz klienta' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Przypisz klienta' });
      await shot(`w06-assign-choose-${px}`);
      await dialog.getByRole('button', { name: 'Dodaj nowego klienta' }).first().click();
      await expect(dialog.getByRole('heading', { name: 'Dodaj nowego klienta' })).toBeVisible();
      await shot(`w06-assign-new-${px}`);
      await dialog.getByRole('button', { name: 'Wróć do wyboru' }).click();
      await dialog.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
      await dialog.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await dialog.getByRole('button', { name: 'Dalej' }).click();
      await expect(dialog.getByText('Klient: Jan Przykładowy')).toBeVisible();
      await shot(`w06-assign-confirm-${px}`);
      api.surveys.conflictOnce = true;
      await dialog.getByRole('button', { name: /^Przypisz klienta Jan Przykładowy/ }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await shot(`w06-assign-conflict-${px}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await page.getByRole('button', { name: /^Status zlecenia: / }).click();
      await page.getByRole('menuitem', { name: 'Zaakceptuj' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Aby zaakceptować, przypisz klienta' })).toBeVisible();
      await shot(`w06-accept-needs-customer-${px}`);
    });

    test(`EVM-138 W-05 the choice "Rodzaj", the light form of a survey, the errors, "Bez opiekuna" and the 404 at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      api.siteSurveysOn = true;
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/work-orders/new');
      await expect(page.getByRole('group', { name: 'Rodzaj' })).toBeVisible();
      await shot(`w05-kind-order-${px}`);
      await page.getByRole('radio', { name: /^Wizja lokalna/ }).check();
      await expect(page.getByRole('button', { name: 'Załóż wizję lokalną' })).toBeVisible();
      await shot(`w05-survey-empty-${px}`);
      await page.getByRole('radio', { name: 'Nowa lokalizacja' }).check();
      await shot(`w05-survey-new-site-${px}`);
      await page.getByRole('radio', { name: 'Istniejąca lokalizacja' }).check();
      await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
      await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
      await page.getByRole('textbox', { name: 'Telefon zamawiającego (opcjonalnie)' }).fill('abc');
      await page.getByRole('combobox', { name: 'Opiekun' }).selectOption({ label: 'Bez opiekuna' });
      await page.getByRole('button', { name: 'Załóż wizję lokalną' }).click();
      await expect(page.getByText('Popraw te pola, aby założyć wizję lokalną')).toBeVisible();
      await shot(`w05-survey-errors-${px}`);
      await page.getByRole('textbox', { name: 'Telefon zamawiającego (opcjonalnie)' }).fill('600 123 456');
      api.siteSurveysOn = false;
      await page.getByRole('button', { name: 'Załóż wizję lokalną' }).click();
      await expect(page.getByText(/lokalizacja jest niedostępna albo wizje lokalne są teraz wyłączone/)).toBeVisible();
      await shot(`w05-survey-unavailable-${px}`);
    });
    test(`EVM-138 W-06 "Odrzuć wizję", the rejected survey of the Administrator and of the Editor, "Przywróć wizję" at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(SURVEY_PATH);
      await page.getByRole('region', { name: BANNER }).getByRole('button', { name: 'Odrzuć wizję…' }).click();
      const dialog = page.getByRole('alertdialog', { name: 'Odrzuć wizję lokalną' });
      await shot(`w06-reject-${px}`);
      await dialog.getByRole('button', { name: 'Odrzuć wizję' }).click();
      await expect(dialog.getByText('Wybierz powód odrzucenia.')).toBeVisible();
      await shot(`w06-reject-reason-required-${px}`);
      await dialog.getByRole('radio', { name: 'Oferta odrzucona' }).check();
      await dialog.getByRole('button', { name: 'Odrzuć wizję' }).click();
      await expect(page.getByRole('region', { name: 'Wizja odrzucona' })).toBeVisible();
      await shot(`w06-rejected-admin-${px}`);
      await page.getByRole('button', { name: 'Przywróć wizję…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Przywrócić wizję?' })).toBeVisible();
      await shot(`w06-restore-${px}`);
      await page.keyboard.press('Escape');
      api.role = 'editor';
      await page.reload();
      await expect(page.getByRole('button', { name: 'Przywróć wizję…' })).toHaveAttribute('aria-disabled', 'true');
      await shot(`w06-rejected-editor-${px}`);
    });
  }
});
