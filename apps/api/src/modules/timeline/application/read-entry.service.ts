/**
 * One entry of the journal (EVM-037 AC7, AC8; SR-AUTHZ-02, SR-AUTHZ-05, CWE-639). The guard has decided before this runs. The order
 * is resolved first through the facade of `work-orders` (read policy in the query); then the entry is read with `id` AND
 * `work_order_id` in ONE condition: an entry of another order, one that does not exist, a deleted one and an entry of an order that
 * does not exist or is deleted are the same `404 not_found` for every role - except that the Administrator reads an entry that is soft
 * deleted (EVM-040 AC1). The answer carries the version of the entry for the `ETag`.
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
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { findEntry, findEntryAnyState } from '../infrastructure/timeline-store.ts';
import { EntryPresenter } from './entry-page.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

const pathSchema = strictObjects(zGetTimelineEntryPath);

/** The entry with the version it was read at: the `ETag` of the answer (the `If-Match` of a deletion, a restoration and a redaction). */
export interface ReadEntry {
  readonly entry: TimelineEntry;
  readonly version: number;
}

@Injectable()
export class ReadEntryService {
  readonly #db: Kysely<Database>;
  readonly #orders: WorkOrderDirectory;
  readonly #presenter: EntryPresenter;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(EntryPresenter) presenter: EntryPresenter,
  ) {
    this.#db = db;
    this.#orders = orders;
    this.#presenter = presenter;
  }

  /** @param rawParams the path parameters as parsed by the framework */
  async get(principal: Principal, rawParams: unknown): Promise<ReadEntry> {
    const { workOrderId, entryId } = parseInput(pathSchema, rawParams) as { workOrderId: string; entryId: string };
    return runInTransaction(
      this.#db,
      async (tx) => {
        const order = await this.#orders.findVisible(tx, principal, workOrderId);
        if (order === undefined) throw new ProblemException('not_found');
        // the Administrator reads a deleted entry too (EVM-040 AC1); for the other roles it does not exist
        const tables = timelineTables(tx);
        const row =
          principal.role === 'administrator'
            ? await findEntryAnyState(tables, order.id, entryId)
            : await findEntry(tables, order.id, entryId);
        if (row === undefined) throw new ProblemException('not_found');
        return { entry: await this.#presenter.entry(tx, principal, order.id, row), version: row.version };
      },
      { isolationLevel: 'repeatable read' },
    );
  }
}
