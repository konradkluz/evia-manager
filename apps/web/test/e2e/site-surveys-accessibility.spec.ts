import type { Locator, Page } from '@playwright/test';
import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { deadlineIn, SURVEY_NUMBER, SURVEY_PATH } from './mock-site-surveys.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const BANNER = 'Wizja lokalna — brak klienta';

async function open(page: Page) {
  await page.goto(SURVEY_PATH);
  await expect(page.getByRole('heading', { level: 1, name: SURVEY_NUMBER })).toBeVisible();
}

/**
 * 360 px and 200 % of the font (WCAG 1.4.4, 1.4.10): the element of this story stays inside the window — the banner with its buttons, the
 * dialogs. (The whole page still scrolls sideways at 200 %, as before this story: the button of the account in the top bar, the tabs and the
 * "Edytuj" of the card of the site are wider than 360 px there; they are not part of EVM-138 and are reported to the Tech Lead.)
 */
async function fitsTheWindow(page: Page, target: Locator): Promise<boolean> {
  const box = await target.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  return box !== null && box.x >= 0 && box.x + box.width <= width + 1;
}

test.describe('accessibility of the site survey in W-06, with colour contrast (EVM-138; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-138 AC3 AC4 AC6 the banner, the dialogs "Przypisz klienta" and "Aby zaakceptować…", the disabled payments at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      await expect(page.getByRole('region', { name: BANNER })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      // the warning variant (15 days or fewer)
      api.surveys.expiresAt = deadlineIn(10);
      await page.reload();
      await expect(page.getByRole('region', { name: `${BANNER}, wymaga decyzji` })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('tab', { name: 'Media i dokumenty' }).click();
      await expect(page.getByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('tab', { name: 'Przegląd' }).click();
      // "Przypisz klienta": the choice, a new customer, the confirmation
      await page
        .getByRole('region', { name: `${BANNER}, wymaga decyzji` })
        .getByRole('button', { name: 'Przypisz klienta' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Przypisz klienta' });
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Dodaj nowego klienta' }).first().click();
      await expect(dialog.getByRole('heading', { name: 'Dodaj nowego klienta' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Wróć do wyboru' }).click();
      await dialog.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
      await dialog.getByRole('option', { name: /Jan Przykładowy/ }).click();
      await dialog.getByRole('button', { name: 'Dalej' }).click();
      await expect(dialog.getByText('Klient: Jan Przykładowy')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Wróć' }).click();
      await dialog.getByRole('button', { name: 'Anuluj' }).click();
      await page.getByRole('button', { name: /^Status zlecenia: / }).click();
      await page.getByRole('menuitem', { name: 'Zaakceptuj' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Aby zaakceptować, przypisz klienta' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-138 AC5 the dialogs "Odrzuć wizję lokalną" and "Przywrócić wizję?", the rejected banner of the Administrator and the Editor at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      await page.getByRole('region', { name: BANNER }).getByRole('button', { name: 'Odrzuć wizję…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Odrzuć wizję lokalną' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('alertdialog').getByRole('radio', { name: 'Rezygnacja klienta' }).check();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Odrzuć wizję' }).click();
      await expect(page.getByRole('region', { name: 'Wizja odrzucona' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Przywróć wizję…' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Przywrócić wizję?' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      api.role = 'editor';
      await page.reload();
      await expect(page.getByRole('button', { name: 'Przywróć wizję…' })).toHaveAttribute('aria-disabled', 'true');
      expect(await violations(page)).toEqual([]);
    });
  }

  test('EVM-138 AC6 at 360 px and at 200 % of the font the banner, its buttons and the dialogs stay inside the window', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await open(page);
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    const banner = page.getByRole('region', { name: BANNER });
    expect(await fitsTheWindow(page, banner)).toBe(true);
    for (const name of ['Przypisz klienta', 'Odrzuć wizję…'])
      expect(await fitsTheWindow(page, banner.getByRole('button', { name }))).toBe(true);
    await banner.getByRole('button', { name: 'Przypisz klienta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Przypisz klienta' });
    expect(await fitsTheWindow(page, dialog)).toBe(true);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await banner.getByRole('button', { name: 'Odrzuć wizję…' }).click();
    const alert = page.getByRole('alertdialog', { name: 'Odrzuć wizję lokalną' });
    await expect(alert).toBeVisible();
    expect(await fitsTheWindow(page, alert)).toBe(true);
    expect(await alert.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  test('EVM-138 AC6 the keyboard: Tab goes from the heading through the banner to the tabs, Esc closes a dialog and returns the focus', async ({
    page,
  }) => {
    await open(page);
    const assign = page.getByRole('region', { name: BANNER }).getByRole('button', { name: 'Przypisz klienta' });
    await assign.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Przypisz klienta' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Przypisz klienta' })).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: SURVEY_NUMBER })).toBeFocused();
    await assign.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('region', { name: BANNER }).getByRole('button', { name: 'Odrzuć wizję…' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tab', { name: 'Przegląd' })).toBeFocused();
  });
});
