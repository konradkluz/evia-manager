import type { UserRole } from '@evia/contracts';
import { describe, expect, it } from 'vitest';
import {
  changedDetails,
  mergedIssues,
  normalizeDetailsPatch,
  statusDecision,
  type StoredDetails,
} from '../../src/modules/payments/domain/milestone-details.ts';
import {
  addDays,
  allowedMilestoneTransitions,
  defaultDueDate,
  correctionAccess,
  correctionFields,
  findMilestoneTransition,
  MILESTONE_TRANSITION_TABLE,
  mayTake,
  moveFields,
} from '../../src/modules/payments/domain/milestone-transitions.ts';
import { PAYMENT_MILESTONE_STATUSES, type PaymentMilestoneStatus } from '../../src/modules/payments/domain/money.ts';
import {
  INVOICED_MILESTONES,
  orderTransitionCondition,
  orderTransitionEffect,
  UNPAID_MILESTONES,
} from '../../src/modules/payments/domain/order-conditions.ts';
import { CLOSED_STATUSES, type WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';
import { mayUse, transitionsFrom, type ActiveStatus } from '../../src/modules/work-orders/domain/work-order-transitions.ts';

const ROLES: readonly UserRole[] = ['administrator', 'editor', 'read_only'];
const pln = (amountMinor: number) => ({ amountMinor, currency: 'PLN' as const });

describe('the table of transitions of a payment milestone (EVM-054 AC1–AC3, AC5, AC7; SR-API-07, SR-AUTHZ-10)', () => {
  it('EVM-054 AC1 AC2 AC3 Administrator and Editor invoice and cancel a planned milestone and record the payment of an invoiced one; Read-only takes nothing', () => {
    for (const role of ['administrator', 'editor'] as const) {
      expect(allowedMilestoneTransitions('planned', role, false)).toEqual(['invoiced', 'cancelled']);
      expect(allowedMilestoneTransitions('invoiced', role, false)).toContain('paid');
    }
    expect(allowedMilestoneTransitions('invoiced', 'editor', false)).toEqual(['paid']);
    expect(allowedMilestoneTransitions('paid', 'editor', false)).toEqual([]);
    expect(allowedMilestoneTransitions('cancelled', 'editor', false)).toEqual([]);
    for (const status of PAYMENT_MILESTONE_STATUSES) expect(allowedMilestoneTransitions(status, 'read_only', false)).toEqual([]);
  });

  it('EVM-057 AC6 SR-AUTHZ-10 every correction is a row of the Administrator alone with a step-up, and only a correction asks for one', () => {
    const corrections = MILESTONE_TRANSITION_TABLE.filter((rule) => rule.move === 'correction').map((rule) => `${rule.from}>${rule.to}`);
    expect(corrections.sort()).toEqual(['cancelled>planned', 'invoiced>cancelled', 'invoiced>planned', 'paid>invoiced']);
    for (const rule of MILESTONE_TRANSITION_TABLE) {
      const name = `${rule.from}>${rule.to}`;
      expect(rule.stepUp, name).toBe(rule.move === 'correction');
      if (rule.move !== 'correction') continue;
      expect(rule.roles, name).toEqual(['administrator']);
      for (const role of ROLES) expect(mayTake(rule, role), `${name} ${role}`).toBe(role === 'administrator');
    }
  });

  it('EVM-057 AC6 SR-AUTHZ-10 no row outside the corrections leads back: to planned from invoiced or cancelled, to invoiced from paid, to cancelled from invoiced', () => {
    const backwards = MILESTONE_TRANSITION_TABLE.filter(
      (rule) =>
        (rule.to === 'planned' && (rule.from === 'invoiced' || rule.from === 'cancelled')) ||
        (rule.to === 'invoiced' && rule.from === 'paid') ||
        (rule.to === 'cancelled' && rule.from === 'invoiced'),
    );
    expect(backwards).toHaveLength(4);
    for (const rule of backwards) expect(rule.move, `${rule.from}>${rule.to}`).toBe('correction');
  });

  it('EVM-057 AC8 the Administrator is offered the corrections of a status whatever the freshness of the step-up (a hint); the Editor and Read-only are not; a closed order offers nothing', () => {
    expect(allowedMilestoneTransitions('planned', 'administrator', false)).toEqual(['invoiced', 'cancelled']);
    expect(allowedMilestoneTransitions('invoiced', 'administrator', false)).toEqual(['paid', 'planned', 'cancelled']);
    expect(allowedMilestoneTransitions('paid', 'administrator', false)).toEqual(['invoiced']);
    expect(allowedMilestoneTransitions('cancelled', 'administrator', false)).toEqual(['planned']);
    for (const status of PAYMENT_MILESTONE_STATUSES) {
      expect(allowedMilestoneTransitions(status, 'administrator', true)).toEqual([]);
      expect(allowedMilestoneTransitions(status, 'read_only', false)).toEqual([]);
    }
  });

  it('EVM-054 AC7 a move outside the table has no row (409); the payments of a closed order offer nothing', () => {
    expect(findMilestoneTransition('planned', 'paid')).toBeUndefined();
    expect(findMilestoneTransition('paid', 'cancelled')).toBeUndefined();
    expect(findMilestoneTransition('planned', 'planned')).toBeUndefined();
    expect(allowedMilestoneTransitions('planned', 'administrator', true)).toEqual([]);
  });
});

describe('the fields of a move (EVM-054 AC1–AC3; Q3a, Q3b, Q3c, Q3e; SR-INPUT-01, SR-INPUT-02)', () => {
  const TODAY = '2026-10-03';
  const planFacts = { amountMinor: null, paymentTermDays: 7 };

  it('EVM-054 AC1 the invoice 1 230,00 zł, FV/TEST/0021/2026 of 2026-10-03 with a plan of 7 days is due on 2026-10-10 — the due date is computed on the server and may be changed', () => {
    const command = { to: 'invoiced' as const, amount: pln(123000), invoiceNumber: ' FV/TEST/0021/2026 ', invoicedOn: '2026-10-03' };
    expect(moveFields('invoice', command, planFacts, TODAY)).toEqual({
      ok: true,
      update: {
        status: 'invoiced',
        amountMinor: 123000,
        invoiceNumber: 'FV/TEST/0021/2026',
        invoicedOn: '2026-10-03',
        dueDate: '2026-10-10',
      },
    });
    expect(moveFields('invoice', { ...command, dueDate: '2026-10-31' }, planFacts, TODAY)).toMatchObject({
      update: { dueDate: '2026-10-31' },
    });
    expect(defaultDueDate('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('EVM-054 AC1 the day of the invoice is today by default and may be in the future (Q3a); the amount entered before is used when none is sent', () => {
    expect(moveFields('invoice', { to: 'invoiced', invoiceNumber: 'FV/1' }, { amountMinor: 5000, paymentTermDays: 0 }, TODAY)).toEqual({
      ok: true,
      update: { status: 'invoiced', amountMinor: 5000, invoiceNumber: 'FV/1', invoicedOn: TODAY, dueDate: TODAY },
    });
    expect(
      moveFields('invoice', { to: 'invoiced', invoiceNumber: 'FV/1', invoicedOn: '2027-01-15', amount: pln(1) }, planFacts, TODAY),
    ).toMatchObject({
      ok: true,
      update: { invoicedOn: '2027-01-15', dueDate: '2027-01-22' },
    });
  });

  it('EVM-054 AC1 Q3a Q3b Q3c without an amount, a number, a due date of a milestone added by hand, a day out of 2000–2100 or a due date before the day it is 400 — pointers and codes, never values', () => {
    const bad = moveFields('invoice', { to: 'invoiced', invoiceNumber: '  ' }, { amountMinor: null, paymentTermDays: null }, TODAY);
    expect(bad).toEqual({
      ok: false,
      status: 400,
      errors: [
        { pointer: '/amount', code: 'required' },
        { pointer: '/invoiceNumber', code: 'required' },
        { pointer: '/dueDate', code: 'required' },
      ],
    });
    const base = { to: 'invoiced' as const, amount: pln(1), invoiceNumber: 'FV/1' };
    expect(moveFields('invoice', { ...base, invoicedOn: '1999-12-31' }, planFacts, TODAY)).toMatchObject({
      errors: [{ pointer: '/invoicedOn', code: 'out_of_range' }],
    });
    expect(moveFields('invoice', { ...base, dueDate: '2101-01-01' }, planFacts, TODAY)).toMatchObject({
      errors: [{ pointer: '/dueDate', code: 'out_of_range' }],
    });
    expect(moveFields('invoice', { ...base, invoicedOn: '2026-10-03', dueDate: '2026-10-02' }, planFacts, TODAY)).toMatchObject({
      errors: [{ pointer: '/dueDate', code: 'before_invoiced_on' }],
    });
    expect(moveFields('invoice', { ...base, invoiceNumber: 'FV/‮1' }, planFacts, TODAY)).toMatchObject({
      errors: [{ pointer: '/invoiceNumber', code: 'invalid_characters' }],
    });
    expect(moveFields('invoice', { ...base, invoiceNumber: 'x'.repeat(61) }, planFacts, TODAY)).toMatchObject({
      errors: [{ pointer: '/invoiceNumber', code: 'too_long' }],
    });
    expect(JSON.stringify(bad)).not.toContain('FV');
  });

  it('EVM-054 AC2 Q3e the payment is today by default; a day after today is 422 in_future, before 2000 is 400', () => {
    expect(moveFields('pay', { to: 'paid' }, planFacts, TODAY)).toEqual({ ok: true, update: { status: 'paid', paidOn: TODAY } });
    expect(moveFields('pay', { to: 'paid', paidOn: '2026-10-04' }, planFacts, TODAY)).toEqual({
      ok: false,
      status: 422,
      errors: [{ pointer: '/paidOn', code: 'in_future' }],
    });
    expect(moveFields('pay', { to: 'paid', paidOn: '1999-01-01' }, planFacts, TODAY)).toMatchObject({ status: 400 });
  });

  it('EVM-054 AC3 a cancellation needs a reason of 1–500 characters; a field of another move is not_allowed', () => {
    expect(moveFields('cancel', { to: 'cancelled', reason: ' Rezygnacja ' }, planFacts, TODAY)).toEqual({
      ok: true,
      update: { status: 'cancelled', statusReason: 'Rezygnacja' },
    });
    expect(moveFields('cancel', { to: 'cancelled' }, planFacts, TODAY)).toMatchObject({
      errors: [{ pointer: '/reason', code: 'required' }],
    });
    expect(moveFields('cancel', { to: 'cancelled', reason: 'x'.repeat(501) }, planFacts, TODAY)).toMatchObject({
      errors: [{ pointer: '/reason', code: 'too_long' }],
    });
    expect(moveFields('pay', { to: 'paid', reason: 'x', invoiceNumber: 'FV' }, planFacts, TODAY)).toEqual({
      ok: false,
      status: 400,
      errors: [
        { pointer: '/invoiceNumber', code: 'not_allowed' },
        { pointer: '/reason', code: 'not_allowed' },
      ],
    });
  });
});

describe('the change of the data of an invoice and of a payment (EVM-054 AC4; Q3d; SR-AUTHZ-10)', () => {
  const invoiced: StoredDetails = {
    amountMinor: 123000,
    invoiceNumber: 'FV/TEST/0021/2026',
    invoicedOn: '2026-10-03',
    dueDate: '2026-10-10',
    paidOn: null,
  };

  it('EVM-054 AC4 an empty patch, a number that is not plain text and a day out of 2000–2100 are 400', () => {
    expect(normalizeDetailsPatch({})).toEqual({ ok: false, errors: [{ pointer: '', code: 'required' }] });
    expect(normalizeDetailsPatch({ invoiceNumber: '\u0000' })).toMatchObject({
      errors: [{ pointer: '/invoiceNumber', code: 'invalid_characters' }],
    });
    expect(normalizeDetailsPatch({ invoicedOn: '1999-12-31', paidOn: '2101-01-01' })).toMatchObject({
      errors: [
        { pointer: '/invoicedOn', code: 'out_of_range' },
        { pointer: '/paidOn', code: 'out_of_range' },
      ],
    });
    expect(normalizeDetailsPatch({ invoiceNumber: ' FV/2 ', dueDate: '2026-10-20' })).toEqual({
      ok: true,
      patch: { invoiceNumber: 'FV/2', dueDate: '2026-10-20' },
    });
  });

  it('EVM-054 AC4 Q3d the invoice belongs to invoiced, the payment to paid, the amount of planned is free', () => {
    for (const access of ['ok', 'forbidden', 'step_up_required'] as const) {
      expect(statusDecision('planned', { amountMinor: 1 }, access)).toBe('ok');
      expect(statusDecision('planned', { amountMinor: 1, invoiceNumber: 'FV' }, access)).toBe('invalid_state_transition');
      expect(statusDecision('invoiced', { invoiceNumber: 'FV', invoicedOn: '2026-10-01', dueDate: '2026-10-09' }, access)).toBe('ok');
      expect(statusDecision('invoiced', { paidOn: '2026-10-01' }, access)).toBe('invalid_state_transition');
      expect(statusDecision('paid', { paidOn: '2026-10-01' }, access)).toBe('ok');
      expect(statusDecision('paid', { dueDate: '2026-10-01' }, access)).toBe('invalid_state_transition');
      expect(statusDecision('cancelled', { paidOn: '2026-10-01' }, access)).toBe('invalid_state_transition');
    }
  });

  it('EVM-057 AC3 AC5 AC6 P2 the amount of an invoiced or paid milestone is a correction: the access of the caller decides, before the fields — also together with other fields', () => {
    for (const status of ['invoiced', 'paid'] as const) {
      expect(statusDecision(status, { amountMinor: 1, invoiceNumber: 'FV' }, 'forbidden')).toBe('forbidden');
      expect(statusDecision(status, { amountMinor: 1, paidOn: '2026-10-01' }, 'step_up_required')).toBe('step_up_required');
      expect(statusDecision(status, { amountMinor: 1 }, 'ok')).toBe('ok');
    }
    expect(statusDecision('invoiced', { amountMinor: 1, invoiceNumber: 'FV' }, 'ok')).toBe('ok');
    expect(statusDecision('invoiced', { amountMinor: 1, paidOn: '2026-10-01' }, 'ok')).toBe('invalid_state_transition');
  });

  it('EVM-057 AC6 the amount of a cancelled milestone is forbidden for every caller — the Administrator with a step-up included', () => {
    for (const access of ['ok', 'forbidden', 'step_up_required'] as const)
      expect(statusDecision('cancelled', { amountMinor: 1 }, access)).toBe('forbidden');
  });

  it('EVM-054 AC4 Q3b the due date is checked on the merged state; the pointer is /invoicedOn when only the day of the invoice changes; Q3e a payment after today is in_future', () => {
    expect(mergedIssues(invoiced, { invoicedOn: '2026-10-11' }, '2026-10-03')).toEqual([
      { pointer: '/invoicedOn', code: 'before_invoiced_on' },
    ]);
    expect(mergedIssues(invoiced, { dueDate: '2026-10-02' }, '2026-10-03')).toEqual([{ pointer: '/dueDate', code: 'before_invoiced_on' }]);
    expect(mergedIssues(invoiced, { invoicedOn: '2026-10-11', dueDate: '2026-10-10' }, '2026-10-03')).toEqual([
      { pointer: '/dueDate', code: 'before_invoiced_on' },
    ]);
    expect(mergedIssues(invoiced, { invoicedOn: '2026-10-11', dueDate: '2026-10-11' }, '2026-10-03')).toEqual([]);
    expect(mergedIssues({ ...invoiced, paidOn: '2026-10-02' }, { paidOn: '2026-10-04' }, '2026-10-03')).toEqual([
      { pointer: '/paidOn', code: 'in_future' },
    ]);
  });

  it('EVM-054 AC4 a value equal to the stored one is no change', () => {
    expect(changedDetails(invoiced, { invoiceNumber: 'FV/TEST/0021/2026', dueDate: '2026-10-10' })).toEqual({});
    expect(changedDetails(invoiced, { invoiceNumber: 'FV/2', dueDate: '2026-10-10' })).toEqual({ invoiceNumber: 'FV/2' });
  });
});

describe('the policy and the fields of a correction (EVM-057 AC1, AC2, AC4, AC5, AC6; P2; SR-SESS-08, SR-AUTHZ-10, CWE-915)', () => {
  it('EVM-057 AC5 AC6 P2 the role before the step-up: the Editor and Read-only are forbidden whatever their key, the Administrator needs a fresh one', () => {
    for (const fresh of [true, false]) {
      expect(correctionAccess('editor', fresh)).toBe('forbidden');
      expect(correctionAccess('read_only', fresh)).toBe('forbidden');
    }
    expect(correctionAccess('administrator', false)).toBe('step_up_required');
    expect(correctionAccess('administrator', true)).toBe('ok');
  });

  const rule = (from: PaymentMilestoneStatus, to: PaymentMilestoneStatus) => {
    const found = findMilestoneTransition(from, to);
    if (found === undefined) throw new Error(`${from}>${to}`);
    return found;
  };

  it('EVM-057 AC1 withdrawing an invoice makes the milestone planned and clears the number, the day of the invoice and the due date; the amount stays', () => {
    expect(correctionFields(rule('invoiced', 'planned'), { to: 'planned' })).toEqual({
      ok: true,
      update: { status: 'planned', invoiceNumber: null, invoicedOn: null, dueDate: null },
    });
  });

  it('EVM-057 AC2 cancelling an invoice keeps the data of the invoice and takes no reason; undoing a payment clears its day', () => {
    expect(correctionFields(rule('invoiced', 'cancelled'), { to: 'cancelled' })).toEqual({ ok: true, update: { status: 'cancelled' } });
    expect(correctionFields(rule('paid', 'invoiced'), { to: 'invoiced' })).toEqual({
      ok: true,
      update: { status: 'invoiced', paidOn: null },
    });
  });

  it('EVM-057 AC4 restoring a cancelled milestone makes it planned and clears the invoice, the payment and the reason', () => {
    expect(correctionFields(rule('cancelled', 'planned'), { to: 'planned' })).toEqual({
      ok: true,
      update: { status: 'planned', invoiceNumber: null, invoicedOn: null, dueDate: null, paidOn: null, statusReason: null },
    });
  });

  it('EVM-057 AC6 CWE-915 a correction takes the target alone: every other field is 400 not_allowed with its pointer, never its value', () => {
    expect(correctionFields(rule('invoiced', 'cancelled'), { to: 'cancelled', reason: 'powod' })).toEqual({
      ok: false,
      status: 400,
      errors: [{ pointer: '/reason', code: 'not_allowed' }],
    });
    expect(
      correctionFields(rule('invoiced', 'planned'), { to: 'planned', amount: pln(1), invoiceNumber: 'FV', dueDate: '2026-10-09' }),
    ).toEqual({
      ok: false,
      status: 400,
      errors: [
        { pointer: '/amount', code: 'not_allowed' },
        { pointer: '/invoiceNumber', code: 'not_allowed' },
        { pointer: '/dueDate', code: 'not_allowed' },
      ],
    });
  });

  it('EVM-057 AC1 a row that is not a correction has no fields of a correction (a defect of the caller)', () => {
    expect(() => correctionFields(rule('planned', 'invoiced'), { to: 'invoiced' })).toThrow('not a correction');
  });
});

describe('the conditions of the payments on a transition of the order (EVM-053 AC6, EVM-054 AC6)', () => {
  it('EVM-054 AC6 a cancellation with an invoiced milestone is invoiced_milestones; a settlement with an unpaid one is unpaid_milestones; other targets have no condition', () => {
    expect(orderTransitionCondition('cancelled', ['invoiced', 'planned'])).toBe(INVOICED_MILESTONES);
    expect(orderTransitionCondition('cancelled', ['paid', 'planned', 'cancelled'])).toBeUndefined();
    expect(orderTransitionCondition('settled', ['paid', 'planned'])).toBe(UNPAID_MILESTONES);
    expect(orderTransitionCondition('settled', ['invoiced'])).toBe(UNPAID_MILESTONES);
    expect(orderTransitionCondition('settled', ['paid', 'cancelled'])).toBeUndefined();
    expect(orderTransitionCondition('on_hold', ['invoiced'])).toBeUndefined();
    expect(orderTransitionEffect('cancelled', ['planned', 'paid'])).toEqual(['cancelled', 'paid']);
    expect(orderTransitionEffect('on_hold', ['planned'])).toEqual(['planned']);
  });
});

/**
 * The paths of the graph (EVM-054 AC5, AC6; SR-AUTHZ-10 "paths do not bypass roles"): a breadth-first walk over the product of the
 * state of an order and the statuses of its milestones, with EVERY move the Editor or the Administrator WITHOUT a step-up may take —
 * the transitions of the order (the table of `work-orders`, its conditions and effects of `payments`) and of the milestones (the table
 * of `payments`, only in an open order). The tables are imported, never copied: a new row is walked by this test.
 */
describe('no sequence of the Editor or of the Administrator without a step-up closes an order with an invoiced milestone (EVM-054 AC5, AC6)', () => {
  interface State {
    readonly status: WorkOrderStatus;
    readonly resumeStatus: ActiveStatus | null;
    readonly milestones: readonly PaymentMilestoneStatus[];
  }
  const key = (state: State) => `${state.status}|${state.resumeStatus ?? '-'}|${state.milestones.join(',')}`;

  function next(state: State, role: UserRole): State[] {
    const out: State[] = [];
    for (const transition of transitionsFrom(state)) {
      if (transition.rule.stepUp || !mayUse(transition, role)) continue;
      if (orderTransitionCondition(transition.to, state.milestones) !== undefined) continue;
      const resumeStatus =
        transition.rule.resumeStatus === 'record'
          ? (state.status as ActiveStatus)
          : transition.rule.resumeStatus === 'clear'
            ? null
            : state.resumeStatus;
      out.push({ status: transition.to, resumeStatus, milestones: orderTransitionEffect(transition.to, state.milestones) });
    }
    if (!CLOSED_STATUSES.includes(state.status)) {
      state.milestones.forEach((status, index) => {
        for (const to of allowedMilestoneTransitions(status, role, false)) {
          const rule = findMilestoneTransition(status, to);
          // without a step-up a correction is out of reach (EVM-057 AC6): the walk takes the rows that ask for none
          if (rule === undefined || !mayTake(rule, role) || rule.stepUp) continue;
          out.push({ ...state, milestones: state.milestones.map((value, at) => (at === index ? to : value)) });
        }
      });
    }
    return out;
  }

  function walk(start: State, role: UserRole): State[] {
    const seen = new Map([[key(start), start]]);
    const queue = [start];
    while (queue.length > 0) {
      const state = queue.shift() as State;
      for (const candidate of next(state, role)) {
        if (seen.has(key(candidate))) continue;
        seen.set(key(candidate), candidate);
        queue.push(candidate);
      }
    }
    return [...seen.values()];
  }

  const STARTS: State[] = [
    { status: 'new', resumeStatus: null, milestones: ['planned', 'planned'] },
    { status: 'in_progress', resumeStatus: null, milestones: ['invoiced', 'planned'] },
    { status: 'on_hold', resumeStatus: 'in_progress', milestones: ['invoiced', 'planned'] },
    { status: 'completed', resumeStatus: null, milestones: ['invoiced', 'paid'] },
  ];

  it.each(['editor', 'administrator'] as const)(
    'EVM-054 AC6 %s: no reachable state is a closed order with an invoiced milestone, and no milestone ever leaves invoiced or paid backwards (no effect of a correction)',
    (role) => {
      for (const start of STARTS) {
        const states = walk(start, role);
        expect(states.length, key(start)).toBeGreaterThan(1);
        for (const state of states) {
          const closedWithInvoice = CLOSED_STATUSES.includes(state.status) && state.milestones.includes('invoiced');
          expect(closedWithInvoice, key(state)).toBe(false);
        }
        // the effect of a correction: a milestone that was invoiced or paid at the start is planned or cancelled later, or paid → invoiced
        for (const state of states)
          start.milestones.forEach((before, index) => {
            const after = state.milestones[index];
            if (before === 'invoiced') expect(['invoiced', 'paid'], key(state)).toContain(after);
            if (before === 'paid') expect(after, key(state)).toBe('paid');
          });
      }
    },
  );

  it('EVM-054 AC6 the walk is not vacuous: from "W realizacji" with an invoiced and a planned milestone the order IS cancelled after the payment — with the milestone paid', () => {
    const states = walk(STARTS[1] as State, 'editor');
    expect(states.some((state) => state.status === 'cancelled' && state.milestones.join() === 'paid,cancelled')).toBe(true);
    expect(states.some((state) => state.status === 'settled')).toBe(true);
  });
});
