/**
 * Queries of the `timeline` module (EVM-037). Every value reaches the database as a bound parameter; every query names its columns
 * (no `select *`, so a column outside the contract — `created_by` is the author's identifier only — cannot leak, SR-DATA-03). The
 * anchor `work_order_id` is in the condition of EVERY read and write of an entry (SR-AUTHZ-02, CWE-639): an entry is never found by
 * its own identifier alone. The order itself is resolved before, through the facade of `work-orders` and its read policy. The
 * filters of the list are conditions of the query, never a filter of the page after it, and an entry that is soft deleted is
 * not in any of them.
 */
import { sql } from 'kysely';
import type { EntryKind, NoteCategory, TimelineDb } from './tables.ts';

/** The columns of an entry that the answers carry. */
const entryColumns = [
  'id',
  'kind',
  'note_category',
  'body',
  'procedure_stage_id',
  'supersedes_entry_id',
  'origin',
  'captured_at',
  'created_at',
  'created_by',
  'redacted_at',
  'deleted_at',
  'version',
  'event_code',
  'event_payload',
] as const;

export interface NewEntry {
  readonly id: string;
  readonly workOrderId: string;
  readonly kind: Exclude<EntryKind, 'event'>;
  readonly noteCategory: NoteCategory | null;
  readonly body: string;
  readonly procedureStageId: string | null;
  readonly supersedesEntryId: string | null;
  readonly authorUserId: string;
}

/**
 * INSERT only: an existing identifier — also of an entry of another order and of a deleted entry — inserts nothing (`undefined`),
 * whatever the content, and the caller answers `409 id_conflict` without a word about the existing row. The origin is `web`, the
 * time is the time of the SERVER: neither is a value of the request.
 */
export function insertEntry(db: TimelineDb, entry: NewEntry, now: Date) {
  return db
    .insertInto('timeline.timeline_entries')
    .values({
      id: entry.id,
      work_order_id: entry.workOrderId,
      kind: entry.kind,
      note_category: entry.noteCategory,
      body: entry.body,
      procedure_stage_id: entry.procedureStageId,
      supersedes_entry_id: entry.supersedesEntryId,
      origin: 'web',
      captured_at: null,
      created_at: now,
      created_by: entry.authorUserId,
      deleted_at: null,
      redacted_at: null,
      event_code: null,
      event_payload: null,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .returning(entryColumns)
    .executeTakeFirst();
}

/** What an event of the journal is written with (EVM-038): the columns the event decides; the identifier is made by the database. */
export interface NewEvent {
  readonly workOrderId: string;
  readonly code: string;
  readonly payload: Record<string, unknown>;
  readonly procedureStageId: string | null;
  readonly actorUserId: string;
}

/**
 * Writes an event of the journal in the transaction of the change (EVM-038 AC1, AC5): `kind = event`, `origin = system`, no text, no
 * category, no correction; the identifier is a UUIDv7 of the database (monotonic in a session, so two events of one change keep their
 * order), the time is the time of the SERVER. The stage is pinned to the same order by the composite key. A failure is an error that
 * rolls the change back — there is no `on conflict`.
 */
export async function insertEvent(db: TimelineDb, event: NewEvent, now: Date): Promise<void> {
  await db
    .insertInto('timeline.timeline_entries')
    .values({
      id: sql<string>`uuidv7()`,
      work_order_id: event.workOrderId,
      kind: 'event',
      note_category: null,
      body: null,
      procedure_stage_id: event.procedureStageId,
      supersedes_entry_id: null,
      origin: 'system',
      captured_at: null,
      created_at: now,
      created_by: event.actorUserId,
      deleted_at: null,
      redacted_at: null,
      event_code: event.code,
      event_payload: event.payload,
    })
    .execute();
}

/** An entry of THIS order (`id` AND `work_order_id` in one condition), not deleted. */
export function findEntry(db: TimelineDb, workOrderId: string, entryId: string) {
  return db
    .selectFrom('timeline.timeline_entries')
    .select(entryColumns)
    .where('id', '=', entryId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
}

/**
 * The entry a correction points at, LOCKED (`SELECT … FOR UPDATE`): `id` AND `work_order_id` in one condition, so an entry of
 * another order, one that does not exist, a deleted one and an EVENT are all `undefined` — one answer (SR-AUTHZ-02). The lock
 * serialises two corrections of the same entry: the second one sees the first.
 */
export function lockCorrectable(db: TimelineDb, workOrderId: string, entryId: string) {
  return db
    .selectFrom('timeline.timeline_entries')
    .select(['id', 'kind', 'procedure_stage_id'])
    .where('id', '=', entryId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .where('kind', 'in', ['note', 'comment'])
    .forUpdate()
    .executeTakeFirst();
}

/** Has the entry a correction already (a live one)? Read under the lock of {@link lockCorrectable}. */
export async function hasCorrection(db: TimelineDb, workOrderId: string, entryId: string): Promise<boolean> {
  const row = await db
    .selectFrom('timeline.timeline_entries')
    .select('id')
    .where('supersedes_entry_id', '=', entryId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row !== undefined;
}

/** The corrections of the entries of a page, by the entry they correct — ONE query for the page (no N+1). */
export async function correctionsOf(db: TimelineDb, workOrderId: string, entryIds: readonly string[]): Promise<Map<string, string>> {
  if (entryIds.length === 0) return new Map();
  // `corrected_id` is never null here: the condition names it (`in`), so the column is typed as the text it is
  const rows = await db
    .selectFrom('timeline.timeline_entries')
    .select(['id', sql<string>`supersedes_entry_id`.as('corrected_id')])
    .where('work_order_id', '=', workOrderId)
    .where('supersedes_entry_id', 'in', entryIds)
    .where('deleted_at', 'is', null)
    .execute();
  return new Map(rows.map((row) => [row.corrected_id, row.id] as const));
}

export interface PageFilter {
  /** Also the entries that are soft deleted (EVM-040): only for the Administrator - the caller decides, the query just obeys. */
  readonly includeDeleted: boolean;
  readonly kind: Exclude<EntryKind, 'event'> | undefined;
  /** The group of the events (EVM-038 AC4): implies `kind = event`; the codes of the group are conditions of the query. */
  readonly eventCodes: readonly string[] | undefined;
  readonly procedureStageId: string | undefined;
}

/** Where the next page starts: the time of the server and the identifier of the last entry shown. */
export interface PagePosition {
  readonly createdAt: Date;
  readonly id: string;
}

/**
 * The page of the journal of an order, newest first (`created_at` of the server, then `id`, both descending — the order is not
 * the order of the identifiers the clients made). One row more than `limit` tells the caller there is a next page.
 */
export function listEntries(db: TimelineDb, workOrderId: string, filter: PageFilter, position: PagePosition | undefined, limit: number) {
  let query = db.selectFrom('timeline.timeline_entries').select(entryColumns).where('work_order_id', '=', workOrderId);
  if (!filter.includeDeleted) query = query.where('deleted_at', 'is', null);
  if (filter.kind !== undefined) query = query.where('kind', '=', filter.kind);
  if (filter.eventCodes !== undefined) query = query.where('kind', '=', 'event').where('event_code', 'in', filter.eventCodes);
  if (filter.procedureStageId !== undefined) query = query.where('procedure_stage_id', '=', filter.procedureStageId);
  if (position !== undefined)
    query = query.where(sql<boolean>`(created_at, id) < (${position.createdAt}::timestamptz, ${position.id}::uuid)`);
  return query
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1)
    .execute();
}

/** Which entries a lookup may return: the live ones (everybody), the soft deleted ones (a restoration) or both (the Administrator, a redaction). */
export type EntryState = 'live' | 'deleted' | 'any';

/** An entry of THIS order (`id` AND `work_order_id`) in any state: for the Administrator, who reads a deleted entry too (EVM-040 AC1). */
export function findEntryAnyState(db: TimelineDb, workOrderId: string, entryId: string) {
  return db
    .selectFrom('timeline.timeline_entries')
    .select(entryColumns)
    .where('id', '=', entryId)
    .where('work_order_id', '=', workOrderId)
    .executeTakeFirst();
}

/**
 * The entry LOCKED for a change (`SELECT … FOR NO KEY UPDATE`; EVM-040): `id` AND `work_order_id` in one condition, so an entry of another order
 * and one that does not exist are both `undefined`. NO KEY UPDATE serialises two commands on the entry but does not block the foreign-key check
 * of a correction that points at it. The state is a condition of the query, never a check after it.
 */
export function lockEntry(db: TimelineDb, workOrderId: string, entryId: string, state: EntryState) {
  let query = db
    .selectFrom('timeline.timeline_entries')
    .select(entryColumns)
    .where('id', '=', entryId)
    .where('work_order_id', '=', workOrderId);
  if (state === 'live') query = query.where('deleted_at', 'is', null);
  if (state === 'deleted') query = query.where('deleted_at', 'is not', null);
  return query.forNoKeyUpdate().executeTakeFirst();
}

/** The soft delete: the version is the one the caller decided on (`version = expected` is in the condition) and grows by one. */
export function softDeleteEntry(db: TimelineDb, workOrderId: string, entryId: string, expectedVersion: number, by: string, at: Date) {
  return db
    .updateTable('timeline.timeline_entries')
    .set({ deleted_at: at, deleted_by: by, version: sql<number>`version + 1` })
    .where('id', '=', entryId)
    .where('work_order_id', '=', workOrderId)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is', null)
    .returning(entryColumns)
    .executeTakeFirst();
}

/** The restoration of a soft deleted entry (the same condition on the version); the text, redacted or not, is as it was. */
export function restoreEntry(db: TimelineDb, workOrderId: string, entryId: string, expectedVersion: number) {
  return db
    .updateTable('timeline.timeline_entries')
    .set({ deleted_at: null, deleted_by: null, version: sql<number>`version + 1` })
    .where('id', '=', entryId)
    .where('work_order_id', '=', workOrderId)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is not', null)
    .returning(entryColumns)
    .executeTakeFirst();
}

/**
 * The redaction (EVM-040 AC2): the text becomes the marker, with the time and the author of the redaction. The trigger of the database
 * accepts nothing else (the marker only, once, never an event); `redacted_at is null` is in the condition too.
 */
export function redactEntry(
  db: TimelineDb,
  workOrderId: string,
  entryId: string,
  expectedVersion: number,
  marker: string,
  by: string,
  at: Date,
) {
  return db
    .updateTable('timeline.timeline_entries')
    .set({ body: marker, redacted_at: at, redacted_by: by, version: sql<number>`version + 1` })
    .where('id', '=', entryId)
    .where('work_order_id', '=', workOrderId)
    .where('version', '=', expectedVersion)
    .where('redacted_at', 'is', null)
    .returning(entryColumns)
    .executeTakeFirst();
}

export type EntryRow = NonNullable<Awaited<ReturnType<typeof findEntry>>>;
