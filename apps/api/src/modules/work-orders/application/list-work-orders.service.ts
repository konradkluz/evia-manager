/**
 * The list of work orders (EVM-017; W-10). The guard has decided before this runs (the three roles, web channel); here: the
 * validated query, the opaque cursor, the mass-read check of policy P10, ONE page query and ONE batch lookup of the names of
 * the coordinators in `identity` (no N+1, AC4), and the response parsed with the schema of the contract (SR-DATA-03: only the
 * fields of the contract leave; the coordinator is `{id, displayName}`, never an e-mail address).
 *
 * Order matters: the query is validated and the cursor opened (400) BEFORE the meter is asked (429); the records returned are
 * counted AFTER the answer is built, so a refused or failed request counts nothing.
 */
import { zWorkOrderList } from '@evia/contracts/zod';
import type { WorkOrderList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { BulkReadControl } from '../../../platform/bulk-read/bulk-read-control.ts';
import { scopeOf, type CursorCodec } from '../../../platform/crypto/opaque-cursor.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput } from '../../../platform/http/validation.ts';
import { BULK_READ_CONTROL, CURSOR_CODEC, DATABASE } from '../../../platform/tokens.ts';
import { UserDirectory } from '../../identity/index.ts';
import {
  filterPartsOf,
  parsePosition,
  positionParts,
  resolveWorkOrderListQuery,
  type Position,
  type WorkOrderListQuery,
} from '../domain/work-order-list-query.ts';
import { readWorkOrderPage, type WorkOrderRow } from '../infrastructure/work-order-list-reader.ts';

/** Identifier of the operation in the contract; the cursor is bound to it. */
export const LIST_WORK_ORDERS_OPERATION = 'listWorkOrders';

@Injectable()
export class ListWorkOrdersService {
  readonly #db: Kysely<Database>;
  readonly #cursors: CursorCodec;
  readonly #bulkRead: BulkReadControl;
  readonly #users: UserDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CURSOR_CODEC) cursors: CursorCodec,
    @Inject(BULK_READ_CONTROL) bulkRead: BulkReadControl,
    @Inject(UserDirectory) users: UserDirectory,
  ) {
    this.#db = db;
    this.#cursors = cursors;
    this.#bulkRead = bulkRead;
    this.#users = users;
  }

  /** @param rawQuery the query string as parsed by the framework (strings only) */
  async list(principal: Principal, rawQuery: unknown): Promise<WorkOrderList> {
    const query = parseInput(resolveWorkOrderListQuery, rawQuery);
    const scope = scopeOf(filterPartsOf(query));
    const position = this.#positionOf(query, principal, scope);
    this.#bulkRead.before(principal.userId);

    const rows = await readWorkOrderPage(this.#db, principal, query, position);
    const shown = rows.slice(0, query.limit);
    const names = await this.#users.displayNamesOf(shown.flatMap((row) => (row.coordinatorUserId === null ? [] : [row.coordinatorUserId])));
    const last = shown.at(-1);
    const list = {
      items: shown.map((row) => toItem(row, names)),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? this.#cursors.seal(LIST_WORK_ORDERS_OPERATION, { position: positionParts(query.sort, last), scope, userId: principal.userId })
          : null,
    };
    const checked = zWorkOrderList.safeParse(list);
    if (!checked.success) throw new ProblemException('internal_error');
    this.#bulkRead.after(principal.userId, checked.data.items.length);
    return checked.data;
  }

  /** @throws ProblemException `invalid_cursor` — one answer for every reason (SR-API-01) */
  #positionOf(query: WorkOrderListQuery, principal: Principal, scope: string): Position | undefined {
    if (query.cursor === undefined) return undefined;
    const parts = this.#cursors.open(LIST_WORK_ORDERS_OPERATION, query.cursor, { scope, userId: principal.userId });
    const position = parts === undefined ? undefined : parsePosition(query.sort, parts);
    if (position === undefined) throw new ProblemException('invalid_cursor');
    return position;
  }
}

function toItem(row: WorkOrderRow, names: ReadonlyMap<string, string>) {
  const displayName = row.coordinatorUserId === null ? undefined : names.get(row.coordinatorUserId);
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    coordinator: row.coordinatorUserId === null || displayName === undefined ? null : { id: row.coordinatorUserId, displayName },
    createdAt: row.createdAt.toISOString(),
  };
}
