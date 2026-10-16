import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const USERS = '/administration/users';

test.describe('accessibility of W-16 in the browser, with colour contrast (EVM-024; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-024 AC5 the list, the menu of a row and the dialog of the resend have no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(USERS);
      await expect(page.getByRole('table', { name: 'Użytkownicy' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: /^Akcje konta: Biuro Testowe/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Wyślij zaproszenie ponownie…' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('menuitem', { name: 'Wyślij zaproszenie ponownie…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Wysłać zaproszenie ponownie?' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-024 AC1 AC2 AC7 the dialog of the invitation: empty, with errors, with the role Administrator and with the conflict have no axe violations at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(USERS);
      await page.getByRole('button', { name: 'Zaproś użytkownika' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Zaproś użytkownika' });
      await expect(dialog).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Zaproś' }).click();
      await expect(dialog.getByText('Podaj nazwę wyświetlaną.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('radio', { name: /^Administrator/ }).check();
      await dialog.getByRole('textbox', { name: 'E-mail' }).fill('jan.przykladowy@example.com');
      await dialog.getByRole('textbox', { name: 'Nazwa wyświetlana' }).fill('Jan');
      await dialog.getByRole('button', { name: 'Zaproś' }).click();
      await expect(dialog.getByRole('alert')).toContainText('Konto z tym adresem już istnieje');
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-024 AC5 AC8 the states empty, error and no access have no axe violations at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      api.users.users.splice(0, api.users.users.length - 1);
      await page.goto(USERS);
      await expect(page.getByRole('heading', { name: 'Na liście jest tylko Twoje konto.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.failNext.set('GET /api/v1/users', { status: 500, code: 'internal_error' });
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Nie udało się wczytać użytkowników.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      api.role = 'editor';
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
