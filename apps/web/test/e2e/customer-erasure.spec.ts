import { expect, test } from './fixtures.ts';

// Delete, restore and anonymize a customer in a real browser against the synthetic API (EVM-041 AC1, AC2, AC3, AC4, AC7, AC8):
// the soft delete with "Cofnij" and the banner, the filter "Usunięci", the restore, the dialog of the anonymization (the tick, the
// neutral data, no `tel:` link), the open orders (409 with the count) and the roles. The step-up (W-04) is covered by the unit tests
// (`stepUp: 'fresh'` here). The full stack (the register, the triggers, the audit, the role matrix) is covered by the API integration tests.
test.use({ session: 'active' });

const JAN_ID = '01968f3e-0000-7000-8000-00000000aaa1';
const JAN_PATH = `/customers/${JAN_ID}`;

const customerAt = <T>(list: readonly T[], index: number): T => {
  const found = list[index];
  if (found === undefined) throw new Error('no such customer');
  return found;
};

test.describe('delete, restore and anonymize a customer (EVM-041)', () => {
  test('EVM-041 AC1 AC3 "Usuń klienta" shows the banner, "Cofnij" restores, the filter "Usunięci" lists the deleted one', async ({
    page,
  }) => {
    await page.goto(JAN_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeVisible();
    await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
    await page.getByRole('menuitem', { name: 'Usuń klienta' }).click();
    await expect(page.getByText('Usunięto klienta. Widzi go tylko administrator.')).toBeVisible();
    await expect(page.getByText('Klient jest usunięty — widzi go tylko administrator.')).toBeVisible();

    // the full list no longer has the customer, the filter does
    await page.goto('/customers');
    await expect(page.getByRole('table', { name: 'Klienci' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Przykładowy Jan/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Usunięci' }).click();
    const row = page.getByRole('link', { name: /Przykładowy Jan.*usunięty/ });
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole('button', { name: 'Przywróć klienta' }).click();
    await expect(page.getByText('Przywrócono klienta. Widzą go wszystkie role.')).toBeVisible();
    await expect(page.getByText('Klient jest usunięty — widzi go tylko administrator.')).toHaveCount(0);
  });

  test('EVM-041 AC1 the Editor gets "Nie znaleziono klienta." for a deleted customer and the operations are off with the hint', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    await page.goto(JAN_PATH);
    await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
    await expect(page.getByRole('menuitem', { name: /^Usuń klienta/ })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Usunąć klienta może tylko administrator.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Usunięci' })).toHaveCount(0);

    customerAt(api.customers, 0).deleted = true;
    await page.goto(JAN_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono klienta.' })).toBeVisible();
  });

  test('EVM-041 AC2 a customer with an open order cannot be deleted: the alert has the count', async ({ page, api }) => {
    customerAt(api.customers, 0).openWorkOrders = 1;
    await page.goto(JAN_PATH);
    await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
    await page.getByRole('menuitem', { name: 'Usuń klienta' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'Nie usunięto klienta — ma niezamknięte zlecenia (1). Usuniesz go, gdy wszystkie będą rozliczone albo anulowane.',
    );
    await expect(page.getByText('Usunięto klienta.')).toHaveCount(0);
  });

  test('EVM-041 AC4 the anonymization needs the tick and leaves neutral data without a telephone link', async ({ page, api }) => {
    api.stepUp = 'fresh';
    await page.goto(JAN_PATH);
    await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
    await page.getByRole('menuitem', { name: 'Anonimizuj klienta…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Zanonimizować klienta „Jan Przykładowy”?' });
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Anonimizuj klienta' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Potwierdź, że rozumiesz skutek operacji.');
    await dialog.getByRole('checkbox', { name: 'Rozumiem, że tej operacji nie można cofnąć.' }).check();
    await dialog.getByRole('button', { name: 'Anonimizuj klienta' }).click();

    await expect(page.getByText('Zanonimizowano klienta.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Klient zanonimizowany' })).toBeVisible();
    const data = page.getByRole('region', { name: 'Dane klienta' });
    await expect(data.getByRole('link')).toHaveCount(0);
    await expect(page.getByText('jan.przykladowy@example.com')).toHaveCount(0);
    // the search no longer finds the old name
    await page.goto('/customers');
    await page.getByRole('searchbox', { name: 'Szukaj klientów' }).fill('Przykładowy');
    await expect(page.getByRole('heading', { level: 2, name: 'Brak klientów spełniających kryteria.' })).toBeVisible();
  });

  test('EVM-041 AC7 Tylko odczyt has no menu and no filter', async ({ page, api }) => {
    api.role = 'read_only';
    await page.goto(JAN_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Akcje klienta/ })).toHaveCount(0);
    await page.goto('/customers');
    await expect(page.getByRole('table', { name: 'Klienci' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Usunięci' })).toHaveCount(0);
  });
});
