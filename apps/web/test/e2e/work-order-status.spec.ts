import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';
import { virtualAuthenticator, watchPage } from './support.ts';

// The status of a work order in W-06 in a real browser against the synthetic API (EVM-030 AC1–AC8): the menu of the badge, the dialogs, the
// toasts with "Cofnij", the restore with W-04, the banner of a closed order. WebAuthn needs a domain name for the relying party, so the spec
// runs on `localhost`; Chromium and Edge get a virtual authenticator, Firefox has none (ADR-0015), so the part with a key skips there.
// The rules of the table, the locking and the audit are covered by the API integration tests.
test.use({ baseURL: 'http://localhost:4173', session: 'active', bypassCSP: false });

const ORIGIN = 'http://localhost:4173';
const NO_FIREFOX = 'Firefox has no virtual authenticator; the passkey ceremony is covered by the API integration tests (ADR-0015).';

/** Creates the order ZL-2026-0042 through W-05 and returns its address (the synthetic API has no other order to read). */
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

const badge = (page: Page, status: string) => page.getByRole('button', { name: `Status zlecenia: ${status}. Zmień status` });

async function choose(page: Page, status: string, item: string | RegExp) {
  await badge(page, status).click();
  await page.getByRole('menuitem', { name: item }).click();
}

const transitions = (api: MockApi) => api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/transitions'));

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

test.describe('status of a work order in W-06 (EVM-030)', () => {
  test('EVM-030 AC1 AC3 the order goes from "Nowe" to "Rozliczone" through the menu; every request has If-Match, an Idempotency-Key and the CSRF token; the banner of the closed order shows', async ({
    page,
    api,
  }) => {
    const problems = await watchPage(page, ORIGIN);
    const path = await createOrder(page);
    await page.goto(path);
    await expect(badge(page, 'Nowe')).toBeVisible();

    await choose(page, 'Nowe', 'Zaakceptuj bez wyceny');
    await expect(badge(page, 'Zaakceptowane')).toBeVisible();
    await expect(page.getByText('Zaakceptowano zlecenie.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cofnij' })).toHaveCount(0);
    await choose(page, 'Zaakceptowane', 'Rozpocznij realizację');
    await expect(badge(page, 'W realizacji')).toBeVisible();

    await choose(page, 'W realizacji', 'Zakończ');
    const complete = page.getByRole('dialog', { name: 'Zakończ zlecenie ZL-2026-0042' });
    await expect(complete.getByLabel('Data zakończenia')).not.toHaveValue('');
    await complete.getByRole('button', { name: 'Zakończ zlecenie' }).click();
    await expect(badge(page, 'Zakończone')).toBeVisible();
    await expect(page.getByText('Zakończono zlecenie.')).toBeVisible();

    await choose(page, 'Zakończone', 'Rozlicz…');
    const settle = page.getByRole('alertdialog', { name: 'Rozliczyć zlecenie ZL-2026-0042?' });
    await expect(settle.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await settle.getByRole('button', { name: 'Rozlicz zlecenie' }).click();
    await expect(badge(page, 'Rozliczone')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Stan zlecenia' })).toContainText('Zlecenie jest rozliczone');
    await expect(badge(page, 'Rozliczone')).toBeFocused();

    const sent = transitions(api);
    expect(sent.map((entry) => entry.headers['if-match'])).toEqual(['"1"', '"2"', '"3"', '"4"']);
    for (const entry of sent) {
      expect(entry.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      expect(entry.headers['x-csrf-token']).toBe('csrf-active');
    }
    // the reason and the order are in no store of the browser
    const stores = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, href: location.href }));
    expect(stores.local + stores.session).toBe(0);
    expect(await problems.cspViolations()).toEqual([]);
  });

  test('EVM-030 AC2 "Wstrzymaj…" needs the reason, "Cofnij" in the toast resumes, "Wstrzymaj…" again and "Wznów" return to the same status', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    await page.goto(path);
    await choose(page, 'Nowe', 'Zaakceptuj bez wyceny');
    await choose(page, 'Zaakceptowane', 'Rozpocznij realizację');
    await choose(page, 'W realizacji', 'Wstrzymaj…');
    const dialog = page.getByRole('dialog', { name: 'Wstrzymaj zlecenie ZL-2026-0042' });
    await expect(dialog.getByLabel('Powód wstrzymania')).toBeFocused();
    await dialog.getByRole('button', { name: 'Wstrzymaj zlecenie' }).click();
    await expect(dialog.getByText('Wpisz powód.')).toBeVisible();
    await dialog.getByLabel('Powód wstrzymania').fill('Czekamy na decyzję klienta');
    await dialog.getByRole('button', { name: 'Wstrzymaj zlecenie' }).click();
    await expect(badge(page, 'Wstrzymane')).toBeVisible();
    await expect(page.getByText('Wstrzymano zlecenie.')).toBeVisible();

    await page.getByRole('button', { name: 'Cofnij' }).click();
    await expect(badge(page, 'W realizacji')).toBeVisible();
    await choose(page, 'W realizacji', 'Wstrzymaj…');
    await page.getByLabel('Powód wstrzymania').fill('Inny powód');
    await page.getByRole('button', { name: 'Wstrzymaj zlecenie' }).click();
    await expect(badge(page, 'Wstrzymane')).toBeVisible();
    await choose(page, 'Wstrzymane', 'Wznów');
    await expect(badge(page, 'W realizacji')).toBeVisible();
    expect(transitions(api).map((entry) => (JSON.parse(entry.postData ?? '{}') as { to: string }).to)).toEqual([
      'accepted',
      'in_progress',
      'on_hold',
      'in_progress',
      'on_hold',
      'in_progress',
    ]);
  });

  test('EVM-030 AC3 AC4 the Administrator cancels with a reason and restores the order only after W-04; the Editor sees the restore disabled', async ({
    page,
    api,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    await accountWithPasskey(page, api);
    const path = await createOrder(page);
    await page.goto(path);
    await choose(page, 'Nowe', 'Anuluj zlecenie…');
    const cancel = page.getByRole('dialog', { name: 'Anuluj zlecenie ZL-2026-0042' });
    await expect(cancel.getByText(/Przywrócić zlecenie może tylko administrator\./)).toBeVisible();
    await cancel.getByLabel('Powód anulowania').fill('Klient zrezygnował');
    await cancel.getByRole('button', { name: 'Anuluj zlecenie' }).click();
    await expect(badge(page, 'Anulowane')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Stan zlecenia' })).toContainText('Zmienisz je po przywróceniu zlecenia');

    await choose(page, 'Anulowane', 'Przywróć zlecenie…');
    await page
      .getByRole('alertdialog', { name: 'Przywrócić zlecenie ZL-2026-0042?' })
      .getByRole('button', { name: 'Przywróć zlecenie' })
      .click();
    const stepUp = page.getByRole('alertdialog', { name: 'Potwierdź tożsamość, aby przywrócić zlecenie' });
    await expect(stepUp).toBeVisible();
    await stepUp.getByRole('button', { name: 'Użyj klucza dostępu' }).click();
    await expect(badge(page, 'Wstrzymane')).toBeVisible();
    await expect(page.getByText('Przywrócono zlecenie.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Stan zlecenia' })).toHaveCount(0);
    // the first request was refused for the missing step-up, the second (after the key) went through
    expect(
      transitions(api)
        .map((entry) => entry.headers['if-match'])
        .slice(-2),
    ).toEqual(['"2"', '"2"']);

    // the Editor: cancelled again by the Administrator, then read by the Editor
    await choose(page, 'Wstrzymane', 'Anuluj zlecenie…');
    await page.getByLabel('Powód anulowania').fill('Jeszcze raz');
    await page.getByRole('button', { name: 'Anuluj zlecenie' }).click();
    await expect(badge(page, 'Anulowane')).toBeVisible();
    api.role = 'editor';
    await page.goto(path);
    await badge(page, 'Anulowane').click();
    const item = page.getByRole('menuitem', { name: /Przywróć zlecenie…/ });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toBeFocused();
    await expect(item).toContainText('Przywrócić zlecenie może tylko administrator.');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Stan zlecenia' })).toContainText('Przywrócić zlecenie może tylko administrator.');
  });

  test('EVM-030 AC7 Tylko odczyt has a static badge and no banner part about adding', async ({ page, api }) => {
    const path = await createOrder(page);
    await page.goto(path);
    await choose(page, 'Nowe', 'Anuluj zlecenie…');
    await page.getByLabel('Powód anulowania').fill('Test');
    await page.getByRole('button', { name: 'Anuluj zlecenie' }).click();
    await expect(badge(page, 'Anulowane')).toBeVisible();
    api.role = 'read_only';
    await page.goto(path);
    await expect(page.getByRole('main').getByText('Anulowane', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Zmień status/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Stan zlecenia' })).toHaveText(
      'Zlecenie jest anulowane — dane zlecenia, zakres, procesy i płatności są tylko do odczytu.',
    );
  });

  test('EVM-030 AC5 a stale version (412) shows the conflict under the badge; "Odśwież zlecenie" reads the order again and the focus returns to the badge', async ({
    page,
    api,
  }) => {
    const path = await createOrder(page);
    await page.goto(path);
    api.failNext.set(`POST /api/v1${path}/transitions`, { status: 412, code: 'version_conflict' });
    await choose(page, 'Nowe', 'Zaakceptuj bez wyceny');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('To zlecenie zmieniono w międzyczasie. Sprawdź jego aktualny stan i wybierz operację ponownie.');
    await alert.getByRole('button', { name: 'Odśwież zlecenie' }).click();
    await expect(alert).toHaveCount(0);
    await expect(badge(page, 'Nowe')).toBeFocused();
  });

  test('EVM-030 AC8 offline the badge is disabled with the hint and an open dialog keeps the reason; 429 shows the wait and keeps it too', async ({
    page,
    api,
    context,
  }) => {
    const path = await createOrder(page);
    await page.goto(path);
    await choose(page, 'Nowe', 'Wstrzymaj…');
    const dialog = page.getByRole('dialog', { name: 'Wstrzymaj zlecenie ZL-2026-0042' });
    await dialog.getByLabel('Powód wstrzymania').fill('Zostaje');
    api.failNext.set(`POST /api/v1${path}/transitions`, { status: 429, code: 'rate_limited', headers: { 'Retry-After': '30' } });
    await dialog.getByRole('button', { name: 'Wstrzymaj zlecenie' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.');
    await expect(dialog.getByLabel('Powód wstrzymania')).toHaveValue('Zostaje');
    await context.setOffline(true);
    await expect(dialog.getByText('Zmienisz po powrocie połączenia.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Wstrzymaj zlecenie' })).toHaveAttribute('aria-disabled', 'true');
    await expect(dialog.getByLabel('Powód wstrzymania')).toHaveValue('Zostaje');
    await context.setOffline(false);
    await dialog.getByRole('button', { name: 'Wstrzymaj zlecenie' }).click();
    await expect(badge(page, 'Wstrzymane')).toBeVisible();
    await context.setOffline(true);
    await expect(badge(page, 'Wstrzymane')).toHaveAttribute('aria-disabled', 'true');
    await expect(badge(page, 'Wstrzymane')).toHaveAttribute('title', 'Zmienisz po powrocie połączenia.');
    await context.setOffline(false);
  });

  test('EVM-030 AC1 the menu is operated with the keyboard only: Enter opens, arrows move, Esc closes and returns to the badge', async ({
    page,
  }) => {
    const path = await createOrder(page);
    await page.goto(path);
    await badge(page, 'Nowe').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Rozpocznij wycenę' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Zaakceptuj bez wyceny' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(badge(page, 'Nowe')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(badge(page, 'Wycena')).toBeVisible();
  });
});

test.describe('accessibility of the status (EVM-030, WCAG 2.2 AA with contrast)', () => {
  test.use({ bypassCSP: true });
  for (const width of [360, 768, 1280, 1440]) {
    test(`EVM-030 AC1 AC6 no axe violations with the menu open, a dialog, and the banner of a closed order at ${String(width)} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const path = await createOrder(page);
      await page.goto(path);
      await badge(page, 'Nowe').click();
      await expect(page.getByRole('menu')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('menuitem', { name: 'Anuluj zlecenie…' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByLabel('Powód anulowania').fill('Test');
      await page.getByRole('button', { name: 'Anuluj zlecenie' }).click();
      await expect(page.getByRole('region', { name: 'Stan zlecenia' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
