import type { ProcedureStage } from '@evia/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { LONG_WAIT_DAYS, STAGE_DIALOG_ACTIONS, describeStageFailure, stageEntries, undoOf } from '../src/work-orders/stage-transitions.ts';

const stage = (extra: Partial<ProcedureStage>): ProcedureStage => ({
  id: '01968f3e-0000-7000-8000-0000000f0001',
  code: 'c',
  name: 'Etap',
  position: 1,
  status: 'todo',
  dueDate: null,
  overdue: false,
  responsibleUser: null,
  waitingOn: null,
  waitingParty: null,
  waitingSince: null,
  waitingDays: null,
  blockedReason: null,
  startedAt: null,
  completedOn: null,
  version: 1,
  ...extra,
});

describe('the menu of a stage (EVM-032 AC1)', () => {
  it('EVM-032 AC1 every status offers the edges of the table "Etap procesu" and nothing else', () => {
    const targets = (status: string) =>
      stageEntries(status).map((entry) => `${entry.action}${entry.to === undefined ? '' : `>${entry.to}`}`);
    expect(targets('todo')).toEqual(['start>in_progress', 'wait>waiting', 'finish>done', 'notApplicable>not_applicable', 'block>blocked']);
    expect(targets('in_progress')).toEqual(['wait>waiting', 'finish>done', 'notApplicable>not_applicable', 'block>blocked']);
    expect(targets('waiting')).toEqual([
      'answered>in_progress',
      'changeWaiting',
      'finish>done',
      'notApplicable>not_applicable',
      'block>blocked',
    ]);
    expect(targets('blocked')).toEqual(['unblock>in_progress']);
    expect(targets('done')).toEqual(['reopen>in_progress']);
    expect(targets('not_applicable')).toEqual(['restore>todo']);
    expect(targets('future_status')).toEqual([]);
    expect(targets('toString')).toEqual([]);
  });

  it('EVM-032 AC2 the actions that need a field open a dialog, the others run at once; the warning starts above 14 days', () => {
    expect([...STAGE_DIALOG_ACTIONS].sort()).toEqual(['block', 'changeWaiting', 'finish', 'wait']);
    expect(LONG_WAIT_DAYS).toBe(14);
  });
});

describe('"Cofnij" (EVM-032 AC5)', () => {
  const waiting = stage({
    status: 'waiting',
    waitingOn: 'party',
    waitingParty: { id: '01968f3e-0000-7000-8000-00000000c001', displayName: 'Stoen Operator (OSD)' },
    waitingSince: '2026-09-18',
  });

  it('EVM-032 AC5 the transitions that have a reverse in the table get it, with the parameters a person could give by hand', () => {
    expect(undoOf(stage({ status: 'todo' }), { to: 'not_applicable' })).toEqual({ to: 'todo' });
    expect(undoOf(stage({ status: 'not_applicable' }), { to: 'todo' })).toEqual({ to: 'not_applicable' });
    expect(undoOf(stage({ status: 'in_progress' }), { to: 'waiting', waitingOn: 'customer' })).toEqual({ to: 'in_progress' });
    expect(undoOf(stage({ status: 'in_progress' }), { to: 'done' })).toEqual({ to: 'in_progress' });
    expect(undoOf(stage({ status: 'in_progress' }), { to: 'blocked', blockedReason: 'x' })).toEqual({ to: 'in_progress' });
    expect(undoOf(waiting, { to: 'in_progress' })).toEqual({
      to: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: '01968f3e-0000-7000-8000-00000000c001',
      waitingSince: '2026-09-18',
    });
    expect(undoOf(stage({ status: 'waiting', waitingOn: 'customer' }), { to: 'in_progress' })).toEqual({
      to: 'waiting',
      waitingOn: 'customer',
    });
    expect(undoOf(stage({ status: 'blocked', blockedReason: 'Brak zgody' }), { to: 'in_progress' })).toEqual({
      to: 'blocked',
      blockedReason: 'Brak zgody',
    });
    expect(undoOf(stage({ status: 'done', completedOn: '2026-10-01' }), { to: 'in_progress' })).toEqual({
      to: 'done',
      completedOn: '2026-10-01',
    });
  });

  it.each([
    ['todo', 'in_progress'],
    ['todo', 'waiting'],
    ['todo', 'done'],
    ['todo', 'blocked'],
    ['in_progress', 'not_applicable'],
    ['waiting', 'done'],
    ['waiting', 'not_applicable'],
    ['waiting', 'blocked'],
  ] as const)('EVM-032 AC5 %s → %s has no "Cofnij"', (from, to) => {
    expect(undoOf(stage({ status: from, waitingOn: 'customer', blockedReason: 'x', completedOn: '2026-10-01' }), { to })).toBeUndefined();
  });

  it('EVM-032 AC5 a reverse that would need data the stage does not have is not offered', () => {
    expect(undoOf(stage({ status: 'waiting' }), { to: 'in_progress' })).toBeUndefined();
    expect(undoOf(stage({ status: 'blocked' }), { to: 'in_progress' })).toBeUndefined();
    expect(undoOf(stage({ status: 'done' }), { to: 'in_progress' })).toBeUndefined();
  });
});

describe('why a request failed (EVM-032 AC6)', () => {
  const failure = (status: number, code: string, errors: { pointer: string; code: string }[] = []) =>
    describeStageFailure(new ApiError(status, { code, errors }));

  it('EVM-032 AC6 the status and the code say which failure it is', () => {
    expect(failure(412, 'version_conflict')).toEqual({ kind: 'conflict' });
    expect(failure(409, 'invalid_state_transition')).toEqual({ kind: 'conflict' });
    expect(failure(409, 'work_order_closed')).toEqual({ kind: 'closed' });
    expect(failure(404, 'not_found')).toEqual({ kind: 'gone' });
    expect(failure(403, 'forbidden')).toEqual({ kind: 'forbidden' });
    expect(failure(429, 'rate_limited')).toEqual({ kind: 'rate', seconds: 60 });
    expect(failure(503, 'unavailable')).toEqual({ kind: 'network' });
    expect(describeStageFailure(new Error('offline'))).toEqual({ kind: 'network' });
    expect(failure(409, 'idempotency_in_progress')).toMatchObject({ kind: 'server' });
    expect(failure(400, 'validation_failed')).toMatchObject({ kind: 'server' });
  });

  it('EVM-032 AC6 400 names the fields by pointer and code — an unknown party is its own answer', () => {
    expect(failure(400, 'validation_failed', [{ pointer: '/waitingOnPartyId', code: 'unknown_party' }])).toEqual({ kind: 'party' });
    const fields = failure(400, 'validation_failed', [{ pointer: '/waitingSince', code: 'out_of_range' }]);
    expect(fields.kind).toBe('fields');
    expect(fields.kind === 'fields' && fields.pointers.get('/waitingSince')).toBe('out_of_range');
  });
});
