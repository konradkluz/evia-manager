import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';

// "Procesy i etapy" in W-06 in a real browser against the synthetic API (EVM-031 AC1–AC8): the nine processes of a template, the person
// and the due date of a stage, the warning of "Zakończ", a closed order, the role. The full stack (the database, the policies, the audit,
// the role matrix with the stage of another order) is covered by the API integration tests.
test.use({ session: 'active' });

/** Creates the order ZL-2026-0042 through W-05 (the template with nine items brings nine processes) and returns its address. */
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

const patches = (api: MockApi) => api.seen.filter((entry) => entry.method === 'PATCH' && entry.url.includes('/procedure-stages/'));

async function openEdit(page: Page, stage: string) {
  await page.getByRole('button', { name: `Akcje etapu: ${stage}` }).click();
  await page.getByRole('menuitem', { name: 'Zmień osobę odpowiedzialną i termin…' }).click();
  return page.getByRole('dialog', { name: `Zmień etap: ${stage}` });
}

interface StageList {
  readonly items: ReadonlyArray<{ readonly stages: ReadonlyArray<{ readonly id: string; readonly name: string }> }>;
}

/** The id of a stage as the panel got it: the rows do not show ids, so the answer of the list is read through the page. */
async function stageIdOf(page: Page, name: string): Promise<string> {
  const path = new URL(page.url()).pathname;
  const answer = await page.evaluate(async (url) => (await fetch(url)).json() as Promise<StageList>, `/api/v1${path}/procedures`);
  const found = answer.items.flatMap((item) => item.stages).find((stage) => stage.name === name);
  if (found === undefined) throw new Error(`stage ${name} not found`);
  return found.id;
}

test.describe('processes and stages of a work order (EVM-031)', () => {
  test('EVM-031 AC1 AC2 a new order has the nine processes of the template, each a section with its progress; "Rozwiń wszystkie" opens them', async ({
    page,
  }) => {
    await createOrder(page);
    const section = page.getByRole('region', { name: 'Procesy i etapy (9)' });
    await expect(section).toBeVisible();
    await expect(section.getByRole('button', { name: /^Uzgodnienia z OSD\s*0 z 3 etapów/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(section.getByText('Pełnomocnictwo od klienta')).toBeVisible();
    await expect(section.getByText('Do zrobienia').first()).toBeVisible();
    await expect(section.getByRole('button', { name: /^Opinia ppoż/ })).toHaveAttribute('aria-expanded', 'false');
    await section.getByRole('button', { name: 'Rozwiń wszystkie' }).click();
    await expect(section.getByRole('button', { name: /^Opinia ppoż/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(section.getByText('Opinia rzeczoznawcy')).toBeVisible();
    await expect(section.getByRole('button', { name: 'Zwiń wszystkie' })).toBeVisible();
  });

  test('EVM-031 AC3 AC6 the Editor sets the person and the date of a stage; a date in the past is "po terminie"; the answer carries If-Match', async ({
    page,
    api,
  }) => {
    api.role = 'editor';
    await createOrder(page);
    const dialog = await openEdit(page, 'Wniosek do OSD');
    await dialog.getByLabel('Osoba odpowiedzialna').selectOption({ label: 'Piotr Testowy' });
    await dialog.getByLabel('Termin').fill('2020-01-02');
    await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByText('Zapisano zmiany etapu.')).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: 'Wniosek do OSD' });
    await expect(row.getByText('Osoba odpowiedzialna: Piotr Testowy')).toBeVisible();
    await expect(row.getByText('Termin: 02.01.2020')).toBeVisible();
    await expect(row.getByText('· po terminie')).toBeVisible();
    const sent = patches(api);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers['if-match']).toBe('"1"');
    expect(sent[0]?.headers['x-csrf-token']).toBe('csrf-active');
    expect(JSON.parse(sent[0]?.postData ?? '{}')).toEqual({
      responsibleUserId: '22222222-2222-4222-8222-222222222222',
      dueDate: '2020-01-02',
    });
    // the next change of the same stage uses the version of the answer
    const again = await openEdit(page, 'Wniosek do OSD');
    await again.getByLabel('Termin').fill('2099-01-02');
    await again.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(row.getByText('Termin: 02.01.2099')).toBeVisible();
    expect(patches(api).map((entry) => entry.headers['if-match'])).toEqual(['"1"', '"2"']);
    await expect(row.getByText('· po terminie')).toBeHidden();
  });

  test('EVM-031 AC3 a stale version (412) keeps what was typed and the next save goes through', async ({ page, api }) => {
    const path = await createOrder(page);
    const dialog = await openEdit(page, 'Warunki przyłączenia');
    await dialog.getByLabel('Termin').fill('2099-03-04');
    const id = await stageIdOf(page, 'Warunki przyłączenia');
    api.failNext.set(`PATCH /api/v1${path}/procedure-stages/${id}`, { status: 412, code: 'version_conflict' });
    await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(dialog.getByText('Ten etap zmieniono w międzyczasie. Sprawdź dane i zapisz zmiany ponownie.')).toBeVisible();
    await expect(dialog.getByLabel('Termin')).toHaveValue('2099-03-04');
    await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByText('Zapisano zmiany etapu.')).toBeVisible();
  });

  test('EVM-031 AC4 "Zakończ" warns about the open stages and does not block the completion', async ({ page, api }) => {
    await createOrder(page);
    await page.getByRole('button', { name: 'Status zlecenia: Nowe. Zmień status' }).click();
    await page.getByRole('menuitem', { name: 'Zaakceptuj bez wyceny' }).click();
    await page.getByRole('button', { name: 'Status zlecenia: Zaakceptowane. Zmień status' }).click();
    await page.getByRole('menuitem', { name: 'Rozpocznij realizację' }).click();
    await page.getByRole('button', { name: 'Status zlecenia: W realizacji. Zmień status' }).click();
    await page.getByRole('menuitem', { name: 'Zakończ' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zakończ zlecenie ZL-2026-0042' });
    await expect(dialog.getByText('Zlecenie ma jeszcze 17 otwartych etapów. Zakończenie zlecenia ich nie zamknie.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Zakończ zlecenie' }).click();
    await expect(page.getByText('Zakończono zlecenie.')).toBeVisible();
    expect(api.seen.filter((entry) => entry.url.endsWith('/transitions') && entry.method === 'POST')).toHaveLength(3);
  });

  test('EVM-031 AC5 a settled order: the actions of the stages are disabled with a reason and nothing is sent', async ({ page, api }) => {
    const path = await createOrder(page);
    const id = path.split('/').at(-1) ?? '';
    api.orders.states.set(id, { status: 'settled', version: 7, closedAt: '2026-10-08T10:00:00.000Z' });
    await page.goto(path);
    await page.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }).click();
    const item = page.getByRole('menuitem', { name: /^Zmień osobę odpowiedzialną i termin…/ });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveAttribute('title', 'Zlecenie jest zamknięte — procesów i etapów nie można zmieniać.');
    await item.click({ force: true });
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(patches(api)).toHaveLength(0);
  });

  test('EVM-031 AC7 Tylko odczyt sees the processes without any action on the stages', async ({ page, api }) => {
    const path = await createOrder(page);
    api.role = 'read_only';
    await page.goto(path);
    await expect(page.getByRole('region', { name: 'Procesy i etapy (9)' })).toBeVisible();
    await expect(page.getByText('Pełnomocnictwo od klienta')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Akcje etapu/ })).toHaveCount(0);
  });

  test('EVM-031 AC8 an order without a template has no processes; a failed read is an alert with "Spróbuj ponownie"', async ({
    page,
    api,
  }) => {
    await page.goto('/work-orders/new');
    await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
    await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
    await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
    await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
    await page.getByRole('radio', { name: 'Puste zlecenie (bez szablonu)' }).check();
    await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
    await expect(page.getByText('Zlecenie nie ma jeszcze procesów.')).toBeVisible();
    const path = new URL(page.url()).pathname;
    api.failNext.set(`GET /api/v1${path}/procedures`, { status: 500, code: 'internal_error' });
    await page.goto(path);
    await expect(page.getByText('Nie udało się wczytać procesów i etapów.')).toBeVisible();
    await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(page.getByText('Zlecenie nie ma jeszcze procesów.')).toBeVisible();
  });
});
