import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { deadlineIn, SURVEY_ID, SURVEY_NUMBER, SURVEY_PATH } from './mock-site-surveys.ts';

// The site survey ("Wizja lokalna") in W-06 in a real browser against the synthetic API (EVM-138 AC3, AC4, AC5, AC6): the banner and
// "Przypisz klienta" (an existing customer, a conflict), the rule "Aby zaakceptować, przypisz klienta", the disabled payments, documents
// and ZIP, the rejection with a reason and the restore (the Administrator with the step-up, the Editor disabled), and Tylko odczyt, who
// gets "Nie znaleziono zlecenia". The rules of the server (policies, the audit, the deletion) belong to the API tests.
test.use({ session: 'active' });

const BANNER = 'Wizja lokalna — brak klienta';
const STATUS = /^Status zlecenia: .*\. Zmień status$/;

/** The one read a survey has no answer for (`404`): the card of the customer. The empty reads of the processes, the scope and the instalments are ignored. */
const NOT_ASKED = ['/customer'];

async function open(page: Page) {
  await page.goto(SURVEY_PATH);
  await expect(page.getByRole('heading', { level: 1, name: SURVEY_NUMBER })).toBeVisible();
}

test.describe('site survey in W-06 (EVM-138)', () => {
  test('EVM-138 AC3 the banner, the marks, "Brak klienta" and the phone; no read of the card of the customer', async ({ page, api }) => {
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

  test('EVM-138 AC4 payments, and the ZIP are disabled with a visible reason; photos and (EVM-148) documents can be added', async ({
    page,
  }) => {
    await open(page);
    const milestone = page.getByRole('button', { name: 'Dodaj transzę' });
    await expect(milestone).toHaveAttribute('aria-disabled', 'true');
    await expect(milestone).toHaveAccessibleDescription('Płatności dodasz po przypisaniu klienta.');
    await page.getByRole('tab', { name: 'Media i dokumenty' }).click();
    await expect(page.getByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' })).toHaveAccessibleDescription(
      'Eksport ZIP będzie dostępny po przypisaniu klienta.',
    );
    await expect(page.getByRole('button', { name: 'Dodaj dokument' }).first()).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('EVM-138 AC6 Tylko odczyt gets "Nie znaleziono zlecenia" with no trace of the survey', async ({ page, api }) => {
    api.role = 'read_only';
    await page.goto(SURVEY_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeVisible();
    await expect(page.getByText(BANNER)).toHaveCount(0);
    await expect(page).toHaveTitle('Nie znaleziono · EVia Manager');
  });

  test('EVM-138 AC5 "Odrzuć wizję…": a reason is required, then "Anulowane" with "Odrzucona", the date of the removal, the focus on the banner', async ({
    page,
    api,
  }) => {
    await open(page);
    await page.getByRole('region', { name: BANNER }).getByRole('button', { name: 'Odrzuć wizję…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Odrzuć wizję lokalną' });
    await expect(dialog.getByText(/Wizja zostanie trwale usunięta po 14 dniach/)).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Oferta odrzucona' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Odrzuć wizję' }).click();
    await expect(dialog.getByText('Wybierz powód odrzucenia.')).toBeVisible();
    await dialog.getByRole('radio', { name: 'Oferta odrzucona' }).check();
    await dialog.getByRole('button', { name: 'Odrzuć wizję' }).click();
    const banner = page.getByRole('region', { name: 'Wizja odrzucona' });
    await expect(banner).toBeVisible();
    await expect(banner.getByText(/Wizja zostanie trwale usunięta dnia \d{2}\.\d{2}\.\d{4} \(za 14 dni\)/)).toBeVisible();
    await expect(page.getByText(/Odrzucono wizję\. Zostanie usunięta dnia \d{2}\.\d{2}\.\d{4}\./)).toBeVisible();
    await expect(page.getByRole('main').getByText('Anulowane')).toBeVisible();
    await expect(page.getByRole('main').getByText('Odrzucona', { exact: true })).toBeVisible();
    await expect(banner.getByText('Wizja odrzucona', { exact: true })).toBeFocused();
    expect(api.surveys.rejections).toEqual(['offer_rejected']);
    await expect(page.getByRole('button', { name: 'Przypisz klienta' })).toHaveCount(0);
  });

  test('EVM-138 AC5 the Administrator restores a rejected survey with the step-up window open; the open banner returns', async ({
    page,
    api,
  }) => {
    api.surveys.status = 'cancelled';
    api.surveys.version = 6;
    api.surveys.expiresAt = deadlineIn(14);
    api.stepUp = 'fresh';
    await open(page);
    await page.getByRole('region', { name: 'Wizja odrzucona' }).getByRole('button', { name: 'Przywróć wizję…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Przywrócić wizję?' });
    await expect(dialog.getByText(/Wizja wróci do statusu „Wstrzymane”/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Przywróć wizję' }).click();
    await expect(page.getByRole('region', { name: BANNER })).toBeVisible();
    await expect(page.getByText(/Przywrócono wizję\. Termin usunięcia: \d{2}\.\d{2}\.\d{4}\./)).toBeVisible();
    await expect(page.getByRole('main').getByText('Wstrzymane')).toBeVisible();
  });

  test('EVM-138 AC5 the Editor sees "Przywróć wizję…" disabled with a reason and cannot restore', async ({ page, api }) => {
    api.role = 'editor';
    api.surveys.status = 'cancelled';
    api.surveys.version = 6;
    api.surveys.expiresAt = deadlineIn(14);
    await open(page);
    const button = page.getByRole('button', { name: 'Przywróć wizję…' });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAccessibleDescription('Przywrócić wizję może tylko administrator.');
    // a disabled button stays focusable but does nothing (Playwright would wait for it to be enabled)
    await button.click({ force: true });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});

// EVM-140 AC6: "Przedłuż o 90 dni" — roles and keyboard through the whole stack of the browser (the rules of the server belong to the API tests).
test.describe('site survey: "Przedłuż o 90 dni" (EVM-140)', () => {
  const EXTEND = 'Przedłuż o 90 dni';

  test('EVM-140 AC6 the Administrator extends with the keyboard: the reason is required, Esc returns the focus, two extensions disable the action with the hint', async ({
    page,
    api,
  }) => {
    await open(page);
    const banner = page.getByRole('region', { name: BANNER });
    const action = banner.getByRole('button', { name: EXTEND });
    await action.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog', { name: 'Przedłuż wizję o 90 dni' });
    await expect(dialog.getByText('To przedłużenie 1 z 2 — po drugim nie przedłużysz wizji ponownie.')).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Czeka na decyzję klienta' })).toBeFocused();
    // Esc closes without a request and the focus returns to the button that opened the dialog
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(action).toBeFocused();
    expect(api.surveys.extensions).toHaveLength(0);

    // the first extension: no reason -> a message; ArrowDown chooses the second reason; Enter on the button sends it
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: EXTEND }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Wybierz powód przedłużenia.')).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Czeka na decyzję klienta' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(dialog.getByRole('radio', { name: 'Czeka na uchwałę wspólnoty lub zarządcy' })).toBeChecked();
    await dialog.getByRole('button', { name: EXTEND }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Przedłużono wizję do \d{2}\.\d{2}\.\d{4}\./)).toBeVisible();
    await expect(banner.getByText(/Wizja zostanie trwale usunięta dnia \d{2}\.\d{2}\.\d{4} \(za 170 dni\)/)).toBeVisible();
    await expect(banner.getByText(/Przedłużono 1 z 2 razy\./)).toBeVisible();
    await expect(banner.getByText(BANNER, { exact: true })).toBeFocused();
    expect(api.surveys.extensions).toEqual([{ reason: 'awaiting_community_decision', version: 5 }]);

    // the second one is the last: the dialog says so; afterwards the action is disabled and described by the hint
    await action.click();
    await expect(dialog.getByText('To ostatnie przedłużenie — potem zostaje przypisanie klienta albo odrzucenie wizji.')).toBeVisible();
    await dialog.getByRole('radio', { name: 'Wymaga drugiej wizyty' }).check();
    await dialog.getByRole('button', { name: EXTEND }).click();
    await expect(banner.getByText(/Przedłużono 2 z 2 razy\./)).toBeVisible();
    await expect(action).toHaveAttribute('aria-disabled', 'true');
    await expect(action).toHaveAccessibleDescription('Przypisz klienta albo odrzuć wizję.');
    await action.click({ force: true });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(api.surveys.extensions.map((entry) => entry.version)).toEqual([5, 6]);
  });

  test('EVM-140 AC6 the Editor sees the action too; a lost race ends with a message and a refreshed banner', async ({ page, api }) => {
    api.role = 'editor';
    api.surveys.extensionCount = 2;
    await open(page);
    // the page opened with the counter 2 and the action is disabled ...
    const action = page.getByRole('region', { name: BANNER }).getByRole('button', { name: EXTEND });
    await expect(action).toHaveAttribute('aria-disabled', 'true');
    // ... and the same survey, before the counter was read, answers `409 extension_limit_reached`
    api.surveys.extensionCount = 1;
    await page.reload();
    await expect(action).not.toHaveAttribute('aria-disabled', 'true');
    api.surveys.extensionCount = 2;
    await action.click();
    const dialog = page.getByRole('alertdialog', { name: 'Przedłuż wizję o 90 dni' });
    await dialog.getByRole('radio', { name: 'Wymaga drugiej wizyty' }).check();
    await dialog.getByRole('button', { name: EXTEND }).click();
    await expect(dialog.getByRole('alert')).toContainText('Ta wizja była już dwukrotnie przedłużona. Przypisz klienta albo odrzuć wizję.');
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(action).toHaveAttribute('aria-disabled', 'true');
  });
});
