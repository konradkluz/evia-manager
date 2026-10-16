/**
 * Reads a page of the list of work orders from the PROJECTION (SELECT only; Kysely builder with bound parameters — no `sql.raw`, no
 * concatenation of a value of the request, CWE-89). ONE statement: the orders that the read policy lets the caller see (the condition
 * of `authorization` on `deleted_at` of the projection, in the query — never a filter of a page already read; EVM-017 AC6, EVM-034
 * W2), filtered, ordered and cut by a keyset — no OFFSET, so a deep page costs what the first one does. One row more than the limit
 * is read to know whether a next page exists.
 *
 * The sort is a map from the enum of the contract to fixed expressions, with the identifier of the order as the last key, so the
 * order is total. The columns are listed explicitly: what the list may show is decided here, not by what the table holds. The title
 * is NOT here (W1): the service takes it from `work-orders`, in one batch, under the read policy of the caller.
 *
 * "Czekamy na…" (EVM-034 D1, D2): a wait that matches is an `EXISTS` over `work_order_waits`, and "longer than X days" is
 * `waiting_since < :today − X` with `:today` a PARAMETER (the day of the injected clock, or `asOf` of the cursor) — never `now()`.
 * Dates are compared as `date`; the sort key of a date sort is `coalesce(column, 'infinity'::date)`, so an order without the date
 * comes last, and a row comparison with the id continues the page.
 *
 * Payments (EVM-056; ADR-0017 D6, D7, D9, W4, W7): the views "Po terminie" (`earliest_invoiced_due_date < :today`) and "Nieopłacone"
 * (`invoiced_count > 0`) list open orders only. "Najpilniejsze" computes the group (1..4) and the day of its key ONCE, in a subquery
 * over the filtered rows; the ORDER BY and the keyset comparison `(group, day, id) > (…)` name its aliases, so the rule is written in
 * one place. Its CASE is made of constants of this file — `:today` and the threshold of 14 days are parameters — and without the right
 * to read payments its variant has no column of payments (group 1 from the stages only).
 */
import { sql, type Expression, type ExpressionBuilder, type Kysely, type RawBuilder, type SqlBool } from 'kysely';
import { workOrderReadCondition } from '../../authorization/index.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { Urgency, UrgencyGroup } from '../domain/work-order-list-query.ts';
import {
  CLOSED_STATUSES,
  DSO_PARTY_KIND,
  SORT_RULES,
  WAITING_WARNING_DAYS,
  type Position,
  type WaitingOnFilter,
  type WorkOrderListQuery,
  type WorkOrderStatus,
} from '../domain/work-order-list-query.ts';
import { overviewTables, type OverviewTables } from './tables.ts';

export interface WorkOrderRow {
  readonly id: string;
  readonly number: string;
  readonly status: WorkOrderStatus;
  readonly createdAt: Date;
  /** the deletion time — only a row of the view "Usunięte" has one (EVM-060) */
  readonly deletedAt: Date | null;
  readonly coordinatorUserId: string | null;
  /** keys only — the name and the address come from `customers` and `sites` in batches, under the policy of the caller (W1, W5) */
  readonly customerId: string | null;
  readonly siteId: string | null;
  readonly waitingCount: number;
  /** `YYYY-MM-DD` */
  readonly longestWaitingSince: string | null;
  readonly longestWaitingOn: 'customer' | 'party' | null;
  readonly longestWaitingPartyId: string | null;
  /** `YYYY-MM-DD` */
  readonly nextDueDate: string | null;
  /** the signals of payments (EVM-056): counters and a date, no amount */
  readonly invoicedCount: number;
  readonly paidCount: number;
  /** `YYYY-MM-DD` */
  readonly earliestInvoicedDueDate: string | null;
  /** the place in "Najpilniejsze" — present when the page is sorted by it */
  readonly urgency?: Urgency;
}

/** What the reader needs besides the query: the day of every comparison and whether the caller may read payments (W4). */
export interface PageScope {
  /** `YYYY-MM-DD`, `Europe/Warsaw`: the clock of the first page, `asOf` of the cursor after */
  readonly today: string;
  readonly withPayments: boolean;
}

const SUMMARIES = 'overview.work_order_summaries';
/** The views that list open orders only (ADR-0017 pyt. 7). */
const OPEN_VIEWS: readonly string[] = ['all_open', 'waiting_on_dso_over_14_days', 'overdue_payments', 'unpaid'];

const NEXT_DUE_DATE = sql.ref('overview.work_order_summaries.next_due_date');
const LONGEST_WAITING_SINCE = sql.ref('overview.work_order_summaries.longest_waiting_since');
const EARLIEST_INVOICED_DUE_DATE = sql.ref('overview.work_order_summaries.earliest_invoiced_due_date');
const isOpen = sql<SqlBool>`${sql.ref('overview.work_order_summaries.status')} not in ('settled', 'cancelled')`;

/**
 * The group and the day of "Najpilniejsze" (D9) over the same three conditions. Group 1: open with a milestone past its due date (only
 * `withPayments`) or a stage past its due date — the day is the LEAST of the past dates (`LEAST` skips a NULL); 2: open and waiting for
 * more than 14 days; 3: open with a stage due from today on; 4: the rest, `infinity`. Constants of the code and two parameters only.
 */
function urgencyExpressions(scope: PageScope): { group: RawBuilder<number>; day: RawBuilder<string> } {
  const today = sql`${scope.today}::date`;
  const stagePast = sql`case when ${NEXT_DUE_DATE} < ${today} then ${NEXT_DUE_DATE} end`;
  const milestonePast = sql`case when ${EARLIEST_INVOICED_DUE_DATE} < ${today} then ${EARLIEST_INVOICED_DUE_DATE} end`;
  const past = scope.withPayments ? sql`least(${milestonePast}, ${stagePast})` : stagePast;
  const first = sql`${isOpen} and ${past} is not null`;
  const second = sql`${isOpen} and ${LONGEST_WAITING_SINCE} < ${today} - ${WAITING_WARNING_DAYS}::int`;
  const third = sql`${isOpen} and ${NEXT_DUE_DATE} >= ${today}`;
  return {
    group: sql<number>`case when ${first} then 1 when ${second} then 2 when ${third} then 3 else 4 end`,
    day: sql<string>`case when ${first} then ${past} when ${second} then ${LONGEST_WAITING_SINCE} when ${third} then ${NEXT_DUE_DATE} else 'infinity'::date end`,
  };
}

/** A wait the order must have (all given conditions hold for ONE wait of the order). */
interface WaitCondition {
  readonly waitingOn: WaitingOnFilter | undefined;
  readonly partyKind: string | undefined;
  readonly longerThanDays: number | undefined;
}

const hasMatchingWait = (condition: WaitCondition, today: string) => (eb: ExpressionBuilder<OverviewTables, typeof SUMMARIES>) => {
  let waits = eb
    .selectFrom('overview.work_order_waits as w')
    .select('w.stage_id')
    .whereRef('w.work_order_id', '=', `${SUMMARIES}.work_order_id`);
  if (condition.waitingOn !== undefined) waits = waits.where('w.waiting_on', '=', condition.waitingOn);
  if (condition.partyKind !== undefined) waits = waits.where('w.party_kind', '=', condition.partyKind);
  if (condition.longerThanDays !== undefined) {
    // N > X  <=>  waiting_since < today - X (a difference of dates: a change of the clock does not move it)
    waits = waits.where(sql<SqlBool>`w.waiting_since < ${today}::date - ${condition.longerThanDays}::int`);
  }
  return eb.exists(waits);
};

/**
 * The identifiers a search phrase matched, per source (EVM-072; ADR-0017 W1): the orders whose number or title matched, the customers and
 * the sites. They only NARROW the page — the read policy of work orders stays in the query next to them (W2). Empty sets are left out
 * of the predicate (all three empty is `false`); each set is ONE array parameter (`= ANY($n::uuid[])`), however many identifiers it holds.
 */
export interface SearchIdSets {
  readonly workOrders: readonly string[];
  readonly customers: readonly string[];
  readonly sites: readonly string[];
}

const matchesAny = (sets: SearchIdSets) => {
  const alternatives: Expression<SqlBool>[] = [];
  if (sets.workOrders.length > 0)
    alternatives.push(sql<SqlBool>`${sql.ref('overview.work_order_summaries.work_order_id')} = any(${[...sets.workOrders]}::uuid[])`);
  if (sets.customers.length > 0)
    alternatives.push(sql<SqlBool>`${sql.ref('overview.work_order_summaries.customer_id')} = any(${[...sets.customers]}::uuid[])`);
  if (sets.sites.length > 0)
    alternatives.push(sql<SqlBool>`${sql.ref('overview.work_order_summaries.site_id')} = any(${[...sets.sites]}::uuid[])`);
  // nothing matched anywhere: no order can match, and the statement says so (it never has an empty `()`)
  return alternatives.length === 0 ? sql<SqlBool>`false` : sql<SqlBool>`(${sql.join(alternatives, sql` or `)})`;
};

/** The date of a sort as an expression: an order without it gets `infinity` and comes last. */
const dayKey = (key: 'longestWaitingSince' | 'nextDueDate'): Expression<string> =>
  key === 'longestWaitingSince'
    ? sql<string>`coalesce(${sql.ref('overview.work_order_summaries.longest_waiting_since')}, 'infinity'::date)`
    : sql<string>`coalesce(${sql.ref('overview.work_order_summaries.next_due_date')}, 'infinity'::date)`;

/**
 * @param narrowing the identifiers a phrase matched in the three modules (EVM-072): an ADDITIONAL condition, ANDed with the read policy
 * @param scope the day (`YYYY-MM-DD`, `Europe/Warsaw`) every comparison of the query uses — the clock of the first page, `asOf` of the
 * cursor after — and whether the caller may read payments (W4: the variant of "Najpilniejsze")
 * @returns at most `query.limit + 1` rows in the order of the sort
 */
export async function readWorkOrderPage(
  db: Kysely<Database>,
  principal: Principal,
  query: WorkOrderListQuery,
  position: Position | undefined,
  scope: PageScope,
  narrowing?: SearchIdSets,
): Promise<WorkOrderRow[]> {
  const { today } = scope;
  const rule = SORT_RULES[query.sort];
  const descending = rule.direction === 'desc';
  let select = overviewTables(db)
    .selectFrom(SUMMARIES)
    .select([
      `${SUMMARIES}.work_order_id as id`,
      `${SUMMARIES}.number as number`,
      `${SUMMARIES}.status as status`,
      `${SUMMARIES}.created_at as createdAt`,
      `${SUMMARIES}.deleted_at as deletedAt`,
      `${SUMMARIES}.coordinator_user_id as coordinatorUserId`,
      `${SUMMARIES}.customer_id as customerId`,
      `${SUMMARIES}.site_id as siteId`,
      `${SUMMARIES}.waiting_count as waitingCount`,
      sql<string | null>`to_char(${LONGEST_WAITING_SINCE}, 'YYYY-MM-DD')`.as('longestWaitingSince'),
      `${SUMMARIES}.longest_waiting_on as longestWaitingOn`,
      `${SUMMARIES}.longest_waiting_party_id as longestWaitingPartyId`,
      sql<string | null>`to_char(${NEXT_DUE_DATE}, 'YYYY-MM-DD')`.as('nextDueDate'),
      `${SUMMARIES}.invoiced_count as invoicedCount`,
      `${SUMMARIES}.paid_count as paidCount`,
      sql<string | null>`to_char(${EARLIEST_INVOICED_DUE_DATE}, 'YYYY-MM-DD')`.as('earliestInvoicedDueDate'),
    ])
    // the ONE place that asks the policy for the soft deleted orders: the view "Usunięte" (EVM-060) — the Administrator's, empty for the others
    .where(workOrderReadCondition(principal, SUMMARIES, query.view === 'deleted' ? 'deleted' : 'visible'));
  if (query.statuses.length > 0) select = select.where(`${SUMMARIES}.status`, 'in', query.statuses);
  if (query.view !== undefined && OPEN_VIEWS.includes(query.view)) select = select.where(`${SUMMARIES}.status`, 'not in', CLOSED_STATUSES);
  // `mine` is the user of the SESSION, never a value of the request; both conditions apply (AND) when both are given.
  if (query.view === 'mine') select = select.where(`${SUMMARIES}.coordinator_user_id`, '=', principal.userId);
  if (query.view === 'waiting_on_dso_over_14_days') {
    select = select.where(hasMatchingWait({ waitingOn: 'party', partyKind: DSO_PARTY_KIND, longerThanDays: WAITING_WARNING_DAYS }, today));
  }
  // the payment views (D6, D7) — the service has refused them already to a caller who may not read payments (W4)
  if (query.view === 'overdue_payments') select = select.where(sql<SqlBool>`${EARLIEST_INVOICED_DUE_DATE} < ${today}::date`);
  if (query.view === 'unpaid') select = select.where(`${SUMMARIES}.invoiced_count`, '>', 0);
  if (query.coordinatorId !== undefined) select = select.where(`${SUMMARIES}.coordinator_user_id`, '=', query.coordinatorId);
  if (query.customerId !== undefined) select = select.where(`${SUMMARIES}.customer_id`, '=', query.customerId);
  if (query.siteType !== undefined) select = select.where(`${SUMMARIES}.site_type`, '=', query.siteType);
  if (query.templateId !== undefined) select = select.where(`${SUMMARIES}.source_template_id`, '=', query.templateId);
  if (narrowing !== undefined) select = select.where(matchesAny(narrowing));
  if (query.waitingOn !== undefined || query.waitingOnPartyKind !== undefined || query.waitingLongerThanDays !== undefined) {
    select = select.where(
      hasMatchingWait(
        { waitingOn: query.waitingOn, partyKind: query.waitingOnPartyKind, longerThanDays: query.waitingLongerThanDays },
        today,
      ),
    );
  }
  if (rule.key === 'urgency') {
    // "Najpilniejsze": the group and the day are computed once, in the subquery `page`; the outer query orders and continues by its aliases
    const { group, day } = urgencyExpressions(scope);
    let page = overviewTables(db)
      .selectFrom(select.select([group.as('urgencyGroup'), day.as('urgencyDate')]).as('page'))
      .selectAll('page')
      .select(
        sql<string>`case when page."urgencyDate" = 'infinity' then 'infinity' else to_char(page."urgencyDate", 'YYYY-MM-DD') end`.as(
          'urgencyDay',
        ),
      );
    if (position !== undefined && 'group' in position) {
      page = page.where(
        sql<SqlBool>`(page."urgencyGroup", page."urgencyDate", page.id) > (${position.group}::int, ${position.day}::date, ${position.id}::uuid)`,
      );
    }
    const rows = await page
      .orderBy(sql`page."urgencyGroup"`)
      .orderBy(sql`page."urgencyDate"`)
      .orderBy(sql`page.id`)
      .limit(query.limit + 1)
      .execute();
    return rows.map((row) => ({ ...(row as WorkOrderRow), urgency: { group: row.urgencyGroup as UrgencyGroup, day: row.urgencyDay } }));
  }
  if (position !== undefined) {
    const comparator = descending ? '<' : '>';
    if ('number' in position) {
      select = select.where(`${SUMMARIES}.number`, comparator, position.number);
    } else if ('day' in position) {
      // the position of a date sort (the cursor is parsed against the sort it belongs to)
      const { day, id } = position;
      const key = dayKey(rule.key === 'nextDueDate' ? 'nextDueDate' : 'longestWaitingSince');
      select = select.where(
        sql<SqlBool>`(${key}, ${sql.ref('overview.work_order_summaries.work_order_id')}) > (${day}::date, ${id}::uuid)`,
      );
    } else {
      const { createdAt, id } = position;
      select = select.where((eb) =>
        eb(eb.refTuple(`${SUMMARIES}.created_at`, `${SUMMARIES}.work_order_id`), comparator, eb.tuple(createdAt, id)),
      );
    }
  }
  const direction = rule.direction;
  let ordered;
  switch (rule.key) {
    case 'number':
      ordered = select.orderBy(`${SUMMARIES}.number`, direction);
      break;
    case 'createdAt':
      ordered = select.orderBy(`${SUMMARIES}.created_at`, direction).orderBy(`${SUMMARIES}.work_order_id`, direction);
      break;
    case 'longestWaitingSince':
    case 'nextDueDate':
      ordered = select.orderBy(dayKey(rule.key), direction).orderBy(`${SUMMARIES}.work_order_id`, direction);
      break;
  }
  const rows = await ordered.limit(query.limit + 1).execute();
  return rows as WorkOrderRow[];
}
