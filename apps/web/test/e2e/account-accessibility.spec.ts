import type { Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { PASSWORD, TOTP_CODE } from './mock-api.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const ACCOUNT = '/account';

async function sessionsShown(page: Page) {
  await page.getByRole('button', { name: 'Pokaż sesje' }).click();
  const stepUp = page.getByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zobaczyć swoje sesje' });
  await stepUp.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
  await stepUp.getByRole('button', { name: 'Potwierdź' }).click();
  await expect(page.getByRole('table', { name: 'Lista moich sesji' })).toBeVisible();
}

test.describe('accessibility of W-15 Konto in the browser, with colour contrast (EVM-028; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-028 AC8 the page of an Administrator, the form of the password and the list of the sessions have no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'editor';
      await page.goto(ACCOUNT);
      await expect(page.getByRole('heading', { level: 2, name: 'Drugi krok logowania' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Zmień hasło' }).click();
      await page.getByLabel('Bieżące hasło').fill('abc');
      await page.getByLabel('Nowe hasło').fill('krótkie');
      await page.getByRole('button', { name: 'Zapisz nowe hasło' }).click();
      await expect(page.getByText('Hasło musi mieć co najmniej 15 znaków.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await sessionsShown(page);
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-028 AC3 the dialogs of the second step and W-04 in both steps have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'editor';
      await page.goto(ACCOUNT);
      await page.getByRole('button', { name: 'Dodaj klucz dostępu' }).click();
      const add = page.getByRole('dialog', { name: 'Dodaj klucz dostępu' });
      await expect(add).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await add.getByRole('button', { name: 'Anuluj' }).click();
      await page.getByRole('button', { name: 'Usuń klucz dostępu Telefon' }).click();
      const remove = page.getByRole('alertdialog', { name: 'Usunąć klucz dostępu „Telefon”?' });
      await expect(remove).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await remove.getByRole('button', { name: 'Usuń klucz' }).click();
      const reauth = page.getByRole('dialog', { name: 'Potwierdź tożsamość, aby usunąć klucz dostępu' });
      await expect(reauth.getByText('Krok 1 z 2')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await reauth.getByLabel('Hasło').fill(PASSWORD);
      await reauth.getByRole('button', { name: 'Dalej' }).click();
      await expect(reauth.getByText('Krok 2 z 2')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await reauth.getByLabel('Kod z aplikacji uwierzytelniającej').fill('000000');
      await reauth.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(reauth.getByRole('alert')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-028 AC5 the dialogs of the new recovery codes have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      api.role = 'editor';
      await page.goto(ACCOUNT);
      await page.getByRole('button', { name: 'Wygeneruj nowe kody…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Wygenerować nowe kody odzyskiwania?' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Wygeneruj nowe kody', exact: true }).click();
      const reauth = page.getByRole('dialog', { name: 'Potwierdź tożsamość, aby wygenerować nowe kody odzyskiwania' });
      await reauth.getByLabel('Hasło').fill(PASSWORD);
      await reauth.getByRole('button', { name: 'Dalej' }).click();
      await reauth.getByLabel('Kod z aplikacji uwierzytelniającej').fill(TOTP_CODE);
      await reauth.getByRole('button', { name: 'Potwierdź' }).click();
      await expect(page.getByRole('dialog', { name: 'Nowe kody odzyskiwania' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
