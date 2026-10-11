/**
 * One entry of the journal (EVM-037 AC7, AC8; SR-AUTHZ-02, SR-AUTHZ-05, CWE-639). The guard has decided before this runs. The order
 * is resolved first through the facade of `work-orders` (read policy in the query); then the entry is read with `id` AND
 * `work_order_id` in ONE condition: an entry of another order, one that does not exist, a deleted one and an entry of an order that
 * does not exist or is deleted are the same `404 not_found` for every role.
 */
import { zGetTimelineEntryPath } from '@evia/contracts/zod';
import type { TimelineEntry } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { DATABASE } from '../../../platform/tokens.ts';
import { UserDirectory } from '../../identity/index.ts';
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../procedures/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { findEntry } from '../infrastructure/timeline-store.ts';
import { presentEntry } from './entry-page.ts';

const pathSchema = strictObjects(zGetTimelineEntryPath);

@Injectable()
export class ReadEntryService {
  readonly #db: Kysely<Database>;
  readonly #orders: WorkOrderDirectory;
  readonly #stages: ProcedureStageDirectory;
  readonly #users: UserDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(PROCEDURE_STAGE_DIRECTORY) stages: ProcedureStageDirectory,
    @Inject(UserDirectory) users: UserDirectory,
  ) {
    this.#db = db;
    this.#orders = orders;
    this.#stages = stages;
    this.#users = users;
  }

  /** @param rawParams the path parameters as parsed by the framework */
  async get(principal: Principal, rawParams: unknown): Promise<TimelineEntry> {
    const { workOrderId, entryId } = parseInput(pathSchema, rawParams) as { workOrderId: string; entryId: string };
    return this.#db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (tx) => {
        const order = await this.#orders.findVisible(tx, principal, workOrderId);
        if (order === undefined) throw new ProblemException('not_found');
        const row = await findEntry(timelineTables(tx), order.id, entryId);
        if (row === undefined) throw new ProblemException('not_found');
        return presentEntry({ users: this.#users, stages: this.#stages }, tx, order.id, row);
      });
  }
}
