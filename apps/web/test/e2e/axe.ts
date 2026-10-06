import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

/**
 * axe-core in the real browser, with colour contrast (WCAG 2.2 AA + best practice). The script is injected, which the
 * strict CSP rightly blocks — a spec that calls this sets `test.use({ bypassCSP: true })`.
 */
export async function violations(page: Page): Promise<string[]> {
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
