import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';
import { freezeServerDay, seedMilestones } from './mock-payments.ts';

// Payments on the list W-10 and in the summary of W-06 in a real browser against the synthetic API (EVM-056 AC1–AC5, AC7, AC8). The
// state, the sums and the days after the due date are the server's: the day of the synthetic server is frozen in the mock and the
// clock of the tab is set to another day, so nothing on the screen can come from the browser's clock. The full stack (the projection,
// the policy, the p95 of 10 000 orders, the role matrix) is covered by the API integration tests.
test.use({ session: 'active' });

const PATH = '/work-orders';
const NBSP = ' ';
/** The clock of the tab — deliberately not the day of the server (and before the real day: the synthetic session expires from it). */
const BROWSER_NOW = new Date('2026-10-01T10:00:00+02:00');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(BROWSER_NOW);
});

const table = (page: Page) => page.getByRole('table', { name: 'Lista zleceń' });
const row = (page: Page, number: string) => table(page).getByRole('row').filter({ hasText: number });
const listQueries = (api: MockApi) =>
  api.seen
    .filter((entry) => entry.method === 'GET' && new URL(entry.url).pathname === '/api/v1/work-orders')
    .map((entry) => new URL(entry.url).searchParams);

/** Creates the order ZL-2026-0042 through W-05 (the full template brings the plan of four instalments) and returns its identifier. */
async function createOrder(page: Page): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

/** The first instalment invoiced (3 600,00 zł, due 2026-10-07), the other three planned. */
function seedFour(api: MockApi, orderId: string) {
  seedMilestones(api.orders, orderId, [
    { status: 'invoiced', amountMinor: 360_000, invoiceNumber: 'FV/TEST/0042/2026', invoicedOn: '2026-09-30', dueDate: '2026-10-07' },
    { amountMinor: 540_000 },
    { amountMinor: 540_000 },
    { amountMinor: 360_000 },
  ]);
}

const tile = (page: Page) => page.getByRole('region', { name: /^Podsumowanie/ }).getByRole('group', { name: 'Płatności' });

test.describe('payments on the list W-10 (EVM-056)', () => {
  test('EVM-056 AC1 the column "Płatność": "Po terminie" with the sum, "Nieopłacone (1)" with the sum, "Opłacone" and "—"', async ({
    page,
    api,
  }) => {
    api.workOrders = 12;
    await page.goto(PATH);
    await expect(table(page).getByRole('columnheader', { name: 'Płatność' })).toBeVisible();
    const overdue = row(page, 'ZL-2026-0001');
    await expect(overdue.getByText('Po terminie', { exact: true })).toBeVisible();
    await expect(overdue.getByText(`3${NBSP}600,00${NBSP}zł`)).toBeVisible();
    await expect(row(page, 'ZL-2026-0002').getByText('Nieopłacone (1)')).toBeVisible();
    await expect(row(page, 'ZL-2026-0002').getByText(`4${NBSP}500,00${NBSP}zł`)).toBeVisible();
    await expect(row(page, 'ZL-2026-0003').getByText('Opłacone', { exact: true })).toBeVisible();
    await expect(row(page, 'ZL-2026-0004').getByText('Brak wystawionych transz')).toBeAttached();
    await expect(table(page).getByRole('link', { name: /^ZL-2026-0001, .*, płatność po terminie, 3\s600,00\szł$/ })).toBeVisible();
  });

  // flows/07 "Responsywność": medium — the priority columns with "Płatność"; expanded — six priority columns; wide — plus "Lokalizacja",
  // "Opiekun" and "Utworzono". The table must not scroll sideways: the payment of AC1 is seen whole without scrolling.
  const LAYOUTS = [
    { width: 768, headers: ['Zlecenie', 'Status', 'Czekamy na', 'Termin', 'Płatność'] },
    { width: 1280, headers: ['Zlecenie', 'Klient', 'Status', 'Czekamy na', 'Termin', 'Płatność'] },
    {
      width: 1440,
      headers: ['Zlecenie', 'Klient', 'Lokalizacja', 'Status', 'Czekamy na', 'Termin', 'Płatność', 'Opiekun', 'Utworzono'],
    },
  ];
  for (const { width, headers } of LAYOUTS) {
    test(`EVM-056 AC1 at ${String(width)} px the column "Płatność" is seen whole, the table does not scroll sideways`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      api.workOrders = 12;
      await page.goto(PATH);
      const visible = table(page).getByRole('columnheader').filter({ visible: true });
      await expect(visible).toHaveText(headers);
      const frame = page.getByRole('region', { name: 'Lista zleceń' });
      const { scrollWidth, clientWidth } = await frame.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      const box = await frame.boundingBox();
      const badge = await row(page, 'ZL-2026-0001').getByText('Po terminie', { exact: true }).boundingBox();
      expect(box).not.toBeNull();
      expect(badge).not.toBeNull();
      if (box !== null && badge !== null) expect(badge.x + badge.width).toBeLessThanOrEqual(box.x + box.width);
    });
  }

  // Font metrics differ between platforms (Linux CI has wider glyphs): the table must stay in its frame also when the text is wider
  // than on the developer's machine (1rem against the 0.875rem of text.body-sm: about the difference of Linux fonts), so the test widens the text of the table itself instead of relying on the platform.
  for (const { width, headers } of LAYOUTS) {
    test(`EVM-056 AC1 at ${String(width)} px with wider glyphs the table stays in its frame`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      api.workOrders = 12;
      await page.goto(PATH);
      await expect(table(page).getByRole('columnheader').filter({ visible: true })).toHaveText(headers);
      await table(page).evaluate((element) => {
        for (const item of element.querySelectorAll<HTMLElement>('*')) item.style.setProperty('font-size', '1rem');
      });
      const frame = page.getByRole('region', { name: 'Lista zleceń' });
      const { scrollWidth, clientWidth } = await frame.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      const box = await frame.boundingBox();
      const badge = await row(page, 'ZL-2026-0001').getByText('Po terminie', { exact: true }).boundingBox();
      expect(box).not.toBeNull();
      expect(badge).not.toBeNull();
      if (box !== null && badge !== null) expect(badge.x + badge.width).toBeLessThanOrEqual(box.x + box.width);
    });
  }

  test('EVM-056 AC2 the views "Po terminie" and "Nieopłacone" list the open orders with such instalments; the address has the view only', async ({
    page,
    api,
  }) => {
    api.workOrders = 12;
    await page.goto(PATH);
    await expect(table(page)).toBeVisible();
    await page.getByRole('button', { name: 'Po terminie' }).click();
    await expect(page).toHaveURL(/\/work-orders\?view=overdue_payments$/);
    // index 0 and 10 are open with an overdue instalment; index 5 has one too, but the order is settled (closed)
    await expect(table(page).getByRole('row')).toHaveCount(3);
    await expect(row(page, 'ZL-2026-0001')).toBeVisible();
    await expect(row(page, 'ZL-2026-0011')).toBeVisible();
    await expect(row(page, 'ZL-2026-0006')).toHaveCount(0);
    expect(listQueries(api).at(-1)?.get('view')).toBe('overdue_payments');
    await page.getByRole('button', { name: 'Nieopłacone' }).click();
    await expect(page).toHaveURL(/\/work-orders\?view=unpaid$/);
    await expect(table(page).getByRole('row')).toHaveCount(6);
    await expect(row(page, 'ZL-2026-0007')).toBeVisible();
    expect(new URL(page.url()).search).toBe('?view=unpaid');
  });

  test('EVM-056 AC2 an empty view says so', async ({ page, api }) => {
    api.workOrders = 0;
    await page.goto(`${PATH}?view=overdue_payments`);
    await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń z płatnością po terminie. Dobra wiadomość.' })).toBeVisible();
    await page.goto(`${PATH}?view=unpaid`);
    await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń z nieopłaconymi transzami.' })).toBeVisible();
  });

  test('EVM-056 AC3 "Najpilniejsze" is the default (sent as sort=urgency), the order of the server is kept, no aria-sort, no address', async ({
    page,
    api,
  }) => {
    api.workOrders = 12;
    await page.goto(PATH);
    await expect(table(page)).toBeVisible();
    expect(listQueries(api).at(-1)?.get('sort')).toBe('urgency');
    await expect(page.getByRole('combobox', { name: 'Sortuj' })).toHaveValue('urgency');
    // group 1 (the oldest past due date first: the payments of 26.09, then the stage of 30.09), then group 2 (waiting > 14 days)
    const numbers = (await table(page).getByRole('link').allTextContents()).map((text) => /ZL-2026-\d{4}/.exec(text)?.[0]);
    expect(numbers.slice(0, 5)).toEqual(['ZL-2026-0001', 'ZL-2026-0011', 'ZL-2026-0007', 'ZL-2026-0003', 'ZL-2026-0009']);
    for (const header of await table(page).getByRole('columnheader').all()) await expect(header).not.toHaveAttribute('aria-sort');
    await page.getByRole('combobox', { name: 'Sortuj' }).selectOption({ label: 'Termin' });
    await expect(page.getByText('Sortowanie: Termin')).toBeAttached();
    expect(listQueries(api).at(-1)?.get('sort')).toBe('nextDueDate');
    expect(new URL(page.url()).search).toBe('');
  });

  test('EVM-056 AC7 Tylko odczyt sees the column and the views', async ({ page, api }) => {
    api.role = 'read_only';
    api.workOrders = 6;
    await page.goto(`${PATH}?view=unpaid`);
    await expect(table(page).getByRole('columnheader', { name: 'Płatność' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nieopłacone' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('EVM-056 AC8 offline: the payments of the last page under the banner; the views and the sort are disabled', async ({
    page,
    api,
    context,
  }) => {
    api.workOrders = 12;
    await page.goto(`${PATH}?view=unpaid`);
    await expect(row(page, 'ZL-2026-0001')).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText(/^Dane mogą być nieaktualne \(z \d{2}:\d{2}\)$/)).toBeVisible();
    await expect(row(page, 'ZL-2026-0001').getByText(`3${NBSP}600,00${NBSP}zł`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Po terminie' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('combobox', { name: 'Sortuj' })).toBeDisabled();
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    await context.setOffline(false);
  });

  test('EVM-056 AC8 a 429 of a view says how long to wait; the view stays chosen', async ({ page, api }) => {
    api.workOrders = 6;
    api.failNext.set('GET /api/v1/work-orders', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
    await page.goto(`${PATH}?view=overdue_payments`);
    await expect(page.getByText('Zbyt wiele zapytań. Spróbuj ponownie za 1 min.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Po terminie' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('the tile "Płatności" of W-06 (EVM-056)', () => {
  test('EVM-056 AC4 four instalments: "Nieopłacone: 3 600,00 zł (1)", "Po terminie" 5 dni, "Planowane: 3", "Opłacone: 0 z 4"', async ({
    page,
    api,
  }) => {
    const id = await createOrder(page);
    seedFour(api, id);
    freezeServerDay(api.orders, '2026-10-12');
    await page.reload();
    const payments = tile(page);
    await expect(payments.getByText(`Nieopłacone: 3${NBSP}600,00${NBSP}zł (1)`)).toBeVisible();
    await expect(payments.getByText('Po terminie', { exact: true })).toBeVisible();
    await expect(payments.getByText('5 dni')).toBeVisible();
    await expect(payments.getByText('Planowane: 3')).toBeVisible();
    await expect(payments.getByText('Opłacone: 0 z 4')).toBeVisible();
    // the whole tile leads to the section of the instalments
    await page.getByRole('tab', { name: 'Dziennik' }).click();
    await payments.getByRole('link').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Płatności' })).toBeFocused();
  });

  test('EVM-056 AC5 an instalment due 2026-10-07 is "Po terminie" only when the server day is 2026-10-08 (counted, not stored)', async ({
    page,
    api,
  }) => {
    const id = await createOrder(page);
    seedFour(api, id);
    freezeServerDay(api.orders, '2026-10-07');
    await page.reload();
    await expect(tile(page).getByText(`Nieopłacone: 3${NBSP}600,00${NBSP}zł (1)`)).toBeVisible();
    await expect(tile(page).getByText('Po terminie', { exact: true })).toHaveCount(0);
    freezeServerDay(api.orders, '2026-10-08');
    await page.reload();
    await expect(tile(page).getByText('Po terminie', { exact: true })).toBeVisible();
    await expect(tile(page).getByText('1 dzień')).toBeVisible();
  });

  test('EVM-056 AC8 a failed read of the instalments: the alert in the tile with a retry; the other tiles work', async ({ page, api }) => {
    const id = await createOrder(page);
    api.failNext.set(`GET /api/v1/work-orders/${id}/payment-milestones`, { status: 500, code: 'internal_error' });
    await page.reload();
    const alert = tile(page).getByRole('alert');
    await expect(alert).toContainText('Nie udało się wczytać płatności.');
    await expect(page.getByRole('region', { name: 'Terminy' })).not.toContainText('Nie udało się');
    await alert.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(tile(page).getByText('Planowane: 4')).toBeVisible();
  });

  test('EVM-056 AC7 Tylko odczyt sees the tile', async ({ page, api }) => {
    const id = await createOrder(page);
    seedFour(api, id);
    api.role = 'read_only';
    await page.reload();
    await expect(tile(page).getByText('Planowane: 3')).toBeVisible();
  });
});

test.describe('payments without a session (EVM-056 AC7)', () => {
  test.use({ session: 'none' });

  test('EVM-056 AC7 a person who is not logged in gets the login page and no amount', async ({ page }) => {
    await page.goto(`${PATH}?view=unpaid`);
    await expect(page.getByRole('heading', { level: 1, name: 'Zaloguj się' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('zł');
  });
});
