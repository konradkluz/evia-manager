/**
 * The lookups that an answer of the journal needs, in the transaction of the caller (EVM-037 AC1–AC3, AC6; SR-DATA-03): the names
 * of the authors (`identity`), the names of the stages (`procedures`) and the corrections of the entries — each looked up ONCE for
 * the whole page, so the number of queries does not depend on the number of entries (no N+1). The shape of the answer itself is
 * `entry-representation.ts`.
 */
import type { TimelineEntry, TimelineEntryList } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { UserDirectory } from '../../identity/index.ts';
import type { ProcedureStageDirectory } from '../../procedures/index.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { correctionsOf, type EntryRow } from '../infrastructure/timeline-store.ts';
import { toTimelineEntry, toTimelineEntryList, type RepresentationBatch } from './entry-representation.ts';

export interface PresentationDeps {
  readonly users: UserDirectory;
  readonly stages: ProcedureStageDirectory;
}

async function batchFor(
  deps: PresentationDeps,
  tx: Kysely<Database>,
  workOrderId: string,
  rows: readonly EntryRow[],
): Promise<RepresentationBatch> {
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

export async function presentEntry(
  deps: PresentationDeps,
  tx: Kysely<Database>,
  workOrderId: string,
  row: EntryRow,
): Promise<TimelineEntry> {
  return toTimelineEntry(row, await batchFor(deps, tx, workOrderId, [row]));
}

export async function presentPage(
  deps: PresentationDeps,
  tx: Kysely<Database>,
  workOrderId: string,
  rows: readonly EntryRow[],
  nextCursor: string | null,
): Promise<TimelineEntryList> {
  return toTimelineEntryList(rows, await batchFor(deps, tx, workOrderId, rows), nextCursor);
}
