import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const USERS = '/administration/users';

test.describe('accessibility of the operations of W-16 in the browser, with colour contrast (EVM-027; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-027 AC8 the menus of a row have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(USERS);
      await expect(page.getByRole('table', { name: 'Użytkownicy' })).toBeVisible();
      await page.getByRole('button', { name: /^Akcje konta: Jan Przykładowy/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Zresetuj drugi krok logowania…' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Akcje konta: Marek Testowy/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Reaktywuj konto…' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-027 AC1 AC4 the role dialog and the reset dialog, also with their errors, have no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(USERS);
      await page.getByRole('button', { name: /^Akcje konta: Biuro Testowe/ }).click();
      await page.getByRole('menuitem', { name: 'Zmień rolę…' }).click();
      const role = page.getByRole('dialog', { name: 'Zmienić rolę konta „Biuro Testowe”?' });
      await expect(role).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await role.getByRole('radio', { name: /^Administrator/ }).check();
      await role.getByRole('button', { name: 'Zmień rolę' }).click();
      await expect(role.getByRole('alert')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await role.getByRole('button', { name: 'Anuluj' }).click();
      await page.getByRole('button', { name: /^Akcje konta: Jan Przykładowy/ }).click();
      await page.getByRole('menuitem', { name: 'Zresetuj drugi krok logowania…' }).click();
      const reset = page.getByRole('dialog', { name: 'Zresetować drugi krok logowania konta „Jan Przykładowy”?' });
      await expect(reset).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await reset.getByRole('button', { name: 'Zresetuj drugi krok' }).click();
      await expect(reset.getByRole('alert')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-027 AC2 AC3 the confirmations have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(USERS);
      await page.getByRole('button', { name: /^Akcje konta: Jan Przykładowy/ }).click();
      await page.getByRole('menuitem', { name: 'Dezaktywuj konto…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Dezaktywować konto „Jan Przykładowy”?' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Akcje konta: Jan Przykładowy/ }).click();
      await page.getByRole('menuitem', { name: 'Wyloguj ze wszystkich sesji…' }).click();
      await expect(page.getByRole('alertdialog', { name: /^Wylogować konto/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
