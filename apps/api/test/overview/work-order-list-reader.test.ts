import { randomUUID } from 'node:crypto';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery } from 'kysely';
import { describe, expect, it } from 'vitest';
import { resolveWorkOrderListQuery } from '../../src/modules/overview/domain/work-order-list-query.ts';
import { readWorkOrderPage } from '../../src/modules/overview/infrastructure/work-order-list-reader.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { principal } from '../support/principals.ts';

/** The statement the reader builds, compiled for PostgreSQL without a database (the driver answers no rows). */
async function statementOf(raw: Record<string, string>, withPayments: boolean, position?: Parameters<typeof readWorkOrderPage>[3]) {
  const compiled: CompiledQuery[] = [];
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (event) => {
      if (event.level === 'query') compiled.push(event.query);
    },
  });
  await readWorkOrderPage(db, principal({ role: 'editor' }), resolveWorkOrderListQuery.parse(raw), position, {
    today: '2026-10-08',
    withPayments,
  });
  const [statement] = compiled;
  if (statement === undefined) throw new Error('no statement');
  return statement;
}

describe('the statement of "Najpilniejsze" and of the payment views (EVM-056 AC3, AC5, AC7; ADR-0017 D6, D7, D9, W4, W7)', () => {
  it('EVM-056 AC5 K5 "today" and the threshold of 14 days are parameters; the SQL has no clock of the database', async () => {
    const queries: Record<string, string>[] = [{ sort: 'urgency' }, { view: 'overdue_payments' }, { view: 'unpaid', sort: 'urgency' }];
    for (const raw of queries) {
      const statement = await statementOf(raw, true);
      expect(statement.sql, JSON.stringify(raw)).not.toMatch(/now\(\)|current_date|current_timestamp|localtimestamp/i);
      expect(statement.parameters, JSON.stringify(raw)).toContain('2026-10-08');
      if (raw.sort === 'urgency') expect(statement.parameters).toContain(14);
    }
  });

  it('EVM-056 AC3 the group and the day are computed once in the subquery `page`; the order and the keyset name its aliases', async () => {
    const id = randomUUID();
    const statement = await statementOf({ sort: 'urgency' }, true, { group: 2, day: '2026-09-18', id });
    expect(statement.sql).toMatch(/as "urgencyGroup"/);
    expect(statement.sql).toMatch(/as "urgencyDate"/);
    expect(statement.sql).toMatch(/\(page\."urgencyGroup", page\."urgencyDate", page\.id\) > \(\$\d+::int, \$\d+::date, \$\d+::uuid\)/);
    expect(statement.sql).toMatch(/order by page\."urgencyGroup", page\."urgencyDate", page\.id limit/);
    expect(statement.sql.match(/case when/g)?.length).toBeGreaterThan(0);
    expect(statement.parameters).toEqual(expect.arrayContaining([2, '2026-09-18', id]));
    // the read policy stays in the inner statement, next to the filters
    expect(statement.sql).toContain('"overview"."work_order_summaries"."deleted_at" is null');
  });

  it('EVM-056 AC7 W4 without the right to read payments the expression of "Najpilniejsze" has no column of payments (group 1 from the stages only)', async () => {
    const withPayments = await statementOf({ sort: 'urgency' }, true);
    const without = await statementOf({ sort: 'urgency' }, false);
    // the two expressions of the subquery: after the plain columns (the last one is the earliest issued due date) up to their aliases
    const expression = (sql: string) => sql.slice(sql.indexOf('as "earliestInvoicedDueDate"'), sql.indexOf('as "urgencyDate"'));
    expect(expression(withPayments.sql)).toContain('"earliest_invoiced_due_date" <');
    expect(expression(withPayments.sql)).toContain('least(');
    expect(expression(without.sql)).not.toContain('earliest_invoiced_due_date');
    expect(expression(without.sql)).not.toContain('least(');
  });

  it('EVM-056 AC2 the payment views are open orders only: "Po terminie" by the earliest issued due date before today, "Nieopłacone" by the counter', async () => {
    const overdue = await statementOf({ view: 'overdue_payments' }, true);
    expect(overdue.sql).toContain('"status" not in');
    expect(overdue.sql).toMatch(/"earliest_invoiced_due_date" < \$\d+::date/);
    const unpaid = await statementOf({ view: 'unpaid' }, true);
    expect(unpaid.sql).toContain('"status" not in');
    expect(unpaid.sql).toMatch(/"invoiced_count" > \$\d+/);
  });
});
