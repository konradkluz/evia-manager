// Accessibility check with axe-core directly (EVM-008 AC3; architect: no vitest-axe). WCAG 2.x A/AA rules; colour
// contrast needs layout, so jsdom reports it as incomplete — contrast is checked in the UX review and E2E screenshots.
import axe from 'axe-core';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** @param options.bestPractice also landmarks, headings and regions — for whole screens, not single components */
export async function axeViolations(node: Element, { bestPractice = false } = {}): Promise<string[]> {
  const result = await axe.run(node, {
    runOnly: { type: 'tag', values: bestPractice ? [...WCAG, 'best-practice'] : WCAG },
    resultTypes: ['violations'],
  });
  return result.violations.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.map((n) => n.html).join(', ')})`);
}
