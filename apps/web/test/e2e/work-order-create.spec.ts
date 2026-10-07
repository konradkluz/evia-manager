import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

// W-05 sections "3. Szablon" and "4. Zlecenie", "Utwórz zlecenie" and the header of W-06 in a real browser against the synthetic API
// (EVM-022 AC1–AC4, AC7, AC8; SR-WEB-05, SR-API-05). The full stack (API and database) is covered by the API integration tests and
// the QA run; here the target is the tab.
test.use({ session: 'active' });

const PATH = '/work-orders/new';

async function pickCustomerAndSite(page: Page, siteType: 'garage' | 'house' = 'garage') {
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill(siteType === 'garage' ? 'testowa' : 'przykladowa');
  await page.getByRole('option', { name: siteType === 'garage' ? /ul\. Testowa 7/ : /ul\. Przykładowa 2/ }).click();
}

const browserStores = (page: Page) =>
  page.evaluate(async () => ({
    local: globalThis.localStorage.length,
    session: globalThis.sessionStorage.length,
    databases: (await globalThis.indexedDB.databases()).length,
    cookies: document.cookie,
  }));

test.describe('a new work order from a template W-05 (EVM-022)', () => {
  test('EVM-022 AC1 the cards show the scope only, the preview stands on the right, and "Utwórz zlecenie" ends in the toast and the header W-06', async ({
    page,
    api,
  }) => {
    await page.goto(PATH);
    await pickCustomerAndSite(page);
    await expect(page.getByText('Szablony dla typu: Garaż w budynku wielorodzinnym.')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Dom — montaż ładowarki 2 pozycje' })).toBeHidden();
    await page.getByRole('radio', { name: 'Garaż — pełny proces 9 pozycji' }).check();
    // 1280 px = breakpoint.expanded: the preview is on the right, not in a Disclosure
    const preview = page.getByRole('complementary', { name: 'Podgląd szablonu' });
    await expect(preview.getByRole('heading', { name: 'Zakres (9 pozycji)' })).toBeVisible();
    await expect(preview.getByText('Pomiary i odbiór')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pokaż szczegóły szablonu' })).toBeHidden();
    await expect(page.getByText(/Plan płatności|Kwoty transz|Zaliczka|Procesy \(/)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Tytuł' })).toHaveValue('Garaż — pełny proces');
    await expect(page.getByRole('combobox', { name: 'Opiekun' })).toHaveValue('11111111-1111-4111-8111-111111111111');
    await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
    await expect(page.getByText('Utworzono zlecenie ZL-2026-0042.')).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByText('Nowe', { exact: true })).toBeVisible();
    await expect(main.getByText('Jan Przykładowy')).toBeVisible();
    await expect(main.getByText('ul. Testowa 7, 00-001 Warszawa')).toBeVisible();
    await expect(page).toHaveTitle('Zlecenie ZL-2026-0042 · EVia Manager');
    const posts = api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/api/v1/work-orders'));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.headers['x-csrf-token']).toBe('csrf-active');
    expect(posts[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(api.orders.created.map((entry) => entry.scopeItems)).toEqual([9]);
    // and the order is on the list W-10
    await page.getByRole('link', { name: 'Zlecenia' }).first().click();
    await expect(page.getByRole('table').getByText('ZL-2026-0042')).toBeVisible();
  });

  test('EVM-022 AC2 the empty order has no scope; without any active template the section says so', async ({ page, api }) => {
    await page.goto(PATH);
    await pickCustomerAndSite(page);
    await page.getByRole('radio', { name: 'Puste zlecenie (bez szablonu)' }).check();
    await expect(page.getByRole('textbox', { name: 'Tytuł' })).toHaveValue('Nowe zlecenie');
    await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
    expect(api.orders.created.map((entry) => [entry.templateId, entry.scopeItems])).toEqual([[null, 0]]);
    api.orders.templates.length = 0;
    await page.goto(PATH);
    await expect(page.getByText('Brak aktywnych szablonów. Utwórz puste zlecenie i dodaj pozycje w zleceniu.')).toBeVisible();
  });

  test('EVM-022 AC3 an empty form: the summary of errors takes the focus, its links lead to the fields, nothing is sent', async ({
    page,
    api,
  }) => {
    await page.goto(PATH);
    await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
    const summary = page.getByRole('alert').filter({ hasText: 'Popraw zaznaczone pola, aby utworzyć zlecenie.' });
    await expect(summary).toBeFocused();
    await summary.getByRole('link', { name: 'Wybierz szablon albo „Puste zlecenie”.' }).click();
    await expect(page.getByRole('radio', { name: /Garaż — pełny proces/ })).toBeFocused();
    await summary.getByRole('link', { name: 'Wybierz klienta.' }).click();
    await expect(page.getByRole('combobox', { name: 'Klient' })).toBeFocused();
    expect(api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/api/v1/work-orders'))).toHaveLength(0);
  });

  test('EVM-022 AC3 a template retired meanwhile: 422 shows the alert by the section, the choice is dropped, the card is gone', async ({
    page,
    api,
  }) => {
    await page.goto(PATH);
    await pickCustomerAndSite(page);
    await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
    const retired = api.orders.templates[0];
    if (retired !== undefined) api.orders.templates[0] = { ...retired, isActive: false };
    await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Szablon „Garaż — pełny proces” został wycofany. Wybierz inny szablon.' });
    await expect(alert).toBeFocused();
    await expect(page.getByRole('radio', { name: /Garaż — pełny proces/ })).toBeHidden();
    await expect(page.getByRole('radio', { name: /Garaż — montaż ładowarki/ })).not.toBeChecked();
  });

  test('EVM-022 AC3 a customer or a site deleted meanwhile: 404 shows the messages by the fields', async ({ page, api }) => {
    await page.goto(PATH);
    await pickCustomerAndSite(page);
    await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
    api.customers.length = 0;
    await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
    await expect(page.getByText('Nie znaleziono wybranego klienta. Wybierz innego.').first()).toBeVisible();
    await expect(page.getByText('Nie znaleziono wybranej lokalizacji. Wybierz inną.').first()).toBeVisible();
  });

  test('EVM-022 AC4 a save whose answer is lost, retried, makes one work order with the same number', async ({ page, api }) => {
    await page.goto(PATH);
    await pickCustomerAndSite(page);
    await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
    api.dropResponseNext.add('POST /api/v1/work-orders');
    await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
    await expect(page.getByText('Nie udało się utworzyć zlecenia. Spróbuj ponownie — nie utworzymy go dwa razy.')).toBeVisible();
    await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
    const posts = api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/api/v1/work-orders'));
    expect(posts).toHaveLength(2);
    expect(posts[1]?.postData).toBe(posts[0]?.postData);
    expect(posts[1]?.headers['idempotency-key']).toBe(posts[0]?.headers['idempotency-key']);
    expect(api.orders.created).toHaveLength(1);
  });

  test('EVM-022 AC7 Tylko odczyt does not create: the link shows the state, nothing of the form is asked for', async ({ page, api }) => {
    api.role = 'read_only';
    await page.goto(PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Nie możesz tworzyć zleceń.' })).toBeVisible();
    await expect(page.getByText('Poproś administratora o uprawnienia.')).toBeVisible();
    expect(api.seen.filter((entry) => /templates|assignable/.test(entry.url))).toHaveLength(0);
  });

  test('EVM-022 AC8 the draft of the order lives in the memory of the tab only — no store of the browser, before and after "Wyloguj"', async ({
    page,
  }) => {
    await page.goto(PATH);
    await pickCustomerAndSite(page);
    await page.getByRole('radio', { name: /Garaż — montaż ładowarki/ }).check();
    await page.getByRole('textbox', { name: 'Opis (opcjonalnie)' }).fill('Klatka B, parter');
    await expect(page.getByText(/^Szkic w tej karcie · \d{2}:\d{2}/)).toBeVisible();
    expect(await browserStores(page)).toEqual({ local: 0, session: 0, databases: 0, cookies: '' });
    await page.getByRole('button', { name: /^Konto:/ }).click();
    await page.getByRole('menuitem', { name: 'Wyloguj' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await browserStores(page)).toEqual({ local: 0, session: 0, databases: 0, cookies: '' });
  });

  test('EVM-022 AC8 "Anuluj" of a started form asks before dropping the draft', async ({ page }) => {
    await page.goto(PATH);
    await page.getByRole('radio', { name: 'Puste zlecenie (bez szablonu)' }).check();
    await page.getByRole('button', { name: 'Anuluj' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Odrzucić nowe zlecenie?' });
    await expect(dialog.getByText('Wpisane dane znikną.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Odrzuć zmiany' }).click();
    await expect(page).toHaveURL(/\/work-orders$/);
  });

  test('EVM-022 AC8 offline: the banner, the button disabled, the data stay', async ({ page, context }) => {
    await page.goto(PATH);
    await pickCustomerAndSite(page);
    await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
    await context.setOffline(true);
    await expect(
      page.getByText('Brak połączenia. Wpisane dane zostają w tej karcie — zapisz je, gdy połączenie wróci.').first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Utwórz zlecenie' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Utworzenie zlecenia wymaga połączenia.')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole('radio', { name: /Garaż — pełny proces/ })).toBeChecked();
  });
});
