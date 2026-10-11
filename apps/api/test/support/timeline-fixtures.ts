/**
 * Synthetic journal entries written straight into the database (EVM-037) — a TEST helper: it lives outside `src`, so it is not in
 * the production image and no route reaches it; it refuses to run when `NODE_ENV=production` (SR-INFRA-08). Everything is
 * synthetic: texts are made of a counter, authors are the fixture users of the identity tests.
 */
import type { Kysely } from 'kysely';
import { timelineTables, type EntryKind, type NoteCategory } from '../../src/modules/timeline/infrastructure/tables.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { uuidv7 } from './uuid.ts';
import { assertSyntheticDataAllowed } from './work-order-fixtures.ts';

export interface EntrySpec {
  readonly id?: string;
  readonly kind?: EntryKind;
  readonly noteCategory?: NoteCategory;
  readonly body?: string;
  readonly procedureStageId?: string;
  readonly supersedesEntryId?: string;
  readonly authorUserId?: string;
  /** ISO time of the server; default: a minute after the previous entry of the call. */
  readonly createdAt?: string;
  readonly deletedAt?: string;
}

let counter = 0;
const BASE = Date.parse('2026-10-01T08:00:00.000Z');

/** Inserts the entries of an order in the order given; returns their identifiers. */
export async function insertEntries(
  db: Kysely<Database>,
  workOrderId: string,
  authorUserId: string,
  specs: readonly EntrySpec[],
): Promise<string[]> {
  assertSyntheticDataAllowed();
  const tables = timelineTables(db);
  const ids: string[] = [];
  for (const spec of specs) {
    counter += 1;
    const id = spec.id ?? uuidv7(BASE + counter);
    const kind = spec.kind ?? 'note';
    await tables
      .insertInto('timeline.timeline_entries')
      .values({
        id,
        work_order_id: workOrderId,
        kind,
        note_category: kind === 'note' ? (spec.noteCategory ?? 'phone_call') : null,
        body: kind === 'event' ? null : (spec.body ?? `Wpis syntetyczny ${counter}`),
        procedure_stage_id: spec.procedureStageId ?? null,
        supersedes_entry_id: spec.supersedesEntryId ?? null,
        origin: kind === 'event' ? 'system' : 'web',
        captured_at: null,
        created_at: new Date(spec.createdAt ?? BASE + counter * 60_000),
        created_by: kind === 'event' ? null : (spec.authorUserId ?? authorUserId),
        deleted_at: spec.deletedAt === undefined ? null : new Date(spec.deletedAt),
        redacted_at: null,
      })
      .execute();
    ids.push(id);
  }
  return ids;
}
