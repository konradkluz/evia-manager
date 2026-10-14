import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

// Adding, removing and restoring processes and stages by hand in W-06 in a real browser against the synthetic API (EVM-042 AC1–AC7):
// "Dodaj proces…", "Dodaj etap…", the confirmations "Usuń proces" and "Usuń etap", "Usunięte procesy i etapy" with "Przywróć" for the
// Administrator, the Editor, Tylko odczyt, a stale version and the offline state. The full stack (the database, the policies, the audit,
// the journal, the role matrix with the stage of another order) is covered by the API integration tests.
test.use({ session: 'active' });

async function createOrder(page: Page, template: boolean): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: template ? /Garaż — pełny proces/ : 'Puste zlecenie (bez szablonu)' }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname;
}

const region = (page: Page, name: string | RegExp) => page.getByRole('region', { name });

test.describe('processes and stages added and removed by hand (EVM-042)', () => {
  test('EVM-042 AC1 AC2 an empty order gets two processes on chosen places, then a stage with a date and a person', async ({
    page,
    api,
  }) => {
    await createOrder(page, false);
    const section = region(page, /^Procesy i etapy/);
    await section.getByRole('button', { name: 'Dodaj proces…' }).click();
    let dialog = page.getByRole('dialog', { name: 'Dodaj proces' });
    await expect(dialog.getByRole('combobox', { name: 'Proces' })).toBeFocused();
    await dialog.getByRole('combobox', { name: 'Proces' }).selectOption({ label: 'Opinia ppoż' });
    await expect(dialog.getByText('Proces dostanie etapy z szablonu w stanie „Do zrobienia”: 1 etap.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Dodaj proces' }).click();
    await expect(page.getByText('Dodano proces „Opinia ppoż”.')).toBeVisible();
    await expect(region(page, 'Procesy i etapy (1)')).toBeVisible();
    await expect(section.getByRole('button', { name: /^Opinia ppoż/ })).toBeFocused();

    // the same code cannot be added twice: the template is listed but cannot be chosen
    await section.getByRole('button', { name: 'Dodaj proces…' }).click();
    dialog = page.getByRole('dialog', { name: 'Dodaj proces' });
    const taken = dialog.getByRole('option', { name: 'Opinia ppoż — już jest w zleceniu' });
    await expect(taken).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Proces' }).selectOption({ label: 'Uzgodnienia z OSD' });
    await dialog.getByRole('button', { name: 'Dodaj proces' }).click();
    await expect(region(page, 'Procesy i etapy (2)')).toBeVisible();
    await expect(section.getByRole('button', { name: /^Uzgodnienia z OSD/ })).toBeFocused();

    await section.getByRole('button', { name: 'Akcje procesu: Uzgodnienia z OSD' }).click();
    await page.getByRole('menuitem', { name: 'Dodaj etap…' }).click();
    const stage = page.getByRole('dialog', { name: 'Dodaj etap' });
    await expect(stage.getByRole('textbox', { name: 'Nazwa etapu' })).toBeFocused();
    await stage.getByRole('textbox', { name: 'Nazwa etapu' }).fill('Uzgodnienie terminu wyłączenia zasilania');
    await stage.getByLabel('Termin (opcjonalnie)').fill('2026-12-01');
    await stage.getByLabel('Osoba odpowiedzialna (opcjonalnie)').selectOption({ label: 'Piotr Testowy' });
    await stage.getByRole('button', { name: 'Dodaj etap' }).click();
    await expect(page.getByText('Dodano etap „Uzgodnienie terminu wyłączenia zasilania”.')).toBeVisible();
    const row = section.getByRole('listitem').filter({ hasText: 'Uzgodnienie terminu wyłączenia zasilania' });
    await expect(row.getByText('Do zrobienia')).toBeVisible();
    await expect(row.getByText('Termin: 01.12.2026')).toBeVisible();
    await expect(row.getByText('Osoba odpowiedzialna: Piotr Testowy')).toBeVisible();
    await expect(section.getByRole('button', { name: /^Uzgodnienia z OSD\s*0 z 4 etapów/ })).toBeVisible();

    const sent = api.seen.filter((entry) => entry.method === 'POST' && /\/procedures(\/[0-9a-f-]+\/stages)?$/.test(entry.url));
    expect(sent).toHaveLength(3);
    for (const entry of sent) {
      expect(entry.headers['x-csrf-token']).toBe('csrf-active');
      expect(entry.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  test('EVM-042 AC3 AC6 the Administrator removes a process after the advice and restores it from "Usunięte procesy i etapy"', async ({
    page,
    api,
  }) => {
    await createOrder(page, true);
    const section = region(page, /^Procesy i etapy/);
    await section.getByRole('button', { name: 'Akcje procesu: Opinia ppoż' }).click();
    await page.getByRole('menuitem', { name: 'Usuń proces…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Usunąć proces „Opinia ppoż”?' });
    await expect(dialog.getByText('Proces zniknie razem z etapami (1).')).toBeVisible();
    await expect(dialog.getByText(/oznaczyć jego etapy jako „Nie dotyczy”/)).toBeVisible();
    await expect(dialog.getByText('Przywrócisz go w „Usunięte procesy i etapy”.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Usuń proces' }).click();
    await expect(page.getByText('Usunięto proces „Opinia ppoż”.')).toBeVisible();
    await expect(region(page, 'Procesy i etapy (8)')).toBeVisible();
    await expect(section.getByRole('button', { name: /^Opinia ppoż/ })).toHaveCount(0);
    const deleted = api.seen.filter((entry) => entry.method === 'DELETE');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.headers['if-match']).toBe('"1"');
    expect(deleted[0]?.headers['x-csrf-token']).toBe('csrf-active');

    await section.getByRole('button', { name: 'Usunięte procesy i etapy (1)' }).click();
    await expect(section.getByText('proces, 1 etap')).toBeVisible();
    await section.getByRole('button', { name: 'Przywróć proces: Opinia ppoż' }).click();
    await expect(page.getByText('Przywrócono proces „Opinia ppoż”.')).toBeVisible();
    await expect(region(page, 'Procesy i etapy (9)')).toBeVisible();
    await expect(section.getByRole('button', { name: /^Opinia ppoż/ })).toBeFocused();
    await expect(section.getByRole('button', { name: /^Usunięte procesy i etapy/ })).toHaveCount(0);
    // back on its place (the fourth), no step-up asked for
    const names = await section.getByRole('heading', { level: 3 }).allTextContents();
    expect(names[3]).toMatch(/^Opinia ppoż/);
  });

  test('EVM-042 AC3 a stage removed with "Usuń etap" can be taken back with "Cofnij"; the dialog advises "Nie dotyczy"', async ({
    page,
  }) => {
    await createOrder(page, true);
    const section = region(page, /^Procesy i etapy/);
    await section.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }).click();
    await page.getByRole('menuitem', { name: 'Usuń etap…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Usunąć etap „Wniosek do OSD”?' });
    await expect(dialog.getByText(/oznacz go jako „Nie dotyczy” — zostanie w historii zlecenia/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Oznacz jako „Nie dotyczy”' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Usuń etap' }).click();
    await expect(page.getByText('Usunięto etap „Wniosek do OSD”.')).toBeVisible();
    const stages = section.getByRole('list', { name: 'Uzgodnienia z OSD' });
    await expect(stages.getByText('Wniosek do OSD', { exact: true })).toHaveCount(0);
    await expect(section.getByRole('button', { name: /^Uzgodnienia z OSD\s*0 z 2 etapów/ })).toBeVisible();
    await page.getByRole('button', { name: 'Cofnij' }).click();
    await expect(page.getByText('Przywrócono etap „Wniosek do OSD”.')).toBeVisible();
    await expect(section.getByText('Wniosek do OSD', { exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: /^Uzgodnienia z OSD\s*0 z 3 etapów/ })).toBeVisible();
  });

  test('EVM-042 AC3 "Oznacz jako „Nie dotyczy”" takes the stage out of the progress and keeps it in the order', async ({ page }) => {
    await createOrder(page, true);
    const section = region(page, /^Procesy i etapy/);
    await section.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }).click();
    await page.getByRole('menuitem', { name: 'Usuń etap…' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Oznacz jako „Nie dotyczy”' }).click();
    await expect(page.getByText('Oznaczono etap „Wniosek do OSD” jako „Nie dotyczy”.')).toBeVisible();
    await expect(section.getByRole('button', { name: /^Uzgodnienia z OSD\s*0 z 2 etapów/ })).toBeVisible();
    await expect(section.getByText('Wniosek do OSD', { exact: true })).toBeVisible();
  });

  test('EVM-042 AC3 AC6 the Editor is told that only an administrator restores and has no section of the deleted ones', async ({
    page,
    api,
  }) => {
    await createOrder(page, true);
    api.role = 'editor';
    const before = api.seen.length;
    await page.reload();
    const section = region(page, /^Procesy i etapy/);
    await section.getByRole('button', { name: 'Akcje etapu: Wniosek do OSD' }).click();
    await page.getByRole('menuitem', { name: 'Usuń etap…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Usunąć etap „Wniosek do OSD”?' });
    await expect(dialog.getByText('Przywrócić go może tylko administrator.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Usuń etap' }).click();
    await expect(page.getByText('Usunięto etap „Wniosek do OSD”.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cofnij' })).toHaveCount(0);
    await expect(section.getByRole('button', { name: /^Usunięte procesy i etapy/ })).toHaveCount(0);
    expect(api.seen.slice(before).filter((entry) => entry.url.endsWith('/deleted-procedures'))).toHaveLength(0);
  });

  test('EVM-042 AC6 Tylko odczyt sees no way to add or remove', async ({ page, api }) => {
    await createOrder(page, true);
    api.role = 'read_only';
    await page.reload();
    const section = region(page, /^Procesy i etapy/);
    await expect(section.getByRole('button', { name: 'Uzgodnienia z OSD', exact: false }).first()).toBeVisible();
    await expect(section.getByRole('button', { name: 'Dodaj proces…' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Akcje (procesu|etapu)/ })).toHaveCount(0);
  });

  test('EVM-042 AC7 a stale version (412) keeps the dialog open with what was on screen; the next try goes through', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page, true);
    const section = region(page, /^Procesy i etapy/);
    const list = await page.evaluate(
      async (url) => (await fetch(url)).json() as Promise<{ items: Array<{ id: string }> }>,
      `/api/v1${path}/procedures`,
    );
    const processId = list.items[3]?.id ?? '';
    await section.getByRole('button', { name: 'Akcje procesu: Opinia ppoż' }).click();
    await page.getByRole('menuitem', { name: 'Usuń proces…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Usunąć proces „Opinia ppoż”?' });
    api.failNext.set(`DELETE /api/v1${path}/procedures/${processId}`, { status: 412, code: 'version_conflict' });
    await dialog.getByRole('button', { name: 'Usuń proces' }).click();
    await expect(dialog.getByText('Ten proces zmieniono w międzyczasie. Sprawdź jego aktualny stan i spróbuj ponownie.')).toBeVisible();
    await expect(dialog.getByText('Proces zniknie razem z etapami (1).')).toBeVisible();
    await dialog.getByRole('button', { name: 'Usuń proces' }).click();
    await expect(page.getByText('Usunięto proces „Opinia ppoż”.')).toBeVisible();
  });

  test('EVM-042 AC4 a settled order disables adding and removing with the reason and nothing is sent', async ({ page, api }) => {
    const path = await createOrder(page, true);
    api.orders.states.set(path.split('/').at(-1) ?? '', { status: 'settled', version: 7, closedAt: '2026-10-08T10:00:00.000Z' });
    await page.goto(path);
    const add = page.getByRole('button', { name: 'Dodaj proces…' });
    await expect(add).toHaveAttribute('aria-disabled', 'true');
    await expect(add).toHaveAttribute('title', 'Zlecenie jest zamknięte — procesów i etapów nie można zmieniać.');
    await page.getByRole('button', { name: 'Akcje procesu: Opinia ppoż' }).click();
    await expect(page.getByRole('menuitem', { name: /^Usuń proces…/ })).toHaveAttribute('aria-disabled', 'true');
    expect(
      api.seen.filter((entry) => entry.method === 'DELETE' || (entry.method === 'POST' && entry.url.includes('/procedure'))),
    ).toHaveLength(0);
  });

  test('EVM-042 AC7 offline the actions are disabled with the reason', async ({ page, context }) => {
    await createOrder(page, true);
    await context.setOffline(true);
    const add = page.getByRole('button', { name: 'Dodaj proces…' });
    await expect(add).toHaveAttribute('aria-disabled', 'true');
    await expect(add).toHaveAttribute('title', 'Zmienisz po powrocie połączenia.');
    await page.getByRole('button', { name: 'Akcje procesu: Opinia ppoż' }).click();
    await expect(page.getByRole('menuitem', { name: /^Dodaj etap…/ })).toHaveAttribute('title', 'Zmienisz po powrocie połączenia.');
    await context.setOffline(false);
  });
});
