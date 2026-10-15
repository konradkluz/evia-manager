import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';
import { freezeServerDay, seedMilestones } from './mock-payments.ts';
import { virtualAuthenticator } from './support.ts';

// The corrections of payments in W-06 in a real browser against the synthetic API (EVM-057 AC1–AC8): the dialogs K1–K6 with "before →
// after", W-04 after `403 step_up_required` and the retry with the same key, "Nie wykonano korekty.", "Po terminie" counted anew, a
// closed order and the roles. Time is frozen in the mock: the day of the synthetic server is fixed (it counts "Po terminie") and the
// clock of the tab is set to another day, so nothing depends on the clock of the machine. WebAuthn needs a domain name, so the spec runs
// on `localhost`; Chromium and Edge get a virtual authenticator, Firefox has none (ADR-0015) — there the step-up is already fresh and
// W-04 does not appear. The full stack (the database, the audit with the amounts before and after, the journal, the projection, the
// role matrix with IDOR) is covered by the API integration tests.
test.use({ baseURL: 'http://localhost:4173', session: 'active', bypassCSP: false });

const NO_FIREFOX = 'Firefox has no virtual authenticator; the passkey ceremony is covered by the API integration tests (ADR-0015).';
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NBSP = ' ';
const zl = (text: string): string => text.replaceAll(' ', NBSP);
const STEP_UP = 'Potwierdź tożsamość, aby skorygować płatność';
const AUDIT = 'Operacja zostanie zapisana w dzienniku audytu.';
/** The day of the synthetic server — "Po terminie" is counted from it. */
const SERVER_DAY = '2026-10-14';
/** The clock of the tab — deliberately another day (and before the real one: the synthetic session expires from it). */
const BROWSER_NOW = new Date('2026-10-01T10:00:00+02:00');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(BROWSER_NOW);
});

/** Registers a passkey in the virtual authenticator and teaches the server its id (what EVM-016 did for the account). */
async function accountWithPasskey(page: Page, api: MockApi): Promise<void> {
  await virtualAuthenticator(page);
  await page.goto('/login');
  api.credentialId = await page.evaluate(async () => {
    const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON({
      rp: { id: 'localhost', name: 'EVia Manager' },
      user: { id: 'dXNlci1oYW5kbGU', name: 'anna.testowa@example.com', displayName: 'Anna Testowa' },
      challenge: 'Y2hhbGxlbmdl',
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      attestation: 'none',
    });
    const credential = await navigator.credentials.create({ publicKey });
    if (!(credential instanceof PublicKeyCredential)) throw new Error('no credential');
    return credential.id;
  });
}

/**
 * Creates ZL-2026-0042 (the plan of four instalments) and sets them: "Zaliczka" invoiced FV/TEST/0007/2026 for 3 600,00 zł due
 * 2026-10-10 (after the due date on the server day), "Po uzyskaniu zgód" paid (due 2026-09-27, paid 2026-10-03), "Po wykonaniu
 * instalacji" planned, "Płatność końcowa" cancelled. Returns the address of the order.
 */
async function seededOrder(page: Page, api: MockApi): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  const path = new URL(page.url()).pathname;
  const orderId = path.split('/').at(-1) ?? '';
  seedMilestones(api.orders, orderId, [
    { status: 'invoiced', amountMinor: 360_000, invoiceNumber: 'FV/TEST/0007/2026', invoicedOn: '2026-10-03', dueDate: '2026-10-10' },
    {
      status: 'paid',
      amountMinor: 540_000,
      invoiceNumber: 'FV/TEST/0008/2026',
      invoicedOn: '2026-09-20',
      dueDate: '2026-09-27',
      paidOn: '2026-10-03',
    },
    { amountMinor: 540_000 },
    { status: 'cancelled' },
  ]);
  freezeServerDay(api.orders, SERVER_DAY);
  await page.reload();
  await expect(section(page).getByRole('table', { name: 'Transze płatności zlecenia' })).toBeVisible();
  return path;
}

const section = (page: Page) => page.getByRole('region', { name: 'Płatności', exact: true });
const rowOf = (page: Page, name: string) => section(page).getByRole('row', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) });
const writes = (api: MockApi, method: string) =>
  api.seen.filter((entry) => entry.method === method && entry.url.includes('/payment-milestones/'));

async function choose(page: Page, name: string, item: string) {
  await page.getByRole('button', { name: `Akcje transzy: ${name}` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe('the corrections of payments (EVM-057)', () => {
  test('EVM-057 AC1 AC5 "Wycofaj fakturę…": "Wystawiona → Planowana", W-04 after 403 step_up_required, the same request with the same key, "Po terminie" gone', async ({
    page,
    api,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    await accountWithPasskey(page, api);
    await seededOrder(page, api);
    await expect(rowOf(page, 'Zaliczka (20%)').getByText('Po terminie')).toBeVisible();
    await choose(page, 'Zaliczka (20%)', 'Wycofaj fakturę…');
    const dialog = page.getByRole('alertdialog', { name: 'Wycofać fakturę FV/TEST/0007/2026?' });
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await expect(dialog.getByText('Stan: z Wystawiona na Planowana')).toBeAttached();
    await expect(dialog.getByText(zl('3 600,00 zł'))).toBeVisible();
    await expect(dialog.getByText('Numer faktury, data wystawienia i termin zostaną wyczyszczone.')).toBeVisible();
    await expect(dialog.getByText(AUDIT)).toBeVisible();
    await dialog.getByRole('button', { name: 'Wycofaj fakturę' }).click();

    const stepUp = page.getByRole('alertdialog', { name: STEP_UP });
    await expect(stepUp.getByText('Wycofanie faktury FV/TEST/0007/2026')).toBeVisible();
    await expect(stepUp.getByText(`Transza „Zaliczka” · ZL-2026-0042 · ${zl('3 600,00 zł')}`)).toBeVisible();
    await stepUp.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
    await expect(page.getByText('Wycofano fakturę FV/TEST/0007/2026 — transza jest Planowana.')).toBeVisible();
    const row = rowOf(page, 'Zaliczka (20%)');
    await expect(row.getByText('Planowana')).toBeVisible();
    await expect(row.getByText('Po terminie')).toHaveCount(0);
    await expect(row.getByText('FV/TEST/0007/2026')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' })).toBeFocused();
    const posts = writes(api, 'POST');
    expect(posts).toHaveLength(2);
    expect(posts.map((entry) => JSON.parse(entry.postData ?? '{}') as unknown)).toEqual([{ to: 'planned' }, { to: 'planned' }]);
    expect(posts[0]?.headers['idempotency-key']).toMatch(UUIDV7);
    expect(posts[1]?.headers['idempotency-key']).toBe(posts[0]?.headers['idempotency-key']);
    expect(posts.map((entry) => entry.headers['if-match'])).toEqual(['"2"', '"2"']);
  });

  test('EVM-057 AC3 AC5 "Zmień kwotę…": cancelling W-04 says "Nie wykonano korekty." and keeps 3 690,00; then 3 600,00 zł → 3 690,00 zł', async ({
    page,
    api,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    await accountWithPasskey(page, api);
    await seededOrder(page, api);
    await choose(page, 'Zaliczka (20%)', 'Zmień kwotę…');
    const dialog = page.getByRole('dialog', { name: 'Zmienić kwotę transzy „Zaliczka”?' });
    const field = dialog.getByRole('textbox', { name: 'Nowa kwota' });
    await expect(field).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Zmień kwotę' })).toHaveAttribute('aria-disabled', 'true');
    await field.fill('3690');
    await expect(dialog.getByText(`${zl('3 600,00 zł')} → ${zl('3 690,00 zł')}`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Zmień kwotę' }).click();
    const stepUp = page.getByRole('alertdialog', { name: STEP_UP });
    await expect(stepUp.getByText(`Zmiana kwoty transzy „Zaliczka”: ${zl('3 600,00 zł')} → ${zl('3 690,00 zł')}`)).toBeVisible();
    await stepUp.getByRole('button', { name: 'Anuluj' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Nie wykonano korekty.');
    await expect(field).toHaveValue(/^3\s690,00$/u);
    await expect(field).toBeFocused();

    await dialog.getByRole('button', { name: 'Zmień kwotę' }).click();
    await stepUp.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
    await expect(page.getByText(`Zmieniono kwotę transzy „Zaliczka”: ${zl('3 600,00 zł')} → ${zl('3 690,00 zł')}.`)).toBeVisible();
    await expect(rowOf(page, 'Zaliczka (20%)').getByText(zl('3 690,00 zł'))).toBeVisible();
    const patches = writes(api, 'PATCH');
    expect(patches).toHaveLength(3);
    expect(JSON.parse(patches[2]?.postData ?? '{}')).toEqual({ amount: { amountMinor: 369_000, currency: 'PLN' } });
    expect(new Set(patches.map((entry) => entry.headers['idempotency-key'])).size).toBe(1);
  });

  test('EVM-057 AC2 AC4 with a fresh step-up: "Cofnij wpłatę…" makes it "Po terminie" at once, "Anuluj fakturę…", "Przywróć transzę…", "Usuń transzę…"', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    const path = await seededOrder(page, api);

    await choose(page, 'Po uzyskaniu zgód (30%)', 'Cofnij wpłatę…');
    const undo = page.getByRole('alertdialog', { name: 'Cofnąć wpłatę za fakturę FV/TEST/0008/2026?' });
    await expect(undo.getByText('Data wpłaty 03.10.2026 zostanie wyczyszczona.')).toBeVisible();
    await expect(undo.getByText('Transza może od razu być po terminie, jeśli termin minął.')).toBeVisible();
    await undo.getByRole('button', { name: 'Cofnij wpłatę' }).click();
    await expect(page.getByText('Cofnięto wpłatę za fakturę FV/TEST/0008/2026 — transza jest Wystawiona.')).toBeVisible();
    await expect(rowOf(page, 'Po uzyskaniu zgód (30%)').getByText('Po terminie')).toBeVisible();
    await expect(page.getByRole('alertdialog', { name: STEP_UP })).toHaveCount(0);

    await choose(page, 'Zaliczka (20%)', 'Anuluj fakturę…');
    await page
      .getByRole('alertdialog', { name: 'Anulować fakturę FV/TEST/0007/2026?' })
      .getByRole('button', { name: 'Anuluj fakturę' })
      .click();
    await expect(page.getByText('Anulowano fakturę FV/TEST/0007/2026.')).toBeVisible();
    await expect(rowOf(page, 'Zaliczka (20%)').getByText('Anulowana')).toBeVisible();

    await choose(page, 'Płatność końcowa (20%)', 'Przywróć transzę…');
    const restore = page.getByRole('alertdialog', { name: 'Przywrócić transzę „Płatność końcowa”?' });
    await expect(restore.getByText('Transza wróci na swoje miejsce na liście.')).toBeVisible();
    await restore.getByRole('button', { name: 'Przywróć transzę' }).click();
    await expect(page.getByText('Przywrócono transzę „Płatność końcowa” — jest Planowana.')).toBeVisible();
    await expect(rowOf(page, 'Płatność końcowa (20%)').getByText('Planowana')).toBeVisible();

    await choose(page, 'Po wykonaniu instalacji (30%)', 'Usuń transzę…');
    const remove = page.getByRole('alertdialog', { name: 'Usunąć transzę „Po wykonaniu instalacji”?' });
    await expect(remove.getByText('Transza zniknie z listy. Edytor i osoba z rolą Tylko odczyt jej nie zobaczą.')).toBeVisible();
    await remove.getByRole('button', { name: 'Usuń transzę' }).click();
    await expect(page.getByText('Usunięto transzę „Po wykonaniu instalacji”.')).toBeVisible();
    await expect(rowOf(page, 'Po wykonaniu instalacji (30%)')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Akcje transzy: Płatność końcowa (20%)' })).toBeFocused();
    const deletes = writes(api, 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.headers['if-match']).toBe('"2"');
    expect(deletes[0]?.headers['idempotency-key']).toMatch(UUIDV7);
    expect(writes(api, 'POST').map((entry) => JSON.parse(entry.postData ?? '{}') as unknown)).toEqual([
      { to: 'invoiced' },
      { to: 'cancelled' },
      { to: 'planned' },
    ]);

    // AC4: the deleted instalment is gone for the Editor and Tylko odczyt too
    for (const role of ['editor', 'read_only'] as const) {
      api.role = role;
      await page.goto(path);
      await expect(section(page).getByRole('table', { name: 'Transze płatności zlecenia' })).toBeVisible();
      await expect(rowOf(page, 'Po wykonaniu instalacji (30%)')).toHaveCount(0);
    }
  });

  test('EVM-057 AC7 a settled order: every correction is disabled for the Administrator; a race gives 409 with the text of AC7', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    const path = await seededOrder(page, api);
    const orderId = path.split('/').at(-1) ?? '';
    // the race: the order is settled meanwhile (the screen still shows it open)
    api.orders.states.set(orderId, { status: 'settled', version: 7 });
    await choose(page, 'Zaliczka (20%)', 'Wycofaj fakturę…');
    const dialog = page.getByRole('alertdialog', { name: 'Wycofać fakturę FV/TEST/0007/2026?' });
    await dialog.getByRole('button', { name: 'Wycofaj fakturę' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Zlecenie jest rozliczone — płatności są tylko do odczytu. Przywrócić zlecenie może tylko administrator.',
    );
    await expect(dialog.getByRole('button', { name: 'Wycofaj fakturę' })).toHaveAttribute('aria-disabled', 'true');
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
    const withdraw = page.getByRole('menuitem', { name: /Wycofaj fakturę…/ });
    await expect(withdraw).toHaveAttribute('aria-disabled', 'true');
    await expect(withdraw).toHaveAttribute(
      'title',
      'Zlecenie jest rozliczone — płatności są tylko do odczytu. Zmienisz je po przywróceniu zlecenia.',
    );
  });

  test('EVM-057 AC8 412: "Tę transzę zmieniono w międzyczasie (teraz: «Opłacona»)." with "Odśwież"; the Editor has the corrections disabled', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    const path = await seededOrder(page, api);
    const orderId = path.split('/').at(-1) ?? '';
    await choose(page, 'Zaliczka (20%)', 'Anuluj fakturę…');
    // the instalment was paid meanwhile in another tab
    seedMilestones(api.orders, orderId, [{ status: 'paid', paidOn: '2026-10-13' }]);
    const dialog = page.getByRole('alertdialog', { name: 'Anulować fakturę FV/TEST/0007/2026?' });
    await dialog.getByRole('button', { name: 'Anuluj fakturę' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Tę transzę zmieniono w międzyczasie (teraz: «Opłacona»).');
    await dialog.getByRole('button', { name: 'Odśwież' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(rowOf(page, 'Zaliczka (20%)').getByText('Opłacona')).toBeVisible();

    api.role = 'editor';
    await page.goto(path);
    await page.getByRole('button', { name: 'Akcje transzy: Płatność końcowa (20%)' }).click();
    const restore = page.getByRole('menuitem', { name: /Przywróć transzę…/ });
    await expect(restore).toHaveAttribute('aria-disabled', 'true');
    await expect(restore).toHaveAttribute('title', 'Korektę płatności może wykonać tylko administrator.');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(writes(api, 'POST')).toHaveLength(1);
  });

  for (const width of [360, 768, 1280, 1440]) {
    test(`EVM-057 AC1 at ${String(width)} px the dialog fits the viewport; "przed → po" is one line from medium, two lines at 360 px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      api.stepUp = 'fresh';
      await seededOrder(page, api);
      const trigger = page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await page.getByRole('menuitem', { name: 'Wycofaj fakturę…' }).click();
      const dialog = page.getByRole('alertdialog', { name: 'Wycofać fakturę FV/TEST/0007/2026?' });
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      if (box === null) return;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      for (const button of await dialog.getByRole('button').all()) await expect(button).toBeInViewport({ ratio: 1 });
      if (width < 768) {
        await expect(dialog.getByText('Przed:')).toBeVisible();
        await expect(dialog.getByText('Po:')).toBeVisible();
        await expect(dialog.getByText('Stan:', { exact: true })).toBeHidden();
      } else {
        await expect(dialog.getByText('Stan:', { exact: true })).toBeVisible();
        await expect(dialog.getByText('Przed:')).toBeHidden();
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
});
