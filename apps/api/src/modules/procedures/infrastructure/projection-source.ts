/** The queries behind the system port of `procedures` for the read model (see `../system-ports.ts`): SELECT only, bound parameters. */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { ProcedureProjectionSource, UnfinishedStageRow } from '../system-ports.ts';
import { procedureTables } from './tables.ts';

const STAGES = 'procedures.procedure_stages';
const PROCEDURES = 'procedures.procedures';

export class ProcedureProjectionSourceService implements ProcedureProjectionSource {
  async unfinishedStagesOf(tx: Kysely<Database>, workOrderIds: readonly string[]): Promise<readonly UnfinishedStageRow[]> {
    if (workOrderIds.length === 0) return [];
    const rows = await procedureTables(tx)
      .selectFrom(STAGES)
      .innerJoin(PROCEDURES, (join) =>
        join.onRef(`${PROCEDURES}.id`, '=', `${STAGES}.procedure_id`).onRef(`${PROCEDURES}.work_order_id`, '=', `${STAGES}.work_order_id`),
      )
      .select([
        `${STAGES}.id as stageId`,
        `${STAGES}.work_order_id as workOrderId`,
        `${PROCEDURES}.position as procedurePosition`,
        `${STAGES}.position as stagePosition`,
        `${STAGES}.status as status`,
        `${STAGES}.waiting_on as waitingOn`,
        `${STAGES}.waiting_on_party_id as waitingOnPartyId`,
        sql<string | null>`to_char(${sql.ref('procedures.procedure_stages.waiting_since')}, 'YYYY-MM-DD')`.as('waitingSince'),
        sql<string | null>`to_char(${sql.ref('procedures.procedure_stages.due_date')}, 'YYYY-MM-DD')`.as('dueDate'),
      ])
      .where(`${STAGES}.work_order_id`, 'in', workOrderIds)
      .where(`${STAGES}.deleted_at`, 'is', null)
      .where(`${PROCEDURES}.deleted_at`, 'is', null)
      .where(`${STAGES}.status`, 'in', ['todo', 'in_progress', 'waiting', 'blocked'])
      .execute();
    return rows as UnfinishedStageRow[];
  }

  async workOrderIdsOfStages(tx: Kysely<Database>, stageIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (stageIds.length === 0) return new Map();
    const rows = await procedureTables(tx).selectFrom(STAGES).select(['id', 'work_order_id']).where('id', 'in', stageIds).execute();
    return new Map(rows.map((row) => [row.id, row.work_order_id]));
  }
}
