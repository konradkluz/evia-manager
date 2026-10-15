import { describe, expect, it } from 'vitest';
import { PaymentPlanLimitError, planMilestones, type PlanMilestone } from '../../src/modules/payments/domain/composition-plan.ts';
import {
  MAX_MILESTONE_NAME_LENGTH,
  MAX_MILESTONES_PER_ORDER,
  amountRule,
  normalizeMilestoneName,
  SETTLED_STATUSES,
} from '../../src/modules/payments/domain/milestone-rules.ts';
import { milestoneTotals, PAYMENT_MILESTONE_STATUSES, toMoney } from '../../src/modules/payments/domain/money.ts';
import { uuidv7 } from '../support/uuid.ts';

const plan = (shares: readonly number[]): PlanMilestone[] =>
  shares.map((sharePercent, index) => ({
    sourceTemplateId: uuidv7(),
    code: `milestone_${index}`,
    name: `Transza ${index}`,
    sharePercent,
    paymentTermDays: 7 + index,
  }));

describe('the copy of the payment plan of a template (EVM-053 AC1; D1)', () => {
  it('EVM-053 AC1 a plan 20/30/30/20 gives 4 milestones with the names, shares and payment terms of the template, numbered 1..4 in its order', () => {
    const source = plan([20, 30, 30, 20]);
    expect(planMilestones(source)).toEqual(source.map((milestone, index) => ({ ...milestone, position: index + 1 })));
  });

  it('EVM-053 AC1 a template without a payment plan gives no milestone', () => {
    expect(planMilestones([])).toEqual([]);
  });

  it('EVM-053 AC1 fail closed: a plan of 21 milestones is not trimmed — the planner throws (the creation of the order rolls back)', () => {
    expect(planMilestones(plan(Array.from({ length: MAX_MILESTONES_PER_ORDER }, () => 5)))).toHaveLength(20);
    expect(() => planMilestones(plan(Array.from({ length: 21 }, () => 5)))).toThrow(PaymentPlanLimitError);
  });
});

describe('the totals of the section "Płatności" (EVM-053 AC2)', () => {
  it('EVM-053 AC2 unpaid is the sum of the invoiced milestones, paid of the paid ones; planned and cancelled are in neither', () => {
    const totals = milestoneTotals([
      { status: 'planned', amountMinor: 100 },
      { status: 'invoiced', amountMinor: 360000 },
      { status: 'invoiced', amountMinor: 1 },
      { status: 'paid', amountMinor: 540000 },
      { status: 'cancelled', amountMinor: 7 },
      { status: 'planned', amountMinor: null },
    ]);
    expect(totals).toEqual({ unpaid: { amountMinor: 360001, currency: 'PLN' }, paid: { amountMinor: 540000, currency: 'PLN' } });
  });

  it('EVM-053 AC2 no milestone gives zero totals; 20 milestones of the largest amount stay exact (safe integers)', () => {
    expect(milestoneTotals([])).toEqual({ unpaid: { amountMinor: 0, currency: 'PLN' }, paid: { amountMinor: 0, currency: 'PLN' } });
    const largest = Array.from({ length: 20 }, () => ({ status: 'paid' as const, amountMinor: 99_999_999_999 }));
    expect(milestoneTotals(largest).paid.amountMinor).toBe(1_999_999_999_980);
  });

  it('EVM-053 AC2 a sum outside the safe integers is an error, never a rounded number', () => {
    expect(() =>
      milestoneTotals([
        { status: 'paid', amountMinor: Number.MAX_SAFE_INTEGER },
        { status: 'paid', amountMinor: 1 },
      ]),
    ).toThrow(RangeError);
  });

  it('EVM-053 AC3 an amount is Money in grosze and PLN; null stays null', () => {
    expect(toMoney(360000)).toEqual({ amountMinor: 360000, currency: 'PLN' });
    expect(toMoney(null)).toBeNull();
    expect(PAYMENT_MILESTONE_STATUSES).toEqual(['planned', 'invoiced', 'paid', 'cancelled']);
  });
});

describe('the rules of a milestone (EVM-053 AC3, AC4, AC6; SR-INPUT-05, SR-AUTHZ-10)', () => {
  it('EVM-053 AC4 the name is NFC, trimmed and 1–120 code points (an astral character counts once)', () => {
    expect(normalizeMilestoneName('  Zaliczka  ')).toEqual({ ok: true, value: 'Zaliczka' });
    expect(normalizeMilestoneName('Zaz\u0307o\u0301\u0142c\u0301')).toEqual({ ok: true, value: 'Za\u017C\u00F3\u0142\u0107' });
    expect(normalizeMilestoneName('e\u0301')).toEqual({ ok: true, value: '\u00E9' });
    expect(normalizeMilestoneName('x'.repeat(MAX_MILESTONE_NAME_LENGTH))).toMatchObject({ ok: true });
    expect(normalizeMilestoneName('x'.repeat(121))).toEqual({ ok: false, code: 'too_long' });
    expect(normalizeMilestoneName('\u{1F4B0}'.repeat(120))).toMatchObject({ ok: true });
    expect(normalizeMilestoneName('\u{1F4B0}'.repeat(121))).toEqual({ ok: false, code: 'too_long' });
  });

  it('EVM-053 AC4 an empty name is required; a control character, NUL, a direction control or a lone surrogate is refused, not removed', () => {
    expect(normalizeMilestoneName('')).toEqual({ ok: false, code: 'required' });
    expect(normalizeMilestoneName('   ')).toEqual({ ok: false, code: 'required' });
    for (const raw of ['Zal\u0000iczka', 'Zal\niczka', 'Zal\u202Eiczka', 'Zal\u2066iczka', 'Zal\u2028iczka', 'Zal\uD800iczka']) {
      expect(normalizeMilestoneName(raw), JSON.stringify(raw)).toEqual({ ok: false, code: 'invalid_characters' });
    }
  });

  it('EVM-053 AC3 EVM-057 AC3 AC6 a planned milestone takes a new amount, an invoiced or paid one by a correction only, a cancelled one never', () => {
    expect(Object.fromEntries(PAYMENT_MILESTONE_STATUSES.map((status) => [status, amountRule(status)]))).toEqual({
      planned: 'free',
      invoiced: 'correction',
      paid: 'correction',
      cancelled: 'forbidden',
    });
  });

  it('EVM-053 AC6 paid and cancelled milestones do not keep an order from being settled', () => {
    expect(SETTLED_STATUSES).toEqual(['paid', 'cancelled']);
  });
});
