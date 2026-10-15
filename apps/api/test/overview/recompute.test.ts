import { describe, expect, it } from 'vitest';
import {
  computeProjection,
  differingGroups,
  type MilestoneSignal,
  type OrderKeys,
  type UnfinishedStage,
} from '../../src/modules/overview/domain/recompute.ts';

const KEYS: OrderKeys = {
  id: '01a13115-0000-7000-8000-000000000001',
  number: 'ZL-2026-0001',
  status: 'in_progress',
  createdAt: new Date('2026-09-01T08:00:00.000Z'),
  deletedAt: null,
  coordinatorUserId: null,
  customerId: null,
  siteId: null,
  sourceTemplateId: null,
};
const OSD = '01a13115-0000-7000-8000-0000000000a1';
const MANAGER = '01a13115-0000-7000-8000-0000000000a2';
const KINDS = new Map([
  [OSD, 'distribution_system_operator'],
  [MANAGER, 'building_manager'],
]);

let counter = 0;
function stage(overrides: Partial<UnfinishedStage> = {}): UnfinishedStage {
  counter += 1;
  return {
    stageId: `01a13115-0000-7000-8000-${String(counter).padStart(12, '0')}`,
    workOrderId: KEYS.id,
    procedurePosition: 1,
    stagePosition: counter,
    status: 'todo',
    waitingOn: null,
    waitingOnPartyId: null,
    waitingSince: null,
    dueDate: null,
    ...overrides,
  };
}
const waiting = (since: string, overrides: Partial<UnfinishedStage> = {}) =>
  stage({ status: 'waiting', waitingOn: 'party', waitingOnPartyId: OSD, waitingSince: since, ...overrides });

describe('the projection of one work order (EVM-034 AC1, AC4; ADR-0017 -> "Funkcja przeliczenia")', () => {
  it('EVM-034 AC1 the longest wait is the OSD since 15 days, the customer since 3 days is the "+1": two waits, the OSD first', () => {
    const projection = computeProjection(
      KEYS,
      null,
      [stage({ status: 'waiting', waitingOn: 'customer', waitingSince: '2026-09-30' }), waiting('2026-09-18')],
      KINDS,
      [],
    );
    expect(projection.summary).toMatchObject({
      waitingCount: 2,
      longestWaitingSince: '2026-09-18',
      longestWaitingOn: 'party',
      longestWaitingPartyId: OSD,
    });
    expect(projection.waits.map((wait) => [wait.waitingOn, wait.partyKind])).toEqual([
      ['party', 'distribution_system_operator'],
      ['customer', null],
    ]);
  });

  it('EVM-034 AC4 a tie in the day is resolved by the position of the process, then of the stage, then the identifier of the stage', () => {
    const second = waiting('2026-09-18', { procedurePosition: 2, stagePosition: 1, waitingOnPartyId: MANAGER });
    const firstOfTwo = waiting('2026-09-18', { procedurePosition: 1, stagePosition: 5 });
    const earlierStage = waiting('2026-09-18', { procedurePosition: 1, stagePosition: 2, waitingOnPartyId: MANAGER });
    const projection = computeProjection(KEYS, null, [second, firstOfTwo, earlierStage], KINDS, []);
    expect(projection.waits.map((wait) => wait.stageId)).toEqual([earlierStage.stageId, firstOfTwo.stageId, second.stageId]);
    expect(projection.summary.longestWaitingPartyId).toBe(MANAGER);
  });

  it('EVM-034 AC4 the next due date is the smallest due date of the unfinished stages; none: null', () => {
    const none = computeProjection(KEYS, null, [stage(), stage({ status: 'blocked' })], KINDS, []);
    expect(none.summary.nextDueDate).toBeNull();
    const some = computeProjection(
      KEYS,
      null,
      [
        stage({ dueDate: '2026-11-02' }),
        stage({ status: 'in_progress', dueDate: '2026-10-05' }),
        waiting('2026-10-01', { dueDate: '2026-10-20' }),
      ],
      KINDS,
      [],
    );
    expect(some.summary.nextDueDate).toBe('2026-10-05');
  });

  it('EVM-034 AC1 an order without a wait has no longest wait and a count of 0 (the column shows a dash)', () => {
    const projection = computeProjection(KEYS, 'single_family_house', [stage({ status: 'in_progress' })], KINDS, []);
    expect(projection.summary).toMatchObject({
      waitingCount: 0,
      longestWaitingSince: null,
      longestWaitingOn: null,
      longestWaitingPartyId: null,
      siteType: 'single_family_house',
    });
    expect(projection.waits).toEqual([]);
  });

  it('EVM-034 AC6 a wait for a party of an unknown kind fails (the transaction rolls back: fail closed)', () => {
    expect(() => computeProjection(KEYS, null, [waiting('2026-09-18', { waitingOnPartyId: 'unknown-party' })], KINDS, [])).toThrow();
  });

  it('EVM-034 AC6 a wait for a party without its identifier, or a waiting stage without "waiting for", is a defect that fails the recomputation', () => {
    expect(() => computeProjection(KEYS, null, [waiting('2026-09-18', { waitingOnPartyId: null })], KINDS, [])).toThrow();
    expect(() => computeProjection(KEYS, null, [waiting('2026-09-18', { waitingOn: null })], KINDS, [])).toThrow();
  });

  it('EVM-034 AC6 a waiting stage without the day cannot be dated: it is not listed as a wait and does not stop the recomputation', () => {
    const projection = computeProjection(
      KEYS,
      null,
      [waiting('2026-09-18', { waitingSince: null }), stage({ status: 'in_progress' })],
      KINDS,
      [],
    );
    expect(projection.summary.waitingCount).toBe(0);
    expect(projection.waits).toEqual([]);
  });

  it('EVM-034 AC4 the order of the waits is total: the same day and the same positions fall back to the identifier of the stage, whatever the input order', () => {
    const a = waiting('2026-09-18', { stageId: '01a13115-0000-7000-8000-00000000f001', procedurePosition: 1, stagePosition: 1 });
    const b = waiting('2026-09-18', { stageId: '01a13115-0000-7000-8000-00000000f002', procedurePosition: 1, stagePosition: 1 });
    const c = waiting('2026-09-18', { stageId: '01a13115-0000-7000-8000-00000000f003', procedurePosition: 1, stagePosition: 1 });
    for (const input of [
      [a, b, c],
      [c, b, a],
      [b, c, a],
      [c, a, b],
    ]) {
      expect(computeProjection(KEYS, null, input, KINDS, []).waits.map((wait) => wait.stageId)).toEqual([a.stageId, b.stageId, c.stageId]);
    }
  });

  it('EVM-034 AC6 a deleted order keeps its deletion time as the authorisation column', () => {
    const deletedAt = new Date('2026-10-01T10:00:00.000Z');
    const projection = computeProjection({ ...KEYS, deletedAt }, null, [], KINDS, []);
    expect(projection.summary.deletedAt).toEqual(deletedAt);
  });
});

describe('the comparison of a stored row with the recomputed one (EVM-034 W2, W11)', () => {
  const stages = [waiting('2026-09-18')];
  const base = computeProjection(KEYS, null, stages, KINDS, []);

  it('EVM-034 a row that equals the recomputation differs in no group', () => {
    expect(differingGroups(base, computeProjection(KEYS, null, stages, KINDS, []))).toEqual([]);
  });

  it('EVM-034 a different deletion time is the group "authorization" (a security alert), a different status "keys"', () => {
    const deleted = computeProjection({ ...KEYS, deletedAt: new Date('2026-10-02T00:00:00.000Z') }, null, stages, KINDS, []);
    expect(differingGroups(base, deleted)).toEqual(['authorization']);
    const closed = computeProjection({ ...KEYS, status: 'settled' }, null, stages, KINDS, []);
    expect(differingGroups(base, closed)).toEqual(['keys']);
  });

  it('EVM-034 waits for the customer (no party) are compared by their day: a wait that moved is "waiting"', () => {
    const customer = (since: string) =>
      computeProjection(
        KEYS,
        null,
        [stage({ stageId: '01a13115-0000-7000-8000-00000000f010', status: 'waiting', waitingOn: 'customer', waitingSince: since })],
        KINDS,
        [],
      );
    expect(differingGroups(customer('2026-09-18'), customer('2026-09-18'))).toEqual([]);
    expect(differingGroups(customer('2026-09-18'), customer('2026-09-20'))).toEqual(['waiting']);
  });

  it('EVM-034 a different wait is "waiting", a different due date is "deadline"', () => {
    expect(differingGroups(base, computeProjection(KEYS, null, [], KINDS, []))).toEqual(['waiting']);
    const due = computeProjection(KEYS, null, [{ ...stages[0], dueDate: '2026-12-01' } as UnfinishedStage], KINDS, []);
    expect(differingGroups(base, due)).toEqual(['deadline']);
  });
});

describe('the signals of payments of one work order (EVM-056 AC1, AC2; ADR-0017 → "Model projekcji", W1, W3)', () => {
  const milestone = (status: MilestoneSignal['status'], dueDate: string | null = null): MilestoneSignal => ({
    workOrderId: KEYS.id,
    status,
    dueDate,
  });

  it('EVM-056 AC1 the counters of the issued and the paid milestones and the earliest due date of the issued ones — no amount', () => {
    const projection = computeProjection(KEYS, null, [], KINDS, [
      milestone('invoiced', '2026-10-20'),
      milestone('planned'),
      milestone('paid', '2026-09-01'),
      milestone('invoiced', '2026-10-07'),
      milestone('paid', '2026-09-15'),
    ]);
    expect(projection.summary).toMatchObject({ invoicedCount: 2, paidCount: 2, earliestInvoicedDueDate: '2026-10-07' });
    expect(Object.keys(projection.summary).join(' ')).not.toMatch(/amount|total|name|invoiceNumber/);
  });

  it('EVM-056 AC1 an order without milestones (or with planned ones only) has zero counters and no date', () => {
    for (const milestones of [[], [milestone('planned'), milestone('planned')]])
      expect(computeProjection(KEYS, null, [], KINDS, milestones).summary).toMatchObject({
        invoicedCount: 0,
        paidCount: 0,
        earliestInvoicedDueDate: null,
      });
  });

  it('EVM-056 AC1 a different signal of payments is the group "payments" of verify (reported apart from the others)', () => {
    const base = computeProjection(KEYS, null, [], KINDS, [milestone('invoiced', '2026-10-07')]);
    expect(differingGroups(base, computeProjection(KEYS, null, [], KINDS, [milestone('invoiced', '2026-10-07')]))).toEqual([]);
    expect(differingGroups(base, computeProjection(KEYS, null, [], KINDS, [milestone('invoiced', '2026-10-08')]))).toEqual(['payments']);
    expect(differingGroups(base, computeProjection(KEYS, null, [], KINDS, [milestone('paid', '2026-10-07')]))).toEqual(['payments']);
    expect(
      differingGroups(
        base,
        computeProjection(KEYS, null, [], KINDS, [milestone('invoiced', '2026-10-07'), milestone('paid', '2026-10-01')]),
      ),
    ).toEqual(['payments']);
  });
});
