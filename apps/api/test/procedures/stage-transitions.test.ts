import { describe, expect, it } from 'vitest';
import { STAGE_STATUSES, type StageStatus } from '../../src/modules/procedures/domain/stage-rules.ts';
import {
  allowedStageTransitions,
  applyStageTransition,
  findStageTransition,
  mayUse,
  normalizeTransitionFields,
  STAGE_TRANSITION_TABLE,
  type StageTransitionCommand,
} from '../../src/modules/procedures/domain/stage-transitions.ts';

const TODAY = '2026-10-03';
const NOW = new Date('2026-10-03T08:00:00.000Z');
const PARTY = '0198b0a0-0000-7000-8000-000000000003';
const fieldsOf = (command: StageTransitionCommand) => {
  const result = normalizeTransitionFields(command, TODAY);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.errors)}`);
  return result.fields;
};
const refused = (command: StageTransitionCommand) => {
  const result = normalizeTransitionFields(command, TODAY);
  if (result.ok) throw new Error('expected the command to be refused');
  return result.errors;
};
const rule = (from: StageStatus, to: StageStatus) => {
  const found = findStageTransition(from, to);
  if (found === undefined) throw new Error(`no row ${from} > ${to}`);
  return found;
};

describe('the table of transitions of a stage (EVM-032 AC1, AC4, AC7; SR-API-07, SR-AUTHZ-05)', () => {
  it('EVM-032 AC1 the menu of a stage that is "Do zrobienia" has the five moves: start, waiting, done, not applicable, block', () => {
    expect(allowedStageTransitions('todo', 'editor')).toEqual(['in_progress', 'waiting', 'done', 'not_applicable', 'blocked']);
  });

  it('EVM-032 AC1 AC3 AC4 the menu of every other status is the table of the domain model', () => {
    expect(allowedStageTransitions('in_progress', 'administrator')).toEqual(['waiting', 'done', 'not_applicable', 'blocked']);
    expect(allowedStageTransitions('waiting', 'editor')).toEqual(['in_progress', 'done', 'not_applicable', 'blocked']);
    expect(allowedStageTransitions('blocked', 'editor')).toEqual(['in_progress']);
    expect(allowedStageTransitions('done', 'editor')).toEqual(['in_progress']);
    expect(allowedStageTransitions('not_applicable', 'editor')).toEqual(['todo']);
  });

  it('EVM-032 AC7 the table has the sixteen rows of the domain model, each for Administrator and Editor and never for Tylko odczyt', () => {
    expect(STAGE_TRANSITION_TABLE).toHaveLength(16);
    for (const row of STAGE_TRANSITION_TABLE) {
      expect(row.roles, `${row.from}>${row.to}`).toEqual(['administrator', 'editor']);
      expect(mayUse(row, 'read_only'), `${row.from}>${row.to}`).toBe(false);
    }
    for (const status of STAGE_STATUSES) expect(allowedStageTransitions(status, 'read_only')).toEqual([]);
  });

  it('EVM-032 AC6 a move that is not in the table does not exist: nothing leaves a status to itself, nothing returns to todo but "Przywróć"', () => {
    for (const status of STAGE_STATUSES) expect(findStageTransition(status, status), status).toBeUndefined();
    expect(findStageTransition('in_progress', 'todo')).toBeUndefined();
    expect(findStageTransition('done', 'blocked')).toBeUndefined();
    expect(findStageTransition('blocked', 'done')).toBeUndefined();
    expect(findStageTransition('not_applicable', 'in_progress')).toBeUndefined();
    expect(findStageTransition('blocked', 'waiting')).toBeUndefined();
    expect(STAGE_TRANSITION_TABLE.filter((row) => row.to === 'todo').map((row) => row.from)).toEqual(['not_applicable']);
  });

  it('EVM-032 AC7 the graph is walked from the table: from every status every status is reachable, and only through rows (no dead end, no trap)', () => {
    for (const start of STAGE_STATUSES) {
      const seen = new Set<StageStatus>([start]);
      const queue = [start];
      while (queue.length > 0) {
        const next = queue.shift() as StageStatus;
        for (const to of allowedStageTransitions(next, 'editor')) {
          if (!seen.has(to)) {
            seen.add(to);
            queue.push(to);
          }
        }
      }
      expect([...seen].sort(), start).toEqual([...STAGE_STATUSES].sort());
    }
  });
});

describe('the fields of a transition (EVM-032 AC2, AC4, AC5; SR-INPUT-01, SR-INPUT-02, SR-DATA-02)', () => {
  it('EVM-032 AC2 waiting: who and since (today by default); a party with its identifier', () => {
    expect(fieldsOf({ to: 'waiting', waitingOn: 'customer' }).waiting).toEqual({
      waitingOn: 'customer',
      waitingOnPartyId: null,
      waitingSince: TODAY,
    });
    expect(fieldsOf({ to: 'waiting', waitingOn: 'party', waitingOnPartyId: PARTY, waitingSince: '2026-09-18' }).waiting).toEqual({
      waitingOn: 'party',
      waitingOnPartyId: PARTY,
      waitingSince: '2026-09-18',
    });
  });

  it('EVM-032 AC2 waiting without who, a party without its id and "since" from the future are refused with a pointer and a code', () => {
    expect(refused({ to: 'waiting' })).toEqual([{ pointer: '/waitingOn', code: 'required' }]);
    expect(refused({ to: 'waiting', waitingOn: 'party' })).toEqual([{ pointer: '/waitingOnPartyId', code: 'required' }]);
    expect(refused({ to: 'waiting', waitingOn: 'customer', waitingSince: '2026-10-04' })).toEqual([
      { pointer: '/waitingSince', code: 'out_of_range' },
    ]);
  });

  it('EVM-032 AC4 done: the day of completion is today by default, not from the future and not before 2000', () => {
    expect(fieldsOf({ to: 'done' }).completedOn).toBe(TODAY);
    expect(fieldsOf({ to: 'done', completedOn: '2026-10-01' }).completedOn).toBe('2026-10-01');
    expect(fieldsOf({ to: 'done', completedOn: '2000-01-01' }).completedOn).toBe('2000-01-01');
    expect(refused({ to: 'done', completedOn: '2026-10-04' })).toEqual([{ pointer: '/completedOn', code: 'out_of_range' }]);
    expect(refused({ to: 'done', completedOn: '1999-12-31' })).toEqual([{ pointer: '/completedOn', code: 'out_of_range' }]);
  });

  it('EVM-032 AC4 blocked: the reason is required, plain text (NFC, trimmed), 1..500 — an error never carries the text', () => {
    expect(fieldsOf({ to: 'blocked', blockedReason: '  Brak zgody wspólnoty  ' }).blockedReason).toBe('Brak zgody wspólnoty');
    expect(fieldsOf({ to: 'blocked', blockedReason: 'a'.repeat(500) }).blockedReason).toHaveLength(500);
    expect(fieldsOf({ to: 'blocked', blockedReason: 'é' }).blockedReason).toBe('é');
    expect(refused({ to: 'blocked' })).toEqual([{ pointer: '/blockedReason', code: 'required' }]);
    expect(refused({ to: 'blocked', blockedReason: '   ' })).toEqual([{ pointer: '/blockedReason', code: 'required' }]);
    expect(refused({ to: 'blocked', blockedReason: 'a'.repeat(501) })).toEqual([{ pointer: '/blockedReason', code: 'too_long' }]);
    expect(refused({ to: 'blocked', blockedReason: 'tekst\u0007' })).toEqual([{ pointer: '/blockedReason', code: 'invalid_characters' }]);
    expect(JSON.stringify(refused({ to: 'blocked', blockedReason: 'Syntetyczny\u0007' }))).not.toContain('Syntetyczny');
  });

  it('EVM-032 AC4 AC6 a field the target does not take is not_allowed: no waiting for outside waiting, no reason outside blocked, no day outside done', () => {
    expect(
      refused({
        to: 'in_progress',
        waitingOn: 'customer',
        waitingOnPartyId: PARTY,
        waitingSince: TODAY,
        blockedReason: 'x',
        completedOn: TODAY,
      }),
    ).toEqual([
      { pointer: '/waitingOn', code: 'not_allowed' },
      { pointer: '/waitingOnPartyId', code: 'not_allowed' },
      { pointer: '/waitingSince', code: 'not_allowed' },
      { pointer: '/blockedReason', code: 'not_allowed' },
      { pointer: '/completedOn', code: 'not_allowed' },
    ]);
    expect(refused({ to: 'blocked', blockedReason: 'x', completedOn: TODAY })).toEqual([{ pointer: '/completedOn', code: 'not_allowed' }]);
    expect(refused({ to: 'done', blockedReason: 'x' })).toEqual([{ pointer: '/blockedReason', code: 'not_allowed' }]);
  });

  it('EVM-032 AC4 the plain moves take no field at all', () => {
    for (const to of ['in_progress', 'not_applicable', 'todo'] as const) {
      expect(fieldsOf({ to })).toEqual({ waiting: null, blockedReason: null, completedOn: null });
    }
  });
});

describe('the effect of a transition on the stage (EVM-032 AC1, AC3, AC4, AC5)', () => {
  const none = { waiting: null, blockedReason: null, completedOn: null };
  const waiting = { waitingOn: 'party', waitingOnPartyId: PARTY, waitingSince: '2026-09-18' } as const;

  it('EVM-032 AC1 "Rozpocznij" (todo > in_progress) records the time of the start; no other move does', () => {
    expect(applyStageTransition(rule('todo', 'in_progress'), none, NOW).startedAt).toEqual(NOW);
    for (const row of STAGE_TRANSITION_TABLE.filter((candidate) => !(candidate.from === 'todo' && candidate.to === 'in_progress'))) {
      expect(applyStageTransition(row, none, NOW), `${row.from}>${row.to}`).not.toHaveProperty('startedAt');
    }
  });

  it('EVM-032 AC2 entering "Czekamy na…" sets who and since and clears the rest', () => {
    expect(applyStageTransition(rule('in_progress', 'waiting'), { ...none, waiting }, NOW)).toEqual({
      status: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: PARTY,
      waitingSince: '2026-09-18',
      blockedReason: null,
      completedOn: null,
    });
  });

  it('EVM-032 AC3 AC4 leaving "Czekamy na…" (answer, done, blocked, not applicable) clears who and since', () => {
    for (const to of ['in_progress', 'done', 'blocked', 'not_applicable'] as const) {
      expect(applyStageTransition(rule('waiting', to), none, NOW), to).toMatchObject({
        status: to,
        waitingOn: null,
        waitingOnPartyId: null,
        waitingSince: null,
      });
    }
  });

  it('EVM-032 AC4 "Zakończ" sets the day, "Zablokuj" the reason, "Odblokuj" and "Otwórz ponownie" clear them', () => {
    expect(applyStageTransition(rule('waiting', 'done'), { ...none, completedOn: '2026-10-01' }, NOW)).toMatchObject({
      status: 'done',
      completedOn: '2026-10-01',
      waitingOn: null,
    });
    expect(applyStageTransition(rule('todo', 'blocked'), { ...none, blockedReason: 'Brak zgody' }, NOW)).toMatchObject({
      status: 'blocked',
      blockedReason: 'Brak zgody',
    });
    expect(applyStageTransition(rule('blocked', 'in_progress'), none, NOW)).toMatchObject({ status: 'in_progress', blockedReason: null });
    expect(applyStageTransition(rule('done', 'in_progress'), none, NOW)).toMatchObject({ status: 'in_progress', completedOn: null });
    expect(applyStageTransition(rule('not_applicable', 'todo'), none, NOW)).toMatchObject({ status: 'todo' });
  });

  it('EVM-032 AC5 "Cofnij" is an ordinary move with the previous parameters: in_progress > waiting keeps the old since (the counter is not reset)', () => {
    const undo = fieldsOf({ to: 'waiting', waitingOn: 'party', waitingOnPartyId: PARTY, waitingSince: '2026-09-18' });
    expect(applyStageTransition(rule('in_progress', 'waiting'), undo, NOW).waitingSince).toBe('2026-09-18');
  });
});
