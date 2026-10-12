import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';

// "Na kogo czekamy?" with the suggestions of the location and "Dodaj stronę" in the window (EVM-033 AC1–AC6) in a real browser against
// the synthetic API. The specs do not depend on the time of day: no date is asserted and no offset from "now" is used. The full stack
// (the database, the soft delete of a party, the role matrix) is covered by the API integration tests.
test.use({ session: 'active' });

const OSD_STAGE = 'Wniosek do OSD';
const OSD = 'Operator Testowy';
const MANAGER = 'Wspólnota Testowa';
const OSD_LINE = `${OSD} · OSD`;
const MANAGER_LINE = `${MANAGER} · Wspólnota / spółdzielnia`;
const OSD_PARTY_ID = '01968f3e-0000-7000-8000-00000000ddd1';

async function createOrder(page: Page): Promise<void> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
}

async function expandAll(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Procesy i etapy (9)' }).getByRole('button', { name: 'Rozwiń wszystkie' }).click();
}

const badge = (page: Page, stage: string) => page.getByRole('button', { name: `Status etapu ${stage}: Do zrobienia. Zmień status` });
const transitions = (api: MockApi) =>
  api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/transitions') && entry.url.includes('/procedure-stages/'));

async function openWaiting(page: Page, stage: string) {
  await badge(page, stage).click();
  await page.getByRole('menuitem', { name: 'Czekamy na…' }).click();
  return page.getByRole('dialog', { name: 'Na kogo czekamy?' });
}

test.describe('suggestions from the location and "Dodaj stronę" (EVM-033)', () => {
  test('EVM-033 AC1 AC2 a stage that waits for an OSD by default opens with "Stronę" and the OSD of the location, the manager is one click away', async ({
    page,
    api,
  }) => {
    await createOrder(page);
    const dialog = await openWaiting(page, OSD_STAGE);
    await expect(dialog.getByRole('radio', { name: 'Stronę' })).toBeChecked();
    const group = dialog.getByRole('group', { name: 'Podpowiedzi z lokalizacji' });
    await expect(group.getByRole('radio')).toHaveCount(2);
    await expect(group.getByRole('radio', { name: OSD_LINE })).toBeChecked();
    await expect(group.getByRole('radio', { name: MANAGER_LINE })).not.toBeChecked();
    // nothing is sent by opening the window: the default is a hint of the screen
    expect(transitions(api)).toHaveLength(0);
    await group.getByRole('radio', { name: MANAGER_LINE }).check();
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByText(new RegExp(`Czekamy na: ${MANAGER}`))).toBeVisible();
    const sent = transitions(api);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]?.postData ?? '{}')).toMatchObject({ to: 'waiting', waitingOn: 'party' });
  });

  test('EVM-033 AC2 a stage that waits for the customer by default opens with "Klienta"; the person can still choose a party', async ({
    page,
  }) => {
    await createOrder(page);
    const dialog = await openWaiting(page, 'Pełnomocnictwo od klienta');
    await expect(dialog.getByRole('radio', { name: 'Klienta' })).toBeChecked();
    await dialog.getByRole('radio', { name: 'Stronę' }).check();
    await expect(dialog.getByRole('radio', { name: 'Klienta' })).not.toBeChecked();
  });

  test('EVM-033 AC3 "Dodaj stronę" replaces the window, saves the party with the kind of the template and comes back with it chosen', async ({
    page,
    api,
  }) => {
    await createOrder(page);
    await expandAll(page);
    const dialog = await openWaiting(page, 'Opinia rzeczoznawcy');
    await expect(dialog.getByRole('radio', { name: 'Stronę' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Dodaj stronę: Strona' }).click();
    const adding = page.getByRole('dialog', { name: 'Na kogo czekamy? › Dodaj stronę' });
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(adding.getByRole('combobox', { name: 'Rodzaj strony' })).toHaveValue('fire_safety_expert');
    await expect(adding.getByText(/Nie wpisuj PESEL/)).toBeVisible();
    await adding.getByRole('textbox', { name: 'Nazwa' }).fill('Rzeczoznawca Testowy');
    await adding.getByRole('button', { name: 'Dodaj stronę' }).click();
    const back = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
    await expect(back.getByText(/Rzeczoznawca Testowy · Rzeczoznawca ppoż/)).toBeVisible();
    await back.getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByText(/Czekamy na: Rzeczoznawca Testowy/)).toBeVisible();
    expect(api.parties.some((party) => party.displayName === 'Rzeczoznawca Testowy')).toBe(true);
    expect(transitions(api)).toHaveLength(1);
  });

  test('EVM-033 AC3 a Polish name (ąćęłńóśźż) of a new party is kept in the form, in the chosen line and in the request', async ({
    page,
    api,
  }) => {
    const name = 'Żółć Ąćęłńóśźż Sp. z o.o.';
    await createOrder(page);
    await expandAll(page);
    const dialog = await openWaiting(page, 'Opinia rzeczoznawcy');
    await dialog.getByRole('button', { name: 'Dodaj stronę: Strona' }).click();
    const adding = page.getByRole('dialog', { name: 'Na kogo czekamy? › Dodaj stronę' });
    await adding.getByRole('textbox', { name: 'Nazwa' }).fill(name);
    await adding.getByRole('button', { name: 'Dodaj stronę' }).click();
    const back = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
    await expect(back.getByText(`${name} · Rzeczoznawca ppoż`)).toBeVisible();
    expect(api.parties.some((party) => party.displayName === name)).toBe(true);
  });

  test('EVM-033 AC3 a lost answer of the save: the retry sends the same party and no duplicate appears', async ({ page, api }) => {
    await createOrder(page);
    await expandAll(page);
    const waiting = await openWaiting(page, 'Opinia rzeczoznawcy');
    await waiting.getByRole('button', { name: 'Dodaj stronę: Strona' }).click();
    const adding = page.getByRole('dialog', { name: 'Na kogo czekamy? › Dodaj stronę' });
    await adding.getByRole('textbox', { name: 'Nazwa' }).fill('Zarząd Testowy');
    api.dropResponseNext.add('POST /api/v1/parties');
    await adding.getByRole('button', { name: 'Dodaj stronę' }).click();
    await expect(adding.getByText(/Nie udało się dodać strony/)).toBeVisible();
    await adding.getByRole('button', { name: 'Dodaj stronę' }).click();
    await expect(page.getByRole('dialog', { name: 'Na kogo czekamy?' })).toBeVisible();
    expect(api.parties.filter((party) => party.displayName === 'Zarząd Testowy')).toHaveLength(1);
  });

  test('EVM-033 AC4 a location without the OSD and the manager: no section of suggestions, the search and "Dodaj stronę" only', async ({
    page,
    api,
  }) => {
    api.parties.length = 0;
    await createOrder(page);
    const dialog = await openWaiting(page, 'Warunki przyłączenia');
    await dialog.getByRole('radio', { name: 'Stronę' }).check();
    await expect(dialog.getByRole('combobox', { name: 'Strona' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Dodaj stronę: Strona' })).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Podpowiedzi z lokalizacji' })).toHaveCount(0);
  });

  test('EVM-033 AC5 a party that was deleted is not suggested and not chosen by the default', async ({ page, api }) => {
    await createOrder(page);
    api.orders.goneParties.add(OSD_PARTY_ID);
    const dialog = await openWaiting(page, OSD_STAGE);
    await expect(dialog.getByRole('group', { name: 'Podpowiedzi z lokalizacji' }).getByRole('radio')).toHaveCount(1);
    await expect(dialog.getByRole('radio', { name: OSD_LINE })).toHaveCount(0);
    await expect(dialog.getByRole('radio', { name: 'Stronę' })).toBeChecked();
    await expect(dialog.getByRole('combobox', { name: 'Strona' })).toBeVisible();
  });

  test('EVM-033 AC6 offline "Dodaj stronę" is disabled and what was typed stays', async ({ page, context }) => {
    await createOrder(page);
    const dialog = await openWaiting(page, 'Warunki przyłączenia');
    await dialog.getByRole('radio', { name: 'Stronę' }).check();
    await dialog.getByLabel('Od kiedy').fill('2026-09-18');
    await context.setOffline(true);
    const add = dialog.getByRole('button', { name: 'Dodaj stronę: Strona' });
    await expect(add).toHaveAttribute('aria-disabled', 'true');
    await expect(add).toHaveAttribute('title', 'Stronę dodasz po powrocie połączenia — wpisane dane zostają.');
    await add.click({ force: true });
    await expect(page.getByRole('dialog', { name: 'Na kogo czekamy? › Dodaj stronę' })).toHaveCount(0);
    await expect(dialog.getByLabel('Od kiedy')).toHaveValue('2026-09-18');
    await context.setOffline(false);
  });

  test('EVM-033 AC6 Tylko odczyt has no menu of the stage and so no suggestions and no "Dodaj stronę"', async ({ page, api }) => {
    await createOrder(page);
    api.role = 'read_only';
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Status etapu/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Dodaj stronę/ })).toHaveCount(0);
  });
});
