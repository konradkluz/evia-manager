import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogItemDirectory } from '../../src/modules/catalog/index.ts';
import { ProceduresScopeParticipant } from '../../src/modules/procedures/application/procedures-scope-participant.ts';
import { WorkOrderScopeRegistry, type ScopeAdditionContext } from '../../src/modules/work-orders/index.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { principal } from '../support/principals.ts';
import { uuidv7 } from '../support/uuid.ts';

// The participant with a FAKE catalog: a request that adds no process comes BEFORE the first query, so the fake transaction has no
// query methods at all — a call to one would fail the test (the writes themselves are proved against PostgreSQL in test/integration).
const TRANSACTION = { marker: 'the transaction of the addition' } as unknown as Kysely<Database>;

function setup() {
  const findProcedures = vi.fn(() => Promise.resolve([]));
  const registry = new WorkOrderScopeRegistry();
  const participant = new ProceduresScopeParticipant({ findProcedures } as unknown as CatalogItemDirectory, registry);
  const context = (procedureCodes: string[]): ScopeAdditionContext => ({
    workOrderId: uuidv7(),
    scopeItem: { id: uuidv7(), sourceCatalogItemId: uuidv7(), code: 'supply_installation' },
    procedureCodes,
    principal: principal({ role: 'editor' }),
    now: new Date('2026-10-11T08:00:00Z'),
  });
  return { findProcedures, registry, participant, context };
}

describe('the participant of the scope that adds processes (EVM-035 AC2; SR-API-06)', () => {
  it('EVM-035 AC2 it registers itself under the name "procedures" when the module starts, once', () => {
    const { registry, participant } = setup();
    participant.onModuleInit();
    expect(registry.ordered().map((item) => [item.name, item.order])).toEqual([['procedures', 100]]);
    expect(() => {
      participant.onModuleInit();
    }).toThrow(/already registered/);
  });

  it('EVM-035 AC2 an item added with no process chosen asks the catalog for nothing and writes nothing', async () => {
    const { findProcedures, participant, context } = setup();
    await expect(participant.addProcedures(TRANSACTION, context([]))).resolves.toEqual([]);
    expect(findProcedures).not.toHaveBeenCalled();
  });
});
