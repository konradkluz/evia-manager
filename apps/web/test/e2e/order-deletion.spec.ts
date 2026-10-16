import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

// The deletion and the restore of a whole order in a real browser against the synthetic API (EVM-060 AC1, AC4, AC5, AC6): the menu `⋮`
// of W-06, the confirmation, the order gone for the API (`404`), the view "Usunięte" of W-10 and "Przywróć". The rules of the instalments
// (`409`, the step-up), the audit, the concurrency and the matrix of roles are covered by the API integration tests and the component tests.
test.use({ session: 'active' });

async function createOrder(page: Page): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — montaż ładowarki/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

async function deleteOrder(page: Page) {
  await page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }).click();
  await page.getByRole('menuitem', { name: 'Usuń zlecenie…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Usunąć zlecenie ZL-2026-0042?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
  return dialog;
}

test.describe('deleting and restoring an order (EVM-060)', () => {
  test('EVM-060 AC1 the Administrator deletes the order: W-10, a toast, and the order is "Nie znaleziono zlecenia" afterwards', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    const dialog = await deleteOrder(page);
    await dialog.getByRole('button', { name: 'Usuń zlecenie' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await expect(page.getByText('Usunięto zlecenie ZL-2026-0042. Przywrócisz je w widoku „Usunięte” listy zleceń.')).toBeVisible();
    const sent = api.seen.filter((entry) => entry.method === 'DELETE');
    expect(sent).toHaveLength(1);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia' })).toBeVisible();
  });

  test('EVM-060 AC1 "Anuluj" and Esc close the dialog without a request and the focus returns to the menu button', async ({
    page,
    api,
  }) => {
    await createOrder(page);
    let dialog = await deleteOrder(page);
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' })).toBeFocused();
    dialog = await deleteOrder(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' })).toBeFocused();
    expect(api.seen.filter((entry) => entry.method === 'DELETE')).toHaveLength(0);
  });

  test('EVM-060 AC4 "Usunięte" lists the deleted order and "Przywróć" brings it back for everyone', async ({ page }) => {
    const path = await createOrder(page);
    await (await deleteOrder(page)).getByRole('button', { name: 'Usuń zlecenie' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await page.getByRole('button', { name: 'Usunięte' }).click();
    const table = page.getByRole('table', { name: 'Usunięte zlecenia' });
    await expect(table.getByText('ZL-2026-0042')).toBeVisible();
    await expect(page).toHaveURL(/view=deleted/);
    await page.getByRole('button', { name: 'Przywróć zlecenie ZL-2026-0042' }).click();
    await expect(page.getByText('Przywrócono zlecenie ZL-2026-0042.')).toBeVisible();
    await expect(page.getByText('Brak usuniętych zleceń.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeFocused();
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  });

  test('EVM-060 AC5 the Editor sees "Usuń zlecenie…" disabled with the reason and no view "Usunięte"', async ({ page, api }) => {
    const path = await createOrder(page);
    api.role = 'editor';
    await page.goto(path);
    await page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }).click();
    const item = page.getByRole('menuitem', { name: /Usuń zlecenie…/ });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toContainText('Usunąć zlecenie może tylko administrator.');
    await page.goto('/work-orders');
    await expect(page.getByRole('button', { name: 'Usunięte' })).toHaveCount(0);
    await page.goto('/work-orders?view=deleted');
    await expect(page.getByText('Nie znaleziono widoku.')).toBeVisible();
  });

  test('EVM-060 AC6 Tylko odczyt has no menu of the order and no view "Usunięte"', async ({ page, api }) => {
    const path = await createOrder(page);
    api.role = 'read_only';
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Akcje zlecenia/ })).toHaveCount(0);
    await page.goto('/work-orders');
    await expect(page.getByRole('button', { name: 'Usunięte' })).toHaveCount(0);
  });
});
