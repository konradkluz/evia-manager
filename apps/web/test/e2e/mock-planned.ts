import type { Page } from '@playwright/test';

// Synthetic answer of the view "Do wystawienia" (EVM-059) for the E2E tests: the shared synthetic server holds only invoiced instalments.
const id = (n: number): string => `01968f3e-0000-7000-8000-${String(n).padStart(12, '0')}`;
export const planned = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(900 + n),
  workOrder: { id: id(800 + n), number: `ZL-2026-${String(n).padStart(4, '0')}`, title: `Montaż ${String(n)}` },
  customer: { id: id(700 + n), displayName: 'Anna Testowa' },
  name: 'Zaliczka',
  sharePercent: 20,
  amount: { amountMinor: 123000, currency: 'PLN' },
  status: 'planned',
  version: 2,
  ...extra,
});
const zero = { count: 0, total: { amountMinor: 0, currency: 'PLN' } };

export async function answerPlanned(page: Page, items: unknown[]) {
  await page.route('**/api/v1/payment-milestones?*view=planned*', async (route) => {
    const summary = {
      unpaid: zero,
      overdue: zero,
      longestOverdue: null,
      filtered: { count: items.length, total: { amountMinor: items.length * 123000, currency: 'PLN' } },
    };
    await route.fulfill({ status: 200, json: { items, nextCursor: null, asOf: '2026-10-15', summary } });
  });
}
