/**
 * Reads a page of the audit log (SELECT only; Kysely builder with bound parameters — no `sql.raw` and no concatenation of
 * filter values, CWE-89). The page is a keyset page over `(occurred_at desc, id desc)`: stable when events share a time, with no
 * OFFSET, so a deep page costs what the first one does. One row more than the limit is read to know whether a next page exists.
 *
 * The columns are listed explicitly and are the only ones read: `session_id` and `trace_id` of the table never leave the
 * database (SR-DATA-03, P9) — what the Administrator may see is decided here, not by what the table happens to hold. The amounts of
 * the events of payments (EVM-053) are `bigint`: the driver returns text, turned into a number checked to be a safe integer.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { AuditQuery } from '../domain/audit-query.ts';
import { auditTables } from './tables.ts';

export interface AuditRow {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly outcome: 'success' | 'denied' | 'failed';
  readonly reasonCode: string | null;
  readonly objectType: string;
  readonly objectId: string | null;
  readonly ipPrefix: string | null;
  readonly amountBeforeMinor: number | null;
  readonly amountAfterMinor: number | null;
}

/** A `bigint` of the driver (text) as a number of grosze — a value that is not a safe integer is an error, never a rounded number. */
export function amountOf(value: string | null): number | null {
  if (value === null) return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new RangeError('an amount of the audit trail is not a safe integer');
  return amount;
}

/** @returns at most `query.limit + 1` rows, newest first */
export async function readAuditPage(tx: Kysely<Database>, query: AuditQuery): Promise<AuditRow[]> {
  const rows = await selectAuditPage(tx, query);
  return rows.map(({ amountBefore, amountAfter, ...row }) => ({
    ...row,
    amountBeforeMinor: amountOf(amountBefore),
    amountAfterMinor: amountOf(amountAfter),
  }));
}

function selectAuditPage(tx: Kysely<Database>, query: AuditQuery) {
  let select = auditTables(tx)
    .selectFrom('audit.events')
    .select([
      'id',
      'occurred_at as occurredAt',
      'actor_user_id as actorUserId',
      'action',
      'outcome',
      'reason_code as reasonCode',
      'object_type as objectType',
      'object_id as objectId',
      'ip_prefix as ipPrefix',
      'amount_before_minor as amountBefore',
      'amount_after_minor as amountAfter',
    ])
    .where('occurred_at', '>=', query.from)
    .where('occurred_at', '<=', query.to);
  if (query.action !== undefined) select = select.where('action', '=', query.action);
  if (query.actorUserId !== undefined) select = select.where('actor_user_id', '=', query.actorUserId);
  if (query.outcome !== undefined) select = select.where('outcome', '=', query.outcome);
  const { cursor } = query;
  if (cursor !== undefined) {
    select = select.where((eb) =>
      eb.or([eb('occurred_at', '<', cursor.occurredAt), eb.and([eb('occurred_at', '=', cursor.occurredAt), eb('id', '<', cursor.id)])]),
    );
  }
  return select
    .orderBy('occurred_at', 'desc')
    .orderBy('id', 'desc')
    .limit(query.limit + 1)
    .execute();
}
