import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORK_ORDER_TITLE,
  normalizeNewWorkOrder,
  resolveTitle,
  type WorkOrderInput,
} from '../../src/modules/work-orders/domain/new-work-order.ts';

const base: WorkOrderInput = {
  id: '0198b0a0-0000-7000-8000-000000000001',
  customerId: '0198b0a0-0000-7000-8000-000000000002',
  siteId: '0198b0a0-0000-7000-8000-000000000003',
  templateId: null,
};
const refused = (overrides: Partial<WorkOrderInput>) => {
  const result = normalizeNewWorkOrder({ ...base, ...overrides });
  if (result.ok) throw new Error('expected the order to be refused');
  return result.errors;
};

describe('a new work order (EVM-022 AC1-AC3; SR-INPUT-01, SR-INPUT-02, SR-INPUT-05)', () => {
  it('EVM-022 AC2 an order with the identifiers only keeps the null defaults: no title, no assignee, no date, no description', () => {
    expect(normalizeNewWorkOrder(base)).toEqual({
      ok: true,
      order: { ...base, title: null, assigneeUserId: null, plannedDate: null, description: null },
    });
  });

  it('EVM-022 AC1 the text is NFC, trimmed and a new line of the description is "\n"; an empty text is absent', () => {
    const result = normalizeNewWorkOrder({ ...base, title: '  Garaż́  ', description: 'a\r\nb\rc', plannedDate: '2026-11-15' });
    expect(result).toMatchObject({
      ok: true,
      order: { title: 'Garaż́'.normalize('NFC'), description: 'a\nb\nc', plannedDate: '2026-11-15' },
    });
    expect(normalizeNewWorkOrder({ ...base, title: '   ', description: '' })).toMatchObject({
      ok: true,
      order: { title: null, description: null },
    });
  });

  it('EVM-022 AC3 the errors are pointers and codes, never the values', () => {
    const errors = refused({ title: 'T'.repeat(201), description: 'bad\u0007', plannedDate: '1999-12-31' });
    expect(errors).toEqual([
      { pointer: '/title', code: 'too_long' },
      { pointer: '/description', code: 'invalid_characters' },
      { pointer: '/plannedDate', code: 'out_of_range' },
    ]);
    expect(JSON.stringify(errors)).not.toMatch(/TTT|bad|1999/);
  });

  it('EVM-022 AC3 the planned date is within 2000-01-01 … 2100-12-31, both ends inclusive', () => {
    for (const plannedDate of ['2000-01-01', '2026-10-07', '2100-12-31'])
      expect(normalizeNewWorkOrder({ ...base, plannedDate }).ok, plannedDate).toBe(true);
    for (const plannedDate of ['1999-12-31', '2101-01-01'])
      expect(refused({ plannedDate }), plannedDate).toEqual([{ pointer: '/plannedDate', code: 'out_of_range' }]);
  });

  it('EVM-022 AC1 the title is what the user typed, else the name of the template, else "Nowe zlecenie"', () => {
    expect(resolveTitle('Mój tytuł', 'Garaż — pełny proces')).toBe('Mój tytuł');
    expect(resolveTitle(null, 'Garaż — pełny proces')).toBe('Garaż — pełny proces');
    expect(resolveTitle(null, null)).toBe(DEFAULT_WORK_ORDER_TITLE);
    expect(DEFAULT_WORK_ORDER_TITLE).toBe('Nowe zlecenie');
  });
});
