/**
 * The SYNC port of `timeline` (EVM-097; ADR-0021 D8): the journal entries of the orders for the phone. The columns are listed, never `*`: the code and the payload
 * of an event, the redaction author and the deletion author never leave. An event about a PAYMENT (`payment_milestone_*`) is hidden in the query itself - not even
 * its existence and its time are for the phone (SR-SYNC-04, P6). The order of an entry is judged by `work-orders` (`ordersInScope`) before the content is read.
 * Not part of `index.ts` (see `work-orders/system-ports.ts`): only `sync` may import it.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { OrderChildSyncSource } from '../../platform/sync/sync-row-state.ts';

export const TIMELINE_ENTRY_SYNC_SOURCE = Symbol('TIMELINE_ENTRY_SYNC_SOURCE');

/** The fields of `SyncTimelineEntry` (contract) that come from the entry; `type` is added by the serializer of `sync`. */
export interface SyncTimelineEntryProjection {
  readonly id: string;
  readonly version: number;
  readonly workOrderId: string;
  readonly kind: string;
  readonly noteCategory: string | null;
  /** After a redaction (EVM-040) the marker text: the original text is gone from the row. */
  readonly body: string | null;
  readonly procedureStageId: string | null;
  readonly authorUserId: string | null;
  readonly createdAt: Date;
  readonly origin: string;
  readonly capturedAt: Date | null;
  readonly supersedesEntryId: string | null;
  readonly supersededByEntryId: string | null;
  readonly redactedAt: Date | null;
}

export interface TimelineEntrySyncSource extends OrderChildSyncSource<SyncTimelineEntryProjection> {
  /** The live entries written by one of the users among `ids`: the author and the order (ONE query). */
  authors(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyArray<{ readonly userId: string; readonly workOrderId: string }>>;
}
