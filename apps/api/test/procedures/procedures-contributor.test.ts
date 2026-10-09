import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { TemplateDirectory, TemplateProcedureForCopy } from '../../src/modules/catalog/index.ts';
import { ProceduresCompositionContributor } from '../../src/modules/procedures/application/procedures-contributor.ts';
import { WorkOrderCompositionRegistry, type CompositionContext } from '../../src/modules/work-orders/index.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { principal } from '../support/principals.ts';
import { uuidv7 } from '../support/uuid.ts';

// The contributor with a FAKE catalog: every refusal comes BEFORE the first write, so the fake transaction has no query methods at
// all — a call to one would fail the test (the writes themselves are proved against PostgreSQL in test/integration).
const TRANSACTION = { marker: 'the transaction of the creation' } as unknown as Kysely<Database>;

const brought = (count: number, stages = 1): TemplateProcedureForCopy[] =>
  Array.from({ length: count }, (_, index) => ({
    sourceProcedureTemplateId: uuidv7(),
    code: `process_${index}`,
    name: `Proces ${index}`,
    broughtByCatalogItemId: uuidv7(),
    stages: Array.from({ length: stages }, (_unused, stageIndex) => ({
      sourceStageTemplateId: uuidv7(),
      code: `stage_${stageIndex}`,
      name: `Etap ${stageIndex}`,
      position: stageIndex + 1,
      outputDocumentKindCodes: [],
    })),
  }));

function setup(answer: TemplateProcedureForCopy[]) {
  const find = vi.fn(() => Promise.resolve(answer));
  const registry = new WorkOrderCompositionRegistry();
  const contributor = new ProceduresCompositionContributor({ findProceduresForCopy: find } as unknown as TemplateDirectory, registry);
  const context = (templateId: string | null): CompositionContext => ({
    workOrderId: uuidv7(),
    templateId,
    scopeItems: [],
    principal: principal({ role: 'editor' }),
    now: new Date('2026-10-09T08:00:00Z'),
  });
  return { find, registry, contributor, context };
}

describe('the contributor of the processes (EVM-031 AC1; SR-API-06, SR-ERR-01)', () => {
  it('EVM-031 AC1 it registers itself under the name "procedures", before the payments (order 100), when the module starts', () => {
    const { registry, contributor } = setup([]);
    contributor.onModuleInit();
    expect(registry.ordered().map((item) => [item.name, item.order])).toEqual([['procedures', 100]]);
    expect(() => {
      contributor.onModuleInit();
    }).toThrow(/already registered/);
  });

  it('EVM-031 AC1 an order without a template asks the catalog for nothing and writes nothing', async () => {
    const { find, contributor, context } = setup(brought(3));
    await contributor.contribute(TRANSACTION, context(null));
    expect(find).not.toHaveBeenCalled();
  });

  it('EVM-031 AC1 a template that brings nothing writes nothing', async () => {
    const { find, contributor, context } = setup([]);
    const templateId = uuidv7();
    await contributor.contribute(TRANSACTION, context(templateId));
    expect(find).toHaveBeenCalledWith(TRANSACTION, templateId);
  });

  it('EVM-031 SR-API-02 SR-ERR-01 a template that brings 31 processes — or a process with 31 stages — fails the creation (the contributor throws before any write); nothing is cut off', async () => {
    const tooMany = setup(brought(31));
    await expect(tooMany.contributor.contribute(TRANSACTION, tooMany.context(uuidv7()))).rejects.toThrow(/too_many_procedures/);
    const tooLong = setup(brought(1, 31));
    await expect(tooLong.contributor.contribute(TRANSACTION, tooLong.context(uuidv7()))).rejects.toThrow(/too_many_stages/);
  });
});
