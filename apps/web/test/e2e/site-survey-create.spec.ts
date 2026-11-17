import { expect, test } from './fixtures.ts';
import { SURVEY_NUMBER } from './mock-site-surveys.ts';

// W-05 "Wizja lokalna" in a real browser against the synthetic API (EVM-138 AC2): the choice "Rodzaj" (only with the function on), the light
// form, the keyboard, "Załóż wizję lokalną" and the way to W-06, the neutral 404 and the phone, which stays out of the address and the storage.
// The rules of the server (the audit, the limit, the real validation) belong to the API tests.
test.use({ session: 'active' });

const SURVEY_FORM = 'Załóż wizję lokalną';

test.describe('creating a site survey in W-05 (EVM-138 AC2)', () => {
  test('EVM-138 AC2 the function off: no choice "Rodzaj", only the form of an order (also for ?rodzaj=wizja)', async ({ page }) => {
    await page.goto('/work-orders/new?rodzaj=wizja');
    await expect(page.getByRole('heading', { level: 1, name: 'Nowe zlecenie' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Rodzaj' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Utwórz zlecenie' })).toBeVisible();
    await expect(page.getByRole('button', { name: SURVEY_FORM })).toHaveCount(0);
  });

  test('EVM-138 AC2 the choice by the keyboard, the light form, the phone and the keeper, "Załóż wizję lokalną" opens W-06 with the number and the toast', async ({
    page,
    api,
  }) => {
    api.siteSurveysOn = true;
    await page.goto('/work-orders/new');
    const order = page.getByRole('radio', { name: /^Zlecenie z szablonu/ });
    await expect(order).toBeChecked();
    await order.focus();
    await page.keyboard.press('ArrowDown');
    const survey = page.getByRole('radio', { name: /^Wizja lokalna/ });
    await expect(survey).toBeChecked();
    await expect(survey).toBeFocused();
    await expect(page).toHaveURL(/\/work-orders\/new\?rodzaj=wizja$/);
    await expect(page.getByRole('combobox', { name: 'Klient' })).toHaveCount(0);

    await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
    await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
    await page.getByRole('textbox', { name: 'Telefon zamawiającego (opcjonalnie)' }).fill('600 123 456');
    await expect(page.getByText('Tylko numer — nie wpisuj imion w opisach.')).toBeVisible();
    await page.getByRole('combobox', { name: 'Opiekun' }).selectOption({ label: 'Bez opiekuna' });
    await expect(page.getByText('Bez opiekuna wizja nie będzie widoczna na żadnym telefonie.')).toBeVisible();
    // the address never carries a value of the form
    expect(page.url()).not.toContain('600');
    expect(page.url()).not.toContain('testowa');
    await page.getByRole('button', { name: SURVEY_FORM }).click();

    await expect(page.getByRole('heading', { level: 1, name: SURVEY_NUMBER })).toBeVisible();
    await expect(page.getByText(`Utworzono wizję lokalną ${SURVEY_NUMBER}.`)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Wizja lokalna — brak klienta' })).toBeVisible();
    expect(api.surveys.creations).toHaveLength(1);
    const sent = api.surveys.creations[0];
    expect(sent?.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sent?.body['requesterPhone']).toBe('600 123 456');
    expect(sent?.body).not.toHaveProperty('assigneeUserId');
    expect(sent?.body).not.toHaveProperty('customerId');
    // the phone is in the memory of the form only: no storage of the browser holds it
    const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    expect(stored).not.toContain('600');
  });

  test('EVM-138 AC2 the validation: no site and a wrong phone — the summary has the focus and nothing is sent', async ({ page, api }) => {
    api.siteSurveysOn = true;
    await page.goto('/work-orders/new?rodzaj=wizja');
    await page.getByRole('textbox', { name: 'Telefon zamawiającego (opcjonalnie)' }).fill('abc');
    await page.getByRole('button', { name: SURVEY_FORM }).click();
    const summary = page.getByText('Popraw te pola, aby założyć wizję lokalną').locator('xpath=ancestor::*[@role="alert"][1]');
    await expect(summary).toBeFocused();
    await expect(summary.getByText('Podaj adres lokalizacji.')).toBeVisible();
    await expect(summary.getByText('Podaj numer telefonu, np. 600 123 456.')).toBeVisible();
    expect(api.surveys.creations).toHaveLength(0);
  });

  test('EVM-138 AC2 404 (the function was switched off meanwhile): one neutral message, the choice goes and the form of an order stays', async ({
    page,
    api,
  }) => {
    api.siteSurveysOn = true;
    await page.goto('/work-orders/new?rodzaj=wizja');
    await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
    await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
    api.siteSurveysOn = false;
    await page.getByRole('button', { name: SURVEY_FORM }).click();
    await expect(page.getByText(/lokalizacja jest niedostępna albo wizje lokalne są teraz wyłączone/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Utwórz zlecenie' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Rodzaj' })).toHaveCount(0);
  });

  test('EVM-138 AC2 a lost answer: "Spróbuj ponownie — nie założymy jej dwa razy" and the retry keeps the key', async ({ page, api }) => {
    api.siteSurveysOn = true;
    await page.goto('/work-orders/new?rodzaj=wizja');
    await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
    await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
    api.failNext.set('POST /api/v1/site-surveys', { status: 503, code: 'unavailable', headers: {} });
    await page.getByRole('button', { name: SURVEY_FORM }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: /Nie udało się założyć wizji\. Spróbuj ponownie — nie założymy jej dwa razy\./ }),
    ).toBeFocused();
    await page.getByRole('button', { name: SURVEY_FORM }).click();
    await expect(page.getByRole('heading', { level: 1, name: SURVEY_NUMBER })).toBeVisible();
    expect(api.surveys.creations).toHaveLength(1);
  });

  test('EVM-138 AC2 Tylko odczyt: "Nie możesz tworzyć zleceń." and no choice', async ({ page, api }) => {
    api.siteSurveysOn = true;
    api.role = 'read_only';
    await page.goto('/work-orders/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Nie możesz tworzyć zleceń.' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Rodzaj' })).toHaveCount(0);
  });
});
