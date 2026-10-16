import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';

// Screenshots for the UX review of EVM-024 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-024 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirInvitation']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const USERS = '/administration/users';

test.describe('UX review screenshots (EVM-024) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-024 W-16 the list, the menu of a row and the dialog of the resend at ${px} px`, async ({ page, api, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(USERS);
      await expect(page.getByRole('table', { name: 'Użytkownicy' })).toBeVisible();
      await shot(`w16-list-${px}`);
      await page.getByRole('button', { name: /^Akcje konta: Biuro Testowe/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Wyślij zaproszenie ponownie…' })).toBeVisible();
      await shot(`w16-menu-${px}`);
      await page.getByRole('menuitem', { name: 'Wyślij zaproszenie ponownie…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Wysłać zaproszenie ponownie?' })).toBeVisible();
      await shot(`w16-resend-${px}`);
    });

    test(`EVM-024 W-16 the dialog of the invitation: empty, errors, role Administrator and conflict at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      api.stepUp = 'fresh';
      await page.goto(USERS);
      await page.getByRole('button', { name: 'Zaproś użytkownika' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Zaproś użytkownika' });
      await expect(dialog).toBeVisible();
      await shot(`w16-invite-${px}`);
      await dialog.getByRole('button', { name: 'Zaproś' }).click();
      await expect(dialog.getByText('Podaj nazwę wyświetlaną.')).toBeVisible();
      await shot(`w16-invite-errors-${px}`);
      await dialog.getByRole('radio', { name: /^Administrator/ }).check();
      await dialog.getByRole('textbox', { name: 'E-mail' }).fill('jan.przykladowy@example.com');
      await dialog.getByRole('textbox', { name: 'Nazwa wyświetlana' }).fill('Jan');
      await shot(`w16-invite-administrator-${px}`);
      await dialog.getByRole('button', { name: 'Zaproś' }).click();
      await expect(dialog.getByRole('alert')).toContainText('Konto z tym adresem już istnieje');
      await shot(`w16-invite-conflict-${px}`);
    });

    test(`EVM-024 W-04 for the invitation at ${px} px`, async ({ page, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(USERS);
      await page.getByRole('button', { name: 'Zaproś użytkownika' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Zaproś użytkownika' });
      await dialog.getByRole('textbox', { name: 'E-mail' }).fill('anna.nowak@example.com');
      await dialog.getByRole('textbox', { name: 'Nazwa wyświetlana' }).fill('Anna Nowak');
      await dialog.getByRole('button', { name: 'Zaproś' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zaprosić użytkownika' })).toBeVisible();
      await shot(`w04-invite-${px}`);
    });

    test(`EVM-024 W-16 offline, empty, loading error and no access at ${px} px`, async ({ page, api, context, shot }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(USERS);
      await expect(page.getByRole('table', { name: 'Użytkownicy' })).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByText('Brak połączenia. Panel działa po jego powrocie.')).toBeVisible();
      await shot(`w16-offline-${px}`);
      await context.setOffline(false);
      api.users.users.splice(0, api.users.users.length - 1);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Na liście jest tylko Twoje konto.' })).toBeVisible();
      await shot(`w16-empty-${px}`);
      api.failNext.set('GET /api/v1/users', { status: 500, code: 'internal_error' });
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Nie udało się wczytać użytkowników.' })).toBeVisible();
      await shot(`w16-error-${px}`);
      api.role = 'editor';
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Nie masz dostępu do administracji.' })).toBeVisible();
      await shot(`w16-denied-${px}`);
    });
  }
});
