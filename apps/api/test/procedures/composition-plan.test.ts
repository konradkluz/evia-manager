import { describe, expect, it } from 'vitest';
import {
  CompositionLimitError,
  planProcedures,
  type TemplateProcedure,
  type TemplateStage,
} from '../../src/modules/procedures/domain/composition-plan.ts';

const stage = (code: string, position: number): TemplateStage => ({
  sourceStageTemplateId: `stage-template-${code}`,
  code,
  name: `Etap ${code}`,
  position,
  outputDocumentKindCodes: [],
});
const procedure = (code: string, itemId: string, stages: TemplateStage[] = [stage('a1', 1)]): TemplateProcedure => ({
  sourceProcedureTemplateId: `procedure-template-${code}`,
  code,
  name: `Proces ${code}`,
  broughtByCatalogItemId: itemId,
  stages,
});
const planned = (brought: TemplateProcedure[], scope: Array<{ id: string; sourceCatalogItemId: string | null }> = []) =>
  planProcedures(brought, scope);

describe('the processes of a new order (EVM-031 AC1; domain-model → "Kompozycja zlecenia z szablonu")', () => {
  it('EVM-031 AC1 the processes keep the order of the template and are numbered 1, 2, 3 …, whatever the numbers of the template', () => {
    const result = planned([procedure('osd', 'i1'), procedure('admin', 'i2'), procedure('works', 'i3')]);
    expect(result.map((item) => [item.position, item.code])).toEqual([
      [1, 'osd'],
      [2, 'admin'],
      [3, 'works'],
    ]);
  });

  it('EVM-031 AC1 the stages of a process are in the order of the template and numbered from 1; the template numbers 5, 2, 9 give 1, 2, 3', () => {
    const [first] = planned([procedure('osd', 'i1', [stage('c', 9), stage('a', 5), stage('b', 2)])]);
    expect(first?.stages.map((item) => [item.position, item.code])).toEqual([
      [1, 'b'],
      [2, 'a'],
      [3, 'c'],
    ]);
  });

  it('EVM-031 AC1 a process whose code comes twice is made once — with the first one that brings it', () => {
    const result = planned(
      [procedure('osd', 'i1'), procedure('admin', 'i2'), { ...procedure('osd', 'i3'), name: 'Proces osd (druga kopia)' }],
      [
        { id: 's1', sourceCatalogItemId: 'i1' },
        { id: 's3', sourceCatalogItemId: 'i3' },
      ],
    );
    expect(result.map((item) => item.code)).toEqual(['osd', 'admin']);
    expect(result[0]).toMatchObject({ name: 'Proces osd', sourceScopeItemId: 's1' });
  });

  it('EVM-031 AC1 the process points at the scope item of the order that brought it; no such item (or an item without a source) gives null', () => {
    const result = planned(
      [procedure('osd', 'i1'), procedure('admin', 'i2')],
      [
        { id: 's1', sourceCatalogItemId: 'i1' },
        { id: 's9', sourceCatalogItemId: null },
      ],
    );
    expect(result.map((item) => item.sourceScopeItemId)).toEqual(['s1', null]);
  });

  it('EVM-031 AC1 the plan carries the sources of the copy (the process template and the stage templates)', () => {
    const [first] = planned([procedure('osd', 'i1')]);
    expect(first).toMatchObject({ sourceProcedureTemplateId: 'procedure-template-osd', code: 'osd', name: 'Proces osd' });
    expect(first?.stages[0]).toMatchObject({ sourceStageTemplateId: 'stage-template-a1', code: 'a1', name: 'Etap a1' });
  });

  it('EVM-031 AC1 a template that brings nothing gives an empty plan', () => {
    expect(planned([])).toEqual([]);
  });

  it('EVM-031 SR-API-02 SR-ERR-01 31 processes are refused, 30 are not; 31 stages in a process are refused, 30 are not — nothing is cut off', () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => procedure(`process_${index}`, `i${index}`));
    expect(planProcedures(many(30), [])).toHaveLength(30);
    expect(() => planProcedures(many(31), [])).toThrow(CompositionLimitError);
    expect(() => planProcedures(many(31), [])).toThrow(/too_many_procedures/);
    const stages = (count: number) => Array.from({ length: count }, (_, index) => stage(`stage_${index}`, index + 1));
    expect(planProcedures([procedure('osd', 'i1', stages(30))], [])).toHaveLength(1);
    expect(() => planProcedures([procedure('osd', 'i1', stages(31))], [])).toThrow(/too_many_stages/);
    try {
      planProcedures([procedure('osd', 'i1', stages(31))], []);
    } catch (error) {
      expect((error as CompositionLimitError).reason).toBe('too_many_stages');
      expect(JSON.stringify(error)).not.toContain('osd');
    }
  });

  it('EVM-031 AC1 the limit counts the processes that will be made, not the repeats: 31 offers of 30 different codes pass', () => {
    const offers = Array.from({ length: 31 }, (_, index) => procedure(`process_${index % 30}`, `i${index}`));
    expect(planned(offers)).toHaveLength(30);
  });
});
