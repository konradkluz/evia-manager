import { expect, test } from './fixtures.ts';

// W-11 "Płatności — nieopłacone" in a real browser against the synthetic API (EVM-055 AC1–AC5, AC8): twelve invoiced instalments in
// twelve orders (AC3 figures), the tiles, the filters (only `view` in the address), "Odnotuj wpłatę", Tylko odczyt, the states.
// The policy of the real server (roles, deleted orders, the cursor, the limits, the mass read) is covered by the API integration tests.
test.use({ session: 'active' });

const NBSP = String.fromCharCode(0xa0);
const zl = (text: string): string => text.replaceAll(' ', NBSP);

const day = (offset: number): string =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

test.describe('the unpaid list (EVM-055)', () => {
  test('EVM-055 AC1 AC2 AC3 "Płatności" in the Sidebar opens W-11: the tiles, the table longest overdue first, "Po terminie" with the days, the sum', async ({
    page,
  }) => {
    await page.goto('/work-orders');
    await page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('link', { name: 'Płatności' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Płatności — nieopłacone' })).toBeVisible();
    await expect(page).toHaveTitle('Płatności · EVia Manager');
    await expect(page.getByRole('region', { name: 'Nieopłacone', exact: true })).toContainText(zl('12 transz · 48 300,00 zł'));
    await expect(page.getByRole('region', { name: 'Po terminie', exact: true })).toContainText(zl('4 · 15 200,00 zł'));
    await expect(page.getByRole('region', { name: 'Najdłużej po terminie', exact: true })).toContainText('21 dni');
    await expect(
      page.getByRole('region', { name: 'Najdłużej po terminie', exact: true }).getByRole('link', { name: 'ZL-2026-0031' }),
    ).toBeVisible();
    const rows = page.getByRole('table', { name: 'Nieopłacone transze' }).getByRole('row');
    await expect(rows).toHaveCount(13);
    const first = rows.nth(1);
    await expect(first).toContainText('ZL-2026-0031');
    await expect(first.getByText('Po terminie', { exact: true })).toBeVisible();
    await expect(first.getByText('21 dni')).toBeVisible();
    await expect(first).toHaveAccessibleName(/Wystawiona, po terminie od 21 dni/);
    const today = rows.filter({ hasText: 'ZL-2026-0038' });
    await expect(today.getByText('Wystawiona', { exact: true })).toBeVisible();
    await expect(today.getByText('Po terminie', { exact: true })).toHaveCount(0);
    await expect(page.getByText(zl('Suma (12 transz): 48 300,00 zł'))).toBeVisible();
    await first.getByRole('link', { name: 'ZL-2026-0031' }).click();
    await expect(page).toHaveURL(/\/work-orders\/01968f3e-0000-7000-8000-d00000000031$/);
  });

  test('EVM-055 AC4 the filters narrow the list and the sum, the tiles stay; the address carries only the view', async ({ page, api }) => {
    await page.goto('/payments');
    await expect(page.getByText(zl('Suma (12 transz): 48 300,00 zł'))).toBeVisible();
    await page.getByRole('button', { name: 'Po terminie', exact: true }).click();
    await expect(page).toHaveURL(/\/payments\?view=overdue$/);
    await expect(page.getByText(zl('Suma (4 transze): 15 200,00 zł'))).toBeVisible();
    await expect(page.getByRole('region', { name: 'Nieopłacone', exact: true })).toContainText(zl('12 transz · 48 300,00 zł'));
    await expect(page.getByRole('table', { name: 'Nieopłacone transze' }).getByRole('row')).toHaveCount(5);
    // the customer: found by POST /customers/search, an identifier to the API, never the address
    await page.getByRole('combobox', { name: 'Klient' }).fill('Przykładowy');
    await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
    await expect(page.getByText(zl('Suma (2 transze): 8 900,00 zł'))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Usuń filtr: klient Jan Przykładowy' })).toBeFocused();
    // the range of the terms: only what is due in the last 4 days
    await page.getByLabel('Termin od').fill(day(-4));
    await expect(page.getByText(zl('Suma (1 transza): 2 900,00 zł'))).toBeVisible();
    expect(page.url()).toMatch(/\/payments\?view=overdue$/);
    const requests = api.seen.filter((entry) => entry.url.includes('/api/v1/payment-milestones') && entry.method === 'GET');
    expect(requests.at(-1)?.url).toContain('customerId=01968f3e-0000-7000-8000-00000000aaa1');
    expect(requests.at(-1)?.url).toContain(`dueFrom=${day(-4)}`);
    // the filters live in the memory of the tab: a reload keeps only the view
    await page.reload();
    await expect(page.getByText(zl('Suma (4 transze): 15 200,00 zł'))).toBeVisible();
    await expect(page.getByLabel('Termin od')).toHaveValue('');
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    // "Wyczyść filtry" brings back the whole list
    await page.getByLabel('Termin do').fill(day(-100));
    await expect(page.getByRole('heading', { level: 2, name: 'Brak transz spełniających filtry.' })).toBeVisible();
    // the button of the empty state is the last one (the filter bar has its own)
    await page.getByRole('button', { name: 'Wyczyść filtry' }).last().click();
    await expect(page.getByText(zl('Suma (12 transz): 48 300,00 zł'))).toBeVisible();
    await expect(page).toHaveURL(/\/payments$/);
  });

  test('EVM-055 AC1 "Odnotuj wpłatę" records the payment: the dialog with the summary, the toast without "Cofnij", the row and the tiles change', async ({
    page,
  }) => {
    await page.goto('/payments');
    await page.getByRole('button', { name: 'Odnotuj wpłatę: Płatność końcowa, ZL-2026-0031' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Odnotować wpłatę za transzę „Płatność końcowa”?' });
    await expect(dialog.getByText(/Termin \d\d\.\d\d\.\d{4} \(21 dni po terminie\)/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Odnotuj wpłatę' }).click();
    await expect(page.getByText(zl('Odnotowano wpłatę 6 000,00 zł za fakturę FV/TEST/0031/2026.'))).toBeVisible();
    await expect(page.getByRole('row', { name: /ZL-2026-0031/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Nieopłacone', exact: true })).toContainText(zl('11 transz · 42 300,00 zł'));
    await expect(page.getByRole('region', { name: 'Najdłużej po terminie', exact: true })).toContainText('5 dni');
    await expect(
      page.getByRole('region', { name: 'Najdłużej po terminie', exact: true }).getByRole('link', { name: 'ZL-2026-0042' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Cofnij/ })).toHaveCount(0);
  });

  test('EVM-055 AC8 412 in the dialog: the alert names the status of now with "Odśwież"', async ({ page, api }) => {
    await page.goto('/payments');
    await expect(page.getByRole('cell', { name: 'FV/TEST/0031/2026', exact: true })).toBeVisible();
    // somebody else paid it meanwhile: the version of the server moved on
    const row = api.unpaid.rows[0];
    if (row === undefined) throw new Error('no row');
    row.status = 'paid';
    row.version = 4;
    await page.getByRole('button', { name: 'Odnotuj wpłatę: Płatność końcowa, ZL-2026-0031' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Odnotuj wpłatę' }).click();
    await expect(dialog.getByText('Tę transzę zmieniono w międzyczasie (teraz: «Opłacona»).')).toBeVisible();
    await dialog.getByRole('button', { name: 'Odśwież' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('row', { name: /ZL-2026-0031/ })).toHaveCount(0);
  });

  test('EVM-055 AC8 offline keeps the last page with the banner and the actions disabled; an error has "Spróbuj ponownie"; nothing unpaid is "Wszystkie wystawione faktury są opłacone."', async ({
    page,
    api,
    context,
  }) => {
    await page.goto('/payments');
    await expect(page.getByRole('cell', { name: 'FV/TEST/0031/2026', exact: true })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText(/^Dane mogą być nieaktualne \(z \d\d:\d\d\)$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Odnotuj wpłatę: Płatność końcowa, ZL-2026-0031' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByRole('cell', { name: 'FV/TEST/0031/2026', exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText(/Dane mogą być nieaktualne/)).toHaveCount(0);
    api.failNext.set('GET /api/v1/payment-milestones', { status: 500, code: 'internal_error' });
    await page.getByRole('button', { name: 'Po terminie', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Nie udało się wczytać płatności.' })).toBeVisible();
    await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(page.getByText(zl('Suma (4 transze): 15 200,00 zł'))).toBeVisible();
    for (const row of api.unpaid.rows) row.status = 'paid';
    await page.goto('/payments');
    await expect(page.getByRole('heading', { level: 2, name: 'Wszystkie wystawione faktury są opłacone.' })).toBeVisible();
  });

  test('EVM-055 AC5 Tylko odczyt sees the amounts, the numbers, the terms and "Po terminie" without the actions and the menu', async ({
    page,
    api,
  }) => {
    api.role = 'read_only';
    await page.goto('/payments');
    const first = page.getByRole('table', { name: 'Nieopłacone transze' }).getByRole('row').nth(1);
    await expect(first).toContainText('FV/TEST/0031/2026');
    await expect(first).toContainText(zl('6 000,00 zł'));
    await expect(first.getByText('Po terminie', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Odnotuj wpłatę/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Akcje transzy/ })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('link', { name: 'Płatności' })).toBeVisible();
  });
});
