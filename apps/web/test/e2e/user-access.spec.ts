import { expect, test } from './fixtures.ts';
import { watchPage } from './support.ts';

// W-16 operations on an account in the browser (EVM-027 AC1–AC5, AC7, AC8): the real panel under the real strict CSP against the
// synthetic API of mock-api.ts. The policy of the real server (blocking, audit, sessions, e-mails) is covered by the API
// integration tests; the passkey ceremony of W-04 by the component tests and the API tests (ADR-0015), so the confirmation window
// is open here.
test.use({ baseURL: 'http://localhost:4173', session: 'active' });

const ORIGIN = 'http://localhost:4173';
const USERS = '/administration/users';
const ALERT = 'Wszyscy administratorzy dostaną alert bezpieczeństwa.';

const menu = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^Akcje konta: ${name},`) });

test.describe('W-16 operations on accounts in the browser (EVM-027)', () => {
  test('EVM-027 AC1 AC7 the role goes from Edytor to Tylko odczyt: no alert for Administrators, the row changes, the toast says it, the focus returns to the menu', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    const problems = await watchPage(page, ORIGIN);
    await page.goto(USERS);
    await menu(page, 'Jan Przykładowy').click();
    await page.getByRole('menuitem', { name: 'Zmień rolę…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zmienić rolę konta „Jan Przykładowy”?' });
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await expect(dialog.getByRole('radio', { name: /^Edytor.*\(obecna\)$/ })).toBeChecked();
    await dialog.getByRole('radio', { name: /^Tylko odczyt/ }).check();
    await expect(dialog.getByText(ALERT)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Zmień rolę' }).click();
    await expect(page.getByText('Zmieniono rolę.')).toBeVisible();
    await expect(page.getByRole('row', { name: /^Jan Przykładowy, Tylko odczyt, Aktywne$/ })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(menu(page, 'Jan Przykładowy')).toBeFocused();
    expect(problems.page).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test('EVM-027 AC1 AC7 the role Administrator: the alert is announced, an account with a key is made, an account without a key is told to add one and nothing is sent', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    await page.goto(USERS);
    await menu(page, 'Biuro Testowe').click();
    await page.getByRole('menuitem', { name: 'Zmień rolę…' }).click();
    const biuro = page.getByRole('dialog', { name: 'Zmienić rolę konta „Biuro Testowe”?' });
    await biuro.getByRole('radio', { name: /^Administrator/ }).check();
    await expect(biuro.getByText(ALERT)).toBeVisible();
    await biuro.getByRole('button', { name: 'Zmień rolę' }).click();
    await expect(biuro.getByRole('alert')).toHaveText('To konto musi najpierw dodać klucz dostępu (Konto → Drugi krok logowania).');
    expect(api.seen.filter((entry) => entry.method === 'PUT')).toHaveLength(0);
    await biuro.getByRole('button', { name: 'Anuluj' }).click();
    await menu(page, 'Jan Przykładowy').click();
    await page.getByRole('menuitem', { name: 'Zmień rolę…' }).click();
    const jan = page.getByRole('dialog', { name: 'Zmienić rolę konta „Jan Przykładowy”?' });
    await jan.getByRole('radio', { name: /^Administrator/ }).check();
    await jan.getByRole('button', { name: 'Zmień rolę' }).click();
    await expect(page.getByRole('row', { name: /^Jan Przykładowy, Administrator, Aktywne$/ })).toBeVisible();
    const sent = api.seen.filter((entry) => entry.method === 'PUT');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers['if-match']).toBe('"3"');
    expect(JSON.parse(sent[0]?.postData ?? '{}')).toEqual({ role: 'administrator' });
  });

  test('EVM-027 AC2 the deactivation and the reactivation: the status follows, an account never activated returns to "Oczekuje na aktywację"', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    await page.goto(USERS);
    await menu(page, 'Jan Przykładowy').click();
    await page.getByRole('menuitem', { name: 'Dezaktywuj konto…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Dezaktywować konto „Jan Przykładowy”?' });
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Dezaktywuj konto' }).click();
    await expect(page.getByText('Dezaktywowano konto.')).toBeVisible();
    await expect(page.getByRole('row', { name: /^Jan Przykładowy, Edytor, Dezaktywowane$/ })).toBeVisible();
    await menu(page, 'Jan Przykładowy').click();
    await expect(page.getByRole('menuitem')).toHaveText(['Reaktywuj konto…']);
    await page.getByRole('menuitem', { name: 'Reaktywuj konto…' }).click();
    await expect(page.getByRole('alertdialog')).toContainText(
      'Konto odzyska dostęp z rolą Edytor i dotychczasowymi metodami drugiego kroku.',
    );
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reaktywuj konto' }).click();
    await expect(page.getByRole('row', { name: /^Jan Przykładowy, Edytor, Aktywne$/ })).toBeVisible();
  });

  test('EVM-027 AC3 "Wyloguj ze wszystkich sesji" asks, sends without If-Match and says the sessions ended', async ({ page, api }) => {
    api.stepUp = 'fresh';
    await page.goto(USERS);
    await menu(page, 'Jan Przykładowy').click();
    await page.getByRole('menuitem', { name: 'Wyloguj ze wszystkich sesji…' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Wyloguj ze wszystkich sesji' }).click();
    await expect(page.getByText('Zakończono sesje konta.')).toBeVisible();
    const sent = api.seen.filter((entry) => entry.method === 'DELETE');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers['if-match']).toBeUndefined();
  });

  test('EVM-027 AC4 the reset of the second step needs the way the identity was confirmed and sends it as a code', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    await page.goto(USERS);
    await menu(page, 'Jan Przykładowy').click();
    await page.getByRole('menuitem', { name: 'Zresetuj drugi krok logowania…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zresetować drugi krok logowania konta „Jan Przykładowy”?' });
    await expect(dialog.getByText(/w ciągu 24 godzin/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Zresetuj drugi krok' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Wybierz, jak potwierdzono tożsamość.');
    expect(api.seen.filter((entry) => entry.url.endsWith('/second-step-reset'))).toHaveLength(0);
    await dialog.getByRole('radio', { name: 'W rozmowie wideo' }).check();
    await dialog.getByRole('button', { name: 'Zresetuj drugi krok' }).click();
    await expect(page.getByText('Zresetowano drugi krok logowania.')).toBeVisible();
    const sent = api.seen.filter((entry) => entry.url.endsWith('/second-step-reset'));
    expect(JSON.parse(sent[0]?.postData ?? '{}')).toEqual({ identityVerification: 'video_call' });
  });

  test('EVM-027 AC8 a version that moved on gives 412: the alert, "Odśwież dane konta", the choice stays and the retry carries the new version', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    await page.goto(USERS);
    await menu(page, 'Jan Przykładowy').click();
    await page.getByRole('menuitem', { name: 'Zmień rolę…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zmienić rolę konta „Jan Przykładowy”?' });
    await dialog.getByRole('radio', { name: /^Tylko odczyt/ }).check();
    // Somebody else changed the account meanwhile.
    const jan = api.users.users.find((user) => user.email === 'jan.przykladowy@example.com');
    if (jan !== undefined) jan.version += 1;
    await dialog.getByRole('button', { name: 'Zmień rolę' }).click();
    await expect(dialog.getByRole('alert')).toContainText('To konto zmieniono w międzyczasie.');
    await dialog.getByRole('button', { name: 'Odśwież dane konta' }).click();
    await expect(dialog.getByRole('radio', { name: /^Tylko odczyt/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Zmień rolę' }).click();
    await expect(page.getByRole('row', { name: /^Jan Przykładowy, Tylko odczyt, Aktywne$/ })).toBeVisible();
    const sent = api.seen.filter((entry) => entry.method === 'PUT');
    expect(sent.map((entry) => entry.headers['if-match'])).toEqual(['"3"', '"4"']);
  });

  test('EVM-027 AC5 the only active Administrator cannot lose the role: the alert in the dialog; the own row has no menu', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    // The page offers no operation on the own row; the answer is the server rule (a race with another Administrator).
    api.users.users.push({
      id: '33333333-3333-4333-8333-333333333399',
      email: 'ewa.testowa@example.com',
      displayName: 'Ewa Testowa',
      role: 'administrator',
      status: 'active',
      invitation: null,
      version: 1,
      activatedAt: '2026-09-01T08:00:00.000Z',
      secondStepMethods: ['passkey'],
    });
    await page.goto(USERS);
    await expect(menu(page, 'Anna Testowa')).toHaveCount(0);
    await menu(page, 'Ewa Testowa').click();
    await page.getByRole('menuitem', { name: 'Zmień rolę…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zmienić rolę konta „Ewa Testowa”?' });
    // Anna is deactivated meanwhile (another tab): Ewa is now the only active Administrator.
    const anna = api.users.users.find((user) => user.email === 'anna.testowa@example.com');
    if (anna !== undefined) anna.status = 'deactivated';
    await dialog.getByRole('radio', { name: /^Edytor/ }).check();
    await dialog.getByRole('button', { name: 'Zmień rolę' }).click();
    await expect(dialog.getByRole('alert')).toContainText('system musi mieć co najmniej jednego aktywnego administratora');
    await dialog.getByRole('button', { name: 'Odśwież listę' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('EVM-027 AC8 the menu works from the keyboard: arrows, Enter opens the dialog, Esc closes it and the focus returns to the trigger', async ({
    page,
    api,
  }) => {
    api.stepUp = 'fresh';
    await page.goto(USERS);
    await menu(page, 'Jan Przykładowy').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Zmień rolę…' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Wyloguj ze wszystkich sesji…' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog', { name: /^Wylogować konto „Jan Przykładowy”/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(menu(page, 'Jan Przykładowy')).toBeFocused();
  });
});
