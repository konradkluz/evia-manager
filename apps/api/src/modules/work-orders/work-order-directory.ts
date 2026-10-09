/**
 * The facade of `work-orders` for the other modules (ADR-0001: a module reaches another one through its `index.ts` only). Its first
 * consumer is `procedures` (EVM-031): the stages of an order may be read and changed only through the order, so the question is
 * always "may THIS caller see this order, and is it closed?" — answered by the ONE read policy of work orders (`visibleWorkOrders`:
 * a deleted or missing order is `undefined` for every role, the Administrator included, until EVM-060). The caller passes ITS
 * transaction. Nothing but the identifier and the status comes back (no customer, no title, no description — SR-DATA-03).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';
import type { WorkOrderStatus } from './domain/work-order-list-query.ts';

export const WORK_ORDER_DIRECTORY = Symbol('WORK_ORDER_DIRECTORY');

export interface WorkOrderRef {
  readonly id: string;
  readonly status: WorkOrderStatus;
  /** Settled or cancelled (PO-8): scope, processes and payments are read-only. */
  readonly closed: boolean;
}

export interface WorkOrderDirectory {
  /** The order the caller may see, or `undefined` (missing and deleted alike). */
  findVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<WorkOrderRef | undefined>;
  /**
   * The same, with the row LOCKED (`SELECT … FOR UPDATE`) until the transaction ends: the decision about a change that depends on the
   * status (is the order closed?) is taken on a status no other transaction can change meanwhile (ASVS V2.3.3).
   */
  lockVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<WorkOrderRef | undefined>;
}
