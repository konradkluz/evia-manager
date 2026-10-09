import { describe, expect, it } from 'vitest';
import { buildStagePatch, formatDueDate, stageEditOf, stageStatusKey } from '../src/work-orders/procedure-format.ts';

const USER = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa' };

describe('formatting of the stages (EVM-031 AC2, AC3)', () => {
  it('EVM-031 AC2 a due date is shown as DD.MM.RRRR, text that is not a day is returned as it came', () => {
    expect(formatDueDate('2026-10-02')).toBe('02.10.2026');
    expect(formatDueDate('jutro')).toBe('jutro');
  });

  it('EVM-031 AC2 stage statuses map to the token keys of the styleguide; an unknown one has none (P-12)', () => {
    expect(stageStatusKey('not_applicable')).toBe('not-applicable');
    expect(stageStatusKey('in_progress')).toBe('in-progress');
    expect(stageStatusKey('todo')).toBe('todo');
    expect(stageStatusKey('future_status')).toBeUndefined();
    expect(stageStatusKey('toString')).toBeUndefined();
  });

  it('EVM-031 AC3 the patch holds only what changed and null clears a value', () => {
    const initial = stageEditOf({ responsibleUser: USER, dueDate: '2026-10-02' });
    expect(initial).toEqual({ responsibleUserId: USER.id, dueDate: '2026-10-02' });
    expect(buildStagePatch(initial, initial)).toEqual({});
    expect(buildStagePatch(initial, { ...initial, dueDate: '2026-11-01' })).toEqual({ dueDate: '2026-11-01' });
    expect(buildStagePatch(initial, { responsibleUserId: '', dueDate: '' })).toEqual({ responsibleUserId: null, dueDate: null });
    expect(stageEditOf({ responsibleUser: null, dueDate: null })).toEqual({ responsibleUserId: '', dueDate: '' });
  });
});
