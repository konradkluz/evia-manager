import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true });

test.describe('accessibility in the browser, with colour contrast (EVM-008 AC3, WCAG 2.2 AA)', () => {
  for (const width of [360, 768, 1280, 1440]) {
    test(`EVM-008 AC3 no axe violations at ${String(width)} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders');
      await expect(page.getByRole('heading', { level: 2, name: 'Nie masz jeszcze zleceń.' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }

  test('EVM-008 AC3 no axe violations with the drawer open and offline', async ({ page, context }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/work-orders');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
});
