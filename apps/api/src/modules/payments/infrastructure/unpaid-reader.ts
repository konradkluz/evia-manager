/**
 * Reads of the summary of unpaid invoices (EVM-055; SR-AUTHZ-03, SR-API-04, CWE-89). SELECT only; Kysely builder with bound parameters —
 * no `sql.raw`, no concatenation of a value of the request. The columns are listed explicitly: what the summary may show is decided
 * here, not by what the table holds (no `status_reason`, no authors).
 *
 * The orders the caller may see are NOT joined from `work-orders` (ADR-0001: no join to a table of another module). The set is started
 * on this side — {@link unpaidOrderIds}, the orders with an issued milestone — and narrowed by the facade of `work-orders` under the
 * read policy of the caller (`refsOf`); every query below receives the visible identifiers as ONE array parameter
 * (`work_order_id = any($n::uuid[])`) next to the base predicate (`status = 'invoiced' AND deleted_at IS NULL`), so a milestone of an
 * order the caller may not see is never read, listed or summed (the same set for the page, the tiles and the sum below the table).
 *
 * "Today" is a PARAMETER (`asOf`: the day of the injected clock, or the day of the cursor) — never `now()` or `current_date`; "overdue"
 * is `due_date < asOf` (the due day itself is not overdue). The amount is a `bigint`: sums come back as TEXT (`sum` of a `bigint` is a
 * `numeric`) and go through {@link amountOfSum} — a safe integer, never a float, and a sum that does not fit is an error, not a
 * rounded number.
 */
import { sql, type Expression, type SqlBool } from 'kysely';
import type { Position } from '../domain/unpaid-query.ts';
import { amountFromDatabase } from './milestone-store.ts';
import type { PaymentsDb } from './tables.ts';

const TABLE = 'payments.payment_milestones';
const BASE = sql<SqlBool>`${sql.ref('payments.payment_milestones.status')} = 'invoiced' and ${sql.ref('payments.payment_milestones.deleted_at')} is null`;
const inOrders = (ids: readonly string[]): Expression<SqlBool> =>
  sql<SqlBool>`${sql.ref('payments.payment_milestones.work_order_id')} = any(${[...ids]}::uuid[])`;

/** The filters of the list that narrow it (and its sum): all optional, combined with AND. */
export interface UnpaidFilters {
  readonly overdueOnly: boolean;
  /** `YYYY-MM-DD`, inclusive */
  readonly dueFrom: string | undefined;
  /** `YYYY-MM-DD`, inclusive */
  readonly dueTo: string | undefined;
}

export interface UnpaidRow {
  readonly id: string;
  readonly workOrderId: string;
  readonly name: string;
  readonly invoiceNumber: string | null;
  readonly amountMinor: number | null;
  /** `YYYY-MM-DD` */
  readonly dueDate: string;
  readonly version: number;
}

export interface CountAndSum {
  readonly count: number;
  readonly totalMinor: number;
}

export interface UnpaidSummaryRow {
  readonly unpaid: CountAndSum;
  readonly overdue: CountAndSum;
  readonly filtered: CountAndSum;
}

export interface LongestOverdueRow {
  readonly workOrderId: string;
  /** `YYYY-MM-DD` */
  readonly dueDate: string;
}

/** The orders that have an issued milestone — the set the facade of `work-orders` narrows to the ones the caller may see. */
export async function unpaidOrderIds(db: PaymentsDb): Promise<string[]> {
  const rows = await db.selectFrom(TABLE).select('work_order_id').distinct().where(BASE).execute();
  return rows.map((row) => row.work_order_id);
}

/** The predicates of the filters (never the orders): the overdue view and the range of due days. */
function filterPredicates(filters: UnpaidFilters, asOf: string): Expression<SqlBool>[] {
  const due = sql.ref('payments.payment_milestones.due_date');
  const predicates: Expression<SqlBool>[] = [];
  if (filters.overdueOnly) predicates.push(sql<SqlBool>`${due} < ${asOf}::date`);
  if (filters.dueFrom !== undefined) predicates.push(sql<SqlBool>`${due} >= ${filters.dueFrom}::date`);
  if (filters.dueTo !== undefined) predicates.push(sql<SqlBool>`${due} <= ${filters.dueTo}::date`);
  return predicates;
}

/**
 * A page in the order "Najdłużej po terminie" — `due_date, id` (a keyset: no OFFSET, so a deep page costs what the first one does); one
 * row more than `limit` is read to know whether a next page exists. `orderIds` are the visible orders narrowed by the customer filter.
 */
export async function readUnpaidPage(
  db: PaymentsDb,
  params: {
    readonly orderIds: readonly string[];
    readonly filters: UnpaidFilters;
    readonly asOf: string;
    readonly position: Position | undefined;
    readonly limit: number;
  },
): Promise<UnpaidRow[]> {
  let select = db
    .selectFrom(TABLE)
    .select([
      'id',
      'work_order_id',
      'name',
      'invoice_number',
      'amount_minor',
      sql<string>`to_char(due_date, 'YYYY-MM-DD')`.as('due_day'),
      'version',
    ])
    .where(BASE)
    .where(inOrders(params.orderIds));
  for (const predicate of filterPredicates(params.filters, params.asOf)) select = select.where(predicate);
  if (params.position !== undefined) {
    const { dueDate, id } = params.position;
    select = select.where(
      sql<SqlBool>`(${sql.ref('payments.payment_milestones.due_date')}, ${sql.ref('payments.payment_milestones.id')}) > (${dueDate}::date, ${id}::uuid)`,
    );
  }
  const rows = await select
    .orderBy('due_date')
    .orderBy('id')
    .limit(params.limit + 1)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    workOrderId: row.work_order_id,
    name: row.name,
    invoiceNumber: row.invoice_number,
    amountMinor: amountFromDatabase(row.amount_minor),
    dueDate: row.due_day,
    version: row.version,
  }));
}

/**
 * The tiles and the sum below the table in ONE statement: `FILTER` over the same base predicate and the same visible orders. The tiles
 * (`unpaid`, `overdue`) ignore the filters of the list and the customer; `filtered` applies them (`filteredOrderIds` ⊂ `orderIds`).
 */
export async function readUnpaidSummary(
  db: PaymentsDb,
  params: {
    readonly orderIds: readonly string[];
    readonly filteredOrderIds: readonly string[];
    readonly filters: UnpaidFilters;
    readonly asOf: string;
  },
): Promise<UnpaidSummaryRow> {
  const due = sql.ref('payments.payment_milestones.due_date');
  const amount = sql.ref('payments.payment_milestones.amount_minor');
  const overdue = sql<SqlBool>`${due} < ${params.asOf}::date`;
  const filtered = sql<SqlBool>`${sql.join([inOrders(params.filteredOrderIds), ...filterPredicates(params.filters, params.asOf)], sql` and `)}`;
  const { rows } = await sql<{
    unpaid_count: number;
    unpaid_total: string;
    overdue_count: number;
    overdue_total: string;
    filtered_count: number;
    filtered_total: string;
  }>`
    select
      (count(*))::int as unpaid_count,
      coalesce(sum(${amount}), 0)::text as unpaid_total,
      (count(*) filter (where ${overdue}))::int as overdue_count,
      coalesce(sum(${amount}) filter (where ${overdue}), 0)::text as overdue_total,
      (count(*) filter (where ${filtered}))::int as filtered_count,
      coalesce(sum(${amount}) filter (where ${filtered}), 0)::text as filtered_total
    from payments.payment_milestones
    where ${BASE} and ${inOrders(params.orderIds)}
  `.execute(db);
  const row = rows[0];
  if (row === undefined) throw new RangeError('an aggregate returned no row');
  return {
    unpaid: { count: row.unpaid_count, totalMinor: amountOfSum(row.unpaid_total) },
    overdue: { count: row.overdue_count, totalMinor: amountOfSum(row.overdue_total) },
    filtered: { count: row.filtered_count, totalMinor: amountOfSum(row.filtered_total) },
  };
}

/** The earliest due day before `asOf` among the visible issued milestones (a tie: the smaller identifier), or `undefined`. */
export async function readLongestOverdue(
  db: PaymentsDb,
  params: { readonly orderIds: readonly string[]; readonly asOf: string },
): Promise<LongestOverdueRow | undefined> {
  const row = await db
    .selectFrom(TABLE)
    .select(['work_order_id', sql<string>`to_char(due_date, 'YYYY-MM-DD')`.as('due_day')])
    .where(BASE)
    .where(inOrders(params.orderIds))
    .where(sql<SqlBool>`${sql.ref('payments.payment_milestones.due_date')} < ${params.asOf}::date`)
    .orderBy('due_date')
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();
  return row === undefined ? undefined : { workOrderId: row.work_order_id, dueDate: row.due_day };
}

/** A sum from the database (TEXT of a ) as a safe integer; a sum outside the safe integers is an error, never rounded. */
export function amountOfSum(text: string): number {
  const sum = Number(text);
  if (!Number.isSafeInteger(sum)) throw new RangeError('a sum of the amounts is not a safe integer');
  return sum;
}
