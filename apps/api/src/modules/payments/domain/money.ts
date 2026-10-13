/**
 * Money of the payments (domain-model.md D5; api-guidelines.md → kwota; EVM-053 AC2, AC3): an amount is an INTEGER number of grosze
 * with its currency — never a float. One milestone holds at most 99 999 999 999 grosze, so the sum of the 20 milestones of an order
 * stays far inside the safe integers of JavaScript; a sum that would leave them is an error, never a rounded number.
 */
export const CURRENCY = 'PLN';
export const MAX_AMOUNT_MINOR = 99_999_999_999;

export interface Money {
  readonly amountMinor: number;
  readonly currency: typeof CURRENCY;
}

export type PaymentMilestoneStatus = 'planned' | 'invoiced' | 'paid' | 'cancelled';

export const PAYMENT_MILESTONE_STATUSES: readonly PaymentMilestoneStatus[] = ['planned', 'invoiced', 'paid', 'cancelled'];

/** `null` stays `null` (an amount not entered yet). */
export const toMoney = (amountMinor: number | null): Money | null => (amountMinor === null ? null : { amountMinor, currency: CURRENCY });

export interface Totals {
  readonly unpaid: Money;
  readonly paid: Money;
}

const add = (sum: number, amountMinor: number | null): number => {
  const next = sum + (amountMinor ?? 0);
  if (!Number.isSafeInteger(next)) throw new RangeError('the sum of the amounts is outside the safe integers');
  return next;
};

/**
 * The totals of the section "Płatności" (EVM-053 AC2): "Nieopłacone" is the sum of the milestones `invoiced`, "Opłacone" of those `paid`;
 * `planned` and `cancelled` are in neither.
 */
export function milestoneTotals(
  milestones: readonly { readonly status: PaymentMilestoneStatus; readonly amountMinor: number | null }[],
): Totals {
  let unpaid = 0;
  let paid = 0;
  for (const milestone of milestones) {
    if (milestone.status === 'invoiced') unpaid = add(unpaid, milestone.amountMinor);
    if (milestone.status === 'paid') paid = add(paid, milestone.amountMinor);
  }
  return { unpaid: { amountMinor: unpaid, currency: CURRENCY }, paid: { amountMinor: paid, currency: CURRENCY } };
}
