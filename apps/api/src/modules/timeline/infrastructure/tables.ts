/**
 * Kysely types of the table the `timeline` module owns (EVM-037). `platform` does not know module tables: the module narrows a
 * handle with `db.$extendTables<TimelineTables>()`. The application role has SELECT, INSERT and UPDATE and NO DELETE; a trigger
 * refuses the change of every column but the soft delete and the version (append-only, D3). Times are written by the application.
 * The events of the journal (EVM-038) are rows of `kind = event`: `event_code` and `event_payload` (a JSON object of codes, identifiers
 * and names of fields — never a value of personal data) exist exactly for them.
 */
import type { Generated, Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';

export type EntryKind = 'note' | 'comment' | 'event';
export type NoteCategory = 'phone_call' | 'meeting' | 'arrangement' | 'site_visit' | 'other';
export type EntryOrigin = 'web' | 'mobile' | 'system';

export interface TimelineEntriesTable {
  /** Made by the client (UUIDv7). */
  id: string;
  work_order_id: string;
  kind: EntryKind;
  note_category: NoteCategory | null;
  body: string | null;
  procedure_stage_id: string | null;
  supersedes_entry_id: string | null;
  origin: EntryOrigin;
  event_code: string | null;
  event_payload: Record<string, unknown> | null;
  captured_at: Date | null;
  created_at: Date;
  created_by: string | null;
  version: Generated<number>;
  deleted_at: Date | null;
  redacted_at: Date | null;
  redacted_by: string | null;
  deleted_by: string | null;
  /** The device of the session of an entry from the phone (EVM-098; 0055): set exactly when `origin = mobile`, never part of an answer. */
  created_via_device_id: string | null;
}

export type TimelineTables = {
  'timeline.timeline_entries': TimelineEntriesTable;
};

export type TimelineDb = Kysely<TimelineTables>;

export const timelineTables = (db: Kysely<Database>): TimelineDb => db.$extendTables<TimelineTables>();
