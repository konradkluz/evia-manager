import { expect, test } from './fixtures.ts';
import { watchPage } from './support.ts';

// W-15 "Urządzenia" and W-17 in the browser (EVM-095 AC1–AC4, AC6): the real panel under the real strict CSP against the synthetic
// API of mock-api.ts. The policy of the real server (roles x channels, IDOR, the state machine, the retention) is covered by the API
// integration tests; W-04 by the component tests (ADR-0015), so the step-up here is already fresh.
test.use({ baseURL: 'http://localhost:4173', session: 'active' });

const ORIGIN = 'http://localhost:4173';

test.describe('W-15 Urządzenia w przeglądarce (EVM-095)', () => {
  test('EVM-095 AC1 AC3 an Editor sees the own phones and logs one out after the confirmation; nothing leaves the origin', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    api.stepUp = 'fresh';
    const problems = await watchPage(page, ORIGIN);
    await page.goto('/account');
    await expect(page.getByRole('heading', { level: 2, name: 'Urządzenia' })).toBeVisible();
    const table = page.getByRole('table', { name: 'Lista moich telefonów' });
    await expect(table.getByText('Samsung SM-G781B · Android 13 · aplikacja 1.0.0')).toBeVisible();
    await expect(table.getByText('Brak kontaktu od 9 dni')).toBeVisible();
    await page.getByRole('button', { name: 'Wyloguj telefon Pixel 7' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Wylogować telefon „Pixel 7”?' });
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Wyloguj telefon' }).click();
    await expect(page.getByText('Wylogowano telefon. Wyloguje się przy najbliższym połączeniu.')).toBeVisible();
    await expect(table.getByText('Wylogowane')).toBeVisible();
    expect(problems.page).toEqual([]);
    expect(problems.console).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
  });

  test('EVM-095 AC1 AC6 the section is hidden for Tylko odczyt', async ({ page, api }) => {
    api.role = 'read_only';
    await page.goto('/account');
    await expect(page.getByRole('heading', { level: 2, name: 'Moje sesje' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Urządzenia' })).toHaveCount(0);
  });
});

test.describe('W-17 Urządzenia użytkowników w przeglądarce (EVM-095)', () => {
  test('EVM-095 AC2 AC4 the Administrator opens the tab, filters, and wipes a phone only after typing its model', async ({ page, api }) => {
    api.stepUp = 'fresh';
    const problems = await watchPage(page, ORIGIN);
    await page.goto('/administration/users');
    await page.getByRole('tab', { name: 'Urządzenia' }).click();
    const table = page.getByRole('table', { name: 'Urządzenia użytkowników' });
    await expect(table.getByText('Moto G')).toBeVisible();
    await expect(table.getByText('Czeka na wyczyszczenie')).toBeVisible();
    await expect(page.getByText('3 urządzenia')).toBeVisible();
    await page.getByLabel('Stan').selectOption('wipe_required');
    await expect(table.getByText('Samsung SM-G781B')).toHaveCount(0);
    await page.getByLabel('Stan').selectOption('');
    await page.getByRole('button', { name: 'Akcje dla Pixel 7, Anna Testowa' }).click();
    await page.getByRole('menuitem', { name: 'Zablokuj i wyczyść…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Zablokować i wyczyścić „Pixel 7”?' });
    await expect(dialog.getByText('Ostatnio zgłoszona liczba niewysłanych elementów na tym telefonie: 4.')).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Zablokuj i wyczyść' });
    await expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await dialog.getByLabel('Wpisz „Pixel 7”, aby potwierdzić').fill('Pixel 7');
    await confirm.click();
    await expect(page.getByText(/Zlecono zablokowanie i wyczyszczenie urządzenia/)).toBeVisible();
    await expect(table.getByText('Czeka na wyczyszczenie')).toHaveCount(2);
    expect(problems.page).toEqual([]);
    expect(problems.console).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
  });

  test('EVM-095 AC2 AC6 an Editor gets "Brak dostępu" and no tab', async ({ page, api }) => {
    api.role = 'editor';
    await page.goto('/administration/devices');
    await expect(page.getByText('Nie masz dostępu do administracji.')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Urządzenia' })).toHaveCount(0);
  });
});
