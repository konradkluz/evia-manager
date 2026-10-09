import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';

// W-14 "Klienci" in a real browser against the synthetic API (EVM-039 AC1–AC8; SR-API-04, SR-WEB-05, SR-AUTHZ-02).
// The full stack (API and database) is covered by the API integration tests; here the target is the tab: the order and the
// paging of the list, the phrase that never reaches the address, the history, the edit with `If-Match`, the roles and the states.
test.use({ session: 'active' });

const JAN_ID = '01968f3e-0000-7000-8000-00000000aaa1';
const JAN_PATH = `/customers/${JAN_ID}`;

function person(index: number, firstName: string, lastName: string, extra: Partial<MockApi['customers'][number]> = {}) {
  return {
    id: `01968f3e-0000-7000-8000-${String(index).padStart(12, '0')}`,
    displayName: `${firstName} ${lastName}`,
    phone: `+486000000${String(index % 100).padStart(2, '0')}`,
    text: `${firstName} ${lastName}`.toLowerCase(),
    kind: 'person' as const,
    firstName,
    lastName,
    version: 1,
    ...extra,
  };
}

/** The three customers of AC1 and two more that make the Polish collation visible ("Ł" after "L", before "P"). */
function seedPolishAlphabet(api: MockApi): void {
  api.customers.length = 0;
  api.customers.push(
    person(1, 'Łukasz', 'Testowy', { text: 'lukasz testowy lodz' }),
    person(2, 'Lucyna', 'Przykładowa'),
    person(3, 'Marek', 'Fikcyjny'),
    person(4, 'Adam', 'Licznikowy'),
    person(5, 'Ewa', 'Ładowarkowa', { email: 'ewa.ladowarkowa@example.com' }),
  );
}

const names = (page: Page) => page.getByRole('table', { name: 'Klienci' }).locator('tbody tr td:first-child .font-semibold');

/** The stores of the browser that must stay empty (SR-WEB-05): local and session storage, IndexedDB, Cache Storage. */
async function stores(page: Page): Promise<{ local: number; session: number; databases: number; caches: number }> {
  return page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).length : 0,
    caches: typeof caches === 'undefined' ? 0 : (await caches.keys()).length,
  }));
}

async function createOrderFor(page: Page): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe('W-14 the list of customers (EVM-039 AC1)', () => {
  test('EVM-039 AC1 "Klienci" in the Sidebar opens the list in the Polish alphabet: surname before the first name, "Ł" after "L"', async ({
    page,
    api,
  }) => {
    seedPolishAlphabet(api);
    await page.goto('/work-orders');
    await page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('link', { name: 'Klienci' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Klienci' })).toBeVisible();
    await expect(page).toHaveTitle('Klienci · EVia Manager');
    await expect(names(page)).toHaveText(['Fikcyjny Marek', 'Licznikowy Adam', 'Ładowarkowa Ewa', 'Przykładowa Lucyna', 'Testowy Łukasz']);
    await expect(page.getByRole('columnheader', { name: /^Klient/ })).toHaveAttribute('aria-sort', 'ascending');
    const row = page.getByRole('link', { name: 'Ładowarkowa Ewa, osoba, telefon +48 600 000 005, e-mail ewa.ladowarkowa@example.com' });
    await expect(row).toHaveAttribute('href', '/customers/01968f3e-0000-7000-8000-000000000005');
  });

  test('EVM-039 AC1 the phrase "Lodz" finds "Łódź" and travels in the body of a POST — never in the address, the title or a store of the browser', async ({
    page,
    api,
  }) => {
    await page.goto('/customers');
    await expect(page.getByRole('table', { name: 'Klienci' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Szukaj klientów' }).fill('Lo');
    await expect(page.getByText('Co najmniej 3 znaki: nazwisko, nazwa firmy, NIP, telefon albo e-mail.')).toBeVisible();
    expect(api.seen.filter((entry) => entry.url.endsWith('/customers/search'))).toHaveLength(0);
    await page.getByRole('searchbox', { name: 'Szukaj klientów' }).fill('Lodz');
    await expect(names(page)).toHaveText(['Przykładowy Jan']);
    const searches = api.seen.filter((entry) => entry.url.endsWith('/customers/search'));
    expect(searches.map((entry) => entry.postData)).toEqual([JSON.stringify({ query: 'Lodz', limit: 25 })]);
    expect(searches[0]?.headers['x-csrf-token']).toBe('csrf-active');
    expect(page.url()).not.toContain('Lodz');
    await expect(page).toHaveTitle('Klienci · EVia Manager');
    expect(await stores(page)).toEqual({ local: 0, session: 0, databases: 0, caches: 0 });
    await page.getByRole('button', { name: 'Wyczyść frazę' }).click();
    await expect(page.getByRole('searchbox', { name: 'Szukaj klientów' })).toBeFocused();
    await expect(names(page)).toHaveCount(2);
  });

  test('EVM-039 AC1 a long list has pages of 25 with a cursor: the next page has no duplicates, the focus goes to the heading, the previous page comes back', async ({
    page,
    api,
  }) => {
    api.customers.length = 0;
    for (let index = 1; index <= 30; index += 1) {
      api.customers.push(person(index, 'Jan', `Nazwisko ${String(index).padStart(2, '0')}`));
    }
    await page.goto('/customers');
    await expect(names(page)).toHaveCount(25);
    const first = await names(page).allInnerTexts();
    await page.getByRole('button', { name: 'Następna strona' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Lista klientów' })).toBeFocused();
    await expect(names(page)).toHaveCount(5);
    const second = await names(page).allInnerTexts();
    expect(first.filter((name) => second.includes(name))).toEqual([]);
    expect(page.url()).not.toContain('cursor');
    await page.getByRole('button', { name: 'Poprzednia strona' }).click();
    await expect(names(page)).toHaveCount(25);
  });

  test('EVM-039 AC8 no customers, no results, a 429 with the time from Retry-After and an error with a retry', async ({ page, api }) => {
    api.customers.length = 0;
    await page.goto('/customers');
    await expect(page.getByRole('heading', { level: 2, name: 'Nie masz jeszcze klientów.' })).toBeVisible();
    await expect(page.getByText('Dodasz ich przy nowym zleceniu.')).toBeVisible();
    api.customers.push(person(1, 'Jan', 'Przykładowy'));
    await page.reload();
    await page.getByRole('searchbox', { name: 'Szukaj klientów' }).fill('Zzzz');
    await expect(page.getByRole('heading', { level: 2, name: 'Brak klientów spełniających kryteria.' })).toBeVisible();
    await page.getByRole('button', { name: 'Wyczyść wyszukiwanie' }).click();
    await expect(names(page)).toHaveCount(1);
    api.failNext.set('POST /api/v1/customers/search', { status: 429, code: 'rate_limited', headers: { 'Retry-After': '60' } });
    await page.getByRole('searchbox', { name: 'Szukaj klientów' }).fill('Przy');
    await expect(page.getByRole('alert').filter({ hasText: 'Zbyt wiele zapytań. Spróbuj ponownie za 1 min.' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Szukaj klientów' })).toHaveValue('Przy');
    await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(names(page)).toHaveText(['Przykładowy Jan']);
    api.failNext.set('GET /api/v1/customers', { status: 500, code: 'internal_error' });
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Nie udało się wczytać klientów.' })).toBeVisible();
    await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(names(page)).toHaveCount(1);
  });

  test('EVM-039 AC8 offline the list stays under "Dane mogą być nieaktualne", the search and the pages are disabled', async ({
    page,
    context,
  }) => {
    await page.goto('/customers');
    await expect(names(page)).toHaveCount(2);
    await context.setOffline(true);
    await expect(page.getByText(/Dane mogą być nieaktualne \(z \d{2}:\d{2}\)/)).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Szukaj klientów' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Wyszukasz po powrocie połączenia.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Następna strona' })).toHaveAttribute('aria-disabled', 'true');
    await expect(names(page)).toHaveCount(2);
    await context.setOffline(false);
  });
});

test.describe('W-14 the details, the history and the edit (EVM-039 AC2, AC3, AC4)', () => {
  test('EVM-039 AC2 A1″ from "Przejdź do klienta" in W-06 to the details with the history; the row of the history leads back to W-06', async ({
    page,
  }) => {
    const orderPath = await createOrderFor(page);
    await page.getByRole('region', { name: 'Klient' }).getByRole('link', { name: 'Przejdź do klienta' }).click();
    await expect(page).toHaveURL(JAN_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeFocused();
    await expect(page).toHaveTitle('Klient · EVia Manager');
    const data = page.getByRole('region', { name: 'Dane klienta' });
    await expect(data.getByRole('link', { name: '+48 600 000 001' })).toHaveAttribute('href', 'tel:+48600000001');
    await expect(data.getByRole('link', { name: 'jan.przykladowy@example.com' })).toHaveAttribute(
      'href',
      'mailto:jan.przykladowy%40example.com',
    );
    await expect(page.getByRole('heading', { level: 2, name: 'Historia zleceń (1)' })).toBeVisible();
    await page.getByRole('link', { name: /ZL-2026-0042, .*utworzono/ }).click();
    await expect(page).toHaveURL(orderPath);
    await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeVisible();
  });

  test('EVM-039 AC3 D4 a phone is changed and an e-mail added: the PATCH carries If-Match, an Idempotency-Key and only those two fields; the page shows the saved data', async ({
    page,
    api,
  }) => {
    api.customers[0] = { ...person(1, 'Jan', 'Przykładowy', { id: JAN_ID, phone: '+48600000001' }) };
    await page.goto(JAN_PATH);
    await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
    await page.getByRole('menuitem', { name: 'Edytuj dane klienta…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edytuj dane klienta' });
    await expect(dialog.getByRole('textbox', { name: 'Imię' })).toBeFocused();
    await expect(dialog.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Telefon' }).fill('600 000 008');
    await dialog.getByRole('textbox', { name: 'E-mail (opcjonalnie)' }).fill('Jan.Nowy@Example.com');
    await dialog.getByRole('button', { name: 'Zapisz dane klienta' }).click();
    await expect(page.getByText('Zapisano dane klienta.')).toBeVisible();
    await expect(dialog).toBeHidden();
    const saves = api.seen.filter((entry) => entry.method === 'PATCH');
    expect(saves).toHaveLength(1);
    expect(saves[0]?.headers['if-match']).toBe('"1"');
    expect(saves[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(saves[0]?.headers['x-csrf-token']).toBe('csrf-active');
    expect(JSON.parse(saves[0]?.postData ?? '{}')).toEqual({ phone: '600 000 008', email: 'Jan.Nowy@Example.com' });
    const data = page.getByRole('region', { name: 'Dane klienta' });
    await expect(data.getByRole('link', { name: '+48 600 000 008' })).toBeVisible();
    await expect(data.getByRole('link', { name: 'jan.nowy@example.com' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' })).toBeFocused();
    await expect(page).toHaveTitle('Klient · EVia Manager');
    expect(await stores(page)).toEqual({ local: 0, session: 0, databases: 0, caches: 0 });
  });

  test("EVM-039 AC3 a wrong phone is told under the field by the server's rules, the focus goes there and the typed data stays", async ({
    page,
  }) => {
    await page.goto(JAN_PATH);
    await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
    await page.getByRole('menuitem', { name: 'Edytuj dane klienta…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edytuj dane klienta' });
    await dialog.getByRole('textbox', { name: 'Telefon' }).fill('12');
    await dialog.getByRole('button', { name: 'Zapisz dane klienta' }).click();
    await expect(dialog.getByText('Podaj poprawny numer telefonu, np. +48 600 000 001.')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Telefon' })).toBeFocused();
    await expect(dialog.getByRole('textbox', { name: 'Telefon' })).toHaveValue('12');
  });

  test('EVM-039 AC3 on 412 the typed data stays, "Aktualnie: …" appears as plain text and the next save with the new version succeeds', async ({
    page,
    api,
  }) => {
    await page.goto(JAN_PATH);
    await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
    await page.getByRole('menuitem', { name: 'Edytuj dane klienta…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edytuj dane klienta' });
    await dialog.getByRole('textbox', { name: 'Telefon' }).fill('600 000 008');
    // somebody else saves the phone meanwhile
    const jan = api.customers[0];
    if (jan === undefined) throw new Error('the seed customer is missing');
    jan.phone = '+48600000009';
    jan.version = 2;
    await dialog.getByRole('button', { name: 'Zapisz dane klienta' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Dane klienta zmieniono w międzyczasie. Twoje zmiany zachowaliśmy — sprawdź aktualne wartości i zapisz ponownie.',
    );
    await expect(dialog.getByText('Aktualnie: +48 600 000 009')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Telefon' })).toHaveValue('600 000 008');
    await expect(dialog.getByRole('textbox', { name: 'Telefon' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Zapisz dane klienta' }).click();
    await expect(page.getByText('Zapisano dane klienta.')).toBeVisible();
    const saves = api.seen.filter((entry) => entry.method === 'PATCH');
    expect(saves.map((entry) => entry.headers['if-match'])).toEqual(['"1"', '"2"']);
    expect(JSON.parse(saves[1]?.postData ?? '{}')).toEqual({ phone: '600 000 008' });
  });

  test('EVM-039 AC3 a save whose answer is lost, retried, changes the customer once (the same Idempotency-Key)', async ({ page, api }) => {
    await page.goto(JAN_PATH);
    await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
    await page.getByRole('menuitem', { name: 'Edytuj dane klienta…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edytuj dane klienta' });
    await dialog.getByRole('textbox', { name: 'Telefon' }).fill('600 000 008');
    api.dropResponseNext.add('PATCH /api/v1/customers/:id');
    await dialog.getByRole('button', { name: 'Zapisz dane klienta' }).click();
    await expect(dialog.getByText('Nie udało się zapisać zmian. Spróbuj ponownie — nie zapiszemy ich dwa razy.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Zapisz dane klienta' }).click();
    await expect(page.getByText('Zapisano dane klienta.')).toBeVisible();
    const saves = api.seen.filter((entry) => entry.method === 'PATCH');
    expect(saves).toHaveLength(2);
    expect(saves[1]?.headers['idempotency-key']).toBe(saves[0]?.headers['idempotency-key']);
    expect(saves[1]?.headers['if-match']).toBe(saves[0]?.headers['if-match']);
    expect(api.customers[0]?.version).toBe(2);
  });

  test('EVM-039 AC3 closing a dialog with typed changes asks "Odrzucić zmiany?"', async ({ page }) => {
    await page.goto(JAN_PATH);
    await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
    await page.getByRole('menuitem', { name: 'Edytuj dane klienta…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edytuj dane klienta' });
    await dialog.getByRole('textbox', { name: 'Telefon' }).fill('600 000 008');
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    const ask = page.getByRole('dialog', { name: 'Odrzucić zmiany?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Odrzuć zmiany' }).click();
    await expect(ask).toBeHidden();
    await expect(page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' })).toBeFocused();
  });

  test('EVM-039 AC4 a field outside the schema and a field of the server are refused with the codes of the API (the panel never sends them)', async ({
    page,
    api,
  }) => {
    await page.goto(JAN_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeVisible();
    const csrf = 'csrf-active';
    const send = (body: object) =>
      page.evaluate(
        async ({ token, payload }) => {
          const response = await fetch('/api/v1/customers/01968f3e-0000-7000-8000-00000000aaa1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'If-Match': '"1"', 'X-CSRF-Token': token },
            body: JSON.stringify(payload),
          });
          return { status: response.status, body: (await response.json()) as { errors?: Array<{ pointer: string; code: string }> } };
        },
        { token: csrf, payload: body },
      );
    expect(await send({ nickname: 'x' })).toMatchObject({
      status: 400,
      body: { errors: [{ pointer: '/nickname', code: 'unknown_field' }] },
    });
    expect(await send({ displayName: 'x', version: 9 })).toMatchObject({
      status: 400,
      body: { errors: [{ code: 'read_only_field' }, { code: 'read_only_field' }] },
    });
    expect(api.customers[0]?.version).toBe(1);
  });
});

test.describe('W-14 deleted customers, roles and the session (EVM-039 AC6, AC7)', () => {
  test('EVM-039 AC6 a deleted customer is ONE screen "Nie znaleziono klienta." with no data, the same as an unknown identifier; not on the list or in the search', async ({
    page,
    api,
  }) => {
    const jan = api.customers[0];
    if (jan === undefined) throw new Error('the seed customer is missing');
    jan.deleted = true;
    await page.goto(JAN_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono klienta.' })).toBeVisible();
    await expect(page).toHaveTitle('Nie znaleziono · EVia Manager');
    await expect(page.getByText('Mógł zostać usunięty albo nie masz do niego dostępu.')).toBeVisible();
    await expect(page.getByText(/Jan Przykładowy|Przykładowy Jan/)).toHaveCount(0);
    const deleted = await page.getByRole('main').innerText();
    await page.goto('/customers/01968f3e-0000-7000-8000-00000000dead');
    await expect(page.getByRole('heading', { level: 1, name: 'Nie znaleziono klienta.' })).toBeVisible();
    expect(await page.getByRole('main').innerText()).toBe(deleted);
    await page.getByRole('button', { name: 'Wróć do listy klientów' }).click();
    await expect(names(page)).toHaveText(['Firma Testowa sp. z o.o.']);
    await page.getByRole('searchbox', { name: 'Szukaj klientów' }).fill('Lodz');
    await expect(page.getByRole('heading', { level: 2, name: 'Brak klientów spełniających kryteria.' })).toBeVisible();
  });

  test('EVM-039 AC7 the Administrator and the Editor have "Akcje klienta", Tylko odczyt has none and sees the same data', async ({
    page,
    api,
  }) => {
    for (const [role, shown] of [
      ['administrator', true],
      ['editor', true],
      ['read_only', false],
    ] as const) {
      api.role = role;
      await page.goto(JAN_PATH);
      await expect(page.getByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' })).toHaveCount(shown ? 1 : 0);
      await expect(page.getByRole('region', { name: 'Dane klienta' })).toBeVisible();
    }
    expect(api.seen.filter((entry) => entry.method === 'PATCH')).toEqual([]);
  });

  test('EVM-039 AC7 the server refuses a change from Tylko odczyt with 403 before it looks at anything else', async ({ page, api }) => {
    api.role = 'read_only';
    await page.goto(JAN_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeVisible();
    const status = await page.evaluate(async () => {
      const response = await fetch('/api/v1/customers/01968f3e-0000-7000-8000-00000000dead', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-active' },
        body: '{"nickname":1}',
      });
      return response.status;
    });
    expect(status).toBe(403);
  });

  test('EVM-039 AC7 logout removes the customer from the tab: the address opened again asks for the login and the stores stay empty', async ({
    page,
  }) => {
    await page.goto(JAN_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeVisible();
    await page.getByRole('button', { name: /^Konto:/ }).click();
    await page.getByRole('menuitem', { name: 'Wyloguj' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await stores(page)).toEqual({ local: 0, session: 0, databases: 0, caches: 0 });
    // the address of the customer opened again: the gate asks for the login and nothing of the customer is shown
    await page.goto(JAN_PATH);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Jan Przykładowy')).toHaveCount(0);
  });

  test('EVM-039 AC7 an expired session (401) sends the tab to the login page and no data of the customer stays on screen', async ({
    page,
    api,
  }) => {
    await page.goto(JAN_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Jan Przykładowy' })).toBeVisible();
    api.session = 'none';
    await page.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }).click();
    await page.getByRole('menuitem', { name: 'Edytuj dane klienta…' }).click();
    await page.getByRole('dialog', { name: 'Edytuj dane klienta' }).getByRole('textbox', { name: 'Telefon' }).fill('600 000 008');
    await page.getByRole('button', { name: 'Zapisz dane klienta' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Jan Przykładowy')).toHaveCount(0);
  });
});
