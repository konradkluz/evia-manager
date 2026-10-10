import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';

// The status of a stage and "Czekamy na…" in W-06 in a real browser against the synthetic API (EVM-032 AC1–AC8): the menu of the badge,
// the dialogs, "Cofnij", the days of waiting, the role, a closed order, offline. The full stack (the database, the table of
// transitions, the audit, the role matrix) is covered by the API integration tests.
test.use({ session: 'active' });

const STAGE = 'Warunki przyłączenia';

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

const badge = (page: Page, status: string) => page.getByRole('button', { name: `Status etapu ${STAGE}: ${status}. Zmień status` });
const row = (page: Page) => page.getByRole('listitem').filter({ hasText: STAGE });
const transitions = (api: MockApi) =>
  api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/transitions') && entry.url.includes('/procedure-stages/'));

async function choose(page: Page, status: string, item: string) {
  await badge(page, status).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe('status of a stage and "Czekamy na…" (EVM-032)', () => {
  test('EVM-032 AC1 AC2 the menu of "Do zrobienia" has the five transitions; "Czekamy na…" with a party saves the party and "od dziś"', async ({
    page,
    api,
  }) => {
    await createOrder(page);
    await badge(page, 'Do zrobienia').click();
    await expect(page.getByRole('menuitem')).toHaveText(['Rozpocznij', 'Czekamy na…', 'Zakończ…', 'Nie dotyczy', 'Zablokuj…']);
    await page.getByRole('menuitem', { name: 'Czekamy na…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
    await dialog.getByRole('radio', { name: 'Stronę' }).check();
    await dialog.getByRole('combobox', { name: 'Strona' }).fill('Operator');
    await page.getByRole('option', { name: /Operator Testowy/ }).click();
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(row(page).getByText('Czekamy na: Operator Testowy · od dziś')).toBeVisible();
    await expect(badge(page, 'Czekamy na…')).toBeVisible();
    const sent = transitions(api);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers['if-match']).toBe('"1"');
    expect(sent[0]?.headers['x-csrf-token']).toBe('csrf-active');
    expect(JSON.parse(sent[0]?.postData ?? '{}')).toMatchObject({ to: 'waiting', waitingOn: 'party' });
  });

  test('EVM-032 AC2 a missing party is an error under the field and nothing is sent; "Klienta" gives "klient"', async ({ page, api }) => {
    await createOrder(page);
    await choose(page, 'Do zrobienia', 'Czekamy na…');
    const dialog = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
    await dialog.getByRole('radio', { name: 'Stronę' }).check();
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(dialog.getByText('Wybierz stronę, na którą czekamy.')).toBeVisible();
    expect(transitions(api)).toHaveLength(0);
    await dialog.getByRole('radio', { name: 'Klienta' }).check();
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(row(page).getByText('Czekamy na: klient · od dziś')).toBeVisible();
  });

  test('EVM-032 AC3 AC5 "Odpowiedź otrzymana" clears the waiting and "Cofnij" waits again for the same party, with the same day', async ({
    page,
    api,
  }) => {
    await createOrder(page);
    await choose(page, 'Do zrobienia', 'Czekamy na…');
    const dialog = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
    await dialog.getByRole('radio', { name: 'Stronę' }).check();
    await dialog.getByRole('combobox', { name: 'Strona' }).fill('Operator');
    await page.getByRole('option', { name: /Operator Testowy/ }).click();
    await dialog.getByLabel('Od kiedy').fill('2026-09-18');
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(row(page).getByText(/Czekamy na: Operator Testowy · od \d+ dni/)).toBeVisible();
    // more than 14 days: the warning icon and the text
    await expect(row(page).getByText('Czekamy dłużej niż 14 dni.')).toBeAttached();
    await choose(page, 'Czekamy na…', 'Odpowiedź otrzymana');
    await expect(badge(page, 'W toku')).toBeVisible();
    await expect(row(page).getByText(/Czekamy na: /)).toBeHidden();
    await page.getByRole('button', { name: 'Cofnij' }).click();
    await expect(badge(page, 'Czekamy na…')).toBeVisible();
    await expect(row(page).getByText(/Czekamy na: Operator Testowy · od \d+ dni/)).toBeVisible();
    const sent = transitions(api).map((entry) => JSON.parse(entry.postData ?? '{}') as Record<string, unknown>);
    expect(sent.map((entry) => entry['to'])).toEqual(['waiting', 'in_progress', 'waiting']);
    expect(sent[2]).toMatchObject({ waitingOn: 'party', waitingSince: '2026-09-18' });
  });

  test('EVM-032 AC3 "Zmień, na kogo czekamy…" is an edit: the counter starts again and the toast has no "Cofnij"', async ({
    page,
    api,
  }) => {
    await createOrder(page);
    await choose(page, 'Do zrobienia', 'Czekamy na…');
    const first = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
    await first.getByRole('radio', { name: 'Klienta' }).check();
    await first.getByLabel('Od kiedy').fill('2026-09-18');
    await first.getByRole('button', { name: 'Zapisz' }).click();
    await expect(row(page).getByText(/Czekamy na: klient · od \d+ dni/)).toBeVisible();
    await choose(page, 'Czekamy na…', 'Zmień, na kogo czekamy…');
    const dialog = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
    await expect(dialog.getByText('Licznik dni zacznie się od nowa.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(row(page).getByText('Czekamy na: klient · od dziś')).toBeVisible();
    await expect(page.getByText('Zmieniono, na kogo czekamy.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cofnij' })).toHaveCount(0);
    expect(transitions(api)).toHaveLength(1);
    expect(api.seen.filter((entry) => entry.method === 'PATCH' && entry.url.includes('/procedure-stages/'))).toHaveLength(1);
  });

  test('EVM-032 AC4 "Zablokuj…" needs a reason, the progress follows "Zakończ…" and "Otwórz ponownie" goes back', async ({ page, api }) => {
    await createOrder(page);
    await choose(page, 'Do zrobienia', 'Zablokuj…');
    const dialog = page.getByRole('dialog', { name: 'Dlaczego etap jest zablokowany?' });
    await expect(dialog.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Zablokuj etap' }).click();
    await expect(dialog.getByText('Podaj powód blokady.')).toBeVisible();
    await dialog.getByLabel('Powód').fill('Brak zgody wspólnoty');
    await dialog.getByRole('button', { name: 'Zablokuj etap' }).click();
    await expect(row(page).getByText('Powód blokady: Brak zgody wspólnoty')).toBeVisible();
    await choose(page, 'Zablokowany', 'Odblokuj');
    await choose(page, 'W toku', 'Zakończ…');
    await page.getByRole('dialog', { name: 'Zakończ etap' }).getByRole('button', { name: 'Zakończ etap' }).click();
    await expect(badge(page, 'Zakończony')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Uzgodnienia z OSD\s*1 z 3 etapów/ })).toBeVisible();
    await choose(page, 'Zakończony', 'Otwórz ponownie');
    await expect(badge(page, 'W toku')).toBeVisible();
    expect(transitions(api).map((entry) => (JSON.parse(entry.postData ?? '{}') as { to: string }).to)).toEqual([
      'blocked',
      'in_progress',
      'done',
      'in_progress',
    ]);
  });

  test('EVM-032 AC6 a stale version (412) keeps the dialog and what was typed; the next save goes through', async ({ page, api }) => {
    const path = await createOrder(page);
    await choose(page, 'Do zrobienia', 'Czekamy na…');
    const dialog = page.getByRole('dialog', { name: 'Na kogo czekamy?' });
    await dialog.getByRole('radio', { name: 'Klienta' }).check();
    const id = await page.evaluate(async (url) => {
      const list = (await (await fetch(url)).json()) as { items: { stages: { id: string; name: string }[] }[] };
      return list.items.flatMap((item) => item.stages).find((stage) => stage.name === 'Warunki przyłączenia')?.id ?? '';
    }, `/api/v1${path}/procedures`);
    api.failNext.set(`POST /api/v1${path}/procedure-stages/${id}/transitions`, { status: 412, code: 'version_conflict' });
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(dialog.getByText(/^Ktoś zmienił ten etap w międzyczasie/)).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Klienta' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await expect(row(page).getByText('Czekamy na: klient · od dziś')).toBeVisible();
  });

  test('EVM-032 AC7 Tylko odczyt has a static badge; a settled order disables the badge with the reason', async ({ page, api }) => {
    const path = await createOrder(page);
    const id = path.split('/').at(-1) ?? '';
    api.role = 'read_only';
    await page.goto(path);
    await expect(row(page).getByText('Do zrobienia')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Status etapu/ })).toHaveCount(0);
    api.role = 'administrator';
    api.orders.states.set(id, { status: 'settled', version: 7, closedAt: '2026-10-08T10:00:00.000Z' });
    await page.goto(path);
    const disabled = badge(page, 'Do zrobienia');
    await expect(disabled).toHaveAttribute('aria-disabled', 'true');
    await expect(disabled).toHaveAttribute('title', 'Zlecenie jest zamknięte — status etapu zmienisz po przywróceniu zlecenia.');
    await disabled.click({ force: true });
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(transitions(api)).toHaveLength(0);
  });

  test('EVM-032 AC8 offline the badge is disabled with "Status etapu zmienisz po powrocie połączenia."', async ({ page, context }) => {
    await createOrder(page);
    await context.setOffline(true);
    await expect(badge(page, 'Do zrobienia')).toHaveAttribute('aria-disabled', 'true');
    await expect(badge(page, 'Do zrobienia')).toHaveAttribute('title', 'Status etapu zmienisz po powrocie połączenia.');
    await context.setOffline(false);
  });
});
