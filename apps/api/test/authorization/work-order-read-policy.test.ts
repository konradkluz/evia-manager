import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workOrderReadCondition } from '../../src/modules/authorization/work-order-read-policy.ts';
import type { Principal } from '../../src/platform/http/principal.ts';

const db = new Kysely<unknown>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new PostgresIntrospector(kysely),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});
const principalOf = (role: Principal['role']): Principal => ({ role }) as Principal;

describe('the read policy of work orders as a condition of a query (EVM-034 W2; EVM-017 AC6; SR-AUTHZ-03, ASVS V8.2.2)', () => {
  it('EVM-034 AC6 W2 every role sees the orders that are not soft deleted — as a condition on the deletion column of the table of the query', () => {
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      expect(workOrderReadCondition(principalOf(role), 'work_orders.work_orders').compile(db).sql, role).toBe(
        '"work_orders"."work_orders"."deleted_at" is null',
      );
      expect(workOrderReadCondition(principalOf(role), 'overview.work_order_summaries').compile(db).sql, role).toBe(
        '"overview"."work_order_summaries"."deleted_at" is null',
      );
    }
  });

  it('EVM-034 AC6 W2 the condition has no parameter: nothing of a request enters it', () => {
    const compiled = workOrderReadCondition(principalOf('editor'), 'overview.work_order_summaries').compile(db);
    expect(compiled.parameters).toEqual([]);
  });

  it('EVM-060 AC4 the mode "deleted" is the Administrator alone: the soft deleted orders for him, a condition that is never true for the Editor and Read-only', () => {
    expect(workOrderReadCondition(principalOf('administrator'), 'overview.work_order_summaries', 'deleted').compile(db).sql).toBe(
      '"overview"."work_order_summaries"."deleted_at" is not null',
    );
    expect(workOrderReadCondition(principalOf('administrator'), 'work_orders.work_orders', 'deleted').compile(db).sql).toBe(
      '"work_orders"."work_orders"."deleted_at" is not null',
    );
    for (const role of ['editor', 'read_only'] as const) {
      expect(workOrderReadCondition(principalOf(role), 'overview.work_order_summaries', 'deleted').compile(db).sql, role).toBe('false');
    }
  });

  it('EVM-060 AC4 the default mode is "visible": a caller that does not name a mode never sees a deleted order', () => {
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      expect(workOrderReadCondition(principalOf(role), 'work_orders.work_orders').compile(db).sql).toBe(
        workOrderReadCondition(principalOf(role), 'work_orders.work_orders', 'visible').compile(db).sql,
      );
    }
  });
});

const SOURCE = join(import.meta.dirname, '../../src');
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [],
  );

describe('the mode "access" of the policy: the target of a mutation of the phone only (EVM-098 AC6; SR-AUTHZ-02, SR-AUTHZ-05)', () => {
  it('EVM-098 AC6 Administrator and Editor have access to every order, deleted or not; Read-only to none (defence in depth: the phone is closed to it) - with no parameter', () => {
    for (const role of ['administrator', 'editor'] as const) {
      const compiled = workOrderReadCondition(principalOf(role), 'work_orders.work_orders', 'access').compile(db);
      expect(compiled.sql, role).toBe('true');
      expect(compiled.parameters).toEqual([]);
    }
    expect(workOrderReadCondition(principalOf('read_only'), 'work_orders.work_orders', 'access').compile(db).sql).toBe('false');
  });

  it('EVM-098 AC6 the mode is named in the policy and in the read policy of work orders only, and the condition built from it is used by the target of a mutation only', () => {
    const files = sourceFiles(SOURCE);
    const naming = files
      .filter((file) => /'access'\)/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SOURCE, file).replaceAll(sep, '/'));
    expect(naming).toEqual(['modules/work-orders/infrastructure/read-policy.ts']);
    const users = files
      .filter((file) => readFileSync(file, 'utf8').includes('accessibleWorkOrders'))
      .map((file) => relative(SOURCE, file).replaceAll(sep, '/'))
      .sort();
    expect(users).toEqual(['modules/work-orders/infrastructure/mutation-target.ts', 'modules/work-orders/infrastructure/read-policy.ts']);
  });
});
