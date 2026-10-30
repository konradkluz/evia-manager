/** The queries behind the sync port of `procedures` (see `../system-ports.ts`): SELECT only, the listed columns, no `created_by`/`updated_by`/`deleted_by`, no `output_document_kind_codes`. */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { SyncChildAnchor } from '../../../platform/sync/sync-row-state.ts';
import type { ProcedureStageSyncSource, SyncProcedureStageProjection } from '../system-ports.ts';
import { procedureTables } from './tables.ts';

const STAGES = 'procedures.procedure_stages';
const PROCEDURES = 'procedures.procedures';

export class ProcedureStageSyncSourceService implements ProcedureStageSyncSource {
  async anchorsOf(tx: Kysely<Database>, ids: readonly string[]): Promise<ReadonlyMap<string, SyncChildAnchor>> {
    if (ids.length === 0) return new Map();
    const rows = await procedureTables(tx)
      .selectFrom(STAGES)
      .innerJoin(PROCEDURES, `${PROCEDURES}.id`, `${STAGES}.procedure_id`)
      .select([
        `${STAGES}.id as id`,
        `${STAGES}.work_order_id as workOrderId`,
        `${STAGES}.deleted_at as stageDeletedAt`,
        `${PROCEDURES}.deleted_at as procedureDeletedAt`,
      ])
      .where(`${STAGES}.id`, 'in', ids)
      .execute();
    return new Map(
      rows.map((row): [string, SyncChildAnchor] => [
        row.id,
        { workOrderId: row.workOrderId, state: row.stageDeletedAt === null && row.procedureDeletedAt === null ? 'live' : 'deleted' },
      ]),
    );
  }

  async liveOf(
    tx: Kysely<Database>,
    ids: readonly string[],
    workOrderIds: readonly string[],
  ): Promise<ReadonlyMap<string, SyncProcedureStageProjection>> {
    if (ids.length === 0 || workOrderIds.length === 0) return new Map();
    const rows = await this.#select(tx).where(`${STAGES}.id`, 'in', ids).where(`${STAGES}.work_order_id`, 'in', workOrderIds).execute();
    return new Map(rows.map((row) => [row.id, row]));
  }

  async ofOrders(tx: Kysely<Database>, workOrderIds: readonly string[]): Promise<readonly SyncProcedureStageProjection[]> {
    if (workOrderIds.length === 0) return [];
    return this.#select(tx)
      .where(`${STAGES}.work_order_id`, 'in', workOrderIds)
      .orderBy(`${STAGES}.work_order_id`)
      .orderBy(`${PROCEDURES}.position`)
      .orderBy(`${STAGES}.position`)
      .execute();
  }

  async waitingOnParties(
    tx: Kysely<Database>,
    ids: readonly string[],
  ): Promise<ReadonlyArray<{ readonly partyId: string; readonly workOrderId: string }>> {
    if (ids.length === 0) return [];
    const rows = await procedureTables(tx)
      .selectFrom(STAGES)
      .innerJoin(PROCEDURES, `${PROCEDURES}.id`, `${STAGES}.procedure_id`)
      .select([`${STAGES}.waiting_on_party_id as partyId`, `${STAGES}.work_order_id as workOrderId`])
      .$narrowType<{ partyId: string }>()
      .where(`${STAGES}.waiting_on_party_id`, 'in', ids)
      .where(`${STAGES}.deleted_at`, 'is', null)
      .where(`${PROCEDURES}.deleted_at`, 'is', null)
      .execute();
    return rows;
  }

  async responsibleUsers(
    tx: Kysely<Database>,
    ids: readonly string[],
  ): Promise<ReadonlyArray<{ readonly userId: string; readonly workOrderId: string }>> {
    if (ids.length === 0) return [];
    const rows = await procedureTables(tx)
      .selectFrom(STAGES)
      .innerJoin(PROCEDURES, `${PROCEDURES}.id`, `${STAGES}.procedure_id`)
      .select([`${STAGES}.responsible_user_id as userId`, `${STAGES}.work_order_id as workOrderId`])
      .$narrowType<{ userId: string }>()
      .where(`${STAGES}.responsible_user_id`, 'in', ids)
      .where(`${STAGES}.deleted_at`, 'is', null)
      .where(`${PROCEDURES}.deleted_at`, 'is', null)
      .execute();
    return rows;
  }

  #select(tx: Kysely<Database>) {
    return procedureTables(tx)
      .selectFrom(STAGES)
      .innerJoin(PROCEDURES, `${PROCEDURES}.id`, `${STAGES}.procedure_id`)
      .select([
        `${STAGES}.id as id`,
        `${STAGES}.version as version`,
        `${STAGES}.work_order_id as workOrderId`,
        `${PROCEDURES}.id as procedureId`,
        `${PROCEDURES}.code as procedureCode`,
        `${PROCEDURES}.name as procedureName`,
        `${STAGES}.code as code`,
        `${STAGES}.name as name`,
        `${STAGES}.position as position`,
        `${STAGES}.status as status`,
        sql<string | null>`to_char(procedures.procedure_stages.due_date, 'YYYY-MM-DD')`.as('dueDate'),
        `${STAGES}.responsible_user_id as responsibleUserId`,
        `${STAGES}.waiting_on as waitingOn`,
        `${STAGES}.waiting_on_party_id as waitingPartyId`,
        sql<string | null>`to_char(procedures.procedure_stages.waiting_since, 'YYYY-MM-DD')`.as('waitingSince'),
        `${STAGES}.blocked_reason as blockedReason`,
        `${STAGES}.started_at as startedAt`,
        sql<string | null>`to_char(procedures.procedure_stages.completed_on, 'YYYY-MM-DD')`.as('completedOn'),
      ])
      .where(`${STAGES}.deleted_at`, 'is', null)
      .where(`${PROCEDURES}.deleted_at`, 'is', null);
  }
}
