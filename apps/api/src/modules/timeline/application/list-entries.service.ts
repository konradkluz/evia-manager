/**
 * The journal of an order for W-08 (EVM-037 AC6; SR-AUTHZ-02, SR-AUTHZ-05, SR-DATA-03, SR-API-02, SR-API-04). The guard has decided
 * before this runs (three roles, web channel). The path and the query are validated and the cursor opened (400) BEFORE the database
 * is asked — all of it depends on the request only. Then, in one snapshot: the order is resolved through the facade of `work-orders`
 * with the read policy IN THE QUERY (missing and deleted are the same `404 not_found` for every role), and only then the entries of
 * THAT order are read with the filters as conditions of the query (not a filter of the page afterwards). The names of the authors
 * and of the stages and the corrections come in batches — the number of queries is constant. The cursor is opaque, bound to the
 * operation, the order, the user and the filters; the answer is parsed with the schema of the contract. A read is not an audited
 * event; nothing here logs a text or a name.
 */
import { zListTimelineEntriesPath } from '@evia/contracts/zod';
import type { TimelineEntryList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { scopeOf, type CursorCodec } from '../../../platform/crypto/opaque-cursor.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { CURSOR_CODEC, DATABASE } from '../../../platform/tokens.ts';
import { UserDirectory } from '../../identity/index.ts';
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../procedures/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { filterPartsOf, parsePosition, positionParts, resolveTimelineListQuery } from '../domain/timeline-list-query.ts';
import { timelineTables } from '../infrastructure/tables.ts';
import { listEntries } from '../infrastructure/timeline-store.ts';
import { presentPage } from './entry-page.ts';

/** Identifier of the operation in the contract; the cursor is bound to it. */
export const LIST_TIMELINE_OPERATION = 'listTimelineEntries';

const pathSchema = strictObjects(zListTimelineEntriesPath);

@Injectable()
export class ListEntriesService {
  readonly #db: Kysely<Database>;
  readonly #cursors: CursorCodec;
  readonly #orders: WorkOrderDirectory;
  readonly #stages: ProcedureStageDirectory;
  readonly #users: UserDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CURSOR_CODEC) cursors: CursorCodec,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(PROCEDURE_STAGE_DIRECTORY) stages: ProcedureStageDirectory,
    @Inject(UserDirectory) users: UserDirectory,
  ) {
    this.#db = db;
    this.#cursors = cursors;
    this.#orders = orders;
    this.#stages = stages;
    this.#users = users;
  }

  /** @param rawParams the path parameters as parsed by the framework; @param rawQuery the query string (strings only) */
  async list(principal: Principal, rawParams: unknown, rawQuery: unknown): Promise<TimelineEntryList> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const query = parseInput(resolveTimelineListQuery, rawQuery);
    const scope = scopeOf(filterPartsOf(workOrderId, query));
    const position = this.#positionOf(query.cursor, principal, scope);

    return this.#db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (tx) => {
        const order = await this.#orders.findVisible(tx, principal, workOrderId);
        if (order === undefined) throw new ProblemException('not_found');
        const rows = await listEntries(
          timelineTables(tx),
          order.id,
          { kind: query.kind, procedureStageId: query.procedureStageId },
          position,
          query.limit,
        );
        const shown = rows.slice(0, query.limit);
        const last = shown.at(-1);
        const nextCursor =
          rows.length > query.limit && last !== undefined
            ? this.#cursors.seal(LIST_TIMELINE_OPERATION, { position: positionParts(last), scope, userId: principal.userId })
            : null;
        return presentPage({ users: this.#users, stages: this.#stages }, tx, order.id, shown, nextCursor);
      });
  }

  /** @throws ProblemException `invalid_cursor` — one answer for every reason (SR-API-01) */
  #positionOf(cursor: string | undefined, principal: Principal, scope: string) {
    if (cursor === undefined) return undefined;
    const parts = this.#cursors.open(LIST_TIMELINE_OPERATION, cursor, { scope, userId: principal.userId });
    const position = parts === undefined ? undefined : parsePosition(parts);
    if (position === undefined) throw new ProblemException('invalid_cursor');
    return position;
  }
}
