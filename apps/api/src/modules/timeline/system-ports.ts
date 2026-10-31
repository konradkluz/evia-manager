/**
 * The SYNC port of `timeline` (EVM-097; ADR-0021 D8): the journal entries of the orders for the phone. The columns are listed, never `*`: the code and the payload
 * of an event, the redaction author and the deletion author never leave. An event about a PAYMENT (`payment_milestone_*`) is hidden in the query itself - not even
 * its existence and its time are for the phone (SR-SYNC-04, P6). The order of an entry is judged by `work-orders` (`ordersInScope`) before the content is read.
 * Not part of `index.ts` (see `work-orders/system-ports.ts`): only `sync` may import it.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { EventContext } from '../../platform/events/event-bus.ts';
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

/**
 * The COMMAND port of `timeline` for the mutations of the phone (EVM-098; ADR-0008): a note or a comment written offline, in the transaction of `sync`, with the
 * rules of the panel (`resolveCreateEntry`: the normalisation of the text, at most 10 000 characters, the category of a note; the stage of THIS order) and INSERT
 * only. The author and the device come from the session (the caller passes them from it). The order has been judged by `work-orders` before this runs. The
 * answer is a code only: no pointer, no value of the request, nothing of an existing row. Not part of `index.ts`: only `sync` may import it.
 */
export const MOBILE_ENTRY_COMMANDS = Symbol('MOBILE_ENTRY_COMMANDS');

export interface MobileEntryCommand {
  readonly id: string;
  readonly kind: 'note' | 'comment';
  readonly workOrderId: string;
  readonly noteCategory: 'phone_call' | 'meeting' | 'arrangement' | 'site_visit' | 'other' | undefined;
  readonly body: string;
  readonly procedureStageId: string | undefined;
  /** In range or `null` (decided by `sync`); metadata only - the order of the journal is the time of the server. */
  readonly capturedAt: Date | null;
}

/** The author and the device of the SESSION of the request. */
export interface MobileAuthor {
  readonly userId: string;
  readonly deviceId: string;
}

/** `applied`: the entry is written and `timeline_entry.created` published; `invalid`: a rule of the content or the stage; `id_conflict`: the identifier exists. */
export type MobileEntryResult = 'applied' | 'invalid' | 'id_conflict';

export interface MobileEntryCommands {
  create(tx: Kysely<Database>, author: MobileAuthor, command: MobileEntryCommand, context: EventContext): Promise<MobileEntryResult>;
  /**
   * The rule of `idempotency_expired` (EVM-098 AC4): an entry with the identifier, the kind and the order of the command, written by this user from this device
   * no later than `createdBefore`. A yes or a no only - no field of the row - asked by `sync` only after the order passed the policy.
   */
  matchesOwnEntry(tx: Kysely<Database>, query: OwnEntry): Promise<boolean>;
}

export interface OwnEntry {
  readonly id: string;
  readonly kind: 'note' | 'comment';
  readonly workOrderId: string;
  readonly author: MobileAuthor;
  readonly createdBefore: Date;
}
