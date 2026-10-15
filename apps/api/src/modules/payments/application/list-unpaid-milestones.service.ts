/**
 * The summary of unpaid invoices for W-11 "Płatności" (EVM-055 AC1–AC4, AC6; SR-AUTHZ-03, SR-API-02, SR-API-04, SR-DATA-03; P6, P10).
 * The guard has decided before this runs (three roles, web channel only — P3). Order matters: the query is validated and the cursor
 * opened (400) BEFORE the meter is asked (429); the records returned are counted AFTER the answer is built, so a refused or failed
 * request counts nothing.
 *
 * The set of orders is started on THIS side (the orders with an issued milestone, `unpaidOrderIds`) and narrowed by the facade of
 * `work-orders` under the read policy of the caller (`refsOf`, ONE query) — the same pattern as the search of `overview` (ADR-0017 W2,
 * no join to a table of another module, no new kind of API). Then, in the SAME transaction (`repeatable read`: one snapshot for the tiles,
 * the sum below the table and the page): the page, the tiles and the sum in `payments` with the visible orders as a condition of the
 * query (the page already read is never filtered), and the names of the customers of the page in ONE batch from `customers`. The number of
 * statements does not depend on the size of the page or of the data (no N+1).
 *
 * The tiles ignore the filters of the list; the filter by a customer narrows the visible set to the orders of that customer — a customer
 * who does not exist or whom the caller may not see gives the same empty list as one without issued invoices (no oracle). "Today" comes from
 * the injected clock on the first page and from `asOf` of the cursor after, for the tiles, the list and the sum alike. The answer is
 * parsed with the schema of the contract (only its fields leave). A read is not an audited event; nothing here logs a number of an
 * invoice, an amount or a name.
 */
import { zUnpaidPaymentMilestoneList } from '@evia/contracts/zod';
import type { UnpaidPaymentMilestoneList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { BulkReadControl } from '../../../platform/bulk-read/bulk-read-control.ts';
import { businessDate } from '../../../platform/clock/business-date.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import { scopeOf, type CursorCodec } from '../../../platform/crypto/opaque-cursor.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput } from '../../../platform/http/validation.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { BULK_READ_CONTROL, CLOCK, CURSOR_CODEC, DATABASE, METRICS } from '../../../platform/tokens.ts';
import { CUSTOMER_DIRECTORY, type CustomerDirectory } from '../../customers/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import {
  compareOrders,
  filterPartsOf,
  parsePlannedPosition,
  parsePosition,
  plannedPositionParts,
  positionParts,
  resolveUnpaidQuery,
  type PlannedPosition,
  type Position,
  type UnpaidQuery,
} from '../domain/unpaid-query.ts';
import { paymentTables } from '../infrastructure/tables.ts';
import {
  plannedOrderIds,
  readLongestOverdue,
  readPlannedPage,
  readPlannedTotals,
  readUnpaidPage,
  readUnpaidSummary,
  unpaidOrderIds,
  type UnpaidFilters,
} from '../infrastructure/unpaid-reader.ts';
import { toPlannedItems, toSummary, toUnpaidItems } from './unpaid-representation.ts';

/** Identifier of the operation in the contract; the cursor is bound to it. */
export const LIST_UNPAID_MILESTONES_OPERATION = 'listUnpaidPaymentMilestones';

/** Where a page starts: the day every comparison of the query uses and the position of the keyset (none on the first page). */
interface PageStart {
  readonly asOf: string;
  readonly position: Position | undefined;
  /** The position of "Do wystawienia" (EVM-059) — set instead of `position` on the next pages of that view. */
  readonly plannedPosition: PlannedPosition | undefined;
}

@Injectable()
export class ListUnpaidMilestonesService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #cursors: CursorCodec;
  readonly #bulkRead: BulkReadControl;
  readonly #orders: WorkOrderDirectory;
  readonly #customers: CustomerDirectory;
  readonly #authzDrift: Counter;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(CURSOR_CODEC) cursors: CursorCodec,
    @Inject(BULK_READ_CONTROL) bulkRead: BulkReadControl,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(CUSTOMER_DIRECTORY) customers: CustomerDirectory,
    @Inject(METRICS) metrics: MetricsRegistry,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#cursors = cursors;
    this.#bulkRead = bulkRead;
    this.#orders = orders;
    this.#customers = customers;
    this.#authzDrift = metrics.counter('payments_unpaid_authz_drift', []);
  }

  /** @param rawQuery the query string as parsed by the framework (strings only) */
  async list(principal: Principal, rawQuery: unknown, context: EventContext): Promise<UnpaidPaymentMilestoneList> {
    const query = parseInput(resolveUnpaidQuery, rawQuery);
    const scope = scopeOf(filterPartsOf(query));
    const start = this.#start(principal, query, scope);
    await this.#bulkRead.before(principal.userId, { ...context, sessionId: principal.sessionId }, 'payment_milestone');
    const answer = await this.#read(principal, query, start, scope);
    const checked = zUnpaidPaymentMilestoneList.safeParse(answer);
    if (!checked.success) throw new ProblemException('internal_error');
    this.#bulkRead.after(principal.userId, checked.data.items.length);
    await this.#bulkRead.afterDistinct(
      principal.userId,
      'customer',
      // the customers the answer NAMES — a deleted one is not in the answer, so it is not counted as read
      checked.data.items.flatMap((item) => (item.customer !== null && 'id' in item.customer ? [item.customer.id] : [])),
      { ...context, sessionId: principal.sessionId },
    );
    return checked.data;
  }

  /**
   * The cursor is `[asOf, dueDate, id]`, sealed together with the operation, the user, the filters and an expiry; every failure —
   * including a day that is not a date or a position that does not fit — is the one `400 invalid_cursor` (SR-API-01). "Today" is the day
   * of the injected clock on the first page and `asOf` of the cursor on the next ones: the page that continues a list continues THAT day.
   */
  #start(principal: Principal, query: UnpaidQuery, scope: string): PageStart {
    if (query.cursor === undefined) return { asOf: businessDate(this.#clock.now()), position: undefined, plannedPosition: undefined };
    const parts = this.#cursors.open(LIST_UNPAID_MILESTONES_OPERATION, query.cursor, { scope, userId: principal.userId });
    const [asOf, ...rest] = parts ?? [];
    if (asOf === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new ProblemException('invalid_cursor');
    if (query.view === 'planned') {
      const plannedPosition = parsePlannedPosition(rest);
      if (plannedPosition === undefined) throw new ProblemException('invalid_cursor');
      return { asOf, position: undefined, plannedPosition };
    }
    const position = parsePosition(rest);
    if (position === undefined) throw new ProblemException('invalid_cursor');
    return { asOf, position, plannedPosition: undefined };
  }

  async #read(principal: Principal, query: UnpaidQuery, start: PageStart, scope: string): Promise<UnpaidPaymentMilestoneList> {
    if (query.view === 'planned') return this.#readPlanned(principal, query, start, scope);
    const { asOf } = start;
    const filters: UnpaidFilters = { overdueOnly: query.view === 'overdue', dueFrom: query.dueFrom, dueTo: query.dueTo };
    return runInTransaction(
      this.#db,
      async (tx) => {
        const tables = paymentTables(tx);
        const refs = await this.#orders.refsOf(tx, principal, await unpaidOrderIds(tables));
        const visible = [...refs.keys()];
        const filteredOrderIds = await this.#narrowedToCustomer(tx, principal, query.customerId, visible, refs);
        const summary = await readUnpaidSummary(tables, { orderIds: visible, filteredOrderIds, filters, asOf });
        const longest = await readLongestOverdue(tables, { orderIds: visible, asOf });
        const rows = await readUnpaidPage(tables, {
          orderIds: filteredOrderIds,
          filters,
          asOf,
          position: start.position,
          limit: query.limit,
        });
        const shown = rows.slice(0, query.limit);
        const customerIds = new Set<string>();
        for (const row of shown) {
          const customerId = refs.get(row.workOrderId)?.customerId ?? null;
          if (customerId !== null) customerIds.add(customerId);
        }
        const names = await this.#customers.displayNamesOf(tx, principal, [...customerIds]);
        const { items, dropped } = toUnpaidItems(shown, refs, names, asOf);
        for (let drift = 0; drift < dropped; drift += 1) this.#authzDrift.increment({});
        const last = shown.at(-1);
        return {
          items,
          nextCursor:
            rows.length > query.limit && last !== undefined
              ? this.#cursors.seal(LIST_UNPAID_MILESTONES_OPERATION, {
                  position: [asOf, ...positionParts({ dueDate: last.dueDate, id: last.id })],
                  scope,
                  userId: principal.userId,
                })
              : null,
          asOf,
          summary: toSummary(summary, longest, refs, asOf),
        };
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  /**
   * "Do wystawienia" (EVM-059 AC1, AC3): the milestones `planned` of the orders the caller may see AND that are not closed. The start set
   * is on this side (`plannedOrderIds`), the facade narrows it under the read policy in ONE query (it also says which orders are closed),
   * and the page, the count and the sum are read with the visible orders as the condition of the query. The tiles are those of the
   * other views (issued milestones); only `filtered` differs. The orders are put in the order of their numbers here (the number lives
   * in `work-orders`), and the cursor keeps the number, the order and the `position` of the last row.
   */
  async #readPlanned(principal: Principal, query: UnpaidQuery, start: PageStart, scope: string): Promise<UnpaidPaymentMilestoneList> {
    const { asOf } = start;
    return runInTransaction(
      this.#db,
      async (tx) => {
        const tables = paymentTables(tx);
        const issuedIds = await unpaidOrderIds(tables);
        const plannedIds = await plannedOrderIds(tables);
        const refs = await this.#orders.refsOf(tx, principal, [...new Set([...issuedIds, ...plannedIds])]);
        const tileOrders = issuedIds.filter((id) => refs.has(id));
        const open = plannedIds.filter((id) => refs.get(id)?.closed === false);
        const narrowed = await this.#narrowedToCustomer(tx, principal, query.customerId, open, refs);
        const ordered = narrowed
          .map((id) => ({ id, number: refs.get(id)?.number ?? '' }))
          .sort(compareOrders)
          .map((order) => order.id);
        const after = start.plannedPosition;
        const remaining =
          after === undefined
            ? ordered
            : ordered.filter(
                (id) => compareOrders({ id, number: refs.get(id)?.number ?? '' }, { id: after.workOrderId, number: after.number }) >= 0,
              );
        const summary = await readUnpaidSummary(tables, {
          orderIds: tileOrders,
          filteredOrderIds: [],
          filters: { overdueOnly: false, dueFrom: undefined, dueTo: undefined },
          asOf,
        });
        const longest = await readLongestOverdue(tables, { orderIds: tileOrders, asOf });
        const filtered = await readPlannedTotals(tables, ordered);
        const rows = await readPlannedPage(tables, { orderIds: remaining, after, limit: query.limit });
        const shown = rows.slice(0, query.limit);
        const customerIds = new Set<string>();
        for (const row of shown) {
          const customerId = refs.get(row.workOrderId)?.customerId ?? null;
          if (customerId !== null) customerIds.add(customerId);
        }
        const names = await this.#customers.displayNamesOf(tx, principal, [...customerIds]);
        const { items, dropped } = toPlannedItems(shown, refs, names);
        for (let drift = 0; drift < dropped; drift += 1) this.#authzDrift.increment({});
        const last = shown.at(-1);
        const lastNumber = last === undefined ? undefined : refs.get(last.workOrderId)?.number;
        return {
          items,
          nextCursor:
            rows.length > query.limit && last !== undefined && lastNumber !== undefined
              ? this.#cursors.seal(LIST_UNPAID_MILESTONES_OPERATION, {
                  position: [asOf, ...plannedPositionParts({ number: lastNumber, workOrderId: last.workOrderId, position: last.position })],
                  scope,
                  userId: principal.userId,
                })
              : null,
          asOf,
          summary: {
            ...toSummary(summary, longest, refs, asOf),
            filtered: { count: filtered.count, total: { amountMinor: filtered.totalMinor, currency: 'PLN' } },
          },
        };
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  /**
   * The visible orders, narrowed to the customer of the filter. A customer who does not exist or whom the caller may not see (checked
   * through `customers`, under ITS read policy) leaves nothing: the list and `filtered` are empty, the tiles do not depend on it.
   */
  async #narrowedToCustomer(
    tx: Kysely<Database>,
    principal: Principal,
    customerId: string | undefined,
    visible: readonly string[],
    refs: ReadonlyMap<string, { readonly customerId: string | null }>,
  ): Promise<string[]> {
    if (customerId === undefined) return [...visible];
    const known = await this.#customers.displayNamesOf(tx, principal, [customerId]);
    if (!known.has(customerId)) return [];
    return visible.filter((id) => refs.get(id)?.customerId === customerId);
  }
}
