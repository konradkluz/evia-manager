/**
 * The deleted processes and stages of a work order for the section "Usunięte procesy i etapy" of W-06 (EVM-042 AC3, AC6; SR-AUTHZ-02,
 * SR-AUTHZ-05, SR-DATA-03, SR-API-02, CWE-639, CWE-770). The guard has decided before this runs: a signed-in ADMINISTRATOR on the web
 * channel — the Editor and Read-only get 403 before the existence of the order is looked at. First of all the order is resolved
 * through the facade of `work-orders`, i.e. with the read policy IN THE QUERY: an order that does not exist and one that is deleted
 * are the same `404 not_found`, also for the Administrator. Then the deleted processes and stages of THAT order are read (the anchor
 * is in the condition of the query), in one snapshot, newest first, at most 100 of each kind — a loop of "add, delete" cannot make
 * the answer grow without a bound; `truncated` says that older ones exist. The answer is only what the row with "Przywróć" needs:
 * ids, names, places, versions and the day of the deletion — no person, day of the deadline, note or reason of a block. A read is not
 * an audited event; nothing here logs a name.
 */
import { zDeletedProcedureList, zListDeletedWorkOrderProceduresPath } from '@evia/contracts/zod';
import type { DeletedProcedureList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { DATABASE } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { listDeletedProcedures, listDeletedStages } from '../infrastructure/manual-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';

/** The most deleted objects of each kind in an answer (the contract says `maxItems: 100`). */
export const DELETED_LIST_LIMIT = 100;

const pathSchema = strictObjects(zListDeletedWorkOrderProceduresPath);

@Injectable()
export class ListDeletedService {
  readonly #db: Kysely<Database>;
  readonly #orders: WorkOrderDirectory;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory) {
    this.#db = db;
    this.#orders = orders;
  }

  /** @param rawParams the path parameters as parsed by the framework */
  async list(principal: Principal, rawParams: unknown): Promise<DeletedProcedureList> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    return runInTransaction(
      this.#db,
      async (tx) => {
        const order = await this.#orders.findVisible(tx, principal, workOrderId);
        if (order === undefined) throw new ProblemException('not_found');
        const tables = procedureTables(tx);
        // one more than is shown tells that the list is cut
        const procedures = await listDeletedProcedures(tables, order.id, DELETED_LIST_LIMIT + 1);
        const stages = await listDeletedStages(tables, order.id, DELETED_LIST_LIMIT + 1);
        const answer = zDeletedProcedureList.safeParse({
          procedures: procedures.slice(0, DELETED_LIST_LIMIT).map((row) => ({
            id: row.id,
            code: row.code,
            name: row.name,
            position: row.position,
            stageCount: row.stage_count,
            version: row.version,
            deletedAt: row.deleted_at.toISOString(),
          })),
          stages: stages.slice(0, DELETED_LIST_LIMIT).map((row) => ({
            id: row.id,
            procedureId: row.procedure_id,
            procedureName: row.procedure_name,
            name: row.name,
            position: row.position,
            procedureDeleted: row.procedure_deleted,
            version: row.version,
            deletedAt: row.deleted_at.toISOString(),
          })),
          truncated: procedures.length > DELETED_LIST_LIMIT || stages.length > DELETED_LIST_LIMIT,
        });
        // the answer is parsed with the schema of the contract: a mismatch is a defect of the server, never data
        if (!answer.success) throw new ProblemException('internal_error');
        return answer.data;
      },
      { isolationLevel: 'repeatable read' },
    );
  }
}
