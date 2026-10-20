import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-027 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-027 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirAccess']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const USERS = '/administration/users';

test.describe('UX review screenshots (EVM-027) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-027 W-16 the menu of an active row and of a deactivated one at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(USERS);
      await expect(page.getByRole('table', { name: 'Użytkownicy' })).toBeVisible();
      await shot(`w16-list-${px}`);
      await page.getByRole('button', { name: /^Akcje konta: Jan Przykładowy/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Zresetuj drugi krok logowania…' })).toBeVisible();
      await shot(`w16-menu-active-${px}`);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Akcje konta: Marek Testowy/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Reaktywuj konto…' })).toBeVisible();
      await shot(`w16-menu-deactivated-${px}`);
    });

    test(`EVM-027 W-16 the dialog of the role: the present role, the alert for Administrators and the missing key at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(USERS);
      await page.getByRole('button', { name: /^Akcje konta: Biuro Testowe/ }).click();
      await page.getByRole('menuitem', { name: 'Zmień rolę…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Zmienić rolę konta „Biuro Testowe”?' });
      await expect(dialog).toBeVisible();
      await shot(`w16-role-${px}`);
      await dialog.getByRole('radio', { name: /^Administrator/ }).check();
      await shot(`w16-role-administrator-${px}`);
      await dialog.getByRole('button', { name: 'Zmień rolę' }).click();
      await expect(dialog.getByRole('alert')).toContainText('To konto musi najpierw dodać klucz dostępu');
      await shot(`w16-role-passkey-required-${px}`);
    });

    test(`EVM-027 W-16 the dialog of the reset of the second step: empty, with the error, for an Administrator at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(USERS);
      await page.getByRole('button', { name: /^Akcje konta: Jan Przykładowy/ }).click();
      await page.getByRole('menuitem', { name: 'Zresetuj drugi krok logowania…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Zresetować drugi krok logowania konta „Jan Przykładowy”?' });
      await expect(dialog).toBeVisible();
      await shot(`w16-reset-${px}`);
      await dialog.getByRole('button', { name: 'Zresetuj drugi krok' }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await shot(`w16-reset-error-${px}`);
    });

    test(`EVM-027 W-16 the confirmations of the deactivation, the reactivation and the sessions at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(USERS);
      await page.getByRole('button', { name: /^Akcje konta: Jan Przykładowy/ }).click();
      await page.getByRole('menuitem', { name: 'Dezaktywuj konto…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Dezaktywować konto „Jan Przykładowy”?' })).toBeVisible();
      await shot(`w16-deactivate-${px}`);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Akcje konta: Jan Przykładowy/ }).click();
      await page.getByRole('menuitem', { name: 'Wyloguj ze wszystkich sesji…' }).click();
      await expect(page.getByRole('alertdialog', { name: /^Wylogować konto/ })).toBeVisible();
      await shot(`w16-sessions-${px}`);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Akcje konta: Marek Testowy/ }).click();
      await page.getByRole('menuitem', { name: 'Reaktywuj konto…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Reaktywować konto „Marek Testowy”?' })).toBeVisible();
      await shot(`w16-reactivate-${px}`);
    });

    test(`EVM-027 W-16 the failures 412 and last_active_administrator in the dialog, and W-04 for the role at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(USERS);
      await page.getByRole('button', { name: /^Akcje konta: Jan Przykładowy/ }).click();
      await page.getByRole('menuitem', { name: 'Zmień rolę…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Zmienić rolę konta „Jan Przykładowy”?' });
      await dialog.getByRole('radio', { name: /^Tylko odczyt/ }).check();
      await dialog.getByRole('button', { name: 'Zmień rolę' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zmienić rolę użytkownika' })).toBeVisible();
      await shot(`w04-role-${px}`);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Anuluj' }).click();
      api.stepUp = 'fresh';
      const jan = api.users.users.find((user) => user.email === 'jan.przykladowy@example.com');
      if (jan !== undefined) jan.version += 1;
      await dialog.getByRole('button', { name: 'Zmień rolę' }).click();
      await expect(dialog.getByRole('alert')).toContainText('To konto zmieniono w międzyczasie.');
      await shot(`w16-role-412-${px}`);
      api.failNext.set('PUT /api/v1/users/' + (jan?.id ?? '') + '/role', { status: 409, code: 'last_active_administrator' });
      await dialog.getByRole('button', { name: 'Odśwież dane konta' }).click();
      await dialog.getByRole('button', { name: 'Zmień rolę' }).click();
      await expect(dialog.getByRole('alert')).toContainText('system musi mieć co najmniej jednego aktywnego administratora');
      await shot(`w16-role-last-administrator-${px}`);
    });
  }
});
