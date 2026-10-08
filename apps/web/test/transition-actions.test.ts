import type { WorkOrderStatus } from '@evia/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { actionOf, describeTransitionFailure, isClosed, menuEntries, todayWarsaw } from '../src/work-orders/transition-actions.ts';

const order = (status: WorkOrderStatus, allowedTransitions: WorkOrderStatus[]) => ({ status, allowedTransitions });
const problem = (status: number, code: string, extra: Record<string, unknown> = {}, retryAfter?: number) =>
  new ApiError(status, { code, traceId: 'abcdef0123456789', ...extra }, retryAfter);

describe('menu of the status badge (EVM-030 AC1, AC4, AC7)', () => {
  it('EVM-030 AC1 every edge of the table of transitions has one name, and the edges outside it have none', () => {
    const edges: Array<[string, WorkOrderStatus, string | undefined]> = [
      ['new', 'quoting', 'quote'],
      ['new', 'accepted', 'acceptWithoutQuote'],
      ['quoting', 'accepted', 'accept'],
      ['accepted', 'in_progress', 'start'],
      ['in_progress', 'completed', 'complete'],
      ['completed', 'settled', 'settle'],
      ['completed', 'in_progress', 'reopen'],
      ['in_progress', 'on_hold', 'hold'],
      ['new', 'on_hold', 'hold'],
      ['on_hold', 'in_progress', 'resume'],
      ['on_hold', 'accepted', 'resume'],
      ['in_progress', 'cancelled', 'cancel'],
      ['on_hold', 'cancelled', 'cancel'],
      ['settled', 'completed', 'restore'],
      ['cancelled', 'on_hold', 'restore'],
      ['settled', 'cancelled', undefined],
      ['new', 'completed', undefined],
    ];
    for (const [from, to, action] of edges) expect(actionOf(from, to), `${from} -> ${to}`).toBe(action);
  });

  it('EVM-030 AC1 the menu follows allowedTransitions in the order of the table: frequent first, "Wstrzymaj…" and "Anuluj zlecenie…" last', () => {
    expect(menuEntries(order('completed', ['in_progress', 'settled']), 'editor').map((entry) => entry.action)).toEqual([
      'settle',
      'reopen',
    ]);
    expect(menuEntries(order('on_hold', ['cancelled', 'in_progress']), 'administrator').map((entry) => entry.action)).toEqual([
      'resume',
      'cancel',
    ]);
    expect(menuEntries(order('new', ['cancelled', 'on_hold', 'accepted', 'quoting']), 'editor').map((entry) => entry.action)).toEqual([
      'quote',
      'acceptWithoutQuote',
      'hold',
      'cancel',
    ]);
  });

  it('EVM-030 AC4 a closed order offers only the restore: enabled for the Administrator, disabled for the Editor, absent for Tylko odczyt', () => {
    expect(menuEntries(order('settled', ['completed']), 'administrator')).toEqual([{ action: 'restore', to: 'completed' }]);
    expect(menuEntries(order('cancelled', ['on_hold']), 'administrator')).toEqual([{ action: 'restore', to: 'on_hold' }]);
    expect(menuEntries(order('settled', []), 'editor')).toEqual([{ action: 'restore', to: 'completed', forbidden: true }]);
    expect(menuEntries(order('cancelled', []), 'editor')).toEqual([{ action: 'restore', to: 'on_hold', forbidden: true }]);
    expect(menuEntries(order('cancelled', []), 'read_only')).toEqual([]);
    expect(menuEntries(order('new', ['quoting']), undefined)).toEqual([]);
    expect(isClosed('settled') && isClosed('cancelled') && !isClosed('completed')).toBe(true);
  });

  it('EVM-030 AC7 the Editor never gets a restore from allowedTransitions of an open order', () => {
    expect(menuEntries(order('completed', ['settled', 'in_progress']), 'editor').some((entry) => entry.action === 'restore')).toBe(false);
  });
});

describe('failures of a transition (EVM-030 AC5, AC8)', () => {
  it('EVM-030 AC5 412 and 409 invalid_state_transition are one conflict; the other 409 is a server failure', () => {
    expect(describeTransitionFailure(problem(412, 'version_conflict'))).toEqual({ kind: 'conflict' });
    expect(describeTransitionFailure(problem(409, 'invalid_state_transition'))).toEqual({ kind: 'conflict' });
    expect(describeTransitionFailure(problem(409, 'idempotency_in_progress'))).toEqual({ kind: 'server', code: 'abcdef01' });
  });

  it('EVM-030 AC4 403 step_up_required and forbidden are told apart; 422 and 429 carry their own kinds', () => {
    expect(describeTransitionFailure(problem(403, 'step_up_required'))).toEqual({ kind: 'stepUp' });
    expect(describeTransitionFailure(problem(403, 'forbidden'))).toEqual({ kind: 'forbidden' });
    expect(describeTransitionFailure(problem(422, 'transition_condition_not_met'))).toEqual({ kind: 'condition' });
    expect(describeTransitionFailure(problem(429, 'rate_limited', {}, 12))).toEqual({ kind: 'rate', seconds: 12 });
    expect(describeTransitionFailure(problem(429, 'rate_limited'))).toEqual({ kind: 'rate', seconds: 60 });
  });

  it('EVM-030 AC8 no answer and 5xx are network failures; 400 points at the fields by code only, any other 400 is a server failure', () => {
    expect(describeTransitionFailure(new Error('offline'))).toEqual({ kind: 'network' });
    expect(describeTransitionFailure(new ApiError(0, undefined))).toEqual({ kind: 'network' });
    expect(describeTransitionFailure(problem(503, 'unavailable'))).toEqual({ kind: 'network' });
    expect(
      describeTransitionFailure(
        problem(400, 'validation_failed', {
          errors: [
            { pointer: '/reason', code: 'too_long' },
            { pointer: '/completedOn', code: 'out_of_range' },
          ],
        }),
      ),
    ).toEqual({ kind: 'fields', reason: 'too_long', completedOn: 'out_of_range' });
    expect(describeTransitionFailure(problem(400, 'validation_failed', { errors: [{ pointer: '/reason', code: 'required' }] }))).toEqual({
      kind: 'fields',
      reason: 'required',
    });
    expect(
      describeTransitionFailure(problem(400, 'validation_failed', { errors: [{ pointer: '/headers/If-Match', code: 'invalid' }] })),
    ).toEqual({
      kind: 'server',
      code: 'abcdef01',
    });
    expect(describeTransitionFailure(new ApiError(404, { code: 'not_found' }))).toEqual({ kind: 'server', code: 'not_found' });
  });

  it('EVM-030 AC1 today is the day in Europe/Warsaw, not in UTC', () => {
    expect(todayWarsaw(Date.parse('2026-10-08T22:30:00.000Z'))).toBe('2026-10-09');
    expect(todayWarsaw(Date.parse('2026-10-08T10:00:00.000Z'))).toBe('2026-10-08');
  });
});
