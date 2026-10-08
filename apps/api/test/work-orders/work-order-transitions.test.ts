import type { UserRole } from '@evia/contracts';
import { describe, expect, it } from 'vitest';
import { ALL_STATUSES } from '../support/work-order-fixtures.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-list-query.ts';
import {
  ACTIVE_STATUSES,
  TRANSITION_TABLE,
  allowedTransitions,
  applyTransition,
  findTransition,
  mayUse,
  transitionsFrom,
  type ActiveStatus,
  type TransitionState,
} from '../../src/modules/work-orders/domain/work-order-transitions.ts';

/**
 * The table of domain-model.md → "Stany i przejścia" → "Zlecenie", typed in by hand here — a second statement of the same table, so
 * a row changed in the code and not in the document (or the other way round) is a failed test. `active` is any of the four active
 * statuses, `resume` the status the order was held from.
 */
type Roles = 'A,E' | 'A+';
const ACTIVE = 'active';
const DOCUMENT: ReadonlyArray<readonly [WorkOrderStatus | typeof ACTIVE, WorkOrderStatus | 'resume', Roles]> = [
  ['new', 'quoting', 'A,E'],
  ['new', 'accepted', 'A,E'],
  ['quoting', 'accepted', 'A,E'],
  ['accepted', 'in_progress', 'A,E'],
  [ACTIVE, 'on_hold', 'A,E'],
  ['on_hold', 'resume', 'A,E'],
  [ACTIVE, 'cancelled', 'A,E'],
  ['on_hold', 'cancelled', 'A,E'],
  ['cancelled', 'on_hold', 'A+'],
  ['in_progress', 'completed', 'A,E'],
  ['completed', 'in_progress', 'A,E'],
  ['completed', 'settled', 'A,E'],
  ['settled', 'completed', 'A+'],
];

const expandedDocument = DOCUMENT.flatMap(([from, to, roles]) =>
  (from === ACTIVE ? [...ACTIVE_STATUSES] : [from]).map((status) => ({ from: status, to, roles })),
);

const T0 = new Date('2026-10-08T08:00:00.000Z');
const fresh = (status: WorkOrderStatus, resumeStatus: ActiveStatus | null = null): TransitionState => ({
  status,
  resumeStatus,
  closedAt: status === 'settled' || status === 'cancelled' ? T0 : null,
  completedOn: null,
});
const resumeOf = (status: WorkOrderStatus): ActiveStatus | null => (status === 'on_hold' ? 'accepted' : null);

describe('the table of transitions of a work order (EVM-030 AC1–AC4; domain-model.md → Zlecenie)', () => {
  it('EVM-030 AC1 the table has exactly the rows of the document: every row exists with its roles and step-up, and there is no other', () => {
    const actual = TRANSITION_TABLE.map((rule) => ({
      from: rule.from,
      to: rule.to,
      roles: rule.roles.length === 1 ? 'A+' : 'A,E',
      stepUp: rule.stepUp,
    }));
    const expected = expandedDocument.map((rule) => ({ ...rule, stepUp: rule.roles === 'A+' }));
    expect(actual).toEqual(expect.arrayContaining(expected));
    expect(actual).toHaveLength(expected.length);
  });

  it('EVM-030 AC5 every pair of statuses that is not a row of the table has no transition: 8 x 8 minus the rows is 409 invalid_state_transition', () => {
    const allowed = new Set(expandedDocument.map((rule) => `${rule.from}>${rule.to === 'resume' ? 'accepted' : rule.to}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const found = findTransition({ status: from, resumeStatus: resumeOf(from) }, to);
        expect(found !== undefined, `${from} > ${to}`).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it('EVM-030 AC2 a resumption goes ONLY to the status the order was held from (every active status), never to another one', () => {
    for (const held of ACTIVE_STATUSES) {
      const state = { status: 'on_hold', resumeStatus: held } as const;
      expect(transitionsFrom(state).map((transition) => transition.to)).toEqual([held, 'cancelled']);
      for (const other of ALL_STATUSES.filter((status) => status !== held && status !== 'cancelled')) {
        expect(findTransition(state, other), `${held} > ${other}`).toBeUndefined();
      }
    }
  });

  it('EVM-030 AC2 an order on hold that has no resume status (not made by the hold command) cannot be resumed: fail closed, it can still be cancelled', () => {
    expect(transitionsFrom({ status: 'on_hold', resumeStatus: null }).map((transition) => transition.to)).toEqual(['cancelled']);
  });

  it('EVM-030 AC1 the effects of the rows: reasons where the document asks, the completion day only on "Zakończ", closing on cancel and settle, clearing on restoration', () => {
    const effect = (from: WorkOrderStatus, to: WorkOrderStatus) => findTransition({ status: from, resumeStatus: resumeOf(from) }, to)?.rule;
    for (const status of ACTIVE_STATUSES) {
      expect(effect(status, 'on_hold')).toMatchObject({ reason: true, resumeStatus: 'record', closedAt: 'keep' });
      expect(effect(status, 'cancelled')).toMatchObject({
        reason: true,
        resumeStatus: 'record',
        closedAt: 'set',
        audit: 'work_order.cancelled',
      });
    }
    expect(effect('on_hold', 'cancelled')).toMatchObject({
      reason: true,
      resumeStatus: 'keep',
      closedAt: 'set',
      audit: 'work_order.cancelled',
    });
    expect(effect('on_hold', 'accepted')).toMatchObject({ reason: false, resumeStatus: 'clear' });
    expect(effect('in_progress', 'completed')).toMatchObject({ completedOn: 'set', reason: false });
    expect(effect('completed', 'in_progress')).toMatchObject({ completedOn: 'clear' });
    expect(effect('completed', 'settled')).toMatchObject({ closedAt: 'set' });
    expect(effect('completed', 'settled')?.audit).toBeUndefined();
    expect(effect('settled', 'completed')).toMatchObject({ closedAt: 'clear', stepUp: true, audit: 'work_order.restored' });
    expect(effect('cancelled', 'on_hold')).toMatchObject({ closedAt: 'clear', stepUp: true, reason: false, audit: 'work_order.restored' });
    // only the sensitive transitions are audited: the five cancellations and the two restorations
    expect(TRANSITION_TABLE.filter((rule) => rule.audit !== undefined).map((rule) => rule.audit)).toHaveLength(7);
  });

  it('EVM-030 AC3 cancelling sets the closing time and records where the order was; cancelling from a hold keeps what the hold recorded', () => {
    const cancel = findTransition({ status: 'in_progress', resumeStatus: null }, 'cancelled');
    if (cancel === undefined) throw new Error('no row');
    const fields = { reason: 'powód syntetyczny', completedOn: null };
    expect(applyTransition(fresh('in_progress'), cancel, fields, T0)).toEqual({
      state: { status: 'cancelled', resumeStatus: 'in_progress', closedAt: T0, completedOn: null },
      statusReason: 'powód syntetyczny',
    });
    const fromHold = findTransition({ status: 'on_hold', resumeStatus: 'quoting' }, 'cancelled');
    if (fromHold === undefined) throw new Error('no row');
    expect(applyTransition(fresh('on_hold', 'quoting'), fromHold, fields, T0).state).toMatchObject({
      status: 'cancelled',
      resumeStatus: 'quoting',
    });
  });

  it('EVM-030 AC4 a restoration clears the closing time; "Rozliczone" returns to "Zakończone" with its completion day, "Anulowane" to "Wstrzymane" with the status it can resume to', () => {
    const settled = findTransition({ status: 'settled', resumeStatus: null }, 'completed');
    const cancelled = findTransition({ status: 'cancelled', resumeStatus: 'accepted' }, 'on_hold');
    if (settled === undefined || cancelled === undefined) throw new Error('no row');
    const none = { reason: null, completedOn: null };
    expect(applyTransition({ ...fresh('settled'), completedOn: '2026-10-07' }, settled, none, T0).state).toEqual({
      status: 'completed',
      resumeStatus: null,
      closedAt: null,
      completedOn: '2026-10-07',
    });
    expect(applyTransition(fresh('cancelled', 'accepted'), cancelled, none, T0).state).toEqual({
      status: 'on_hold',
      resumeStatus: 'accepted',
      closedAt: null,
      completedOn: null,
    });
  });

  it('EVM-030 AC1 "Zakończ" sets the completion day and "Otwórz ponownie" clears it; a resumption clears what the hold recorded', () => {
    const complete = findTransition({ status: 'in_progress', resumeStatus: null }, 'completed');
    const reopen = findTransition({ status: 'completed', resumeStatus: null }, 'in_progress');
    const resume = findTransition({ status: 'on_hold', resumeStatus: 'new' }, 'new');
    if (complete === undefined || reopen === undefined || resume === undefined) throw new Error('no row');
    const completed = applyTransition(fresh('in_progress'), complete, { reason: null, completedOn: '2026-10-08' }, T0).state;
    expect(completed).toMatchObject({ status: 'completed', completedOn: '2026-10-08' });
    expect(applyTransition(completed, reopen, { reason: null, completedOn: null }, T0).state).toMatchObject({
      status: 'in_progress',
      completedOn: null,
    });
    expect(applyTransition(fresh('on_hold', 'new'), resume, { reason: null, completedOn: null }, T0).state).toMatchObject({
      status: 'new',
      resumeStatus: null,
    });
  });
});

describe('allowedTransitions per role (EVM-030 AC1, AC4, AC7; the menu of the badge)', () => {
  it('EVM-030 AC7 Tylko odczyt gets none, in any status', () => {
    for (const status of ALL_STATUSES)
      expect(allowedTransitions({ status, resumeStatus: resumeOf(status) }, 'read_only'), status).toEqual([]);
  });

  it('EVM-030 AC1 the menu of "Nowe" is "Rozpocznij wycenę", "Zaakceptuj bez wyceny", "Wstrzymaj…", "Anuluj zlecenie…" — the same for Administrator and Editor', () => {
    const expected = ['quoting', 'accepted', 'on_hold', 'cancelled'];
    expect(allowedTransitions({ status: 'new', resumeStatus: null }, 'administrator')).toEqual(expected);
    expect(allowedTransitions({ status: 'new', resumeStatus: null }, 'editor')).toEqual(expected);
  });

  it('EVM-030 AC4 a closed order offers its restoration to the Administrator and nothing to the Editor', () => {
    expect(allowedTransitions({ status: 'settled', resumeStatus: null }, 'administrator')).toEqual(['completed']);
    expect(allowedTransitions({ status: 'cancelled', resumeStatus: 'in_progress' }, 'administrator')).toEqual(['on_hold']);
    expect(allowedTransitions({ status: 'settled', resumeStatus: null }, 'editor')).toEqual([]);
    expect(allowedTransitions({ status: 'cancelled', resumeStatus: 'in_progress' }, 'editor')).toEqual([]);
  });

  it('EVM-030 AC2 an order on hold offers the resumption to the held status (and the cancellation)', () => {
    expect(allowedTransitions({ status: 'on_hold', resumeStatus: 'quoting' }, 'editor')).toEqual(['quoting', 'cancelled']);
  });

  it('EVM-030 AC7 the table agrees with the document for each role: the Editor has every row of "A, E" and none of "A (step-up)"', () => {
    for (const [from, to, roles] of expandedDocument.map((rule) => [rule.from, rule.to, rule.roles] as const)) {
      const state = { status: from, resumeStatus: resumeOf(from) };
      const target = to === 'resume' ? 'accepted' : to;
      expect(allowedTransitions(state, 'editor').includes(target), `E ${from}>${to}`).toBe(roles === 'A,E');
      expect(allowedTransitions(state, 'administrator').includes(target), `A ${from}>${to}`).toBe(true);
    }
  });
});

/** A node of the walk: the status and what the status carries (the closing and the status of resumption). */
const key = (state: TransitionState): string =>
  `${state.status}|${state.resumeStatus ?? '-'}|${state.closedAt === null ? 'open' : 'closed'}`;

function walk(role: UserRole, start: TransitionState) {
  const seen = new Map<string, TransitionState>([[key(start), start]]);
  const used: Array<{ from: TransitionState; rule: ReturnType<typeof transitionsFrom>[number]['rule'] }> = [];
  const queue = [start];
  while (queue.length > 0) {
    const state = queue.shift() as TransitionState;
    for (const transition of transitionsFrom(state).filter((candidate) => mayUse(candidate, role))) {
      used.push({ from: state, rule: transition.rule });
      const next = applyTransition(state, transition, { reason: 'powód', completedOn: '2026-10-08' }, T0).state;
      if (!seen.has(key(next))) {
        seen.set(key(next), next);
        queue.push(next);
      }
    }
  }
  return { seen: [...seen.values()], used };
}

const STARTS: TransitionState[] = [
  ...ACTIVE_STATUSES.map((status) => fresh(status)),
  fresh('completed'),
  fresh('settled'),
  ...ACTIVE_STATUSES.flatMap((held) => [fresh('on_hold', held), fresh('cancelled', held)]),
];

describe('paths in the graph of transitions (EVM-030 AC7; SR-AUTHZ-05, SR-AUTHZ-10; AB-17)', () => {
  it('EVM-030 AC7 an Editor never leaves "Rozliczone" or "Anulowane": from a closed order nothing is reachable but the order itself', () => {
    for (const start of STARTS.filter((state) => state.status === 'settled' || state.status === 'cancelled')) {
      const { seen, used } = walk('editor', start);
      expect(seen.map(key), key(start)).toEqual([key(start)]);
      expect(used, key(start)).toEqual([]);
    }
  });

  it('EVM-030 AC7 whatever sequence an Editor takes from any start, no step uses a restoration, none leaves a closed status and none clears the closing time', () => {
    for (const start of STARTS) {
      const { used } = walk('editor', start);
      for (const { from, rule } of used) {
        expect(rule.audit, `${key(start)}: ${rule.from}>${rule.to}`).not.toBe('work_order.restored');
        expect(rule.stepUp).toBe(false);
        expect(rule.closedAt, `${rule.from}>${rule.to}`).not.toBe('clear');
        expect(from.status === 'settled' || from.status === 'cancelled', `${rule.from}>${rule.to}`).toBe(false);
      }
    }
  });

  it('EVM-030 AC7 along every path the closing time is set exactly when the status is closed (no sequence clears it by another way)', () => {
    for (const role of ['editor', 'administrator'] as const) {
      for (const start of STARTS) {
        for (const state of walk(role, start).seen) {
          expect(state.closedAt !== null, `${role} ${key(state)}`).toBe(state.status === 'settled' || state.status === 'cancelled');
        }
      }
    }
  });

  it('EVM-030 AC7 the Administrator, by contrast, does reach the restoration (the test of the test: the graph walk can see one)', () => {
    const { used } = walk('administrator', fresh('settled'));
    expect(used.map(({ rule }) => rule.audit)).toContain('work_order.restored');
  });

  it('EVM-030 AC7 every row with a step-up is restricted to the Administrator, so the step-up is never a way to hand a restoration to a lower role', () => {
    for (const rule of TRANSITION_TABLE.filter((candidate) => candidate.stepUp)) expect(rule.roles).toEqual(['administrator']);
    for (const rule of TRANSITION_TABLE.filter((candidate) => candidate.audit === 'work_order.restored')) expect(rule.stepUp).toBe(true);
  });
});
