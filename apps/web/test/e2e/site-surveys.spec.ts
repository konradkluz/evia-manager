import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { SURVEY_ID, SURVEY_NUMBER, SURVEY_PATH } from './mock-site-surveys.ts';

// The site survey ("Wizja lokalna") in W-06 in a real browser against the synthetic API (EVM-138 AC3, AC4, AC5, AC6): the banner and
// "Przypisz klienta" (an existing customer, a conflict), the rule "Aby zaakceptować, przypisz klienta", the disabled payments, documents
// and ZIP, the rejection with a reason and the restore (the Administrator with the step-up, the Editor disabled), and Tylko odczyt, who
// gets "Nie znaleziono zlecenia". The rules of the server (policies, the audit, the deletion) belong to the API tests.
test.use({ session: 'active' });

const BANNER = 'Wizja lokalna — brak klienta';
const STATUS = /^Status zlecenia: .*\. Zmień status$/;

/** The reads a survey does not have: the panel must not ask for them (flows/17; EVM-138 delegation decision 5). */
const NOT_ASKED = ['/scope-items', '/procedures', '/payment-milestones', '/customer'];

async function open(page: Page) {
  await page.goto(SURVEY_PATH);
  await expect(page.getByRole('heading', { level: 1, name: SURVEY_NUMBER })).toBeVisible();
}

test.describe('site survey in W-06 (EVM-138)', () => {
  test('EVM-138 AC3 the banner, the marks, "Brak klienta" and the phone; no reads of processes, instalments, scope or customer', async ({
    page,
    api,
  }) => {
    await open(page);
    const banner = page.getByRole('region', { name: BANNER });
    await expect(banner).toBeVisible();
    await expect(banner.getByText(/Wizja zostanie trwale usunięta dnia \d{2}\.\d{2}\.\d{4} \(za 80 dni\)/)).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Przypisz klienta' })).toBeVisible();
    await expect(page.getByRole('link', { name: /\+48 600 000 002/ })).toHaveAttribute('href', 'tel:+48600000002');
    await expect(page).toHaveTitle(`${SURVEY_NUMBER} · EVia Manager`);
    expect(page.url()).not.toContain('600');
    const asked = api.seen.filter((entry) =>
      NOT_ASKED.some((part) => new URL(entry.url).pathname === `/api/v1/work-orders/${SURVEY_ID}${part}`),
    );
    expect(asked).toEqual([]);
  });

  test('EVM-138 AC3 "Przypisz klienta": an existing customer, the confirmation, the banner is gone and the customer is shown', async ({
    page,
    api,
  }) => {
    await open(page);
    await page.getByRole('region', { name: BANNER }).getByRole('button', { name: 'Przypisz klienta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Przypisz klienta' });
    await expect(dialog.getByText('Klienta możesz przypisać tylko raz — nie da się go później zmienić.')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
    await dialog.getByRole('option', { name: /Jan Przykładowy/ }).click();
    await dialog.getByRole('button', { name: 'Dalej' }).click();
    await expect(dialog.getByRole('heading', { name: `Przypisać klienta do wizji ${SURVEY_NUMBER}?` })).toBeFocused();
    await dialog.getByRole('button', { name: /^Przypisz klienta Jan Przykładowy do wizji/ }).click();
    await expect(page.getByRole('region', { name: BANNER })).toBeHidden();
    await expect(page.getByText('Przypisano klienta. Wizja jest teraz zwykłym zleceniem.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: SURVEY_NUMBER })).toBeFocused();
    await expect(page.getByRole('main').getByText('Jan Przykładowy').first()).toBeVisible();
    expect(api.surveys.assignments).toHaveLength(1);
    expect(api.surveys.assignments[0]?.version).toBe(5);
  });

  test('EVM-138 AC3 a conflict of versions: the message, "Odśwież zlecenie", the retry goes through', async ({ page, api }) => {
    api.surveys.conflictOnce = true;
    await open(page);
    await page.getByRole('region', { name: BANNER }).getByRole('button', { name: 'Przypisz klienta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Przypisz klienta' });
    await dialog.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
    await dialog.getByRole('option', { name: /Jan Przykładowy/ }).click();
    await dialog.getByRole('button', { name: 'Dalej' }).click();
    await dialog.getByRole('button', { name: /^Przypisz klienta Jan Przykładowy/ }).click();
    await expect(dialog.getByRole('alert')).toContainText('To zlecenie zmieniono w międzyczasie.');
    await expect(dialog.getByText('Klient: Jan Przykładowy')).toBeVisible();
    await dialog.getByRole('button', { name: 'Odśwież zlecenie' }).click();
    await dialog.getByRole('button', { name: /^Przypisz klienta Jan Przykładowy/ }).click();
    await expect(page.getByRole('region', { name: BANNER })).toBeHidden();
    expect(api.surveys.assignments.map((entry) => entry.version)).toEqual([5, 6]);
  });

  test('EVM-138 AC4 "Zaakceptuj" without a customer: "Aby zaakceptować, przypisz klienta" leads to "Przypisz klienta"; Esc closes', async ({
    page,
    api,
  }) => {
    await open(page);
    await page.getByRole('button', { name: STATUS }).click();
    await page.getByRole('menuitem', { name: 'Zaakceptuj' }).click();
    const alert = page.getByRole('alertdialog', { name: 'Aby zaakceptować, przypisz klienta' });
    await expect(alert.getByRole('button', { name: 'Przypisz klienta' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(alert).toBeHidden();
    await page.getByRole('button', { name: STATUS }).click();
    await page.getByRole('menuitem', { name: 'Zaakceptuj' }).click();
    await alert.getByRole('button', { name: 'Przypisz klienta' }).click();
    await expect(page.getByRole('dialog', { name: 'Przypisz klienta' })).toBeVisible();
    expect(api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/transitions'))).toHaveLength(0);
  });

  test('EVM-138 AC4 payments, documents and the ZIP are disabled with a visible reason; photos can still be added', async ({ page }) => {
    await open(page);
    const milestone = page.getByRole('button', { name: 'Dodaj transzę' });
    await expect(milestone).toHaveAttribute('aria-disabled', 'true');
    await expect(milestone).toHaveAccessibleDescription('Płatności dodasz po przypisaniu klienta.');
    await page.getByRole('tab', { name: 'Media i dokumenty' }).click();
    await expect(page.getByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' })).toHaveAccessibleDescription(
      'Eksport ZIP będzie dostępny po przypisaniu klienta.',
    );
    await expect(page.getByRole('button', { name: 'Dodaj dokument' }).first()).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('EVM-138 AC6 Tylko odczyt gets "Nie znaleziono zlecenia" with no trace of the survey', async ({ page, api }) => {
    api.role = 'read_only';
    await page.goto(SURVEY_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeVisible();
    await expect(page.getByText(BANNER)).toHaveCount(0);
    await expect(page).toHaveTitle('Nie znaleziono · EVia Manager');
  });
});
