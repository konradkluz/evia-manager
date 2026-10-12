import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';

// The editing of the data and of the scope of an order in W-06 in a real browser against the synthetic API (EVM-035 AC1–AC8):
// the dialog "Edytuj dane zlecenia" with If-Match and 412, the mode "Edytuj zakres", adding an item with its processes, the
// parameters, removing, the limit, a closed order, the role and offline. The full stack (the database, the transaction, the audit,
// the matrix of roles) is covered by the API integration tests.
test.use({ session: 'active' });

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function createOrder(page: Page, template: RegExp = /Garaż — pełny proces/): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: template }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /^Zakres \(\d+ pozycj/ })).toBeVisible();
  return new URL(page.url()).pathname;
}

const sent = (api: MockApi, method: string, suffix = '') =>
  api.seen.filter((entry) => entry.method === method && entry.url.includes('/work-orders/') && entry.url.endsWith(suffix));

async function openOrderDialog(page: Page) {
  await page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }).click();
  await page.getByRole('menuitem', { name: 'Edytuj dane zlecenia…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edytuj dane zlecenia' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('edit of the data of an order (EVM-035 AC1, AC7, AC8)', () => {
  test('EVM-035 AC1 the dialog saves the changed fields with If-Match and the title is on the page at once', async ({ page, api }) => {
    await createOrder(page);
    const dialog = await openOrderDialog(page);
    await expect(dialog.getByLabel('Tytuł')).toHaveValue('Garaż — pełny proces');
    await dialog.getByLabel('Tytuł').fill('Garaż — poprawiony');
    await dialog.getByLabel('Opis (opcjonalnie)').fill('Trasa kabla przez szacht B.');
    await dialog.getByLabel('Opiekun').selectOption({ label: 'Piotr Testowy' });
    await dialog.getByLabel('Planowana data (opcjonalnie)').fill('2026-12-01');
    await dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }).click();
    await expect(page.getByText('Zapisano zmiany zlecenia.')).toBeVisible();
    await expect(page.getByText('Garaż — poprawiony')).toBeVisible();
    await expect(page.getByText('Trasa kabla przez szacht B.')).toBeVisible();
    await expect(page.getByText('01.12.2026')).toBeVisible();
    const requests = sent(api, 'PATCH');
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]?.postData ?? '{}')).toMatchObject({
      title: 'Garaż — poprawiony',
      description: 'Trasa kabla przez szacht B.',
      plannedDate: '2026-12-01',
    });
    expect(requests[0]?.headers['if-match']).toBe('"1"');
    expect(requests[0]?.headers['idempotency-key']).toMatch(UUID_V7);
    expect(requests[0]?.headers['x-csrf-token']).toBe('csrf-active');
    // the focus is back on the trigger of the menu
    await expect(page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' })).toBeFocused();
  });

  test('EVM-035 AC1 412 keeps what was typed and tells the current value; the next save goes through', async ({ page, api }) => {
    const path = await createOrder(page);
    const dialog = await openOrderDialog(page);
    await dialog.getByLabel('Tytuł').fill('Mój tytuł');
    // another tab changed the order meanwhile: the same request, made outside the dialog, raises the version on the server
    const status = await page.evaluate(async (target) => {
      const response = await fetch(`/api/v1${target}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': '"1"', 'X-CSRF-Token': 'csrf-active' },
        body: JSON.stringify({ plannedDate: '2026-11-15' }),
      });
      return response.status;
    }, path);
    expect(status).toBe(200);
    await dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }).click();
    await expect(dialog.getByRole('alert')).toContainText('To zlecenie zmieniono w międzyczasie. Twoje zmiany zachowaliśmy');
    await expect(dialog.getByLabel('Tytuł')).toHaveValue('Mój tytuł');
    await expect(dialog.getByText('Aktualnie: 15.11.2026')).toBeVisible();
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    await dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }).click();
    await expect(page.getByText('Zapisano zmiany zlecenia.')).toBeVisible();
    // the other tab, the refused save with the old version and the save with the fresh one
    expect(sent(api, 'PATCH').map((entry) => entry.headers['if-match'])).toEqual(['"1"', '"1"', '"2"']);
  });

  test('EVM-035 AC1 an empty title is told and nothing is sent; "Anuluj" with changes asks first', async ({ page, api }) => {
    await createOrder(page);
    const dialog = await openOrderDialog(page);
    await dialog.getByLabel('Tytuł').fill('');
    await dialog.getByRole('button', { name: 'Zapisz zmiany zlecenia' }).click();
    // an empty title is a change, but the panel checks it first
    await expect(dialog.getByText('Podaj tytuł zlecenia.')).toBeVisible();
    expect(sent(api, 'PATCH')).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(page.getByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeVisible();
    await page.getByRole('button', { name: 'Wróć do edycji' }).click();
    await expect(dialog.getByLabel('Tytuł')).toHaveValue('');
  });

  test('EVM-035 AC8 Tylko odczyt has no menu of the order and no "Edytuj zakres"', async ({ page, api }) => {
    const path = await createOrder(page);
    api.role = 'read_only';
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 2, name: 'Zakres (9 pozycji)' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Akcje zlecenia/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edytuj zakres' })).toHaveCount(0);
  });
});

test.describe('edit of the scope (EVM-035 AC2–AC6)', () => {
  test('EVM-035 AC2 adding "Instalacja zasilająca" sends the item and its process in one request; the process appears with its stages', async ({
    page,
    api,
  }) => {
    await createOrder(page, /Garaż — montaż ładowarki/);
    await page.getByRole('button', { name: 'Edytuj zakres' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Zakres — edycja (2 pozycje)' })).toBeFocused();
    await page.getByRole('button', { name: 'Dodaj pozycję…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dodaj pozycję zakresu' });
    await dialog.getByLabel('Pozycja z katalogu').selectOption({ label: 'Instalacja zasilająca' });
    await dialog.getByRole('group', { name: 'Obwód dedykowany' }).getByRole('radio', { name: 'Tak' }).check();
    await dialog.getByLabel('Długość kabla (opcjonalnie)').fill('18');
    const processes = dialog.getByRole('group', { name: 'Procesy z tą pozycją' });
    await expect(processes.getByRole('checkbox', { name: /Instalacja zasilająca/ })).toBeChecked();
    await expect(processes.getByText('3 etapy „Do zrobienia”')).toBeVisible();
    // "Uzgodnienia z OSD" is already in the order (the template brings it): told, not offered
    await expect(processes.getByText('Uzgodnienia z OSD — już jest w zleceniu, nie dodamy drugiego.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Dodaj pozycję' }).click();
    await expect(page.getByText('Dodano pozycję „Instalacja zasilająca” i proces „Instalacja zasilająca”.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Zakres — edycja (3 pozycje)' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Procesy i etapy (2)' })).toBeVisible();
    const requests = sent(api, 'POST', '/scope-items');
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]?.postData ?? '{}')).toMatchObject({
      catalogItemCode: 'supply_installation',
      parameters: { dedicatedCircuit: true, cableLengthM: 18 },
    });
    expect(JSON.parse(requests[0]?.postData ?? '{}')).toHaveProperty('procedureCodes', ['supply']);
    expect(requests[0]?.headers['idempotency-key']).toMatch(UUID_V7);
  });

  test('EVM-035 AC4 "Inna usługa" needs the description; the parameters are checked against the set before sending', async ({
    page,
    api,
  }) => {
    await createOrder(page);
    await page.getByRole('button', { name: 'Edytuj zakres' }).click();
    await page.getByRole('button', { name: 'Dodaj pozycję…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dodaj pozycję zakresu' });
    await dialog.getByLabel('Pozycja z katalogu').selectOption({ label: 'Ładowarka klienta' });
    await dialog.getByLabel('Moc ładowarki').fill('1500');
    await dialog.getByLabel('Prąd').selectOption('ac');
    await dialog.getByRole('button', { name: 'Dodaj pozycję' }).click();
    await expect(dialog.getByText('Wartość spoza zakresu — dozwolone większe od 0 i nie więcej niż 1000.')).toBeVisible();
    await expect(dialog.getByText('Dla prądu AC podaj liczbę faz.')).toBeVisible();
    expect(sent(api, 'POST', '/scope-items')).toHaveLength(0);
    await dialog.getByLabel('Pozycja z katalogu').selectOption({ label: 'Inna usługa (opis w zleceniu)' });
    await expect(dialog.getByText('Parametry techniczne')).toHaveCount(0);
    await expect(dialog.getByText('Ta pozycja nie wnosi procesów.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Dodaj pozycję' }).click();
    await expect(dialog.getByText('Opisz usługę.')).toBeVisible();
    await dialog.getByLabel('Opis usługi').fill('Wymiana zabezpieczenia w rozdzielnicy garażowej');
    await dialog.getByRole('button', { name: 'Dodaj pozycję' }).click();
    await expect(page.getByText('Dodano pozycję „Inna usługa (opis w zleceniu)”.')).toBeVisible();
    await expect(page.getByText('Notatki: Wymiana zabezpieczenia w rozdzielnicy garażowej')).toBeVisible();
  });

  test('EVM-035 AC4 the parameters of an item are changed with If-Match of the item and shown in words', async ({ page, api }) => {
    await createOrder(page);
    await page.getByRole('button', { name: 'Edytuj zakres' }).click();
    await page.getByRole('button', { name: 'Akcje pozycji: Pozycja 1' }).click();
    await page.getByRole('menuitem', { name: 'Edytuj parametry…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edytuj parametry: Pozycja 1' });
    await expect(dialog.getByLabel('Moc ładowarki')).toHaveValue('11');
    await dialog.getByLabel('Moc ładowarki').fill('22');
    await dialog.getByRole('button', { name: 'Zapisz parametry' }).click();
    await expect(page.getByText('Zapisano parametry pozycji „Pozycja 1”.')).toBeVisible();
    await expect(page.getByText('AC, 22 kW, 3 fazy')).toBeVisible();
    const requests = sent(api, 'PATCH').filter((entry) => entry.url.includes('/scope-items/'));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers['if-match']).toBe('"1"');
    expect(JSON.parse(requests[0]?.postData ?? '{}')).toEqual({ parameters: { currentType: 'ac', powerKw: 22, phases: 3 } });
  });

  test('EVM-035 AC3 removing an item asks first, the numbering goes on and the focus goes to the next item', async ({ page, api }) => {
    await createOrder(page);
    await page.getByRole('button', { name: 'Edytuj zakres' }).click();
    await page.getByRole('button', { name: 'Akcje pozycji: Pozycja 2' }).click();
    await page.getByRole('menuitem', { name: 'Usuń pozycję…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Usunąć pozycję „Pozycja 2”?' });
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await expect(dialog.getByText('Pozycja zniknie z zakresu zlecenia.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Usuń pozycję' }).click();
    await expect(page.getByText('Usunięto pozycję „Pozycja 2”.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Zakres — edycja (8 pozycji)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Akcje pozycji: Pozycja 3' })).toBeFocused();
    const requests = sent(api, 'DELETE');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers['if-match']).toBe('"1"');
  });

  test('EVM-035 AC6 a closed order has the actions disabled with the reason; the server would answer 409', async ({ page, api }) => {
    const path = await createOrder(page);
    // cancel the order: the transition is made from the menu of the status
    await page.getByRole('button', { name: /^Status zlecenia: .*Zmień status$/ }).click();
    await page.getByRole('menuitem', { name: 'Anuluj zlecenie…' }).click();
    const cancel = page.getByRole('dialog', { name: 'Anuluj zlecenie ZL-2026-0042' });
    await cancel.getByLabel('Powód anulowania').fill('Rezygnacja klienta');
    await cancel.getByRole('button', { name: 'Anuluj zlecenie' }).click();
    await expect(page.getByRole('button', { name: /^Status zlecenia: Anulowane/ })).toBeVisible();
    const edit = page.getByRole('button', { name: 'Edytuj zakres' });
    await expect(edit).toHaveAttribute('aria-disabled', 'true');
    await expect(edit).toHaveAttribute('title', 'Zlecenie jest anulowane — zakres zmienisz po przywróceniu zlecenia.');
    await page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }).click();
    await expect(page.getByRole('menuitem', { name: /Edytuj dane zlecenia…/ })).toHaveAttribute('aria-disabled', 'true');
    expect(path).toContain('/work-orders/');
    expect(sent(api, 'PATCH')).toHaveLength(0);
  });

  test('EVM-035 AC5 at 50 items the button of adding is disabled with the limit', async ({ page }) => {
    await createOrder(page);
    await page.getByRole('button', { name: 'Edytuj zakres' }).click();
    // nine items from the template; add the rest one by one through the dialog (the synthetic server counts like the real one)
    for (let count = 9; count < 50; count += 1) {
      await page.getByRole('button', { name: 'Dodaj pozycję…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Dodaj pozycję zakresu' });
      await dialog.getByLabel('Pozycja z katalogu').selectOption({ label: 'Pomiary i odbiór' });
      await dialog.getByRole('button', { name: 'Dodaj pozycję' }).click();
      await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^Zakres — edycja \\(${String(count + 1)} `) })).toBeVisible();
    }
    const add = page.getByRole('button', { name: 'Dodaj pozycję…' });
    await expect(add).toHaveAttribute('aria-disabled', 'true');
    await expect(add).toHaveAttribute('title', 'Zlecenie ma już 50 pozycji zakresu — to limit.');
  });

  test('EVM-035 AC1 offline the actions of editing are disabled with the reason', async ({ page, context }) => {
    await createOrder(page);
    await context.setOffline(true);
    await expect(page.getByText(/Dane mogą być nieaktualne/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edytuj zakres' })).toHaveAttribute('title', 'Zmienisz po powrocie połączenia.');
    await page.getByRole('button', { name: 'Akcje zlecenia: ZL-2026-0042' }).click();
    await expect(page.getByRole('menuitem', { name: /Edytuj dane zlecenia…/ })).toHaveAttribute('aria-disabled', 'true');
    await context.setOffline(false);
  });
});
