import { describe, expect, it } from 'vitest';
import { scopeItemView, toScopeItem } from '../../src/modules/work-orders/application/scope-item-representation.ts';
import type { ScopeItemRow } from '../../src/modules/work-orders/infrastructure/work-order-store.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';

const row = (overrides: Partial<ScopeItemRow> = {}): ScopeItemRow => ({
  id: '0198b0a0-0000-7000-8000-000000000001',
  position: 2,
  code: 'supply_installation',
  name: 'Instalacja zasilająca',
  parameter_set_code: 'supply_circuit',
  parameters: { dedicatedCircuit: true },
  quantity: 1,
  notes: null,
  version: 3,
  source_catalog_item_id: '0198b0a0-0000-7000-8000-000000000002',
  ...overrides,
});

describe('the answer of a scope item (EVM-018, EVM-035; SR-DATA-03)', () => {
  it('EVM-035 AC8 the keys of the contract and nothing else — no catalogue identifier, no author; the notes only when there are some', () => {
    expect(toScopeItem(row())).toEqual({
      id: '0198b0a0-0000-7000-8000-000000000001',
      position: 2,
      code: 'supply_installation',
      name: 'Instalacja zasilająca',
      parameterSetCode: 'supply_circuit',
      parameters: { dedicatedCircuit: true },
      quantity: 1,
      version: 3,
    });
    expect(toScopeItem(row({ notes: 'Uwaga' }))).toMatchObject({ notes: 'Uwaga' });
    expect(JSON.stringify(scopeItemView(row()))).not.toContain('source_catalog_item_id');
  });

  it('EVM-035 AC8 a row that does not fit the contract is a defect of the server (500), never data that leaves', () => {
    expect(() => toScopeItem(row({ code: 'Not A Code' }))).toThrow(ProblemException);
    expect(() => toScopeItem(row({ quantity: 0 }))).toThrow(ProblemException);
  });
});
