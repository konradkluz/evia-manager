import { expect, test } from './fixtures.ts';
import { SURVEY_PATH } from './mock-site-surveys.ts';
import { openDocuments, sendOffer } from './survey-offer-support.ts';

// The offer in a site survey in a real browser against the synthetic API (EVM-148 AC1-AC5): the form of an offer with the warning, the
// request that carries only what a survey accepts, the reasons of a refusal and "Dodaj ponownie". The rules of the server belong to the API
// tests (EVM-147). Synthetic data only.
test.use({ session: 'active' });

test.describe('the offer in a site survey (EVM-148)', () => {
  test('EVM-148 AC1 AC2 the form is an offer only: read-only "Przypisz do" and "Rodzaj", the warning, no class or stage', async ({
    page,
  }) => {
    await openDocuments(page);
    await expect(page.getByText('Dokumenty znikną razem z wizją dnia', { exact: false })).toBeVisible();
    const add = page.getByRole('button', { name: 'Dodaj dokument' });
    await expect(add).not.toHaveAttribute('aria-disabled', 'true');
    await add.click();
    const dialog = page.getByRole('dialog', { name: 'Dodaj dokument' });
    await expect(dialog.getByRole('textbox', { name: 'Przypisz do' })).toHaveValue('Zlecenie');
    await expect(dialog.getByRole('textbox', { name: 'Rodzaj' })).toHaveValue('Oferta/wycena');
    await expect(dialog.getByRole('textbox', { name: 'Rodzaj' })).not.toBeEditable();
    await expect(dialog.getByText('Dane osobowe w ofercie')).toBeVisible();
    await expect(dialog.getByText('Nie wpisuj imion, nazwisk, PESEL ani numerów dokumentów.')).toBeVisible();
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    await expect(dialog.getByText('Podnieś klasę')).toHaveCount(0);
    await expect(dialog.getByText('Etap')).toHaveCount(0);
  });

  test('EVM-148 AC2 AC4 AC5 the request is the offer for the order; "customer_required" has its own text, no "Ponów", and "Dodaj ponownie" keeps the fields', async ({
    page,
    api,
  }) => {
    api.surveys.documentRefusal = 'customer_required';
    await openDocuments(page);
    await sendOffer(page);
    const failure = page.getByRole('alert').filter({ hasText: 'Nie dodano dokumentu. Najpierw przypisz klienta do tej wizji.' });
    await expect(failure).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ponów' })).toHaveCount(0);
    expect(api.surveys.documentCreates).toHaveLength(1);
    const body = api.surveys.documentCreates[0] ?? {};
    expect(body).toMatchObject({ kindCode: 'quote', title: 'Oferta testowa' });
    for (const field of ['anchor', 'confidentialityOverride', 'procedureStageId', 'containsIdentityData'])
      expect(body).not.toHaveProperty(field);
    await page.getByRole('button', { name: 'Dodaj ponownie' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dodaj dokument' });
    await expect(dialog.getByRole('textbox', { name: 'Tytuł' })).toHaveValue('Oferta testowa');
    await expect(dialog.getByText(/^oferta-testowa\.pdf/)).toBeVisible();
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  });

  test('EVM-148 AC4 a rejected survey: the button is disabled with the reason, the empty state tells when the documents go', async ({
    page,
    api,
  }) => {
    api.surveys.status = 'cancelled';
    await openDocuments(page);
    const add = page.getByRole('button', { name: 'Dodaj dokument' });
    await expect(add).toHaveAttribute('aria-disabled', 'true');
    await expect(add).toHaveAccessibleDescription('Wizja jest odrzucona — dokumentów nie można już dodawać.');
    await expect(page.getByText(/Wizja jest odrzucona\. Dokumenty zostaną usunięte razem z nią dnia \d{2}\.\d{2}\.\d{4}\./)).toBeVisible();
  });

  test('EVM-148 AC4 "work_order_closed" is told as a read-only survey, without "Ponów"', async ({ page, api }) => {
    api.surveys.documentRefusal = 'work_order_closed';
    await openDocuments(page);
    await sendOffer(page);
    await expect(
      page.getByRole('alert').filter({ hasText: 'Ta wizja jest odrzucona i jest tylko do odczytu — dokumentów nie można już dodawać.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ponów' })).toHaveCount(0);
  });

  test('EVM-148 AC5 a server error offers "Ponów" and keeps the line', async ({ page }) => {
    await openDocuments(page);
    await sendOffer(page);
    await expect(page.getByRole('alert').filter({ hasText: 'Nie udało się wysłać dokumentu. Spróbuj ponownie.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ponów' })).toBeVisible();
  });

  test('EVM-148 K9 Tylko odczyt gets "Nie znaleziono zlecenia", no form', async ({ page, api }) => {
    api.role = 'read_only';
    await page.goto(SURVEY_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dodaj dokument' })).toHaveCount(0);
  });
});
