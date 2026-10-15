/**
 * The rules of a payment milestone that the schema of the contract cannot state (EVM-053 AC3, AC4; SR-INPUT-01, SR-INPUT-05,
 * SR-AUTHZ-10; P5):
 * - an order holds at most {@link MAX_MILESTONES_PER_ORDER} milestones — the cancelled ones included (api-guidelines → limits);
 * - the name is plain text: a lone UTF-16 surrogate, a control or an invisible formatting character (NUL, the direction controls of
 *   the text included) is refused — NOT removed, the office sees what is stored; normalised to NFC once, trimmed, 1–120 CODE POINTS;
 * - only a `planned` milestone takes a new amount from Administrator and Editor; the amount of an invoiced or paid one is a correction
 *   of the Administrator with a step-up (EVM-057); the amount of a cancelled one is changed by nobody (`403 forbidden`, deny by
 *   default — the corrections of domain-model.md name the amount of `invoiced` and `paid` only).
 * An error is a code, never the value (SR-ERR-02) — a name may name a person.
 */
import type { PaymentMilestoneStatus } from './money.ts';

export const MAX_MILESTONES_PER_ORDER = 20;
export const MAX_MILESTONE_NAME_LENGTH = 120;

export type NameResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly code: 'required' | 'too_long' | 'invalid_characters' };

const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function normalizeMilestoneName(raw: string): NameResult {
  if (!raw.isWellFormed()) return { ok: false, code: 'invalid_characters' };
  const text = raw.normalize('NFC').trim();
  if (FORBIDDEN.test(text)) return { ok: false, code: 'invalid_characters' };
  if (text === '') return { ok: false, code: 'required' };
  if (codePoints(text) > MAX_MILESTONE_NAME_LENGTH) return { ok: false, code: 'too_long' };
  return { ok: true, value: text };
}

/** The length in code points: a pair of surrogates (the text is well formed) counts once. */
function codePoints(text: string): number {
  let points = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) index += 1;
    points += 1;
  }
  return points;
}

/** How the amount of a milestone in the status may change: freely, by a correction (EVM-057), or not at all. */
export type AmountRule = 'free' | 'correction' | 'forbidden';

const AMOUNT_RULES: Record<PaymentMilestoneStatus, AmountRule> = {
  planned: 'free',
  invoiced: 'correction',
  paid: 'correction',
  cancelled: 'forbidden',
};

export const amountRule = (status: PaymentMilestoneStatus): AmountRule => AMOUNT_RULES[status];

/** The statuses of a milestone that does not wait for money any more; any other keeps an order from being settled (domain-model.md → "Zlecenie"). */
export const SETTLED_STATUSES: readonly PaymentMilestoneStatus[] = ['paid', 'cancelled'];
