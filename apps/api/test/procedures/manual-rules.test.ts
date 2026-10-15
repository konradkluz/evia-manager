import { describe, expect, it } from 'vitest';
import { CompositionLimitError, planProcedureCopy, type ProcedureToCopy } from '../../src/modules/procedures/domain/composition-plan.ts';
import { MANUAL_STAGE_CODE_PREFIX, manualStageCode, normalizeStageName } from '../../src/modules/procedures/domain/manual-stage.ts';
import { PROCEDURE_EVENT_TYPES, PROCEDURE_JOURNAL_EVENT_TYPES } from '../../src/modules/procedures/events.ts';
import { insertionPoint, movesToClose, movesToOpen } from '../../src/modules/procedures/domain/ordering.ts';

const rows = (...positions: number[]) => positions.map((position) => ({ id: `row-${position}`, position }));

describe('the places of the processes and stages (EVM-042 AC1, AC2, AC3; domain-model → Procedure, ProcedureStage)', () => {
  it('EVM-042 AC1 AC2 a row without a wanted place goes to the end; a wanted place is kept; one past the end is cut to the end', () => {
    expect(insertionPoint(undefined, 0)).toBe(1);
    expect(insertionPoint(undefined, 4)).toBe(5);
    expect(insertionPoint(1, 4)).toBe(1);
    expect(insertionPoint(5, 4)).toBe(5);
    expect(insertionPoint(30, 4)).toBe(5);
  });

  it('EVM-042 AC1 AC2 the rows from the new place on move one down, the LAST first, so none moves onto a taken place', () => {
    expect(movesToOpen(rows(1, 2, 3, 4), 2)).toEqual([
      { id: 'row-4', to: 5 },
      { id: 'row-3', to: 4 },
      { id: 'row-2', to: 3 },
    ]);
    expect(movesToOpen(rows(1, 2, 3), 1).map((move) => move.to)).toEqual([4, 3, 2]);
  });

  it('EVM-042 AC1 AC2 a row at the end needs no room', () => {
    expect(movesToOpen(rows(1, 2, 3), 4)).toEqual([]);
    expect(movesToOpen([], 1)).toEqual([]);
  });

  it('EVM-042 AC3 the gaps left by a deleted row close, the FIRST row first, and rows that are in place do not move', () => {
    expect(movesToClose(rows(1, 3, 4, 6))).toEqual([
      { id: 'row-3', to: 2 },
      { id: 'row-4', to: 3 },
      { id: 'row-6', to: 4 },
    ]);
    expect(movesToClose(rows(1, 2, 3))).toEqual([]);
    expect(movesToClose(rows(2))).toEqual([{ id: 'row-2', to: 1 }]);
  });

  it('EVM-042 AC3 the rows given in any order are closed in the order of their places', () => {
    expect(movesToClose([...rows(4, 1, 3)])).toEqual([
      { id: 'row-3', to: 2 },
      { id: 'row-4', to: 3 },
    ]);
  });
});

describe('the stage added by hand (EVM-042 AC2; SR-INPUT-01, SR-INPUT-05)', () => {
  it('EVM-042 AC2 the name is plain text: NFC once, trimmed, 1 to 120 characters', () => {
    expect(normalizeStageName('  Uzgodnienie terminu  ')).toEqual({ ok: true, name: 'Uzgodnienie terminu' });
    // a decomposed letter and its composed form are one name
    expect(normalizeStageName('Łączność ze zarządcą'.normalize('NFD'))).toEqual({
      ok: true,
      name: 'Łączność ze zarządcą'.normalize('NFC'),
    });
    expect(normalizeStageName('a'.repeat(120))).toMatchObject({ ok: true });
  });

  it('EVM-042 AC2 an empty, too long or control-character name is a pointer and a code — never the value', () => {
    expect(normalizeStageName('   ')).toEqual({ ok: false, errors: [{ pointer: '/name', code: 'required' }] });
    expect(normalizeStageName('a'.repeat(121))).toEqual({ ok: false, errors: [{ pointer: '/name', code: 'too_long' }] });
    expect(normalizeStageName('Etap\u0000')).toEqual({ ok: false, errors: [{ pointer: '/name', code: 'invalid_characters' }] });
    expect(normalizeStageName('Etap\nnowa linia')).toEqual({ ok: false, errors: [{ pointer: '/name', code: 'invalid_characters' }] });
    expect(normalizeStageName('Etap‮odwrócony')).toEqual({ ok: false, errors: [{ pointer: '/name', code: 'invalid_characters' }] });
    expect(JSON.stringify(normalizeStageName('Jan Kowalski\u0000'))).not.toContain('Kowalski');
  });

  it('EVM-042 AC2 the code is made of the prefix and 12 characters of the random part, whatever the length of it', () => {
    expect(manualStageCode('0123456789abcdef')).toBe(`${MANUAL_STAGE_CODE_PREFIX}0123456789ab`);
    expect(manualStageCode('0123456789ab')).toBe('custom_0123456789ab');
    expect(manualStageCode('0123456789ab')).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
  });
});

const template = (stages: number): ProcedureToCopy => ({
  sourceProcedureTemplateId: 'template-id',
  code: 'fire_opinion',
  name: 'Opinia ppoż',
  stages: Array.from({ length: stages }, (_, index) => ({
    sourceStageTemplateId: `stage-template-${index}`,
    code: `step_${index}`,
    name: `Etap ${index}`,
    position: 10 * (stages - index),
    outputDocumentKindCodes: [],
  })),
});

describe('the process added by hand (EVM-042 AC1, AC4; domain-model → Procedure)', () => {
  it('EVM-042 AC1 a COPY of the template at the chosen place: stages in order numbered 1…n, brought by no scope item', () => {
    const planned = planProcedureCopy(template(3), 4);
    expect(planned).toMatchObject({
      sourceProcedureTemplateId: 'template-id',
      sourceScopeItemId: null,
      code: 'fire_opinion',
      name: 'Opinia ppoż',
      position: 4,
    });
    expect(planned.stages.map((stage) => [stage.code, stage.position])).toEqual([
      ['step_2', 1],
      ['step_1', 2],
      ['step_0', 3],
    ]);
  });

  it('EVM-042 AC4 a template with 30 stages is copied; one with 31 is not — nothing is cut off', () => {
    expect(planProcedureCopy(template(30), 1).stages).toHaveLength(30);
    expect(() => planProcedureCopy(template(31), 1)).toThrow(CompositionLimitError);
    try {
      planProcedureCopy(template(31), 1);
    } catch (error) {
      expect((error as CompositionLimitError).reason).toBe('too_many_stages');
    }
  });
});

describe('the events of the module (EVM-042 AC5)', () => {
  it('EVM-042 AC5 the type of an audit event is never the type of a journal event: the bus delivers by type, so a clash would hand an audit event to the journal', () => {
    const audited: readonly string[] = PROCEDURE_EVENT_TYPES;
    expect(PROCEDURE_JOURNAL_EVENT_TYPES.filter((type) => audited.includes(type))).toEqual([]);
  });
});
