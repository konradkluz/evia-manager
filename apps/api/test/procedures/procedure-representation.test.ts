import { describe, expect, it } from 'vitest';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { responsibleIdsOf, toProcedureList, toProcedureStage } from '../../src/modules/procedures/application/procedure-representation.ts';
import { responsibleNamesOf } from '../../src/modules/procedures/application/responsible-names.ts';
import type { UserDirectory } from '../../src/modules/identity/index.ts';
import type { ProcedureRow, StageRow } from '../../src/modules/procedures/infrastructure/procedure-store.ts';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/platform/database/database.ts';
import { vi } from 'vitest';
import { uuidv7 } from '../support/uuid.ts';

const ANNA = uuidv7();
const P1 = uuidv7();
const P2 = uuidv7();
const stage = (overrides: Partial<StageRow> = {}): StageRow => ({
  id: uuidv7(),
  procedure_id: P1,
  code: 'submit',
  name: 'Złożenie wniosku',
  position: 1,
  status: 'todo',
  due_date: null,
  responsible_user_id: null,
  version: 1,
  ...overrides,
});
const procedure = (id: string, position: number): ProcedureRow => ({ id, code: `process_${id}`, name: `Proces ${id}`, position });

describe('the answers of the processes (EVM-031 AC2, AC3, AC4; SR-DATA-03)', () => {
  it('EVM-031 AC3 a stage: the person as { id, displayName }, overdue computed for "today" in Warsaw, the version', () => {
    const view = toProcedureStage(
      stage({ due_date: '2026-10-02', responsible_user_id: ANNA }),
      new Map([[ANNA, 'Anna Testowa']]),
      '2026-10-03',
    );
    expect(view).toMatchObject({
      status: 'todo',
      dueDate: '2026-10-02',
      overdue: true,
      responsibleUser: { id: ANNA, displayName: 'Anna Testowa' },
      version: 1,
    });
    expect(toProcedureStage(stage({ due_date: '2026-10-02' }), new Map(), '2026-10-02')).toMatchObject({
      overdue: false,
      responsibleUser: null,
    });
  });

  it('EVM-031 AC3 a person without a name is a defect of the server (500), not a stage without a person', () => {
    expect(() => toProcedureStage(stage({ responsible_user_id: ANNA }), new Map(), '2026-10-03')).toThrow(ProblemException);
    try {
      toProcedureStage(stage({ responsible_user_id: ANNA }), new Map(), '2026-10-03');
    } catch (error) {
      expect((error as ProblemException).code).toBe('internal_error');
    }
  });

  it('EVM-031 AC2 AC4 the list: the stages go to their process, the progress and the open stages are counted, the order of the rows is kept', () => {
    const list = toProcedureList(
      [procedure(P1, 1), procedure(P2, 2)],
      [
        stage({ procedure_id: P1, position: 1, status: 'done' }),
        stage({ procedure_id: P1, position: 2, status: 'todo' }),
        stage({ procedure_id: P1, position: 3, status: 'not_applicable' }),
        stage({ procedure_id: P2, position: 1, status: 'in_progress' }),
        stage({ procedure_id: P2, position: 2, status: 'blocked' }),
      ],
      new Map(),
      '2026-10-03',
    );
    expect(list.items.map((item) => [item.position, item.progress, item.stages.length])).toEqual([
      [1, { done: 1, total: 2 }, 3],
      [2, { done: 0, total: 2 }, 2],
    ]);
    expect(list.openStageCount).toBe(2);
  });

  it('EVM-031 AC8 no processes is an empty list', () => {
    expect(toProcedureList([], [], new Map(), '2026-10-03')).toEqual({ items: [], openStageCount: 0 });
  });

  it('EVM-031 SR-API-02 the people are listed once, and a lookup of more than 100 of them is made in batches of 100', async () => {
    const stages = Array.from({ length: 250 }, (_, index) => stage({ responsible_user_id: `user-${index % 205}` }));
    const ids = responsibleIdsOf(stages);
    expect(ids).toHaveLength(205);
    const lookup = vi.fn((batch: readonly string[]) => Promise.resolve(new Map(batch.map((id) => [id, `Nazwa ${id}`]))));
    const names = await responsibleNamesOf({ displayNamesOf: lookup } as unknown as UserDirectory, {} as unknown as Kysely<Database>, [
      ...ids,
      ...ids,
    ]);
    expect(lookup.mock.calls.map(([batch]) => batch.length)).toEqual([100, 100, 5]);
    expect(names.size).toBe(205);
    expect(names.get('user-204')).toBe('Nazwa user-204');
  });
});
