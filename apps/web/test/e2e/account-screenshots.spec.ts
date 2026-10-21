import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures.ts';
import { PASSWORD, TOTP_CODE } from './mock-api.ts';

// Screenshots for the UX review of EVM-028 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-028 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirAccount']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const ACCOUNT = '/account';

async function reauthenticate(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: title });
  await dialog.getByLabel('Hasło').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Dalej' }).click();
  await dialog.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
  await dialog.getByRole('button', { name: 'Potwierdź' }).click();
}

test.describe('UX review screenshots (EVM-028) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-028 W-15 the page of an Editor and of an Administrator with one key at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'editor';
      api.account.totp = { addedAt: '2026-10-03T11:00:00.000Z' };
      await page.goto(ACCOUNT);
      await expect(page.getByRole('heading', { level: 2, name: 'Drugi krok logowania' })).toBeVisible();
      await shot(`w15-editor-${px}`);
      api.role = 'administrator';
      api.account.totp = null;
      api.account.passkeys = api.account.passkeys.slice(0, 1);
      api.account.recovery = { remaining: 3, generatedAt: '2026-10-03T12:00:00.000Z' };
      await page.goto(ACCOUNT);
      await expect(page.getByText('Dodaj drugi klucz dostępu, np. w telefonie')).toBeVisible();
      await shot(`w15-administrator-one-key-${px}`);
    });

    test(`EVM-028 W-15 the form of the password: empty, with the error, after the change at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'editor';
      await page.goto(ACCOUNT);
      await page.getByRole('button', { name: 'Zmień hasło' }).click();
      await shot(`w15-password-form-${px}`);
      await page.getByLabel('Bieżące hasło').fill(PASSWORD);
      await page.getByLabel('Nowe hasło').fill('krótkie');
      await page.getByRole('button', { name: 'Zapisz nowe hasło' }).click();
      await expect(page.getByText('Hasło musi mieć co najmniej 15 znaków.')).toBeVisible();
      await shot(`w15-password-error-${px}`);
      await page.getByLabel('Nowe hasło').fill('zupełnie nowe hasło do konta');
      await page.getByRole('button', { name: 'Zapisz nowe hasło' }).click();
      const dialog = page.getByRole('dialog', { name: 'Potwierdź tożsamość, aby zmienić hasło' });
      await expect(dialog).toBeVisible();
      await shot(`w04-password-${px}`);
      await dialog.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
      await dialog.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(page.getByText(/Konto ma jeszcze 2 inne aktywne sesje\./)).toBeVisible();
      await shot(`w15-password-changed-${px}`);
    });

    test(`EVM-028 W-04 the full re-authentication in both steps and with the error at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'editor';
      await page.goto(ACCOUNT);
      await page.getByRole('button', { name: 'Usuń klucz dostępu Telefon' }).click();
      await page.getByRole('button', { name: 'Usuń klucz', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Potwierdź tożsamość, aby usunąć klucz dostępu' });
      await expect(dialog).toBeVisible();
      await shot(`w04-step1-${px}`);
      await dialog.getByLabel('Hasło').fill('zle hasło');
      await dialog.getByRole('button', { name: 'Dalej' }).click();
      await expect(dialog.getByText('Krok 2 z 2')).toBeVisible();
      await shot(`w04-step2-${px}`);
      await dialog.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
      await dialog.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await shot(`w04-rejected-${px}`);
    });

    test(`EVM-028 W-15 the dialogs of the methods: add a key, remove a key, the last method at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'editor';
      await page.goto(ACCOUNT);
      await page.getByRole('button', { name: 'Dodaj klucz dostępu' }).click();
      await expect(page.getByRole('dialog', { name: 'Dodaj klucz dostępu' })).toBeVisible();
      await shot(`w15-add-key-${px}`);
      await page.getByRole('button', { name: 'Anuluj' }).click();
      await page.getByRole('button', { name: 'Usuń klucz dostępu Telefon' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Usunąć klucz dostępu „Telefon”?' })).toBeVisible();
      await shot(`w15-remove-key-${px}`);
      await page.getByRole('button', { name: 'Usuń klucz', exact: true }).click();
      await reauthenticate(page, 'Potwierdź tożsamość, aby usunąć klucz dostępu');
      await expect(page.getByText('Usunięto klucz dostępu.')).toBeVisible();
      await expect(page.getByText('To jedyna metoda — najpierw dodaj inną.')).toBeVisible();
      await shot(`w15-last-method-${px}`);
    });

    test(`EVM-028 W-15 the code of the app and the new recovery codes at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'editor';
      await page.goto(ACCOUNT);
      await page.getByRole('button', { name: 'Dodaj kod z aplikacji' }).click();
      await reauthenticate(page, 'Potwierdź tożsamość, aby dodać kod z aplikacji');
      await expect(page.getByRole('dialog', { name: 'Dodaj kod z aplikacji' }).getByRole('img', { name: /kod QR/i })).toBeVisible();
      await shot(`w15-add-totp-${px}`);
      await page.getByRole('button', { name: 'Anuluj' }).click();
      api.usedCodes.clear();
      await page.getByRole('button', { name: 'Wygeneruj nowe kody…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Wygenerować nowe kody odzyskiwania?' })).toBeVisible();
      await shot(`w15-codes-confirm-${px}`);
      await page.getByRole('button', { name: 'Wygeneruj nowe kody', exact: true }).click();
      await reauthenticate(page, 'Potwierdź tożsamość, aby wygenerować nowe kody odzyskiwania');
      await expect(page.getByRole('dialog', { name: 'Nowe kody odzyskiwania' })).toBeVisible();
      await shot(`w15-codes-${px}`);
    });

    test(`EVM-028 W-15 "Moje sesje": before, the list, one session at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'editor';
      await page.goto(ACCOUNT);
      await expect(page.getByRole('button', { name: 'Pokaż sesje' })).toBeVisible();
      await shot(`w15-sessions-before-${px}`);
      await page.getByRole('button', { name: 'Pokaż sesje' }).click();
      const stepUp = page.getByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zobaczyć swoje sesje' });
      await expect(stepUp).toBeVisible();
      await shot(`w04-sessions-${px}`);
      await stepUp.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
      await stepUp.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(page.getByRole('table', { name: 'Lista moich sesji' })).toBeVisible();
      await shot(`w15-sessions-${px}`);
      await page.getByRole('button', { name: 'Zakończ pozostałe sesje' }).click();
      await expect(page.getByText('Konto jest zalogowane tylko w tej przeglądarce.')).toBeVisible();
      await shot(`w15-sessions-alone-${px}`);
    });
  }
});
