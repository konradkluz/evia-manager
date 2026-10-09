/** The implementation of the `WorkOrderDirectory` facade (see `work-order-directory.ts`): one query in the transaction of the caller. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { CLOSED_STATUSES } from '../domain/work-order-list-query.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import { findVisibleWorkOrderRef } from '../infrastructure/work-order-store.ts';
import type { WorkOrderDirectory, WorkOrderRef } from '../work-order-directory.ts';

@Injectable()
export class WorkOrderDirectoryService implements WorkOrderDirectory {
  findVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<WorkOrderRef | undefined> {
    return this.#find(tx, principal, id, false);
  }

  lockVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<WorkOrderRef | undefined> {
    return this.#find(tx, principal, id, true);
  }

  async #find(tx: Kysely<Database>, principal: Principal, id: string, lock: boolean): Promise<WorkOrderRef | undefined> {
    const row = await findVisibleWorkOrderRef(workOrderTables(tx), principal, id, { lock });
    return row === undefined ? undefined : { id: row.id, status: row.status, closed: CLOSED_STATUSES.includes(row.status) };
  }
}
