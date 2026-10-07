/**
 * The Administrator's view of the audit log (EVM-029 AC5, AC6; SR-LOG-03, SR-LOG-04, SR-DATA-03, P9). The guard has decided
 * before this runs (Administrator, web, step-up within 15 minutes); here: the validated query, one transaction that reads
 * the page, names the people through the `identity` facade and writes `audit.read` — the read is audited in the same
 * transaction, so a read that cannot be audited is not served (fail closed). The event carries no value of the filters.
 *
 * The response is built from a fixed list of fields and parsed with the schema of the contract: a person is `userId` and
 * `displayName` (never an e-mail address), the address only as the /24 or /48 prefix the trail stores.
 */
import { Inject, Injectable } from '@nestjs/common';
import { zAuditEventList } from '@evia/contracts/zod';
import type { AuditEventList } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput } from '../../../platform/http/validation.ts';
import { CLOCK, DATABASE } from '../../../platform/tokens.ts';
import { UserDirectory } from '../../identity/index.ts';
import { encodeCursor, resolveAuditQuery } from '../domain/audit-query.ts';
import { toAuditRecord } from '../domain/audit-record.ts';
import { readAuditPage, type AuditRow } from '../infrastructure/audit-reader.ts';
import { insertAuditRecord } from '../infrastructure/audit-store.ts';

@Injectable()
export class AuditReadService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #users: UserDirectory;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(CLOCK) clock: Clock, @Inject(UserDirectory) users: UserDirectory) {
    this.#db = db;
    this.#clock = clock;
    this.#users = users;
  }

  /** @param rawQuery the query string as parsed by the framework (strings only) */
  async list(principal: Principal, rawQuery: unknown, context: EventContext): Promise<AuditEventList> {
    const now = this.#clock.now();
    const query = parseInput(resolveAuditQuery(now), rawQuery);
    const page = await this.#db.transaction().execute(async (transaction) => {
      const rows = await readAuditPage(transaction, query);
      const shown = rows.slice(0, query.limit);
      const names = await this.#users.displayNamesOf(
        shown.flatMap((row) => (row.actorUserId === null ? [] : [row.actorUserId])),
        transaction,
      );
      const record = toAuditRecord(
        { type: 'audit.read', actor: { type: 'user', userId: principal.userId }, outcome: 'success', objectType: 'audit' },
        { ...context, sessionId: principal.sessionId },
        now,
      );
      await insertAuditRecord(transaction, record);
      return { shown, hasMore: rows.length > query.limit, names };
    });
    const last = page.shown.at(-1);
    const list = {
      items: page.shown.map((row) => toItem(row, page.names)),
      nextCursor: page.hasMore && last !== undefined ? encodeCursor({ occurredAt: last.occurredAt, id: last.id }) : null,
    };
    const checked = zAuditEventList.safeParse(list);
    if (!checked.success) throw new ProblemException('internal_error');
    return checked.data;
  }
}

function toItem(row: AuditRow, names: ReadonlyMap<string, string>) {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actor: row.actorUserId === null ? null : { userId: row.actorUserId, displayName: names.get(row.actorUserId) ?? null },
    action: row.action,
    outcome: row.outcome,
    reasonCode: row.reasonCode,
    objectType: row.objectType,
    objectId: row.objectId,
    ipPrefix: row.ipPrefix,
  };
}
