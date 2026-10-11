/**
 * The shape of the answers of the module (EVM-037 AC1–AC3, AC6): the rows of the database, the names of the authors and of the
 * stages and the corrections of a page become the objects of the contract. The author is `{id, displayName}` and nothing else
 * (SR-DATA-03). Every answer is parsed with the schema of the contract before it leaves, so only the fields of the contract can
 * leave; a mismatch is a defect of the server (`500`), never data (ASVS V15.3.1). ONE batch of names and corrections per page:
 * the number of queries does not depend on the number of entries (no N+1).
 */
import { zTimelineEntry, zTimelineEntryList } from '@evia/contracts/zod';
import type { TimelineEntry, TimelineEntryList } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { UserDirectory } from '../../identity/index.ts';
import type { ProcedureStageDirectory } from '../../procedures/index.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { correctionsOf, type EntryRow } from '../infrastructure/timeline-store.ts';

export interface PresentationDeps {
  readonly users: UserDirectory;
  readonly stages: ProcedureStageDirectory;
}

interface Batch {
  readonly authors: ReadonlyMap<string, string>;
  readonly stageNames: ReadonlyMap<string, string>;
  readonly corrections: ReadonlyMap<string, string>;
}

const checked = <T>(result: { success: true; data: T } | { success: false }): T => {
  if (!result.success) throw new ProblemException('internal_error');
  return result.data;
};

/** The names and corrections the rows need, each looked up ONCE for the whole page, in the transaction of the caller. */
async function batchFor(deps: PresentationDeps, tx: Kysely<Database>, workOrderId: string, rows: readonly EntryRow[]): Promise<Batch> {
  const authorIds = [...new Set(rows.flatMap((row) => (row.created_by === null ? [] : [row.created_by])))];
  const stageIds = [...new Set(rows.flatMap((row) => (row.procedure_stage_id === null ? [] : [row.procedure_stage_id])))];
  return {
    authors: await deps.users.displayNamesOf(authorIds, tx),
    stageNames: await deps.stages.namesOf(tx, workOrderId, stageIds),
    corrections: await correctionsOf(
      timelineTables(tx),
      workOrderId,
      rows.map((row) => row.id),
    ),
  };
}

function entryView(row: EntryRow, batch: Batch) {
  const authorName = row.created_by === null ? undefined : batch.authors.get(row.created_by);
  // the key is a user of the system, so a name is always there; a missing one is a defect, not an entry without an author
  if (row.created_by !== null && authorName === undefined) throw new ProblemException('internal_error');
  return {
    id: row.id,
    kind: row.kind,
    noteCategory: row.note_category,
    body: row.body,
    procedureStageId: row.procedure_stage_id,
    procedureStageName: row.procedure_stage_id === null ? null : (batch.stageNames.get(row.procedure_stage_id) ?? null),
    author: row.created_by === null || authorName === undefined ? null : { id: row.created_by, displayName: authorName },
    createdAt: row.created_at.toISOString(),
    origin: row.origin,
    capturedAt: row.captured_at === null ? null : row.captured_at.toISOString(),
    supersedesEntryId: row.supersedes_entry_id,
    supersededByEntryId: batch.corrections.get(row.id) ?? null,
    redactedAt: row.redacted_at === null ? null : row.redacted_at.toISOString(),
  };
}

export async function presentEntry(
  deps: PresentationDeps,
  tx: Kysely<Database>,
  workOrderId: string,
  row: EntryRow,
): Promise<TimelineEntry> {
  return checked(zTimelineEntry.safeParse(entryView(row, await batchFor(deps, tx, workOrderId, [row]))));
}

export async function presentPage(
  deps: PresentationDeps,
  tx: Kysely<Database>,
  workOrderId: string,
  rows: readonly EntryRow[],
  nextCursor: string | null,
): Promise<TimelineEntryList> {
  const batch = await batchFor(deps, tx, workOrderId, rows);
  return checked(zTimelineEntryList.safeParse({ items: rows.map((row) => entryView(row, batch)), nextCursor }));
}
