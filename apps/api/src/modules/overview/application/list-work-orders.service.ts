/**
 * The list of work orders (EVM-017; W-10), read from the projection of `overview` (ADR-0017). The guard has decided before this runs
 * (the three roles, web channel); here: the validated query, the opaque cursor, the mass-read check of policy P10, ONE page query over
 * the projection with the read policy in it, ONE batch lookup of the titles in `work-orders` (read policy of the caller) and ONE of
 * the names of the coordinators in `identity` (no N+1, AC4), and the response parsed with the schema of the contract (SR-DATA-03:
 * only the fields of the contract leave; the coordinator is `{id, displayName}`, never an e-mail address).
 *
 * Defence in depth (ADR-0017 W2): an order of the page that `work-orders` does not show to the caller — which the policy in the
 * query should have excluded — is dropped from the page and counted (`projection_authz_drift`); a title that is not returned is never
 * replaced by a guess. The authorisation column of the projection is the primary control, this is the second line.
 *
 * Order matters: the query is validated and the cursor opened (400) BEFORE the meter is asked (429); the records returned are
 * counted AFTER the answer is built, so a refused or failed request counts nothing.
 */
import { zWorkOrderList } from '@evia/contracts/zod';
import type { WorkOrderList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { BulkReadControl } from '../../../platform/bulk-read/bulk-read-control.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import { businessDate } from '../../../platform/clock/business-date.ts';
import { scopeOf, type CursorCodec } from '../../../platform/crypto/opaque-cursor.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput } from '../../../platform/http/validation.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { BULK_READ_CONTROL, CLOCK, CURSOR_CODEC, DATABASE, METRICS } from '../../../platform/tokens.ts';
import { UserDirectory } from '../../identity/index.ts';
import { PARTY_DIRECTORY, type PartyDirectory } from '../../parties/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import {
  daysBetween,
  filterPartsOf,
  parsePosition,
  positionParts,
  resolveWorkOrderListQuery,
  type Position,
  type WorkOrderListQuery,
} from '../domain/work-order-list-query.ts';
import { readWorkOrderPage, type WorkOrderRow } from '../infrastructure/work-order-list-reader.ts';

/** Identifier of the operation in the contract; the cursor is bound to it. */
export const LIST_WORK_ORDERS_OPERATION = 'listWorkOrders';

@Injectable()
export class ListWorkOrdersService {
  readonly #db: Kysely<Database>;
  readonly #cursors: CursorCodec;
  readonly #bulkRead: BulkReadControl;
  readonly #users: UserDirectory;
  readonly #orders: WorkOrderDirectory;
  readonly #parties: PartyDirectory;
  readonly #clock: Clock;
  readonly #authzDrift: Counter;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CURSOR_CODEC) cursors: CursorCodec,
    @Inject(BULK_READ_CONTROL) bulkRead: BulkReadControl,
    @Inject(UserDirectory) users: UserDirectory,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(PARTY_DIRECTORY) parties: PartyDirectory,
    @Inject(CLOCK) clock: Clock,
    @Inject(METRICS) metrics: MetricsRegistry,
  ) {
    this.#db = db;
    this.#cursors = cursors;
    this.#bulkRead = bulkRead;
    this.#users = users;
    this.#orders = orders;
    this.#parties = parties;
    this.#clock = clock;
    this.#authzDrift = metrics.counter('projection_authz_drift', []);
  }

  /** @param rawQuery the query string as parsed by the framework (strings only) */
  async list(principal: Principal, rawQuery: unknown, context: EventContext): Promise<WorkOrderList> {
    const query = parseInput(resolveWorkOrderListQuery, rawQuery);
    const scope = scopeOf(filterPartsOf(query));
    const opened = this.#openCursor(query, principal, scope);
    // "today" is the day of the injected clock on the first page and `asOf` of the cursor on the next ones (W8): the page that
    // continues a list continues THAT day, so a midnight between two requests neither repeats an order nor skips one.
    const today = opened?.asOf ?? businessDate(this.#clock.now());
    await this.#bulkRead.before(principal.userId, { ...context, sessionId: principal.sessionId });

    const rows = await readWorkOrderPage(this.#db, principal, query, opened?.position, today);
    const shown = rows.slice(0, query.limit);
    const titles = await this.#orders.titlesOf(
      this.#db,
      principal,
      shown.map((row) => row.id),
    );
    const visible = shown.filter((row) => titles.has(row.id));
    for (let dropped = visible.length; dropped < shown.length; dropped += 1) this.#authzDrift.increment({});
    const names = await this.#users.displayNamesOf(
      visible.flatMap((row) => (row.coordinatorUserId === null ? [] : [row.coordinatorUserId])),
    );
    const partyIds = visible.flatMap((row) => (row.longestWaitingPartyId === null ? [] : [row.longestWaitingPartyId]));
    // two batch lookups through the facade (the read policy of parties): none when no order of the page waits for a party
    const partyNames = partyIds.length === 0 ? new Map<string, string>() : await this.#parties.namesOf(this.#db, principal, partyIds);
    const partyKinds = partyIds.length === 0 ? new Map<string, string>() : await this.#parties.kindsOf(this.#db, principal, partyIds);
    const last = shown.at(-1);
    const list = {
      items: visible.map((row) => toItem(row, titles.get(row.id) ?? '', names, partyNames, partyKinds, today)),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? this.#cursors.seal(LIST_WORK_ORDERS_OPERATION, {
              position: [today, ...positionParts(query.sort, last)],
              scope,
              userId: principal.userId,
            })
          : null,
    };
    const checked = zWorkOrderList.safeParse(list);
    if (!checked.success) throw new ProblemException('internal_error');
    this.#bulkRead.after(principal.userId, checked.data.items.length);
    return checked.data;
  }

  /**
   * The cursor is `[asOf, …position]`, sealed together with the operation, the user, the filters and an expiry; every failure —
   * including a day that is not a date or a position that does not fit the sort — is the one `400 invalid_cursor` (SR-API-01).
   */
  #openCursor(query: WorkOrderListQuery, principal: Principal, scope: string): { asOf: string; position: Position } | undefined {
    if (query.cursor === undefined) return undefined;
    const parts = this.#cursors.open(LIST_WORK_ORDERS_OPERATION, query.cursor, { scope, userId: principal.userId });
    const [asOf, ...rest] = parts ?? [];
    const position = asOf === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ? undefined : parsePosition(query.sort, rest);
    if (asOf === undefined || position === undefined) throw new ProblemException('invalid_cursor');
    return { asOf, position };
  }
}

function toItem(
  row: WorkOrderRow,
  title: string,
  names: ReadonlyMap<string, string>,
  partyNames: ReadonlyMap<string, string>,
  partyKinds: ReadonlyMap<string, string>,
  today: string,
) {
  const displayName = row.coordinatorUserId === null ? undefined : names.get(row.coordinatorUserId);
  return {
    id: row.id,
    number: row.number,
    title,
    status: row.status,
    coordinator: row.coordinatorUserId === null || displayName === undefined ? null : { id: row.coordinatorUserId, displayName },
    createdAt: row.createdAt.toISOString(),
    waiting: waitingOf(row, partyNames, partyKinds, today),
    nextDueDate: row.nextDueDate,
    // a difference of dates (`YYYY-MM-DD` compare as dates): the deadline of the nearest unfinished stage is before today
    hasOverdueStage: row.nextDueDate !== null && row.nextDueDate < today,
  };
}

/** The longest wait of the order: who, since when, for how many days (from the day of the page) and how many others (D3). */
function waitingOf(row: WorkOrderRow, partyNames: ReadonlyMap<string, string>, partyKinds: ReadonlyMap<string, string>, today: string) {
  if (row.waitingCount === 0 || row.longestWaitingSince === null || row.longestWaitingOn === null) return null;
  const partyId = row.longestWaitingPartyId;
  const name = partyId === null ? undefined : partyNames.get(partyId);
  const kind = partyId === null ? undefined : partyKinds.get(partyId);
  // a party the caller may not see (or that is gone) is `null`, never a guess; the wait itself (since, days, "+n") stays
  const party = partyId === null || name === undefined || kind === undefined ? null : { id: partyId, displayName: name, kind };
  return {
    waitingOn: row.longestWaitingOn,
    party,
    since: row.longestWaitingSince,
    days: daysBetween(row.longestWaitingSince, today),
    otherCount: row.waitingCount - 1,
  };
}
