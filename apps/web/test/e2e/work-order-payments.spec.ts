import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';

// "Płatności" in W-06 in a real browser against the synthetic API (EVM-053 AC1–AC8): the instalments of the plan of the template,
// "Zmień kwotę", "Dodaj transzę", settling and cancelling an order with instalments, a closed order, the role and the states. The full
// stack (the database, the transaction of the order with its instalments, the audit with the amounts, the role and channel matrix,
// the concurrency) is covered by the API integration tests.
test.use({ session: 'active' });

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Creates the order ZL-2026-0042 through W-05 and returns its address (the full template brings the plan 20/30/30/20). */
async function createOrder(page: Page, template: RegExp | string = /Garaż — pełny proces/): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: template }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

/** Puts the created order into a status on the synthetic server (the walk through the menu is EVM-030's) and reloads the page. */
async function setStatus(page: Page, api: MockApi, path: string, status: string) {
  const id = path.split('/').at(-1) ?? '';
  api.orders.states.set(id, { status, version: 7 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
}

const section = (page: Page) => page.getByRole('region', { name: 'Płatności', exact: true });
const sent = (api: MockApi, method: string) =>
  api.seen.filter((entry) => entry.method === method && entry.url.includes('/payment-milestones'));

test.describe('payments of a work order (EVM-053)', () => {
  test('EVM-053 AC1 AC2 a new order has the four planned instalments of the template, with shares, no amounts and the totals', async ({
    page,
  }) => {
    await createOrder(page);
    const payments = section(page);
    await expect(payments.getByRole('table', { name: 'Transze płatności zlecenia' })).toBeVisible();
    await expect(payments.getByText('Nieopłacone 0,00 zł · Opłacone 0,00 zł')).toBeVisible();
    for (const name of ['Zaliczka (20%)', 'Po uzyskaniu zgód (30%)', 'Po wykonaniu instalacji (30%)', 'Płatność końcowa (20%)']) {
      await expect(payments.getByRole('cell', { name, exact: true })).toBeVisible();
    }
    await expect(payments.getByText('Planowana', { exact: true })).toHaveCount(4);
  });

  test('EVM-053 AC3 "Zmień kwotę…" saves 3 600,00 zł in grosze with If-Match; the row and a toast show it', async ({ page, api }) => {
    await createOrder(page);
    await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
    await page.getByRole('menuitem', { name: 'Zmień kwotę…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zmień kwotę transzy' });
    await expect(dialog.getByText('Udział z planu: 20% (tylko informacyjnie)')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Kwota' })).toBeFocused();
    await dialog.getByRole('textbox', { name: 'Kwota' }).fill('3600');
    await dialog.getByRole('button', { name: 'Zapisz kwotę' }).click();
    await expect(page.getByText('Zmieniono kwotę transzy „Zaliczka”: 3 600,00 zł.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Zaliczka \(20%\)/ }).getByText('3 600,00 zł')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' })).toBeFocused();
    const [patch] = sent(api, 'PATCH');
    expect(JSON.parse(patch?.postData ?? '{}')).toEqual({ amount: { amountMinor: 360000, currency: 'PLN' } });
    expect(patch?.headers['if-match']).toBe('"1"');
  });

  test('EVM-053 AC4 "Dodaj transzę" puts the new planned instalment at the end, with a UUIDv7 and an Idempotency-Key', async ({
    page,
    api,
  }) => {
    await createOrder(page);
    await section(page).getByRole('button', { name: 'Dodaj transzę' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dodaj transzę' });
    await expect(dialog.getByRole('textbox', { name: 'Nazwa transzy' })).toBeFocused();
    await dialog.getByRole('textbox', { name: 'Nazwa transzy' }).fill('Dopłata za instalację zasilającą');
    await dialog.getByRole('textbox', { name: 'Kwota (opcjonalnie)' }).fill('1500');
    await dialog.getByRole('textbox', { name: 'Kwota (opcjonalnie)' }).blur();
    await expect(dialog.getByRole('textbox', { name: 'Kwota (opcjonalnie)' })).toHaveValue(/^1\s500,00$/);
    await dialog.getByRole('button', { name: 'Dodaj transzę' }).click();
    await expect(page.getByText('Dodano transzę „Dopłata za instalację zasilającą”.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Akcje transzy: Dopłata za instalację zasilającą' })).toBeFocused();
    const rows = section(page).getByRole('row');
    await expect(rows).toHaveCount(6);
    await expect(rows.last()).toContainText('Dopłata za instalację zasilającą1 500,00 złPlanowana');
    const [post] = sent(api, 'POST');
    const body = JSON.parse(post?.postData ?? '{}') as { id: string };
    expect(body.id).toMatch(UUIDV7);
    expect(post?.headers['idempotency-key']).toMatch(UUIDV7);
  });

  test('EVM-053 AC6 settling with a planned instalment is refused with the reason; cancelling warns and cancels the planned ones', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    await setStatus(page, api, path, 'completed');
    await page.getByRole('button', { name: 'Status zlecenia: Zakończone. Zmień status' }).click();
    await page.getByRole('menuitem', { name: 'Rozlicz…' }).click();
    const settle = page.getByRole('alertdialog');
    await settle.getByRole('button', { name: 'Rozlicz zlecenie' }).click();
    await expect(settle.getByRole('alert')).toHaveText('Rozliczysz, gdy wszystkie transze będą opłacone albo anulowane.');
    await settle.getByRole('button', { name: 'Anuluj' }).click();

    await setStatus(page, api, path, 'on_hold');
    await page.getByRole('button', { name: 'Status zlecenia: Wstrzymane. Zmień status' }).click();
    await page.getByRole('menuitem', { name: 'Anuluj zlecenie…' }).click();
    const cancel = page.getByRole('dialog', { name: 'Anuluj zlecenie ZL-2026-0042' });
    await expect(cancel.getByText('Planowane transze (4) zostaną anulowane.')).toBeVisible();
    await cancel.getByRole('textbox', { name: 'Powód anulowania' }).fill('Klient zrezygnował');
    await cancel.getByRole('button', { name: 'Anuluj zlecenie' }).click();
    await expect(section(page).getByText('Anulowana', { exact: true })).toHaveCount(4);
  });

  test('EVM-053 AC5 a settled order: "Dodaj transzę" and "Zmień kwotę…" are disabled with the hint for the role', async ({ page, api }) => {
    const path = await createOrder(page);
    await setStatus(page, api, path, 'settled');
    const add = section(page).getByRole('button', { name: 'Dodaj transzę' });
    await expect(add).toHaveAttribute('aria-disabled', 'true');
    await expect(add).toHaveAttribute(
      'title',
      'Zlecenie jest rozliczone — płatności są tylko do odczytu. Zmienisz je po przywróceniu zlecenia.',
    );
    api.role = 'editor';
    await page.reload();
    await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
    await expect(page.getByRole('menuitem', { name: /Zmień kwotę…/ })).toHaveAttribute(
      'title',
      'Zlecenie jest rozliczone — płatności są tylko do odczytu. Przywrócić zlecenie może tylko administrator.',
    );
  });

  test('EVM-053 AC7 Tylko odczyt sees the instalments and the totals without any action', async ({ page, api }) => {
    const path = await createOrder(page);
    api.role = 'read_only';
    await page.goto(path);
    await expect(section(page).getByRole('table', { name: 'Transze płatności zlecenia' })).toBeVisible();
    await expect(section(page).getByText('Nieopłacone 0,00 zł · Opłacone 0,00 zł')).toBeVisible();
    await expect(section(page).getByRole('button')).toHaveCount(0);
  });

  test('EVM-053 AC8 an order without instalments says "Brak transz."; offline the actions say "Zmienisz po powrocie połączenia."', async ({
    page,
    context,
  }) => {
    await createOrder(page, 'Puste zlecenie (bez szablonu)');
    await expect(section(page).getByText('Brak transz.')).toBeVisible();
    await context.setOffline(true);
    const add = section(page).getByRole('button', { name: 'Dodaj transzę' });
    await expect(add).toHaveAttribute('aria-disabled', 'true');
    await expect(add).toHaveAttribute('title', 'Zmienisz po powrocie połączenia.');
    await context.setOffline(false);
    await expect(add).not.toHaveAttribute('aria-disabled', 'true');
  });
});
