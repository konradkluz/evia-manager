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
