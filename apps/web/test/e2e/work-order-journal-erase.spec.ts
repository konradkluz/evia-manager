import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';
import { seedJournal } from './mock-journal.ts';
import { virtualAuthenticator } from './support.ts';

// Delete, restore and redact an entry of the journal in a real browser against the synthetic API (EVM-040 AC1, AC2, AC3, AC5, AC6, AC7):
// the soft delete with "Cofnij", the mark "Usunięty", the dialog of the redaction with W-04 after `403 step_up_required`, the marker in
// place of the text, the refused register and the roles. WebAuthn needs a domain name, so the spec runs on `localhost`; Chromium and Edge
// get a virtual authenticator, Firefox has none (ADR-0015) — the step-up is covered there by the unit tests. The full stack (the register,
// the append-only trigger, the audit, the role matrix) is covered by the API integration tests.
test.use({ baseURL: 'http://localhost:4173', session: 'active', bypassCSP: false });

const NO_FIREFOX = 'Firefox has no virtual authenticator; the passkey ceremony is covered by the API integration tests (ADR-0015).';
const CANARY = 'Numer dowodu ABC000000 wpisany omyłkowo';
const STEP_UP = 'Potwierdź tożsamość, aby zredagować treść wpisu';
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

/** Creates ZL-2026-0042, seeds three entries (the newest carries the canary) and opens the tab "Dziennik". */
async function openJournal(page: Page, api: MockApi): Promise<void> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  seedJournal(api.journal, id, 3, (n) => (n === 1 ? CANARY : `Wpis numer ${String(n)}`));
  await page.reload();
  await page.getByRole('tab', { name: 'Dziennik' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Dziennik' })).toBeVisible();
  await expect(page.getByText(CANARY)).toBeVisible();
}

const entryOf = (page: Page, text: string) => page.locator('li[data-entry-id]').filter({ hasText: text });
async function choose(page: Page, text: string, item: string | RegExp) {
  await entryOf(page, text)
    .getByRole('button', { name: /^Akcje wpisu/ })
    .click();
  await page.getByRole('menuitem', { name: item }).click();
}
const writes = (api: MockApi, method: string) =>
  api.seen.filter((entry) => entry.method === method && /\/timeline\/[0-9a-f-]{36}/.test(entry.url));

test.describe('delete and redact an entry of the journal (EVM-040)', () => {
  test('EVM-040 AC1 "Usuń wpis" marks the entry "Usunięty" for the Administrator and the toast "Cofnij" restores it', async ({
    page,
    api,
  }) => {
    await openJournal(page, api);
    await choose(page, CANARY, 'Usuń wpis');
    await expect(page.getByText('Usunięto wpis.')).toBeVisible();
    await expect(entryOf(page, CANARY).getByText('Usunięty')).toBeVisible();
    const [call] = writes(api, 'DELETE');
    expect(call?.headers['if-match']).toBe('"1"');
    expect(call?.headers['idempotency-key']).toMatch(UUIDV7);
    expect(call?.headers['x-csrf-token']).toBe('csrf-active');

    await page.getByRole('button', { name: 'Cofnij' }).click();
    await expect(page.getByText('Przywrócono wpis.')).toBeVisible();
    await expect(entryOf(page, CANARY).getByText('Usunięty')).toHaveCount(0);
    expect(writes(api, 'POST').map((entry) => entry.url.split('/').at(-1))).toEqual(['restore']);
  });

  test('EVM-040 AC2 AC7 the dialog warns, W-04 follows, the text becomes the marker; cancelling W-04 changes nothing', async ({
    page,
    api,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', NO_FIREFOX);
    await accountWithPasskey(page, api);
    await openJournal(page, api);
    await choose(page, CANARY, /^Zredaguj treść/);
    const dialog = page.getByRole('alertdialog', { name: 'Zredagować treść wpisu?' });
    await expect(dialog.getByText('Treść zostanie zastąpiona znacznikiem — tej operacji nie można cofnąć.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
    await expect(dialog).not.toContainText(CANARY);
    await dialog.getByRole('button', { name: 'Zredaguj treść' }).click();

    const stepUp = page.getByRole('alertdialog', { name: STEP_UP });
    await stepUp.getByRole('button', { name: 'Anuluj' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Nie wykonano operacji.');
    await expect(page.getByText(CANARY)).toBeVisible();

    await dialog.getByRole('button', { name: 'Zredaguj treść' }).click();
    await page.getByRole('alertdialog', { name: STEP_UP }).getByRole('button', { name: 'Użyj klucza dostępu' }).click();
    await expect(page.getByText('Zredagowano treść wpisu.')).toBeVisible();
    await expect(page.getByText(/^Treść usunięta przez administratora \d{2}\.\d{2}\.\d{4}\.$/)).toBeVisible();
    await expect(page.getByText(CANARY)).toHaveCount(0);
    expect(writes(api, 'POST').every((entry) => entry.url.endsWith('/redact'))).toBe(true);
    expect(writes(api, 'POST').at(-1)?.headers['if-match']).toBe('"1"');
  });

  test('EVM-040 AC6 the Editor sees the items disabled with the reason and the server refuses a delete (403)', async ({ page, api }) => {
    api.role = 'editor';
    await openJournal(page, api);
    await entryOf(page, CANARY)
      .getByRole('button', { name: /^Akcje wpisu/ })
      .click();
    const remove = page.getByRole('menuitem', { name: /^Usuń wpis/ });
    await expect(remove).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('menuitem', { name: /^Zredaguj treść/ })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Usunąć wpis może tylko administrator.').first()).toBeAttached();
    await remove.click({ force: true });
    expect(writes(api, 'DELETE')).toHaveLength(0);
  });
});
