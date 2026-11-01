/**
 * The facade of `work-orders` for the other modules (ADR-0001: a module reaches another one through its `index.ts` only). Its first
 * consumer is `procedures` (EVM-031): the stages of an order may be read and changed only through the order, so the question is
 * always "may THIS caller see this order, and is it closed?" — answered by the ONE read policy of work orders (`visibleWorkOrders`:
 * a deleted or missing order is `undefined` for every role, the Administrator included — the deleted ones have a mode of their own, `deletedRefsOf`). The caller passes ITS
 * transaction. Nothing but the identifier and the status comes back (no customer, no title, no description — SR-DATA-03).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';
import type { WorkOrderStatus } from './domain/work-order-status.ts';

export const WORK_ORDER_DIRECTORY = Symbol('WORK_ORDER_DIRECTORY');

export interface WorkOrderRef {
  readonly id: string;
  readonly status: WorkOrderStatus;
  /** Settled or cancelled (PO-8): scope, processes and payments are read-only. */
  readonly closed: boolean;
  /** The site of the order (`null` for an order created before sites): the anchor of the documents of a site (EVM-050); a key only. */
  readonly siteId: string | null;
  /** The customer of the order or `null`: the anchor of the documents of a customer (EVM-050); a key only. */
  readonly customerId: string | null;
}

/** The header of an order a list of another module shows: the number, the title and the customer (a key only — the name comes from `customers`). */
export interface WorkOrderListRef {
  readonly number: string;
  readonly title: string;
  readonly customerId: string | null;
  /** Settled or cancelled (PO-8) — "Do wystawienia" (EVM-059) leaves such orders out. */
  readonly closed: boolean;
}

/** A soft deleted order as the view "Usunięte" shows it (EVM-060): the title and the version a restoration needs (`If-Match`). */
export interface DeletedOrderRef {
  readonly title: string;
  readonly version: number;
}

export interface WorkOrderDirectory {
  /** The order the caller may see, or `undefined` (missing and deleted alike). */
  findVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<WorkOrderRef | undefined>;
  /**
   * The same, with the row LOCKED (`SELECT … FOR NO KEY UPDATE`) until the transaction ends: the decision about a change that depends on the
   * status (is the order closed?) is taken on a status no other transaction can change meanwhile (ASVS V2.3.3).
   */
  lockVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<WorkOrderRef | undefined>;
  /**
   * The title of every order among `ids` that the caller may see (ONE query, the read policy in it); the others are absent — the list
   * of `overview` shows nothing for an order this answer leaves out (fail closed, ADR-0017 W2).
   */
  titlesOf(tx: Kysely<Database>, principal: Principal, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /**
   * The title and the version of every SOFT DELETED order among `ids` — ONE query with the read policy in its mode `deleted` (EVM-060):
   * only the Administrator gets an answer, for every other role the condition is never true and the map is empty. The ONLY way another
   * module reads a deleted order, for the view "Usunięte" of `overview`; never a source of permission (SR-AUTHZ-02).
   */
  deletedRefsOf(tx: Kysely<Database>, principal: Principal, ids: readonly string[]): Promise<ReadonlyMap<string, DeletedOrderRef>>;
  /**
   * The identifiers of the orders the caller may see whose number or title contains the (normalised) phrase — at most `limit`, the
   * read policy of work orders IN the query (EVM-072). Only a narrowing for the search of `overview`, never a source of permission.
   */
  searchIds(tx: Kysely<Database>, principal: Principal, term: string, limit: number): Promise<string[]>;
  /**
   * The number, the title and the customer of every order among `ids` that the caller may see (ONE query, the read policy of work orders
   * in it, the identifiers as one array parameter); the others are absent. A NARROWING of a set the caller has started on its own side
   * (the orders with an unpaid invoice — `payments`, EVM-055), never a source of permission: a row of the caller whose order is absent
   * here is dropped (fail closed; SR-AUTHZ-03, SR-DATA-03, ADR-0017 W2).
   */
  refsOf(tx: Kysely<Database>, principal: Principal, ids: readonly string[]): Promise<ReadonlyMap<string, WorkOrderListRef>>;
}
