/**
 * The queries behind the sync port of `timeline` (see `../system-ports.ts`): SELECT only, the listed columns (no event code and payload, no `created_by` of
 * the system, no redaction or deletion author), an event about a payment excluded IN the query (SR-SYNC-04).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { SyncChildAnchor } from '../../../platform/sync/sync-row-state.ts';
import type { SyncTimelineEntryProjection, TimelineEntrySyncSource } from '../system-ports.ts';
import { timelineTables } from './tables.ts';

const ENTRIES = 'timeline.timeline_entries';
const E = sql.ref('timeline.timeline_entries');

/** An entry that is an event about a payment milestone (`payment_milestone_*`): never for the phone. */
const aboutPayment = sql<boolean>`(${E}.kind = 'event' and ${E}.event_code like 'payment\\_milestone\\_%' escape '\\')`;
const notAboutPayment = sql<boolean>`not coalesce(${aboutPayment}, false)`;

export class TimelineEntrySyncSourceService implements TimelineEntrySyncSource {
  async anchorsOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, SyncChildAnchor>> {
    if (ids.length === 0) return new Map();
    const rows = await timelineTables(tx)
      .selectFrom(ENTRIES)
      .select([`${ENTRIES}.id as id`, `${ENTRIES}.work_order_id as workOrderId`, `${ENTRIES}.deleted_at as deletedAt`])
      .select(aboutPayment.as('hidden'))
      .where(`${ENTRIES}.id`, 'in', ids)
      .execute();
    return new Map(
      rows.map((row): [string, SyncChildAnchor] => [
        row.id,
        { workOrderId: row.workOrderId, state: row.hidden ? 'hidden' : row.deletedAt === null ? 'live' : 'deleted' },
      ]),
    );
  }

  async liveOf(
    tx: Kysely<Database>,
    ids: readonly string[],
    workOrderIds: readonly string[],
  ): Promise<ReadonlyMap<string, SyncTimelineEntryProjection>> {
    if (ids.length === 0 || workOrderIds.length === 0) return new Map();
    const rows = await this.#select(tx).where(`${ENTRIES}.id`, 'in', ids).where(`${ENTRIES}.work_order_id`, 'in', workOrderIds).execute();
    return new Map(rows.map((row) => [row.id, row]));
  }

  async ofOrders(tx: Kysely<Database>, workOrderIds: readonly string[]): Promise<readonly SyncTimelineEntryProjection[]> {
    if (workOrderIds.length === 0) return [];
    return this.#select(tx)
      .where(`${ENTRIES}.work_order_id`, 'in', workOrderIds)
      .orderBy(`${ENTRIES}.work_order_id`)
      .orderBy(`${ENTRIES}.created_at`)
      .orderBy(`${ENTRIES}.id`)
      .execute();
  }

  async authors(
    tx: Kysely<Database>,
    ids: readonly string[],
  ): Promise<ReadonlyArray<{ readonly userId: string; readonly workOrderId: string }>> {
    if (ids.length === 0) return [];
    const rows = await timelineTables(tx)
      .selectFrom(ENTRIES)
      .select([`${ENTRIES}.created_by as userId`, `${ENTRIES}.work_order_id as workOrderId`])
      .distinct()
      .$narrowType<{ userId: string }>()
      .where(`${ENTRIES}.created_by`, 'in', ids)
      .where(`${ENTRIES}.deleted_at`, 'is', null)
      .where(notAboutPayment)
      .execute();
    return rows;
  }

  #select(tx: Kysely<Database>) {
    return timelineTables(tx)
      .selectFrom(ENTRIES)
      .select([
        `${ENTRIES}.id as id`,
        `${ENTRIES}.version as version`,
        `${ENTRIES}.work_order_id as workOrderId`,
        `${ENTRIES}.kind as kind`,
        `${ENTRIES}.note_category as noteCategory`,
        `${ENTRIES}.body as body`,
        `${ENTRIES}.procedure_stage_id as procedureStageId`,
        `${ENTRIES}.created_by as authorUserId`,
        `${ENTRIES}.created_at as createdAt`,
        `${ENTRIES}.origin as origin`,
        `${ENTRIES}.captured_at as capturedAt`,
        `${ENTRIES}.supersedes_entry_id as supersedesEntryId`,
        sql<
          string | null
        >`(select correction.id from timeline.timeline_entries correction where correction.supersedes_entry_id = ${E}.id and correction.work_order_id = ${E}.work_order_id and correction.deleted_at is null order by correction.created_at, correction.id limit 1)`.as(
          'supersededByEntryId',
        ),
        `${ENTRIES}.redacted_at as redactedAt`,
      ])
      .where(`${ENTRIES}.deleted_at`, 'is', null)
      .where(notAboutPayment);
  }
}
