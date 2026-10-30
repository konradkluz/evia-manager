import type { Kysely } from 'kysely';
import type { Database } from '../database/database.ts';
/**
 * What the reader of the change log (`sync`) learns about ONE row that a log entry names (EVM-096; ADR-0021 D1, D4), shared by the sync ports of the modules
 * that own the tables. The log holds no content, so the reader asks the owner of the table for the CURRENT state of the row, under the read policy:
 * - `upsert`: the row exists, the caller may read it - its projection (the columns of the contract only);
 * - `delete`: the row exists but is deleted (soft) - a marker is due when it was in the scope of the phone;
 * - `skip`: the row exists and nothing is due.
 * A row that no longer exists at all (purged, anonymised rows still exist) is ABSENT from the map the port returns.
 */
export type SyncRowState<Projection> =
  { readonly kind: 'upsert'; readonly projection: Projection } | { readonly kind: 'delete' } | { readonly kind: 'skip' };

/**
 * What the owner of a table with an anchor order (scope items, stages, journal entries) tells `sync` about ONE row WITHOUT its content (EVM-097): the order it
 * belongs to and whether the row is live, deleted (soft) or hidden from the phone for good (a journal entry about a payment, SR-SYNC-04). `sync` asks
 * `work-orders` which of the orders are in the scope of the caller, and only then reads the content of the rows of those orders (`liveOf`) - the content of a row
 * outside the scope is never read.
 */
export interface SyncChildAnchor {
  readonly workOrderId: string;
  readonly state: 'live' | 'deleted' | 'hidden';
}

export interface OrderChildSyncSource<Projection> {
  /** The anchor of every row among `ids` that exists (ONE query); a row that does not exist (purged) is absent. */
  anchorsOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, SyncChildAnchor>>;
  /** The projection of the LIVE rows among `ids` that belong to one of `workOrderIds` (the orders in scope) (ONE query). */
  liveOf(tx: Kysely<Database>, ids: readonly string[], workOrderIds: readonly string[]): Promise<ReadonlyMap<string, Projection>>;
  /** The projections of the live rows of the orders (ONE query), in the order of the phone: `workOrderId`, then the natural order of the entity. */
  ofOrders(tx: Kysely<Database>, workOrderIds: readonly string[]): Promise<readonly Projection[]>;
}
