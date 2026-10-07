import { expect, test } from './fixtures.ts';

// W-05 section "1. Klient" in a real browser against the synthetic API (EVM-020 AC1–AC4, AC7, AC8; SR-WEB-05, SR-API-04).
// The full stack (API and database) is covered by the API integration tests and the QA run; here the target is the tab.
test.use({ session: 'active' });

const PATH = '/work-orders/new';
const JAN = 'Jan Przykładowy · +48 600 000 001';

test.describe('customer in a new work order W-05 (EVM-020)', () => {
  test('EVM-020 AC1 "Lodz" finds the customer from Łódź; the phrase travels in the body of a POST, never in the address or the title', async ({
    page,
    api,
  }) => {
    await page.goto(PATH);
    await expect(page).toHaveTitle('Nowe zlecenie · EVia Manager');
    const field = page.getByRole('combobox', { name: 'Klient' });
    await field.fill('pr');
    await expect(page.getByText('Wpisz co najmniej 3 znaki, aby wyszukać.')).toBeVisible();
    await field.fill('Lodz');
    const option = page.getByRole('option', { name: /Jan Przykładowy/ });
    await expect(option).toContainText('+48 600 000 001');
    const searches = api.seen.filter((entry) => entry.url.endsWith('/api/v1/customers/search'));
    expect(searches.map((entry) => entry.postData)).toEqual([JSON.stringify({ query: 'Lodz' })]);
    expect(searches[0]?.headers['x-csrf-token']).toBe('csrf-active');
    expect(page.url()).not.toContain('Lodz');
    await expect(page).toHaveTitle('Nowe zlecenie · EVia Manager');
    await field.press('ArrowDown');
    await field.press('Enter');
    await expect(page.getByText(JAN)).toBeFocused();
    await expect(page.getByText(/^Szkic w tej karcie · \d{2}:\d{2}/)).toBeVisible();
  });

  test('EVM-020 AC2 AC4 a save whose answer is lost, retried, makes one customer and the replay is marked', async ({ page, api }) => {
    await page.goto(PATH);
    await page.getByRole('combobox', { name: 'Klient' }).fill('Kowalski');
    await expect(page.getByText('Brak wyników dla „Kowalski”.')).toBeVisible();
    await page.getByRole('button', { name: 'Dodaj klienta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dodaj klienta' });
    await expect(dialog.getByRole('textbox', { name: 'Imię' })).toBeFocused();
    await expect(dialog.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Imię' }).fill('Piotr');
    await dialog.getByRole('textbox', { name: 'Nazwisko' }).fill('Kowalski');
    await dialog.getByRole('textbox', { name: 'Telefon' }).fill('600 123 456');
    api.dropResponseNext.add('POST /api/v1/customers');
    await dialog.getByRole('button', { name: 'Dodaj klienta' }).click();
    await expect(dialog.getByText('Nie udało się dodać klienta. Spróbuj ponownie — nie dodamy go dwa razy.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Dodaj klienta' }).click();
    await expect(page.getByText('Piotr Kowalski · +48 600 123 456')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Dodano klienta.')).toBeVisible();
    const saves = api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/api/v1/customers'));
    expect(saves).toHaveLength(2);
    expect(saves[1]?.postData).toBe(saves[0]?.postData);
    expect(saves[1]?.headers['idempotency-key']).toBe(saves[0]?.headers['idempotency-key']);
    expect(api.customers.filter((entry) => entry.displayName === 'Piotr Kowalski')).toHaveLength(1);
  });

  test('EVM-020 AC2 the server tells a wrong phone under the field and the focus goes there', async ({ page }) => {
    await page.goto(PATH);
    await page.getByRole('combobox', { name: 'Klient' }).fill('Nowak');
    await page.getByRole('button', { name: 'Dodaj klienta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dodaj klienta' });
    await dialog.getByRole('button', { name: 'Dodaj klienta' }).click();
    await expect(dialog.getByText('Uzupełnij to pole.')).toHaveCount(3);
    await expect(dialog.getByRole('textbox', { name: 'Imię' })).toBeFocused();
    await dialog.getByRole('textbox', { name: 'Imię' }).fill('Ewa');
    await dialog.getByRole('textbox', { name: 'Nazwisko' }).fill('Nowak');
    await dialog.getByRole('textbox', { name: 'Telefon' }).fill('12');
    await dialog.getByRole('button', { name: 'Dodaj klienta' }).click();
    await expect(dialog.getByText('Podaj poprawny numer telefonu, np. +48 600 000 001.')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Telefon' })).toBeFocused();
  });

  test('EVM-020 AC3 the same phone shows "Podobny klient" and "Wybierz tego klienta" picks it without saving', async ({ page, api }) => {
    await page.goto(PATH);
    await page.getByRole('combobox', { name: 'Klient' }).fill('Kowalski');
    await page.getByRole('button', { name: 'Dodaj klienta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dodaj klienta' });
    await dialog.getByRole('textbox', { name: 'Telefon' }).fill('+48 600 000 001');
    await expect(dialog.getByText(`Podobny klient: ${JAN}`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Wybierz tego klienta' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(JAN)).toBeVisible();
    expect(api.customers).toHaveLength(2);
  });

  test('EVM-020 AC8 offline: "Wyszukiwanie wymaga połączenia." and the dialog keeps what was typed', async ({ page, context }) => {
    await page.goto(PATH);
    await page.getByRole('combobox', { name: 'Klient' }).fill('Kowalski');
    await page.getByRole('button', { name: 'Dodaj klienta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dodaj klienta' });
    await dialog.getByRole('textbox', { name: 'Imię' }).fill('Piotr');
    await context.setOffline(true);
    await expect(dialog.getByText('Brak połączenia. Dodasz klienta po powrocie połączenia — wpisane dane zostają.').first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Dodaj klienta' })).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('combobox', { name: 'Klient' }).fill('Nowak');
    await expect(page.getByText('Wyszukiwanie wymaga połączenia.')).toBeVisible();
    await context.setOffline(false);
    await page.getByRole('combobox', { name: 'Klient' }).fill('Kowalski');
    await page.getByRole('button', { name: 'Dodaj klienta' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Imię' })).toHaveValue('Piotr');
  });

  test('EVM-020 AC8 the draft lives in the memory of the tab: it is not in any storage and a refresh drops it', async ({ page }) => {
    await page.goto(PATH);
    await page.getByRole('combobox', { name: 'Klient' }).fill('przykl');
    await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
    await expect(page.getByText(/^Szkic w tej karcie/)).toBeVisible();
    const stores = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
    expect(stores).toEqual({ local: 0, session: 0 });
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Klient' })).toBeVisible();
    await expect(page.getByText(/^Szkic w tej karcie/)).toHaveCount(0);
  });

  test('EVM-020 AC8 "Anuluj" with a chosen customer asks before it throws the draft away', async ({ page }) => {
    await page.goto(PATH);
    await page.getByRole('combobox', { name: 'Klient' }).fill('przykl');
    await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
    await page.getByRole('button', { name: 'Anuluj' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Odrzucić nowe zlecenie?' });
    await expect(confirm.getByRole('button', { name: 'Wróć do formularza' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Odrzuć zmiany' }).click();
    await expect(page).toHaveURL(/\/work-orders$/);
  });
});

test.describe('who creates work orders (EVM-020 AC7)', () => {
  test('EVM-020 AC7 Administrator and Edytor have "Nowe zlecenie" on the list; it opens W-05', async ({ page, api }) => {
    for (const role of ['administrator', 'editor'] as const) {
      api.role = role;
      await page.goto('/work-orders');
      await page.getByRole('button', { name: 'Nowe zlecenie' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Nowe zlecenie' })).toBeVisible();
      await expect(page).toHaveURL(/\/work-orders\/new$/);
    }
  });

  test('EVM-020 AC7 Tylko odczyt has no button and a link to W-05 shows "Nie możesz tworzyć zleceń."', async ({ page, api }) => {
    api.role = 'read_only';
    await page.goto('/work-orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nowe zlecenie' })).toHaveCount(0);
    await page.goto(PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Nie możesz tworzyć zleceń.' })).toBeVisible();
    await expect(page.getByText('Poproś administratora o uprawnienia.')).toBeVisible();
    await page.getByRole('button', { name: 'Wróć do listy' }).click();
    await expect(page).toHaveURL(/\/work-orders$/);
    expect(api.seen.filter((entry) => entry.url.includes('/customers'))).toEqual([]);
  });
});
