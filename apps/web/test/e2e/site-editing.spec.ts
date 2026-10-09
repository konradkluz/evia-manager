import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';

// Editing a site and a party from the card "Lokalizacja" and "Inne zlecenia w tej lokalizacji" in a real browser against the synthetic API
// (EVM-036 AC1–AC5, AC7, AC8; SR-INPUT-02, SR-AUTHZ-03, SR-AUTHZ-08, SR-WEB-03). The full stack (API and database) is covered by the API
// integration tests and the role matrix; here the target is the tab: the dialogs, the focus, the toasts and the requests the tab sends.
test.use({ session: 'active' });

const SITE_ID = '01968f3e-0000-7000-8000-00000000bbb1';
const OSD_ID = '01968f3e-0000-7000-8000-00000000ddd1';
const OTHER_ORDER_ID = '01968f3e-0000-7000-8000-00000000d017';

/** Creates the order ZL-2026-0042 through W-05 and returns its address (the synthetic API has no other order to read). */
async function createOrder(page: Page): Promise<string> {
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

const settledOrder = {
  id: OTHER_ORDER_ID,
  number: 'ZL-2026-0017',
  title: 'Przyłącze — garaż',
  status: 'settled',
  closedAt: '2026-09-30T12:00:00.000Z',
};

const patches = (api: MockApi, resource: string) => api.seen.filter((entry) => entry.method === 'PATCH' && entry.url.includes(resource));

test.describe('editing a site and a party (EVM-036)', () => {
  test('EVM-036 AC1 AC5 the card lists the other order of the site without its customer; "Edytuj lokalizację" saves the PPE with If-Match, shows the toast and gives the focus back', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    api.orders.otherOrders = [settledOrder];
    await page.goto(path);
    const card = page.getByRole('region', { name: 'Lokalizacja' });
    const others = card.getByRole('region', { name: 'Inne zlecenia w tej lokalizacji (1)' });
    await expect(others.getByRole('link', { name: 'ZL-2026-0017' })).toHaveAttribute('href', `/work-orders/${OTHER_ORDER_ID}`);
    await expect(others.getByText('Przyłącze — garaż')).toBeVisible();
    await expect(others.getByText('Rozliczone')).toBeVisible();
    await expect(others.getByText('zamknięte 30.09.2026')).toBeVisible();
    await expect(others.getByText(/Przykładowy|@|\+48/)).toHaveCount(0);

    await card.getByRole('button', { name: 'Edytuj lokalizację' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edytuj lokalizację' });
    await expect(dialog.getByText('Zmiana dotyczy wszystkich zleceń w tej lokalizacji (2).')).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Typ obiektu' })).toBeFocused();
    await expect(dialog.getByRole('textbox', { name: 'PPE (opcjonalnie)' })).toHaveValue('PL-TEST-0001');
    await dialog.getByRole('textbox', { name: 'PPE (opcjonalnie)' }).fill('PL-TEST-0002');
    await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByText('Zapisano zmiany lokalizacji.')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(card.getByText('PL-TEST-0002')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Edytuj lokalizację' })).toBeFocused();

    const [request] = patches(api, `/api/v1/sites/${SITE_ID}`);
    expect(request?.headers['if-match']).toBe('"1"');
    expect(request?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(request?.postData ?? '{}')).toEqual({ meteringPointId: 'PL-TEST-0002' });
  });

  test('EVM-036 AC5 AC6 the list is asked for by the order only: no site in the path, nothing in the query, and the other order is never opened by the card', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    api.orders.otherOrders = [settledOrder];
    await page.goto(path);
    await expect(page.getByRole('link', { name: 'ZL-2026-0017' })).toBeVisible();
    const asked = api.seen.filter((entry) => entry.url.includes('/site-orders'));
    expect(asked.length).toBeGreaterThan(0);
    for (const entry of asked) {
      expect(new URL(entry.url).search).toBe('');
      expect(new URL(entry.url).pathname).toBe(`/api/v1${path}/site-orders`);
    }
    expect(api.seen.some((entry) => entry.url.includes(OTHER_ORDER_ID))).toBe(false);
  });

  test('EVM-036 AC8 no other orders: the section is hidden', async ({ page }) => {
    const path = await createOrder(page);
    await page.goto(path);
    const card = page.getByRole('region', { name: 'Lokalizacja' });
    await expect(card.getByText('PL-TEST-0001')).toBeVisible();
    await expect(card.getByText(/Inne zlecenia w tej lokalizacji/)).toHaveCount(0);
  });

  test('EVM-036 AC2 a party added in the view of the dialog is chosen, assigned only after "Zapisz zmiany" and shown on the card', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    await page.goto(path);
    await page.getByRole('button', { name: 'Edytuj lokalizację' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edytuj lokalizację' });
    await dialog.getByRole('button', { name: 'Zmień zarządcę / administrację' }).click();
    await dialog.getByRole('button', { name: 'Dodaj stronę: zarządca / administracja' }).click();
    const adding = page.getByRole('dialog', { name: 'Edytuj lokalizację › Dodaj stronę' });
    await adding.getByRole('combobox', { name: 'Rodzaj strony' }).selectOption('property_manager');
    await adding.getByRole('textbox', { name: 'Nazwa' }).fill('Zarząd Testowy');
    await adding.getByRole('button', { name: 'Dodaj stronę' }).click();
    const back = page.getByRole('dialog', { name: 'Edytuj lokalizację' });
    await expect(back.getByText('Zarząd Testowy · Zarządca')).toBeVisible();
    await expect(back.getByText('Dodano stronę „Zarząd Testowy”. Zapisz zmiany lokalizacji, aby ją przypisać.')).toBeVisible();
    expect(patches(api, '/api/v1/sites/')).toHaveLength(0);
    await back.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByText('Zapisano zmiany lokalizacji.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Lokalizacja' }).getByText('Zarząd Testowy')).toBeVisible();
    const sent = JSON.parse(patches(api, `/api/v1/sites/${SITE_ID}`)[0]?.postData ?? '{}') as Record<string, string>;
    expect(Object.keys(sent)).toEqual(['managerPartyId']);
  });

  test('EVM-036 AC3 the menu next to the OSD opens "Edytuj stronę": the shared-party notice, a saved name on the card, the toast and the focus on the menu', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    await page.goto(path);
    const card = page.getByRole('region', { name: 'Lokalizacja' });
    await card.getByRole('button', { name: 'Akcje strony: Operator Testowy (OSD)' }).click();
    await page.getByRole('menuitem', { name: 'Edytuj stronę…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edytuj stronę' });
    await expect(
      dialog.getByText('Strona jest wspólna — zmiana będzie widoczna we wszystkich lokalizacjach i zleceniach z tą stroną.'),
    ).toBeVisible();
    await expect(dialog.getByText('Rodzaju strony nie można zmienić — od niego zależy, gdzie można ją wybrać.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Nazwa' }).fill('Operator Nowy');
    await dialog.getByRole('button', { name: 'Zapisz zmiany strony' }).click();
    await expect(page.getByText('Zapisano zmiany strony.')).toBeVisible();
    await expect(card.getByText('Operator Nowy')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Akcje strony: Operator Nowy (OSD)' })).toBeFocused();
    const [request] = patches(api, `/api/v1/parties/${OSD_ID}`);
    expect(request?.headers['if-match']).toBe('"1"');
    expect(JSON.parse(request?.postData ?? '{}')).toEqual({ displayName: 'Operator Nowy' });
  });

  test('EVM-036 AC4 somebody changed the site meanwhile: 412 keeps the typed data, shows "Aktualnie: …" as text and the next save goes through', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    await page.goto(path);
    await page.getByRole('button', { name: 'Edytuj lokalizację' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edytuj lokalizację' });
    await dialog.getByRole('textbox', { name: 'PPE (opcjonalnie)' }).fill('PL-TEST-0002');
    api.orders.siteEdits.set(SITE_ID, { fields: { meteringPointId: '<b>PL-TEST-0009</b>' }, version: 2 });
    await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(
      dialog.getByText('Lokalizację zmieniono w międzyczasie. Twoje zmiany zachowaliśmy — sprawdź aktualne wartości i zapisz ponownie.'),
    ).toBeVisible();
    await expect(dialog.getByText('Aktualnie: <b>PL-TEST-0009</b>')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'PPE (opcjonalnie)' })).toHaveValue('PL-TEST-0002');
    await expect(dialog.getByRole('textbox', { name: 'PPE (opcjonalnie)' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByText('Zapisano zmiany lokalizacji.')).toBeVisible();
    expect(patches(api, `/api/v1/sites/${SITE_ID}`).map((entry) => entry.headers['if-match'])).toEqual(['"1"', '"2"']);
  });

  test('EVM-036 AC8 429 on save keeps the data and says when to try again; offline "Edytuj" is disabled and says why', async ({
    page,
    api,
    context,
  }) => {
    const path = await createOrder(page);
    await page.goto(path);
    const edit = page.getByRole('button', { name: 'Edytuj lokalizację' });
    await edit.click();
    const dialog = page.getByRole('dialog', { name: 'Edytuj lokalizację' });
    await dialog.getByRole('textbox', { name: 'Miasto' }).fill('Kraków');
    api.failNext.set(`PATCH /api/v1/sites/${SITE_ID}`, { status: 429, code: 'rate_limited', headers: { 'Retry-After': '30' } });
    await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(dialog.getByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Miasto' })).toHaveValue('Kraków');
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await page.getByRole('dialog', { name: 'Odrzucić zmiany?' }).getByRole('button', { name: 'Odrzuć zmiany' }).click();
    await context.setOffline(true);
    await expect(edit).toHaveAttribute('aria-disabled', 'true');
    await expect(edit).toHaveAttribute('title', 'Zmienisz po powrocie połączenia.');
    await context.setOffline(false);
  });

  test('EVM-036 AC7 Tylko odczyt sees the data of the site and the other orders but has no "Edytuj" and no menu of the parties', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    api.orders.otherOrders = [settledOrder];
    api.role = 'read_only';
    await page.goto(path);
    const card = page.getByRole('region', { name: 'Lokalizacja' });
    await expect(card.getByRole('link', { name: 'ZL-2026-0017' })).toBeVisible();
    await expect(card.getByText('Operator Testowy')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Edytuj lokalizację' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Akcje strony/ })).toHaveCount(0);
  });

  test('EVM-036 AC8 the notes are text: markup stays text on the card and in the dialog', async ({ page, api }) => {
    const path = await createOrder(page);
    api.orders.notes = '<script>alert(1)</script> javascript:alert(1) https://example.invalid/mapa';
    await page.goto(path);
    const card = page.getByRole('region', { name: 'Lokalizacja' });
    await expect(card.getByRole('link', { name: 'https://example.invalid/mapa' })).toBeVisible();
    await expect(card.getByRole('link', { name: /javascript/ })).toHaveCount(0);
    await card.getByRole('button', { name: 'Edytuj lokalizację' }).click();
    const notes = page
      .getByRole('dialog', { name: 'Edytuj lokalizację' })
      .getByRole('textbox', { name: 'Notatki do lokalizacji (opcjonalnie)' });
    await expect(notes).toHaveValue(api.orders.notes);
    expect(await page.locator('script').evaluateAll((nodes) => nodes.filter((node) => node.textContent.includes('alert(1)')).length)).toBe(
      0,
    );
  });
});
