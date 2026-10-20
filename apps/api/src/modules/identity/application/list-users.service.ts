/**
 * The list of users for the Administrator (EVM-024 AC5, AC7; W-16; SR-AUTHZ-05, SR-API-04, SR-DATA-03). The guard has decided before this runs
 * (Administrator, web channel); here: the validated query, ONE page and the answer parsed with the schema of the contract (only the fields
 * of the contract leave — no hash, no handle, no credential).
 *
 * Two statements per page, however long it is: the accounts with their latest link (a lateral join), and the latest message of the page's
 * accounts from the outbox of the platform (`latestEmailStatus` — this module never reads that table). The cursor is bound to the operation and
 * to the user, holds the id of the last account only, and is read back to its sort key (the display name) by the reader: a user deleted
 * while the Administrator pages keeps the position; one that is gone for good is `400 invalid_cursor`.
 */
import { zUserList } from '@evia/contracts/zod';
import type { UserList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import { scopeOf, type CursorCodec } from '../../../platform/crypto/opaque-cursor.ts';
import type { Database } from '../../../platform/database/database.ts';
import { latestEmailStatus } from '../../../platform/email/email-outbox.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput } from '../../../platform/http/validation.ts';
import { CLOCK, CURSOR_CODEC, DATABASE } from '../../../platform/tokens.ts';
import { parseUserPosition, resolveUserListQuery } from '../domain/user-list-query.ts';
import { listSecondStepKinds } from '../infrastructure/access-queries.ts';
import { findDisplayName, readUserPage } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import { toUser } from './user-representation.ts';

const OPERATION = 'listUsers';
const SCOPE = scopeOf([]);

@Injectable()
export class ListUsersService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #cursors: CursorCodec;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(CLOCK) clock: Clock, @Inject(CURSOR_CODEC) cursors: CursorCodec) {
    this.#db = db;
    this.#clock = clock;
    this.#cursors = cursors;
  }

  /** @param rawQuery the query string as parsed by the framework (strings only) */
  async list(principal: Principal, rawQuery: unknown): Promise<UserList> {
    const query = parseInput(resolveUserListQuery, rawQuery);
    const db = identityTables(this.#db);
    const after = await this.#after(principal, query.cursor);

    const rows = await readUserPage(db, { limit: query.limit, after });
    const shown = rows.slice(0, query.limit);
    const last = shown.at(-1);
    const statuses = await latestEmailStatus(
      this.#db,
      shown.map((row) => row.id),
      'user_invitation',
    );
    const kinds = await listSecondStepKinds(
      db,
      shown.map((row) => row.id),
    );
    const now = this.#clock.now();
    const list = zUserList.safeParse({
      items: shown.map((row) =>
        toUser(
          row,
          row.lastLinkIssuedAt === null || row.lastLinkExpiresAt === null
            ? null
            : {
                issuedAt: row.lastLinkIssuedAt,
                expiresAt: row.lastLinkExpiresAt,
                usedAt: row.lastLinkUsedAt,
                supersededAt: row.lastLinkSupersededAt,
              },
          statuses.get(row.id),
          now,
          kinds.get(row.id) ?? [],
        ),
      ),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? this.#cursors.seal(OPERATION, { position: [last.id], scope: SCOPE, userId: principal.userId })
          : null,
    });
    if (!list.success) throw new ProblemException('internal_error');
    return list.data;
  }

  /** @throws ProblemException `invalid_cursor` — one answer for every reason: not ours, expired, other user, gone for good */
  async #after(principal: Principal, cursor: string | undefined) {
    if (cursor === undefined) return undefined;
    const parts = this.#cursors.open(OPERATION, cursor, { scope: SCOPE, userId: principal.userId });
    const id = parts === undefined ? undefined : parseUserPosition(parts);
    const displayName = id === undefined ? undefined : await findDisplayName(identityTables(this.#db), id);
    if (id === undefined || displayName === undefined) throw new ProblemException('invalid_cursor');
    return { displayName, id };
  }
}
