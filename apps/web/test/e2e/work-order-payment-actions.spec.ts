import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';

// The actions of the instalments in W-06 in a real browser against the synthetic API (EVM-054 AC1–AC8): "Wystaw fakturę…",
// "Odnotuj wpłatę…", "Anuluj transzę…", the corrections of the data, the corrections that wait for EVM-057, cancelling an order with
// an invoiced instalment, a closed order and the roles. The full stack (the database, the audit with the codes of the statuses, the
// journal, the role and channel matrix, the race with cancelling the order) is covered by the API integration tests.
test.use({ session: 'active' });

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADMIN_ONLY = 'Korektę płatności może wykonać tylko administrator.';

/** Today and tomorrow in Europe/Warsaw (the clock of the synthetic server and of the browser are the same machine). */
const dayOf = (offsetDays: number): string =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

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

async function setStatus(page: Page, api: MockApi, path: string, status: string) {
  const id = path.split('/').at(-1) ?? '';
  api.orders.states.set(id, { status, version: 7 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
}

const section = (page: Page) => page.getByRole('region', { name: 'Płatności', exact: true });
const rowOf = (page: Page, name: string) => section(page).getByRole('row', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) });
const transitions = (api: MockApi) => api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/transitions'));

/** "Wystaw fakturę…" of "Zaliczka (20%)": 1 230,00 zł, FV/TEST/0021/2026 on 2026-10-03 (the due date of the plan — 7 days). */
async function issueInvoice(page: Page) {
  await rowOf(page, 'Zaliczka (20%)').getByRole('button', { name: 'Wystaw fakturę…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Wystawić fakturę dla transzy „Zaliczka”?' });
  await expect(dialog.getByRole('textbox', { name: 'Kwota' })).toBeFocused();
  await dialog.getByRole('textbox', { name: 'Kwota' }).fill('1230');
  await dialog.getByRole('textbox', { name: 'Nr faktury lub proformy' }).fill('FV/TEST/0021/2026');
  await dialog.getByLabel('Data wystawienia').fill('2026-10-03');
  await expect(dialog.getByLabel('Termin płatności')).toHaveValue('2026-10-10');
  await expect(dialog.getByText('Cofnąć wystawienie może tylko administrator.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Wystaw fakturę' }).click();
  await expect(page.getByText('Wystawiono fakturę FV/TEST/0021/2026 na 1 230,00 zł, termin płatności 10.10.2026.')).toBeVisible();
}

test.describe('the actions of the instalments (EVM-054)', () => {
  test('EVM-054 AC1 "Wystaw fakturę…" makes the instalment "Wystawiona" with the due date of the plan; the request has If-Match and a key', async ({
    page,
    api,
  }) => {
    await createOrder(page);
    await issueInvoice(page);
    const row = rowOf(page, 'Zaliczka (20%)');
    await expect(row.getByText(/^(Wystawiona|Po terminie)$/)).toBeVisible();
    await expect(row.getByText('FV/TEST/0021/2026')).toBeVisible();
    await expect(row.getByText('10.10.2026')).toBeVisible();
    await expect(section(page).getByText('Nieopłacone 1 230,00 zł · Opłacone 0,00 zł')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' })).toBeFocused();
    const [request] = transitions(api);
    expect(JSON.parse(request?.postData ?? '{}')).toEqual({
      to: 'invoiced',
      amount: { amountMinor: 123000, currency: 'PLN' },
      invoiceNumber: 'FV/TEST/0021/2026',
      invoicedOn: '2026-10-03',
    });
    expect(request?.headers['if-match']).toBe('"1"');
    expect(request?.headers['idempotency-key']).toMatch(UUIDV7);
  });

  test('EVM-054 AC2 "Odnotuj wpłatę…" — the focus on "Anuluj", a day in the future refused, today accepted, no "Cofnij"', async ({
    page,
  }) => {
    await createOrder(page);
    await issueInvoice(page);
    await rowOf(page, 'Zaliczka (20%)').getByRole('button', { name: 'Odnotuj wpłatę…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Odnotować wpłatę za transzę „Zaliczka”?' });
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await expect(dialog.getByText('Faktura FV/TEST/0021/2026 · 1 230,00 zł')).toBeVisible();
    await expect(dialog.getByLabel('Data wpłaty')).toHaveValue(dayOf(0));
    await dialog.getByLabel('Data wpłaty').fill(dayOf(1));
    await dialog.getByRole('button', { name: 'Odnotuj wpłatę' }).click();
    await expect(dialog.getByText('Data wpłaty nie może być późniejsza niż dziś.')).toBeVisible();
    await dialog.getByLabel('Data wpłaty').fill(dayOf(0));
    await dialog.getByRole('button', { name: 'Odnotuj wpłatę' }).click();
    await expect(page.getByText('Odnotowano wpłatę 1 230,00 zł za fakturę FV/TEST/0021/2026.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cofnij' })).toHaveCount(0);
    await expect(rowOf(page, 'Zaliczka (20%)').getByText('Opłacona')).toBeVisible();
    await expect(section(page).getByText('Nieopłacone 0,00 zł · Opłacone 1 230,00 zł')).toBeVisible();
  });

  test('EVM-054 AC3 "Anuluj transzę…" with the required reason makes it "Anulowana"', async ({ page, api }) => {
    await createOrder(page);
    await page.getByRole('button', { name: 'Akcje transzy: Płatność końcowa (20%)' }).click();
    await page.getByRole('menuitem', { name: 'Anuluj transzę…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Anulować transzę „Płatność końcowa”?' });
    await expect(dialog.getByRole('textbox', { name: 'Powód anulowania' })).toBeFocused();
    await expect(dialog.getByText('Przywrócić transzę może tylko administrator.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Anuluj transzę' }).click();
    await expect(dialog.getByText('Podaj powód anulowania.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Powód anulowania' }).fill('Klient zrezygnował z tej transzy');
    await dialog.getByRole('button', { name: 'Anuluj transzę' }).click();
    await expect(page.getByText('Anulowano transzę „Płatność końcowa”.')).toBeVisible();
    await expect(rowOf(page, 'Płatność końcowa (20%)').getByText('Anulowana')).toBeVisible();
    expect(JSON.parse(transitions(api)[0]?.postData ?? '{}')).toEqual({ to: 'cancelled', reason: 'Klient zrezygnował z tej transzy' });
  });

  test('EVM-054 AC4 "Popraw dane faktury…" and "Popraw datę wpłaty…" save with If-Match without changing the amount or the status', async ({
    page,
    api,
  }) => {
    await createOrder(page);
    await issueInvoice(page);
    await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
    await page.getByRole('menuitem', { name: 'Popraw dane faktury…' }).click();
    const details = page.getByRole('dialog', { name: 'Popraw dane faktury' });
    await expect(details.getByText('Kwota: 1 230,00 zł')).toBeVisible();
    await details.getByRole('textbox', { name: 'Nr faktury lub proformy' }).fill('FV/TEST/0031/2026');
    await details.getByLabel('Termin płatności').fill('2026-10-17');
    await details.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByText('Zapisano dane faktury FV/TEST/0031/2026.')).toBeVisible();
    const row = rowOf(page, 'Zaliczka (20%)');
    await expect(row.getByText('17.10.2026')).toBeVisible();
    await expect(row.getByText(/^(Wystawiona|Po terminie)$/)).toBeVisible();
    const patch = api.seen.filter((entry) => entry.method === 'PATCH').at(-1);
    expect(JSON.parse(patch?.postData ?? '{}')).toEqual({ invoiceNumber: 'FV/TEST/0031/2026', dueDate: '2026-10-17' });
    expect(patch?.headers['if-match']).toBe('"2"');

    await row.getByRole('button', { name: 'Odnotuj wpłatę…' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Odnotuj wpłatę' }).click();
    await expect(row.getByText('Opłacona')).toBeVisible();
    await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
    await page.getByRole('menuitem', { name: 'Popraw datę wpłaty…' }).click();
    const paidOn = page.getByRole('dialog', { name: 'Popraw datę wpłaty' });
    await paidOn.getByLabel('Data wpłaty').fill('2026-10-02');
    await paidOn.getByRole('button', { name: 'Zapisz datę' }).click();
    await expect(page.getByText('Zapisano datę wpłaty 02.10.2026.')).toBeVisible();
    await expect(row.getByText('1 230,00 zł')).toBeVisible();
  });

  test('EVM-054 AC5 the Editor sees the corrections disabled with the reason; the Administrator does not see them', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    await issueInvoice(page);
    await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Popraw dane faktury…']);
    await page.keyboard.press('Escape');
    api.role = 'editor';
    await page.goto(path);
    await page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }).click();
    const withdraw = page.getByRole('menuitem', { name: /Wycofaj fakturę…/ });
    await expect(withdraw).toHaveAttribute('aria-disabled', 'true');
    await expect(withdraw).toHaveAttribute('title', ADMIN_ONLY);
    await expect(page.getByRole('menuitem', { name: /Usuń transzę…/ })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('separator')).toHaveCount(1);
    // the keyboard reaches the disabled item and its reason (§ 3.1)
    await page.keyboard.press('ArrowDown');
    await expect(withdraw).toBeFocused();
    await withdraw.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('EVM-054 AC6 an order "Wstrzymane" with an invoiced instalment is not cancelled: the dialog says what to do first', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    await issueInvoice(page);
    await setStatus(page, api, path, 'on_hold');
    await page.getByRole('button', { name: 'Status zlecenia: Wstrzymane. Zmień status' }).click();
    await page.getByRole('menuitem', { name: 'Anuluj zlecenie…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Anuluj zlecenie ZL-2026-0042' });
    await dialog.getByRole('textbox', { name: 'Powód anulowania' }).fill('Klient zrezygnował');
    await dialog.getByRole('button', { name: 'Anuluj zlecenie' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Najpierw odnotuj wpłatę albo poproś administratora o anulowanie faktury.');
    await expect(rowOf(page, 'Zaliczka (20%)').getByText(/^(Wystawiona|Po terminie)$/)).toBeVisible();
    await expect(section(page).getByText('Planowana', { exact: true })).toHaveCount(3);
  });

  test('EVM-054 AC7 AC8 a settled order disables the buttons of the rows; Tylko odczyt has none', async ({ page, api }) => {
    const path = await createOrder(page);
    await setStatus(page, api, path, 'settled');
    const invoice = rowOf(page, 'Zaliczka (20%)').getByRole('button', { name: 'Wystaw fakturę…' });
    await expect(invoice).toHaveAttribute('aria-disabled', 'true');
    await expect(invoice).toHaveAttribute(
      'title',
      'Zlecenie jest rozliczone — płatności są tylko do odczytu. Zmienisz je po przywróceniu zlecenia.',
    );
    api.role = 'read_only';
    await page.goto(path);
    await expect(section(page).getByRole('table', { name: 'Transze płatności zlecenia' })).toBeVisible();
    await expect(section(page).getByRole('button')).toHaveCount(0);
  });

  for (const width of [360, 768, 1280, 1440]) {
    test(`EVM-054 AC3 AC5 at ${String(width)} px the table fits W-06 and the whole menu of an instalment is in the viewport`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      await issueInvoice(page);
      api.role = 'editor';
      await page.goto(path);
      // § 3.6: the status and the actions of the row are visible without scrolling the frame of the table
      const frame = section(page).getByRole('region', { name: 'Transze płatności zlecenia' });
      await expect(frame).toBeVisible();
      expect(await frame.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
      const row = rowOf(page, 'Zaliczka (20%)');
      const pay = row.getByRole('button', { name: 'Odnotuj wpłatę…' });
      await pay.scrollIntoViewIfNeeded();
      await expect(pay).toBeInViewport({ ratio: 1 });
      await expect(row.getByText('Po terminie')).toBeInViewport({ ratio: 1 });
      // the longest menu (the Editor, "Wystawiona"): every item and the reason of AC5 are readable, nothing is cut
      const trigger = page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      const menu = page.getByRole('menu', { name: 'Akcje transzy: Zaliczka (20%)' });
      const box = await menu.boundingBox();
      expect(box).not.toBeNull();
      if (box === null) return;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(900);
      for (const item of await menu.getByRole('menuitem').all()) await expect(item).toBeInViewport({ ratio: 1 });
      await expect(menu.getByText(ADMIN_ONLY).first()).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      // "Anuluj transzę…" (AC3) of a planned instalment at the end of the table
      const last = page.getByRole('button', { name: 'Akcje transzy: Płatność końcowa (20%)' });
      await last.scrollIntoViewIfNeeded();
      await last.click();
      await expect(page.getByRole('menuitem', { name: 'Anuluj transzę…' })).toBeInViewport({ ratio: 1 });
    });
  }

  // Font metrics differ between platforms (Linux CI has wider glyphs): a menu wider than the toast limit must still be
  // wrapped and kept inside the viewport, so the test widens the text itself instead of relying on the platform.
  for (const [width, height] of [
    [360, 900],
    [360, 240],
  ] as const) {
    test(`EVM-054 AC3 AC5 at ${String(width)}x${String(height)} px a menu with wide labels wraps them and stays in the viewport`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height });
      const path = await createOrder(page);
      await issueInvoice(page);
      api.role = 'editor';
      await page.goto(path);
      const trigger = page.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      const menu = page.getByRole('menu', { name: 'Akcje transzy: Zaliczka (20%)' });
      await menu.evaluate((element) => {
        for (const item of element.querySelectorAll<HTMLElement>('*')) item.style.setProperty('font-size', '1.5rem');
        window.dispatchEvent(new Event('resize'));
      });
      const box = await menu.boundingBox();
      expect(box).not.toBeNull();
      if (box === null) return;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
    });
  }
});
