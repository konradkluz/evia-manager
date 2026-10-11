import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';
import { seedJournal } from './mock-journal.ts';

// "Dziennik" of an order in W-06 in a real browser against the synthetic API (EVM-037 AC1–AC8): a note and a comment, the correction
// instead of an edit, the text as text, the retry after a lost answer, the timeline with 60 entries, the role and the stores of the
// browser. The full stack (the database, the policies, the append-only trigger, the audit, the role matrix) is covered by the API
// integration tests.
test.use({ session: 'active' });

/** Creates the order ZL-2026-0042 through W-05 and opens its tab "Dziennik"; returns the id of the order. */
async function openJournal(page: Page): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  await page.getByRole('tab', { name: 'Dziennik' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Dziennik' })).toBeVisible();
  return id;
}

const posts = (api: MockApi) => api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/timeline'));
const entries = (page: Page) => page.locator('li[data-entry-id]');

test.describe('journal of a work order (EVM-037)', () => {
  test('EVM-037 AC1 AC2 a note with a category and a stage and a comment go to the top of the timeline with the toast', async ({
    page,
    api,
  }) => {
    await openJournal(page);
    await expect(page.getByText('Brak wpisów. Dodaj pierwszą notatkę.')).toBeVisible();
    await page.getByRole('button', { name: 'Rozmowa telefoniczna' }).click();
    await page.getByLabel('Etap (opcjonalnie)').selectOption({ label: 'Wniosek do OSD' });
    await page.getByRole('textbox', { name: 'Treść' }).fill('Uzgodniono z klientem podpisanie pełnomocnictwa.');
    await page.getByRole('button', { name: 'Dodaj wpis' }).click();
    await expect(page.getByText('Dodano wpis.')).toBeVisible();
    const first = entries(page).first();
    await expect(first).toContainText('Anna Testowa');
    await expect(first).toContainText('Uzgodniono z klientem podpisanie pełnomocnictwa.');
    await expect(first).toContainText('Rozmowa telefoniczna · Etap: Wniosek do OSD');
    await expect(first).toContainText('dziś,');
    expect(JSON.parse(posts(api)[0]?.postData ?? '{}')).toMatchObject({ kind: 'note', noteCategory: 'phone_call' });
    expect(posts(api)[0]?.headers['x-csrf-token']).toBe('csrf-active');
    await expect(page.getByRole('textbox', { name: 'Treść' })).toHaveValue('');

    await page.getByRole('radio', { name: 'Komentarz' }).check();
    await expect(page.getByRole('button', { name: 'Rozmowa telefoniczna' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Treść' }).fill('Proszę o potwierdzenie terminu.');
    await page.getByRole('button', { name: 'Dodaj komentarz' }).click();
    await expect(entries(page)).toHaveCount(2);
    const comment = entries(page).first();
    await expect(comment).toContainText('Proszę o potwierdzenie terminu.');
    await expect(comment.locator('svg.lucide-message-square-text')).toBeVisible();
    await expect(entries(page).nth(1).locator('svg.lucide-pencil')).toBeVisible();
  });

  test('EVM-037 AC3 a correction is a new entry: the old one is collapsed with "Zastąpiony poprawką" and "Pokaż treść"', async ({
    page,
    api,
  }) => {
    const id = await openJournal(page);
    seedJournal(api.journal, id, 1, () => 'Trasa kabla przez szacht A.');
    await page.reload();
    await page.getByRole('tab', { name: 'Dziennik' }).click();
    await page.getByRole('button', { name: /^Akcje wpisu/ }).click();
    await page.getByRole('menuitem', { name: 'Popraw wpis' }).click();
    const dialog = page.getByRole('dialog', { name: 'Popraw wpis' });
    await expect(dialog.getByRole('textbox', { name: 'Treść poprawki' })).toHaveValue('Trasa kabla przez szacht A.');
    await dialog.getByRole('textbox', { name: 'Treść poprawki' }).fill('Trasa kabla przez szacht B.');
    await dialog.getByRole('button', { name: 'Zapisz poprawkę' }).click();
    await expect(page.getByText('Dodano poprawkę wpisu.')).toBeVisible();
    await expect(entries(page)).toHaveCount(2);
    await expect(entries(page).first()).toContainText('Poprawka wpisu z dziś,');
    await expect(entries(page).first()).toContainText('Trasa kabla przez szacht B.');
    const old = entries(page).nth(1);
    await expect(old).toContainText('Zastąpiony poprawką z dziś,');
    await expect(old).not.toContainText('Trasa kabla przez szacht A.');
    await old.getByRole('button', { name: 'Pokaż treść' }).click();
    await expect(old).toContainText('Trasa kabla przez szacht A.');
    // the body of the correction points at the old entry; nothing else of the old one was sent
    expect(JSON.parse(posts(api)[0]?.postData ?? '{}')).toMatchObject({ supersedesEntryId: '01968f3e-0000-7000-8000-000000000001' });
    // the newest version can be corrected again, the replaced one cannot
    await expect(old.getByRole('button', { name: /^Akcje wpisu/ })).toHaveCount(0);
    await expect(
      entries(page)
        .first()
        .getByRole('button', { name: /^Akcje wpisu/ }),
    ).toBeVisible();
  });

  test('EVM-037 AC4 a script and a javascript: address are text; only https, tel and mailto are links; nothing runs', async ({
    page,
    api,
  }) => {
    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    await openJournal(page);
    const text =
      '<script>alert(1)</script> javascript:alert(1) https://example.invalid/mapa tel:+48600000001 mailto:biuro@example.invalid?cc=x@example.invalid';
    await page.getByRole('textbox', { name: 'Treść' }).fill(text);
    await page.getByRole('button', { name: 'Dodaj wpis' }).click();
    const first = entries(page).first();
    await expect(first).toContainText('<script>alert(1)</script> javascript:alert(1)');
    expect(await first.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual([
      'https://example.invalid/mapa',
      'tel:+48600000001',
      'mailto:biuro@example.invalid',
    ]);
    expect(await page.evaluate(() => document.querySelectorAll('main script').length)).toBe(0);
    expect(dialogs).toBe(0);
    expect(api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/timeline'))).toHaveLength(1);
  });

  test('EVM-037 AC5 a lost answer: the message, the text stays, the retry has the same id and key and there is one entry', async ({
    page,
    api,
  }) => {
    await openJournal(page);
    api.dropResponseNext.add('POST /api/v1/work-orders/:id/timeline');
    await page.getByRole('textbox', { name: 'Treść' }).fill('Wpis, na który nie wróciła odpowiedź.');
    await page.getByRole('button', { name: 'Dodaj wpis' }).click();
    await expect(page.getByText('Nie udało się dodać wpisu. Spróbuj ponownie — nie dodamy go dwa razy.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Treść' })).toHaveValue('Wpis, na który nie wróciła odpowiedź.');
    await page.getByRole('button', { name: 'Dodaj wpis' }).click();
    await expect(page.getByText('Dodano wpis.')).toBeVisible();
    await expect(entries(page)).toHaveCount(1);
    const [first, second] = posts(api);
    expect(first?.postData).toBe(second?.postData);
    expect(first?.headers['idempotency-key']).toBe(second?.headers['idempotency-key']);
    expect((JSON.parse(first?.postData ?? '{}') as { id?: string }).id).toBeTruthy();
  });

  test('EVM-037 AC6 60 entries: 25 at a time from the newest, grouped by day, "Pokaż starsze" and the filters', async ({ page, api }) => {
    const id = await openJournal(page);
    seedJournal(api.journal, id, 60);
    await page.reload();
    await page.getByRole('tab', { name: 'Dziennik' }).click();
    await expect(entries(page)).toHaveCount(25);
    await expect(entries(page).first()).toContainText('Wpis numer 1');
    await page.getByRole('button', { name: 'Pokaż starsze' }).click();
    await expect(entries(page)).toHaveCount(50);
    await expect(entries(page).first()).toContainText('Wpis numer 1');
    await page.getByRole('button', { name: 'Pokaż starsze' }).click();
    await expect(entries(page)).toHaveCount(60);
    await expect(page.getByRole('button', { name: 'Pokaż starsze' })).toHaveCount(0);
    // 60 entries a half-hour apart reach into the day before: more than one day group, always with the heading
    await expect(page.getByRole('heading', { level: 3 })).not.toHaveCount(0);

    await page.getByRole('button', { name: 'Komentarze' }).click();
    await expect(entries(page)).toHaveCount(12);
    await page.getByRole('button', { name: 'Wpisy' }).click();
    await expect(entries(page)).toHaveCount(25);
    expect(api.seen.some((entry) => entry.url.includes('kind=comment'))).toBe(true);
  });

  test('EVM-037 AC7 a settled order still takes an entry', async ({ page, api }) => {
    const id = await openJournal(page);
    api.orders.states.set(id, { status: 'settled', version: 9, closedAt: '2026-10-08T10:00:00.000Z' });
    await page.reload();
    await page.getByRole('tab', { name: 'Dziennik' }).click();
    await page.getByRole('textbox', { name: 'Treść' }).fill('Wpis po rozliczeniu.');
    await page.getByRole('button', { name: 'Dodaj wpis' }).click();
    await expect(page.getByText('Dodano wpis.')).toBeVisible();
    await expect(entries(page)).toHaveCount(1);
  });

  test('EVM-037 AC8 Tylko odczyt sees the timeline and the filters without the field and the menu', async ({ page, api }) => {
    const id = await openJournal(page);
    seedJournal(api.journal, id, 3);
    api.role = 'read_only';
    await page.reload();
    await page.getByRole('tab', { name: 'Dziennik' }).click();
    await expect(entries(page)).toHaveCount(3);
    await expect(page.getByRole('textbox', { name: 'Treść' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Dodaj wpis' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Akcje wpisu/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Komentarze' })).toBeVisible();
  });

  test('EVM-037 AC8 offline "Dodaj wpis" is disabled with the reason and the text stays', async ({ page, context }) => {
    await openJournal(page);
    await page.getByRole('textbox', { name: 'Treść' }).fill('Tekst bez zasięgu.');
    await context.setOffline(true);
    await expect(page.getByText('Dodasz wpis po powrocie połączenia.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dodaj wpis' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('textbox', { name: 'Treść' })).toHaveValue('Tekst bez zasięgu.');
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'Dodaj wpis' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('EVM-037 AC8 a text over the limit is not sent and says the limit', async ({ page, api }) => {
    await openJournal(page);
    await page.getByRole('textbox', { name: 'Treść' }).fill('a'.repeat(10_001));
    await expect(page.getByText(/Treść może mieć najwyżej 10\s000 znaków\./)).toBeVisible();
    await page.getByRole('button', { name: 'Dodaj wpis' }).click();
    expect(posts(api)).toHaveLength(0);
  });

  test('EVM-037 AC8 SR-WEB-05 the draft and the journal are in the memory of the tab only: no localStorage, sessionStorage, IndexedDB or cache; not in the address or the title', async ({
    page,
    api,
  }) => {
    const id = await openJournal(page);
    seedJournal(api.journal, id, 2, (n) => `Poufny wpis ${String(n)}`);
    await page.reload();
    await page.getByRole('tab', { name: 'Dziennik' }).click();
    await expect(entries(page)).toHaveCount(2);
    await page.getByRole('textbox', { name: 'Treść' }).fill('Szkic z danymi klienta');
    await expect(page.getByText(/Szkic w tej karcie · /)).toBeVisible();
    const stores = await page.evaluate(async () => ({
      local: JSON.stringify(Object.entries(localStorage)),
      session: JSON.stringify(Object.entries(sessionStorage)),
      databases: (await indexedDB.databases()).length,
      caches: (await caches.keys()).length,
      url: location.href,
      title: document.title,
    }));
    for (const value of [stores.local, stores.session, stores.url, stores.title]) {
      expect(value).not.toContain('Szkic z danymi klienta');
      expect(value).not.toContain('Poufny wpis');
    }
    expect(stores.databases).toBe(0);
    expect(stores.caches).toBe(0);
  });

  test('EVM-037 AC6 a failed read has "Spróbuj ponownie" and the read works afterwards', async ({ page, api }) => {
    const id = await openJournal(page);
    seedJournal(api.journal, id, 1);
    api.failNext.set(`GET /api/v1/work-orders/${id}/timeline`, { status: 500, code: 'internal_error' });
    await page.getByRole('tab', { name: 'Przegląd' }).click();
    await page.getByRole('tab', { name: 'Dziennik' }).click();
    await expect(page.getByText('Nie udało się wczytać dziennika.')).toBeVisible();
    await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    await expect(entries(page)).toHaveCount(1);
  });
});
