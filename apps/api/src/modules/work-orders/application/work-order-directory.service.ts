/** The implementation of the `WorkOrderDirectory` facade (see `work-order-directory.ts`): one query in the transaction of the caller. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { CLOSED_STATUSES } from '../domain/work-order-status.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import {
  findDeletedRefs,
  findVisibleRefs,
  findVisibleTitles,
  findVisibleWorkOrderRef,
  searchVisibleIds,
} from '../infrastructure/work-order-store.ts';
import type { DeletedOrderRef, WorkOrderDirectory, WorkOrderListRef, WorkOrderRef } from '../work-order-directory.ts';

@Injectable()
export class WorkOrderDirectoryService implements WorkOrderDirectory {
  findVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<WorkOrderRef | undefined> {
    return this.#find(tx, principal, id, false);
  }

  lockVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<WorkOrderRef | undefined> {
    return this.#find(tx, principal, id, true);
  }

  titlesOf(tx: Kysely<Database>, principal: Principal, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    return findVisibleTitles(workOrderTables(tx), principal, [...new Set(ids)]);
  }

  deletedRefsOf(tx: Kysely<Database>, principal: Principal, ids: readonly string[]): Promise<ReadonlyMap<string, DeletedOrderRef>> {
    return findDeletedRefs(workOrderTables(tx), principal, [...new Set(ids)]);
  }

  searchIds(tx: Kysely<Database>, principal: Principal, term: string, limit: number): Promise<string[]> {
    return searchVisibleIds(workOrderTables(tx), principal, term, limit);
  }

  refsOf(tx: Kysely<Database>, principal: Principal, ids: readonly string[]): Promise<ReadonlyMap<string, WorkOrderListRef>> {
    return findVisibleRefs(workOrderTables(tx), principal, [...new Set(ids)]);
  }

  async #find(tx: Kysely<Database>, principal: Principal, id: string, lock: boolean): Promise<WorkOrderRef | undefined> {
    const row = await findVisibleWorkOrderRef(workOrderTables(tx), principal, id, { lock });
    return row === undefined ? undefined : { id: row.id, status: row.status, closed: CLOSED_STATUSES.includes(row.status) };
  }
}
