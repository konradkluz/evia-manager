/**
 * ONE page of the list of work orders for the list (EVM-017, EVM-034) and for the search (EVM-072): the same projection, the same
 * read policy in the same query, the same order, the same item and the same envelope, so an order that is on the list is found by
 * the search and the other way round. The callers differ only in what comes BEFORE the page — the query string and the meter for the
 * list; the limiter, the body, the phrase, the meter and the three id sets for the search.
 *
 * What it does, in this order: ONE page query over the projection with the read policy in it (ADR-0017 W2) → ONE batch lookup of the
 * titles in `work-orders` (read policy of the caller), of the coordinators in `identity`, of the parties in `parties`, of the customers
 * in `customers` and of the sites in `sites` (no N+1; EVM-072 AC1 — the number of statements does not depend on the size of the page) →
 * the response parsed with the schema of the contract (SR-DATA-03: only the fields of the contract leave) → the records returned are
 * counted for the mass-read limit and the different customers for its alert (P10) AFTER the answer is built, so a refused or failed
 * request counts nothing.
 *
 * Defence in depth (ADR-0017 W2): an order of the page that `work-orders` does not show to the caller — which the policy in the
 * query should have excluded — is dropped and counted (`projection_authz_drift`); a title that is not returned is never replaced by
 * a guess. The customer of an order that `customers` does not show (deleted) is `{deleted: true}`: no identifier, no name (TM-18).
 *
 * Payments (EVM-056; ADR-0017 D8, W2, W4): the right to read payments (`canReadPayments` of `authorization` — the rule
 * `restrictedParams.paymentMilestone.read` of the contract) decides three things here, for the list and the search alike: a payment
 * view without it is `403 forbidden` ({@link WorkOrderPageService.authorize}, after the validation, before the meter), "Najpilniejsze"
 * is computed without the payments, and the items have no field `payment`. The variant is part of the scope of the cursor
 * ({@link WorkOrderPageService.scope}), so a cursor of one variant never positions a page of the other. The field `payment` is the
 * state of the projection on the day of the page plus the totals of the facade of `payments` — ONE batch for the orders that passed
 * the batch of titles (`visible`), with the same day, skipped when no order of the page has an issued milestone.
 */
import { zWorkOrderList } from '@evia/contracts/zod';
import type { WorkOrderList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { BulkReadControl } from '../../../platform/bulk-read/bulk-read-control.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import { businessDate } from '../../../platform/clock/business-date.ts';
import type { CursorCodec } from '../../../platform/crypto/opaque-cursor.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import { BULK_READ_CONTROL, CLOCK, CURSOR_CODEC, DATABASE, METRICS } from '../../../platform/tokens.ts';
import { scopeOf } from '../../../platform/crypto/opaque-cursor.ts';
import { PAYMENT_READ_POLICY, type PaymentReadPolicy } from '../../authorization/index.ts';
import { CUSTOMER_DIRECTORY, type CustomerDirectory } from '../../customers/index.ts';
import { UserDirectory } from '../../identity/index.ts';
import { PARTY_DIRECTORY, type PartyDirectory } from '../../parties/index.ts';
import { PAYMENT_TOTALS_DIRECTORY, type PaymentTotals, type PaymentTotalsDirectory } from '../../payments/payment-totals.ts';
import { SITE_DIRECTORY, type SiteDirectory, type SiteLine } from '../../sites/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { PAYMENT_VIEWS, paymentStateOf } from '../domain/payment-signals.ts';
import { daysBetween, parsePosition, positionParts, type Position, type WorkOrderListQuery } from '../domain/work-order-list-query.ts';
import { readWorkOrderPage, type SearchIdSets, type WorkOrderRow } from '../infrastructure/work-order-list-reader.ts';

/** Where a page starts: the day every comparison of the query uses and the position of the keyset (none on the first page). */
export interface PageStart {
  readonly today: string;
  readonly position: Position | undefined;
}

export interface PageRequest {
  /** identifier of the operation in the contract; the cursor of the next page is bound to it */
  readonly operation: string;
  readonly query: WorkOrderListQuery;
  /** `scopeOf` of the normalised filters (and the phrase, for a search) — the cursor is bound to it */
  readonly scope: string;
  readonly start: PageStart;
  /** the identifiers a search phrase matched; absent for the list */
  readonly narrowing: SearchIdSets | undefined;
  readonly context: EventContext;
}

@Injectable()
export class WorkOrderPageService {
  readonly #db: Kysely<Database>;
  readonly #cursors: CursorCodec;
  readonly #bulkRead: BulkReadControl;
  readonly #users: UserDirectory;
  readonly #orders: WorkOrderDirectory;
  readonly #parties: PartyDirectory;
  readonly #customers: CustomerDirectory;
  readonly #sites: SiteDirectory;
  readonly #paymentTotals: PaymentTotalsDirectory;
  readonly #canReadPayments: PaymentReadPolicy;
  readonly #clock: Clock;
  readonly #authzDrift: Counter;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CURSOR_CODEC) cursors: CursorCodec,
    @Inject(BULK_READ_CONTROL) bulkRead: BulkReadControl,
    @Inject(UserDirectory) users: UserDirectory,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(PARTY_DIRECTORY) parties: PartyDirectory,
    @Inject(CUSTOMER_DIRECTORY) customers: CustomerDirectory,
    @Inject(SITE_DIRECTORY) sites: SiteDirectory,
    @Inject(PAYMENT_TOTALS_DIRECTORY) paymentTotals: PaymentTotalsDirectory,
    @Inject(PAYMENT_READ_POLICY) canReadPayments: PaymentReadPolicy,
    @Inject(CLOCK) clock: Clock,
    @Inject(METRICS) metrics: MetricsRegistry,
  ) {
    this.#db = db;
    this.#cursors = cursors;
    this.#bulkRead = bulkRead;
    this.#users = users;
    this.#orders = orders;
    this.#parties = parties;
    this.#customers = customers;
    this.#sites = sites;
    this.#paymentTotals = paymentTotals;
    this.#canReadPayments = canReadPayments;
    this.#clock = clock;
    this.#authzDrift = metrics.counter('projection_authz_drift', []);
  }

  /**
   * The scope of the cursor: the digest of the normalised filters (and the phrase of a search) and, for a caller who may not read
   * payments, the mark of the variant without them (W4) — so a cursor of one variant fails (`invalid_cursor`) in the other.
   */
  scope(principal: Principal, filterParts: readonly string[]): string {
    return scopeOf(this.#canReadPayments(principal) ? [...filterParts] : [...filterParts, 'variant:without-payments']);
  }

  /**
   * W4: a payment view needs the right to read payments — without it `403 forbidden`, the same answer for every value (no echo). The
   * sort "Najpilniejsze" is never refused: without the right it is computed without the payments (D9). Called after the validation
   * and before the meter of mass reading, so a refused request reads and counts nothing.
   *
   * @throws ProblemException `forbidden`
   */
  authorize(principal: Principal, query: WorkOrderListQuery): void {
    if (query.view !== undefined && PAYMENT_VIEWS.includes(query.view) && !this.#canReadPayments(principal)) {
      throw new ProblemException('forbidden');
    }
  }

  /**
   * The cursor is `[asOf, …position]`, sealed together with the operation, the user, the filters and an expiry; every failure —
   * including a day that is not a date or a position that does not fit the sort — is the one `400 invalid_cursor` (SR-API-01).
   * "Today" is the day of the injected clock on the first page and `asOf` of the cursor on the next ones (W8): the page that continues
   * a list continues THAT day, so a midnight between two requests neither repeats an order nor skips one.
   *
   * @throws ProblemException `invalid_cursor`
   */
  start(principal: Principal, operation: string, query: WorkOrderListQuery, scope: string): PageStart {
    if (query.cursor === undefined) return { today: businessDate(this.#clock.now()), position: undefined };
    const parts = this.#cursors.open(operation, query.cursor, { scope, userId: principal.userId });
    const [asOf, ...rest] = parts ?? [];
    const position = asOf === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ? undefined : parsePosition(query.sort, rest);
    if (asOf === undefined || position === undefined) throw new ProblemException('invalid_cursor');
    return { today: asOf, position };
  }

  /** The caller has asked the meter (`before`) already; this reads, builds, parses and counts. */
  async page(principal: Principal, request: PageRequest): Promise<WorkOrderList> {
    const { query, start } = request;
    const { today } = start;
    const withPayments = this.#canReadPayments(principal);
    const rows = await readWorkOrderPage(this.#db, principal, query, start.position, { today, withPayments }, request.narrowing);
    const shown = rows.slice(0, query.limit);
    const titles = await this.#orders.titlesOf(
      this.#db,
      principal,
      shown.map((row) => row.id),
    );
    const visible = shown.flatMap((row) => {
      const title = titles.get(row.id);
      return title === undefined ? [] : [{ row, title }];
    });
    for (let dropped = visible.length; dropped < shown.length; dropped += 1) this.#authzDrift.increment({});
    const names = await this.#users.displayNamesOf(
      visible.flatMap(({ row }) => (row.coordinatorUserId === null ? [] : [row.coordinatorUserId])),
    );
    const partyIds = visible.flatMap(({ row }) => (row.longestWaitingPartyId === null ? [] : [row.longestWaitingPartyId]));
    // two batch lookups through the facade (the read policy of parties): none when no order of the page waits for a party
    const partyNames = partyIds.length === 0 ? new Map<string, string>() : await this.#parties.namesOf(this.#db, principal, partyIds);
    const partyKinds = partyIds.length === 0 ? new Map<string, string>() : await this.#parties.kindsOf(this.#db, principal, partyIds);
    // the customers and the sites: ONE statement each for the whole page, under the read policy of their modules (none when absent)
    const customerNames = await this.#customers.displayNamesOf(this.#db, principal, unique(visible.map(({ row }) => row.customerId)));
    const siteLines = await this.#sites.linesOf(this.#db, principal, unique(visible.map(({ row }) => row.siteId)));
    const totals = withPayments ? await this.#totalsOf(principal, visible, today) : undefined;
    const last = shown.at(-1);
    const list = {
      items: visible.map(({ row, title }) => ({
        ...toItem(row, title, { names, partyNames, partyKinds, customerNames, siteLines }, today),
        ...(totals === undefined ? {} : { payment: paymentOf(row, totals, today) }),
      })),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? this.#cursors.seal(request.operation, {
              position: [today, ...positionParts(query.sort, last)],
              scope: request.scope,
              userId: principal.userId,
            })
          : null,
    };
    const checked = zWorkOrderList.safeParse(list);
    if (!checked.success) throw new ProblemException('internal_error');
    this.#bulkRead.after(principal.userId, checked.data.items.length);
    await this.#bulkRead.afterDistinct(
      principal.userId,
      'customer',
      // the customers the answer NAMES — a deleted one is not in the answer, so it is not counted as read
      checked.data.items.flatMap((item) =>
        item.customer !== null && item.customer !== undefined && 'id' in item.customer ? [item.customer.id] : [],
      ),
      { ...request.context, sessionId: principal.sessionId },
    );
    return checked.data;
  }

  /**
   * The totals of the issued milestones of the orders of the page that passed the batch of titles — never of a row the fail-closed
   * batch dropped (K3) — in ONE statement of `payments`, with the day of the page. No statement when no order has an issued milestone.
   */
  async #totalsOf(
    principal: Principal,
    visible: readonly { readonly row: WorkOrderRow }[],
    today: string,
  ): Promise<ReadonlyMap<string, PaymentTotals>> {
    const ids = visible.flatMap(({ row }) => (row.invoicedCount > 0 ? [row.id] : []));
    if (ids.length === 0) return new Map();
    return this.#paymentTotals.paymentTotalsOf(this.#db, principal, ids, today);
  }
}

const money = (amountMinor: number) => ({ amountMinor, currency: 'PLN' as const });

/**
 * The column "Płatność" (D8): the state from the projection and the day of the page, the totals from the facade. The two are read by
 * separate statements without a common snapshot, so for a moment around a parallel change of a milestone they may disagree (the state
 * says `overdue`, the total of the overdue ones is 0): a deliberate tolerance — the contract does not tie them, and the next refresh
 * agrees. An order without an issued milestone has zero totals.
 */
function paymentOf(row: WorkOrderRow, totals: ReadonlyMap<string, PaymentTotals>, today: string) {
  const total = totals.get(row.id);
  return {
    state: paymentStateOf(row, today),
    invoicedCount: row.invoicedCount,
    invoicedTotal: money(total?.invoicedMinor ?? 0),
    overdueTotal: money(total?.overdueMinor ?? 0),
  };
}

const unique = (ids: readonly (string | null)[]): string[] => [...new Set(ids.filter((id): id is string => id !== null))];

interface Lookups {
  readonly names: ReadonlyMap<string, string>;
  readonly partyNames: ReadonlyMap<string, string>;
  readonly partyKinds: ReadonlyMap<string, string>;
  readonly customerNames: ReadonlyMap<string, string>;
  readonly siteLines: ReadonlyMap<string, SiteLine>;
}

function toItem(row: WorkOrderRow, title: string, lookups: Lookups, today: string) {
  const displayName = row.coordinatorUserId === null ? undefined : lookups.names.get(row.coordinatorUserId);
  return {
    id: row.id,
    number: row.number,
    title,
    status: row.status,
    coordinator: row.coordinatorUserId === null || displayName === undefined ? null : { id: row.coordinatorUserId, displayName },
    createdAt: row.createdAt.toISOString(),
    waiting: waitingOf(row, lookups.partyNames, lookups.partyKinds, today),
    nextDueDate: row.nextDueDate,
    // a difference of dates (`YYYY-MM-DD` compare as dates): the deadline of the nearest unfinished stage is before today
    hasOverdueStage: row.nextDueDate !== null && row.nextDueDate < today,
    customer: customerOf(row.customerId, lookups.customerNames),
    site: siteOf(row.siteId, lookups.siteLines),
  };
}

/**
 * `null` — the order has no customer; `{deleted: true}` — it has one the caller may not see (deleted): no identifier and no name, so the
 * list neither names nor links a deleted customer (TM-18, W-10 "Klient usunięty").
 */
function customerOf(customerId: string | null, names: ReadonlyMap<string, string>) {
  if (customerId === null) return null;
  const displayName = names.get(customerId);
  return displayName === undefined ? { deleted: true as const } : { id: customerId, displayName };
}

/** The city, the street and the building number — never the postal code or the apartment (SR-DATA-03); a site that is gone is `null`. */
function siteOf(siteId: string | null, lines: ReadonlyMap<string, SiteLine>) {
  if (siteId === null) return null;
  const line = lines.get(siteId);
  return line === undefined
    ? null
    : { id: line.id, siteType: line.siteType, city: line.city, street: line.street, buildingNumber: line.buildingNumber };
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
