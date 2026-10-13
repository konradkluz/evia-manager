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
 */
import { sql, type Expression, type ExpressionBuilder, type Kysely, type SqlBool } from 'kysely';
import { workOrderReadCondition } from '../../authorization/index.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
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
  readonly coordinatorUserId: string | null;
  readonly waitingCount: number;
  /** `YYYY-MM-DD` */
  readonly longestWaitingSince: string | null;
  readonly longestWaitingOn: 'customer' | 'party' | null;
  readonly longestWaitingPartyId: string | null;
  /** `YYYY-MM-DD` */
  readonly nextDueDate: string | null;
}

const SUMMARIES = 'overview.work_order_summaries';

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

/** The date of a sort as an expression: an order without it gets `infinity` and comes last. */
const dayKey = (key: 'longestWaitingSince' | 'nextDueDate'): Expression<string> =>
  key === 'longestWaitingSince'
    ? sql<string>`coalesce(${sql.ref('overview.work_order_summaries.longest_waiting_since')}, 'infinity'::date)`
    : sql<string>`coalesce(${sql.ref('overview.work_order_summaries.next_due_date')}, 'infinity'::date)`;

/**
 * @param today the day (`YYYY-MM-DD`, `Europe/Warsaw`) every comparison of the query uses: the clock of the first page, `asOf` of the cursor after
 * @returns at most `query.limit + 1` rows in the order of the sort
 */
export async function readWorkOrderPage(
  db: Kysely<Database>,
  principal: Principal,
  query: WorkOrderListQuery,
  position: Position | undefined,
  today: string,
): Promise<WorkOrderRow[]> {
  const rule = SORT_RULES[query.sort];
  const descending = rule.direction === 'desc';
  let select = overviewTables(db)
    .selectFrom(SUMMARIES)
    .select([
      `${SUMMARIES}.work_order_id as id`,
      `${SUMMARIES}.number as number`,
      `${SUMMARIES}.status as status`,
      `${SUMMARIES}.created_at as createdAt`,
      `${SUMMARIES}.coordinator_user_id as coordinatorUserId`,
      `${SUMMARIES}.waiting_count as waitingCount`,
      sql<string | null>`to_char(${sql.ref('overview.work_order_summaries.longest_waiting_since')}, 'YYYY-MM-DD')`.as(
        'longestWaitingSince',
      ),
      `${SUMMARIES}.longest_waiting_on as longestWaitingOn`,
      `${SUMMARIES}.longest_waiting_party_id as longestWaitingPartyId`,
      sql<string | null>`to_char(${sql.ref('overview.work_order_summaries.next_due_date')}, 'YYYY-MM-DD')`.as('nextDueDate'),
    ])
    .where(workOrderReadCondition(principal, SUMMARIES));
  if (query.statuses.length > 0) select = select.where(`${SUMMARIES}.status`, 'in', query.statuses);
  if (query.view === 'all_open' || query.view === 'waiting_on_dso_over_14_days') {
    select = select.where(`${SUMMARIES}.status`, 'not in', CLOSED_STATUSES);
  }
  // `mine` is the user of the SESSION, never a value of the request; both conditions apply (AND) when both are given.
  if (query.view === 'mine') select = select.where(`${SUMMARIES}.coordinator_user_id`, '=', principal.userId);
  if (query.view === 'waiting_on_dso_over_14_days') {
    select = select.where(hasMatchingWait({ waitingOn: 'party', partyKind: DSO_PARTY_KIND, longerThanDays: WAITING_WARNING_DAYS }, today));
  }
  if (query.coordinatorId !== undefined) select = select.where(`${SUMMARIES}.coordinator_user_id`, '=', query.coordinatorId);
  if (query.customerId !== undefined) select = select.where(`${SUMMARIES}.customer_id`, '=', query.customerId);
  if (query.waitingOn !== undefined || query.waitingOnPartyKind !== undefined || query.waitingLongerThanDays !== undefined) {
    select = select.where(
      hasMatchingWait(
        { waitingOn: query.waitingOn, partyKind: query.waitingOnPartyKind, longerThanDays: query.waitingLongerThanDays },
        today,
      ),
    );
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
