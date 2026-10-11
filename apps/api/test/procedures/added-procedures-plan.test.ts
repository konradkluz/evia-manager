import { describe, expect, it } from 'vitest';
import {
  CompositionLimitError,
  planAddedProcedures,
  type TemplateProcedure,
  type TemplateStage,
} from '../../src/modules/procedures/domain/composition-plan.ts';

const ITEM = '0198b0a0-0000-7000-8000-0000000000aa';
const stage = (code: string, position: number): TemplateStage => ({
  sourceStageTemplateId: `stage-template-${code}`,
  code,
  name: `Etap ${code}`,
  position,
  outputDocumentKindCodes: [],
});
const procedure = (code: string, stages: TemplateStage[] = [stage('a1', 1), stage('a2', 2), stage('a3', 3)]): TemplateProcedure => ({
  sourceProcedureTemplateId: `procedure-template-${code}`,
  code,
  name: `Proces ${code}`,
  broughtByCatalogItemId: 'catalog-item',
  stages,
});
const plan = (overrides: Partial<Parameters<typeof planAddedProcedures>[0]> = {}) =>
  planAddedProcedures({
    brought: [procedure('electrical'), procedure('dso')],
    requestedCodes: ['electrical', 'dso'],
    activeCodes: [],
    takenPositions: [],
    scopeItemId: ITEM,
    ...overrides,
  });

describe('the processes added with an item to an order that exists (EVM-035 AC2, AC3, AC5; domain-model → ScopeItem)', () => {
  it('EVM-035 AC2 the chosen processes are copied with their stages in order, every one pointing at the item that brought it', () => {
    const [first] = plan({ requestedCodes: ['electrical'], brought: [procedure('electrical', [stage('c', 9), stage('a', 5)])] });
    expect(first).toMatchObject({
      code: 'electrical',
      name: 'Proces electrical',
      sourceScopeItemId: ITEM,
      sourceProcedureTemplateId: 'procedure-template-electrical',
      position: 1,
    });
    expect(first?.stages.map((item) => [item.position, item.code])).toEqual([
      [1, 'a'],
      [2, 'c'],
    ]);
  });

  it('EVM-035 AC2 only the chosen codes are planned, in the order the item brings them', () => {
    expect(plan({ requestedCodes: ['dso'] }).map((item) => item.code)).toEqual(['dso']);
    expect(plan({ requestedCodes: ['dso', 'electrical'] }).map((item) => item.code)).toEqual(['electrical', 'dso']);
    expect(plan({ requestedCodes: [] })).toEqual([]);
  });

  it('EVM-035 AC2 a code that is already active in the order is skipped — no duplicates by code, and no error', () => {
    expect(plan({ activeCodes: ['dso'], takenPositions: [1] }).map((item) => item.code)).toEqual(['electrical']);
    expect(plan({ activeCodes: ['dso', 'electrical'], takenPositions: [1, 2] })).toEqual([]);
  });

  it('EVM-035 AC2 a process that the item brings twice is planned once', () => {
    expect(plan({ brought: [procedure('dso'), procedure('dso')], requestedCodes: ['dso'] })).toHaveLength(1);
  });

  it('EVM-035 AC2 the new processes take the positions after the highest one; with the end past the limit, the lowest free places', () => {
    expect(plan({ activeCodes: ['x', 'y'], takenPositions: [1, 2] }).map((item) => item.position)).toEqual([3, 4]);
    expect(plan({ activeCodes: ['x'], takenPositions: [5] }).map((item) => item.position)).toEqual([6, 7]);
    const taken = Array.from({ length: 29 }, (_, index) => index + 2); // 2…30: one free place, at 1
    expect(
      plan({ requestedCodes: ['electrical'], activeCodes: taken.map((n) => `p${n}`), takenPositions: taken }).map((item) => item.position),
    ).toEqual([1]);
  });

  it('EVM-035 AC5 SR-API-02 the 31st process fails the whole addition (nothing is cut off): 29 active + 2 chosen', () => {
    const active = Array.from({ length: 29 }, (_, index) => `p${index}`);
    expect(() => plan({ activeCodes: active, takenPositions: active.map((_, index) => index + 1) })).toThrow(CompositionLimitError);
    expect(plan({ activeCodes: active.slice(0, 28), takenPositions: [] })).toHaveLength(2); // 28 + 2 = 30 is allowed
  });

  it('EVM-035 AC5 a process of more than 30 stages (a defect of the catalogue) fails the addition, not the data', () => {
    const stages = Array.from({ length: 31 }, (_, index) => stage(`s${index}`, index + 1));
    expect(() => plan({ brought: [procedure('long', stages)], requestedCodes: ['long'] })).toThrow(/too_many_stages/);
  });
});
