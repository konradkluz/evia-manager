import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true });

async function violations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const { axe } = window as unknown as {
      axe: { run: (context: Document, options: object) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> };
    };
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    });
    return result.violations.map((violation) => `${violation.id} (${String(violation.nodes.length)})`);
  });
}

test.describe('accessibility in the browser, with colour contrast (EVM-008 AC3, WCAG 2.2 AA)', () => {
  for (const width of [360, 768, 1280, 1440]) {
    test(`EVM-008 AC3 no axe violations at ${String(width)} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/work-orders');
      await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń' })).toBeVisible();
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
