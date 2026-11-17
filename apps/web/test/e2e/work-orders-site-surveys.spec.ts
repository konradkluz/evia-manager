import type { MockApi } from './mock-api.ts';
import { expect, test } from './fixtures.ts';
import { surveyListRow } from './mock-site-surveys.ts';

// W-10 and the site surveys in a real browser against the synthetic API (EVM-138 AC1, AC6): the marks, "Brak klienta", the deadline with an
// icon and text, the filters "Wizje lokalne", the view "Wygasające wizje (n)", the sort "Termin wygaśnięcia", the roles. The deadlines are
// counted from today (the rows are made for "N days from now"). The rules of the server (the filters, the policies) belong to the API tests.
test.use({ session: 'active' });

/** 12 days (a warning), 80 days, 15 days (the boundary), 16 days (out of the view), a rejected one with 9 days to the deletion. */
const SOON = 12;
function withSurveys(api: MockApi) {
  api.siteSurveysOn = true;
  api.surveyRows = [
    surveyListRow(2049, 80),
    surveyListRow(2050, SOON),
    surveyListRow(2051, 15),
    surveyListRow(2052, 16),
    surveyListRow(2047, 9, true),
  ];
}
const link = (page: import('@playwright/test').Page, number: string) => page.getByRole('link', { name: new RegExp(number) });

test.describe('site surveys in W-10 (EVM-138)', () => {
  test('EVM-138 AC1 the rows: the mark, "Brak klienta", the deadline with an icon and text, "Odrzucona" with "Usunięcie za 9 dni" — and no address', async ({
    page,
    api,
  }) => {
    withSurveys(api);
    await page.goto('/work-orders');
    await expect(link(page, 'ZL-2026-2050')).toBeVisible();
    const soon = page.getByRole('row').filter({ has: link(page, 'ZL-2026-2050') });
    await expect(soon.getByText('Wygasa za 12 dni', { exact: true })).toBeVisible();
    await expect(soon.getByText('Brak klienta').locator('visible=true').first()).toBeVisible();
    await expect(soon.locator('svg.lucide-binoculars')).toBeVisible();
    await expect(soon.locator('svg.lucide-triangle-alert')).toBeVisible();
    expect(await link(page, 'ZL-2026-2050').getAttribute('aria-label')).toMatch(
      /^ZL-2026-2050, Wizja lokalna, brak klienta, status: Wycena, .*wygasa za 12 dni, dnia \d{2}\.\d{2}\.\d{4} — wymaga decyzji$/,
    );
    const rejected = page.getByRole('row').filter({ has: link(page, 'ZL-2026-2047') });
    await expect(rejected.getByText('Odrzucona')).toBeVisible();
    await expect(rejected.getByText('Usunięcie za 9 dni', { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('row')
        .filter({ has: link(page, 'ZL-2026-2049') })
        .getByText('Wygasa za 80 dni', { exact: true }),
    ).toBeVisible();
    // the phone of the requester is in the data of the list, never on the screen or in the address
    await expect(page.getByText(/600 000 002|\+48/)).toHaveCount(0);
    expect(page.url()).not.toContain('600');
  });

  test('EVM-138 AC1 "Tylko wizje" and "Bez wizji" (the radio group, the arrows), the address carries siteSurvey, "Usuń filtr" clears it', async ({
    page,
    api,
  }) => {
    withSurveys(api);
    await page.goto('/work-orders');
    const group = page.getByRole('group', { name: 'Wizje lokalne' });
    await expect(group).toBeVisible();
    await group.getByRole('radio', { name: 'Wszystkie zlecenia' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(group.getByRole('radio', { name: 'Tylko wizje' })).toBeChecked();
    await expect(page).toHaveURL(/siteSurvey=only/);
    await expect(link(page, 'ZL-2026-2049')).toBeVisible();
    await expect(page.getByRole('link', { name: /Garaż|ZL-2026-0001/ })).toHaveCount(0);
    await group.getByRole('radio', { name: 'Bez wizji' }).check();
    await expect(page).toHaveURL(/siteSurvey=exclude/);
    await expect(link(page, 'ZL-2026-2049')).toHaveCount(0);
    await page.getByRole('button', { name: 'Usuń filtr Bez wizji' }).click();
    await expect(page).not.toHaveURL(/siteSurvey/);
    await expect(link(page, 'ZL-2026-2049')).toBeVisible();
  });

  test('EVM-138 AC1 "Termin wygaśnięcia" is in "Sortuj" only with "Tylko wizje" and puts the soonest first', async ({ page, api }) => {
    withSurveys(api);
    await page.goto('/work-orders');
    const sort = page.getByRole('combobox', { name: 'Sortuj' });
    await expect(sort.locator('option', { hasText: 'Termin wygaśnięcia' })).toHaveCount(0);
    await page.getByRole('group', { name: 'Wizje lokalne' }).getByRole('radio', { name: 'Tylko wizje' }).check();
    await sort.selectOption({ label: 'Termin wygaśnięcia' });
    const first = page.getByRole('table', { name: 'Lista zleceń' }).getByRole('link').first();
    await expect(first).toHaveAttribute('aria-label', /^ZL-2026-2047, /);
  });

  test('EVM-138 AC1 "Wygasające wizje (2)": the surveys of 15 days or fewer, not the rejected, with "2 wizje do rozstrzygnięcia" and the polite line', async ({
    page,
    api,
  }) => {
    withSurveys(api);
    await page.goto('/work-orders');
    const chip = page.getByRole('button', { name: 'Wygasające wizje (2)' });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page).toHaveURL(/view=expiring_site_surveys/);
    await expect(page.getByText('2 wizje do rozstrzygnięcia — wygasają w ciągu 15 dni')).toHaveAttribute('aria-live', 'polite');
    await expect(link(page, 'ZL-2026-2050')).toBeVisible();
    await expect(link(page, 'ZL-2026-2051')).toBeVisible();
    await expect(link(page, 'ZL-2026-2052')).toHaveCount(0);
    await expect(link(page, 'ZL-2026-2047')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Sortuj' })).toHaveValue('siteSurveyExpiresAt');
    await page.getByRole('button', { name: 'Usuń filtr Wygasają w ciągu 15 dni' }).click();
    await expect(page).not.toHaveURL(/view=expiring/);
  });

  test('EVM-138 AC1 no survey of 15 days or fewer: "Żadna wizja nie wygasa w ciągu 15 dni." and "Pokaż wszystkie wizje"', async ({
    page,
    api,
  }) => {
    api.siteSurveysOn = true;
    api.surveyRows = [surveyListRow(2049, 80)];
    await page.goto('/work-orders?view=expiring_site_surveys');
    await expect(page.getByRole('heading', { name: 'Żadna wizja nie wygasa w ciągu 15 dni.' })).toBeVisible();
    await page.getByRole('button', { name: 'Pokaż wszystkie wizje' }).click();
    await expect(link(page, 'ZL-2026-2049')).toBeVisible();
  });

  test('EVM-138 AC1 "Tylko wizje" without a survey: "Brak wizji lokalnych." and "Nowa wizja lokalna" leads to the form of a survey', async ({
    page,
    api,
  }) => {
    api.siteSurveysOn = true;
    await page.goto('/work-orders?siteSurvey=only');
    await expect(page.getByRole('heading', { name: 'Brak wizji lokalnych.' })).toBeVisible();
    await page.getByRole('button', { name: 'Nowa wizja lokalna' }).click();
    await expect(page).toHaveURL(/\/work-orders\/new\?rodzaj=wizja$/);
    await expect(page.getByRole('button', { name: 'Załóż wizję lokalną' })).toBeVisible();
  });

  test('EVM-138 AC1 the list of surveys fails: the alert of the list with "Spróbuj ponownie"', async ({ page, api }) => {
    withSurveys(api);
    await page.goto('/work-orders');
    await expect(link(page, 'ZL-2026-2049')).toBeVisible();
    api.failNext.set('GET /api/v1/work-orders', { status: 500, code: 'internal_error' });
    await page.getByRole('group', { name: 'Wizje lokalne' }).getByRole('radio', { name: 'Tylko wizje' }).check();
    await expect(page.getByRole('heading', { name: 'Nie udało się wczytać zleceń.' })).toBeVisible();
    await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(link(page, 'ZL-2026-2049')).toBeVisible();
  });

  test('EVM-138 AC6 Tylko odczyt: no group, no view, no survey in the list and no siteSurvey in any request — even from the address', async ({
    page,
    api,
  }) => {
    withSurveys(api);
    api.role = 'read_only';
    api.workOrders = 3;
    await page.goto('/work-orders?siteSurvey=only');
    await expect(page.getByRole('table', { name: 'Lista zleceń' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Wizje lokalne' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Wygasające wizje/ })).toHaveCount(0);
    await expect(link(page, 'ZL-2026-2049')).toHaveCount(0);
    expect(api.seen.filter((entry) => entry.url.includes('siteSurvey'))).toEqual([]);
    await page.goto('/work-orders?view=expiring_site_surveys');
    await expect(page.getByRole('heading', { name: 'Nie znaleziono widoku.' })).toBeVisible();
    await page.goto('/work-orders/01968f3e-0000-7000-8000-00000000d049');
    await expect(page).toHaveTitle('Nie znaleziono · EVia Manager');
  });

  test('EVM-138 AC6 the function off and no survey in the list: neither the group nor the view', async ({ page, api }) => {
    api.workOrders = 3;
    await page.goto('/work-orders');
    await expect(page.getByRole('table', { name: 'Lista zleceń' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Wizje lokalne' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Wygasające wizje/ })).toHaveCount(0);
    expect(api.seen.filter((entry) => entry.url.includes('siteSurvey'))).toEqual([]);
  });
});
