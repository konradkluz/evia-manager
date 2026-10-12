import { expect, test } from './fixtures.ts';

// W-10 "Czekamy na…" in a real browser against the synthetic API (EVM-034 AC1–AC4, AC7, AC8; SR-API-04, SR-WEB-05). The full stack (the
// projection, the policy, the p95 of 10 000 orders) is covered by the API integration tests; here the target is the tab. The days are the
// ones the synthetic server sends (2026-10-03); the clock of the tab is fixed, so nothing depends on the time of the day.
test.use({ session: 'active' });

const PATH = '/work-orders';
const FIXED_NOW = new Date('2026-10-03T10:00:00+02:00');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
});

test.describe('"Czekamy na…" on the list of work orders (EVM-034)', () => {
  test('EVM-034 AC1 the column shows the longest wait with the warning above 14 days and "+1"; a customer wait is "Klient · od 3 dni"', async ({
    page,
    api,
  }) => {
    api.workOrders = 12;
    await page.goto(PATH);
    const table = page.getByRole('table', { name: 'Lista zleceń' });
    await expect(table).toBeVisible();
    const osd = table.getByRole('row').filter({ hasText: 'ZL-2026-0001' });
    await expect(osd.getByText('Stoen Operator (OSD) · od 15 dni')).toBeVisible();
    await expect(osd.getByText('+1', { exact: true })).toBeVisible();
    await expect(osd.getByText('Czekamy dłużej niż 14 dni.')).toBeAttached();
    await expect(osd.locator('svg').first()).toBeVisible();
    const customer = table.getByRole('row').filter({ hasText: 'ZL-2026-0002' });
    await expect(customer.getByText('Klient · od 3 dni')).toBeVisible();
    await expect(customer.getByText('Czekamy dłużej niż 14 dni.')).toHaveCount(0);
    const nobody = table.getByRole('row').filter({ hasText: 'ZL-2026-0005' });
    await expect(nobody.getByText('Brak oczekiwań')).toBeAttached();
  });

  test('EVM-034 AC2 the filter "OSD dłużej niż X dni": X = 14 has the order, X = 15 has not; the address holds the kind and X only', async ({
    page,
    api,
  }) => {
    api.workOrders = 12;
    await page.goto(PATH);
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('combobox', { name: 'Czekamy na' }).selectOption({ label: 'OSD' });
    await expect(page.getByRole('button', { name: 'Usuń filtr Czekamy na: OSD > 14 dni' })).toBeVisible();
    await expect(page).toHaveURL(/\?waitingOn=distribution_system_operator&waitingDays=14$/);
    const table = page.getByRole('table', { name: 'Lista zleceń' });
    await expect(table.getByRole('row').filter({ hasText: 'ZL-2026-0001' })).toBeVisible();
    await expect(table.getByRole('row').filter({ hasText: 'ZL-2026-0002' })).toHaveCount(0);
    const days = page.getByRole('textbox', { name: 'Dłużej niż' });
    await days.fill('15');
    await expect(page).toHaveURL(/waitingDays=15$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń spełniających filtry.' })).toBeVisible();
    await days.fill('14');
    await expect(table.getByRole('row').filter({ hasText: 'ZL-2026-0001' })).toBeVisible();
    // the customer waits 3 days: not "longer than 14", but longer than 2; and an invalid number is told and not sent
    await page.getByRole('combobox', { name: 'Czekamy na' }).selectOption({ label: 'Klient' });
    await expect(table.getByRole('row').filter({ hasText: 'ZL-2026-0002' })).toHaveCount(0);
    await days.fill('2');
    await expect(table.getByRole('row').filter({ hasText: 'ZL-2026-0002' })).toBeVisible();
    await days.fill('366');
    await expect(page.getByText('Podaj liczbę dni od 1 do 365.')).toBeVisible();
    expect(new URL(page.url()).search).toBe('?waitingOn=customer&waitingDays=2');
    // nothing but the kind and X travels in the address — no identifier, no name
    expect(page.url()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(page.url()).not.toContain('Stoen');
  });

  test('EVM-034 AC3 the saved view "Czekamy na OSD > 14 dni" has only its identifier in the address; with no results it is good news', async ({
    page,
    api,
  }) => {
    api.workOrders = 12;
    await page.goto(PATH);
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('button', { name: 'Czekamy na OSD > 14 dni' }).click();
    await expect(page).toHaveURL(/\?view=waiting_on_dso_over_14_days$/);
    const table = page.getByRole('table', { name: 'Lista zleceń' });
    await expect(table.getByRole('row').filter({ hasText: 'ZL-2026-0001' })).toBeVisible();
    await expect(table.getByRole('row').filter({ hasText: 'ZL-2026-0003' })).toHaveCount(0);
    api.waits = false;
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Nie czekamy na OSD dłużej niż 14 dni. Dobra wiadomość.' })).toBeVisible();
  });

  test('EVM-034 AC4 "Najdłużej czekamy" puts the longest wait first and "Termin" the nearest date; a date that has passed has alarm-clock', async ({
    page,
    api,
  }) => {
    api.workOrders = 12;
    await page.goto(PATH);
    await expect(page.getByRole('table')).toBeVisible();
    const table = page.getByRole('table', { name: 'Lista zleceń' });
    await page.getByRole('combobox', { name: 'Sortuj' }).selectOption({ label: 'Najdłużej czekamy' });
    await expect(page.getByRole('columnheader', { name: 'Czekamy na' })).toHaveAttribute('aria-sort', 'ascending');
    // 20 days (the administration) before 15 days (the OSD) before 10 days
    await expect(table.getByRole('row').nth(1)).toContainText('Administracja Testowa (Administracja) · od 20 dni');
    await expect(table.getByRole('row').nth(3)).toContainText('Stoen Operator (OSD) · od 15 dni');
    await page.getByRole('combobox', { name: 'Sortuj' }).selectOption({ label: 'Termin' });
    await expect(page.getByRole('columnheader', { name: 'Termin' })).toHaveAttribute('aria-sort', 'ascending');
    const first = table.getByRole('row').nth(1);
    await expect(first).toContainText('30.09.2026');
    await expect(first.getByText('Termin minął.')).toBeAttached();
    await expect(first.locator('svg').first()).toBeVisible();
    // the sort is not in the address
    expect(new URL(page.url()).search).toBe('');
  });

  test('EVM-034 AC7 Tylko odczyt sees the columns, the filter and the view', async ({ page, api }) => {
    api.role = 'read_only';
    api.workOrders = 12;
    await page.goto(`${PATH}?waitingOn=party&waitingDays=14`);
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Czekamy na' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Czekamy na' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Czekamy na OSD > 14 dni' })).toBeVisible();
  });

  test('EVM-034 AC8 a 429 keeps the filter; offline shows the last page and disables the filter, the field and the view', async ({
    page,
    api,
    context,
  }) => {
    api.workOrders = 12;
    await page.goto(`${PATH}?waitingOn=party&waitingDays=14`);
    await expect(page.getByRole('table')).toBeVisible();
    api.failNext.set('GET /api/v1/work-orders', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '90' } });
    await page.getByRole('textbox', { name: 'Dłużej niż' }).fill('17');
    await expect(page.getByRole('alert')).toContainText('Zbyt wiele zapytań. Spróbuj ponownie za 2 min.');
    await expect(page.getByRole('button', { name: 'Usuń filtr Czekamy na: Dowolna strona > 17 dni' })).toBeVisible();
    await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText(/^Dane mogą być nieaktualne \(z \d\d:\d\d\)$/)).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Czekamy na' })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Dłużej niż' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Czekamy na OSD > 14 dni' })).toHaveAttribute('aria-disabled', 'true');
    await context.setOffline(false);
  });

  test('EVM-034 AC8 the names of the parties never reach the stores of the browser (SR-WEB-05)', async ({ page, api }) => {
    api.workOrders = 12;
    await page.goto(`${PATH}?waitingOn=party&waitingDays=14`);
    await expect(page.getByRole('table').getByText('Stoen Operator (OSD) · od 15 dni').first()).toBeVisible();
    const stores = await page.evaluate(async () => ({
      local: globalThis.localStorage.length,
      session: globalThis.sessionStorage.length,
      databases: (await globalThis.indexedDB.databases()).length,
      caches: (await globalThis.caches.keys()).length,
    }));
    expect(stores).toEqual({ local: 0, session: 0, databases: 0, caches: 0 });
  });
});
