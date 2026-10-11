/** The implementation of the `ProcedureStageDirectory` facade (see `stage-directory.ts`): one query in the transaction of the caller. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { findActiveStageId, findStageNames } from '../infrastructure/procedure-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';
import type { ProcedureStageDirectory } from '../stage-directory.ts';

@Injectable()
export class ProcedureStageDirectoryService implements ProcedureStageDirectory {
  async existsInOrder(
    tx: Kysely<Database>,
    workOrderId: string,
    stageId: string,
    options: { readonly lock?: boolean } = {},
  ): Promise<boolean> {
    return (await findActiveStageId(procedureTables(tx), workOrderId, stageId, options.lock === true)) !== undefined;
  }

  async namesOf(tx: Kysely<Database>, workOrderId: string, stageIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const distinct = [...new Set(stageIds)];
    if (distinct.length === 0) return new Map();
    const rows = await findStageNames(procedureTables(tx), workOrderId, distinct);
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
