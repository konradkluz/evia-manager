/**
 * The shape of the answers of the module (EVM-037 AC1–AC3, AC6): a row of the database, the names of the author and of the stage
 * and the correction of the entry become the object of the contract. The author is `{id, displayName}` and nothing else (SR-DATA-03).
 * Every answer is parsed with the schema of the contract before it leaves, so only the fields of the contract can leave; a mismatch
 * is a defect of the server (`500`), never data (ASVS V15.3.1). Pure — the batches of names and corrections are looked up by the
 * caller (`entry-page.ts`), ONE per page, so the number of queries does not depend on the number of entries (no N+1).
 */
import { zTimelineEntry, zTimelineEntryList } from '@evia/contracts/zod';
import type { TimelineEntry, TimelineEntryList } from '@evia/contracts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { EntryRow } from '../infrastructure/timeline-store.ts';

/** What a page needs besides its rows: the names of the authors and of the stages, and the corrections, by identifier. */
export interface RepresentationBatch {
  readonly authors: ReadonlyMap<string, string>;
  readonly stageNames: ReadonlyMap<string, string>;
  /** The correction of an entry, by the entry it corrects. */
  readonly corrections: ReadonlyMap<string, string>;
}

const checked = <T>(result: { success: true; data: T } | { success: false }): T => {
  if (!result.success) throw new ProblemException('internal_error');
  return result.data;
};

/** The author as `{id, displayName}`; a user of the system always has a name, so a missing one is a defect, not an entry without an author. */
function authorOf(userId: string | null, authors: ReadonlyMap<string, string>) {
  if (userId === null) return null;
  const displayName = authors.get(userId);
  if (displayName === undefined) throw new ProblemException('internal_error');
  return { id: userId, displayName };
}

function entryView(row: EntryRow, batch: RepresentationBatch) {
  return {
    id: row.id,
    kind: row.kind,
    noteCategory: row.note_category,
    body: row.body,
    procedureStageId: row.procedure_stage_id,
    procedureStageName: row.procedure_stage_id === null ? null : (batch.stageNames.get(row.procedure_stage_id) ?? null),
    author: authorOf(row.created_by, batch.authors),
    createdAt: row.created_at.toISOString(),
    origin: row.origin,
    capturedAt: row.captured_at === null ? null : row.captured_at.toISOString(),
    supersedesEntryId: row.supersedes_entry_id,
    supersededByEntryId: batch.corrections.get(row.id) ?? null,
    redactedAt: row.redacted_at === null ? null : row.redacted_at.toISOString(),
  };
}

export const toTimelineEntry = (row: EntryRow, batch: RepresentationBatch): TimelineEntry =>
  checked(zTimelineEntry.safeParse(entryView(row, batch)));

export const toTimelineEntryList = (rows: readonly EntryRow[], batch: RepresentationBatch, nextCursor: string | null): TimelineEntryList =>
  checked(zTimelineEntryList.safeParse({ items: rows.map((row) => entryView(row, batch)), nextCursor }));
