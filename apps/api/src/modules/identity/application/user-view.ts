/**
 * The representation of ONE account after a change (EVM-027; also the answer of an invitation and of a resend): the account, its latest link, the
 * latest invitation message of the outbox and the kinds of its active second steps — read in the transaction of the change, so the answer shows the
 * state the change left, and parsed with the schema of the contract (only the fields of the contract leave — SR-DATA-03).
 */
import { zUser } from '@evia/contracts/zod';
import type { User } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { latestEmailStatus } from '../../../platform/email/email-outbox.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { listSecondStepKinds } from '../infrastructure/access-queries.ts';
import { findLatestLink, type UserRow } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import { toUser } from './user-representation.ts';

export async function representUser(tx: Kysely<Database>, row: UserRow, now: Date): Promise<User> {
  const db = identityTables(tx);
  const link = await findLatestLink(db, row.id);
  const status = (await latestEmailStatus(tx, [row.id], 'user_invitation')).get(row.id);
  const kinds = (await listSecondStepKinds(db, [row.id])).get(row.id) ?? [];
  const parsed = zUser.safeParse(
    toUser(
      row,
      link === undefined
        ? null
        : { issuedAt: link.issued_at, expiresAt: link.expires_at, usedAt: link.used_at, supersededAt: link.superseded_at },
      status,
      now,
      kinds,
    ),
  );
  if (!parsed.success) throw new ProblemException('internal_error');
  return parsed.data;
}
