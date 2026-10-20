/**
 * The limit of five sessions of the web channel (EVM-028 AC6; SR-SESS-04; K8): called by everything that makes an `active` session of an account — the end of
 * the second step of a sign-in, the end of an enrolment — in the transaction of that, right BEFORE the insert. Never after the first step (a password alone
 * makes no `active` session, so a person who knows only the password cannot push the owner's sessions out — Z5).
 *
 * One advisory lock per account serialises the starts: of three parallel sign-ins with four sessions open, the second sees the first's session and so on, and
 * the account never ends with more than five. The sessions that count are the alive ones (not revoked, not past a deadline) in state `active` of the web
 * channel; the oldest by start go first. Each ended session is audited (`session.revoked`, reason `session_limit`) and the owner gets ONE e-mail 8 for the
 * sign-in (the text is composed from the rows by the worker — nothing of the sessions is in the outbox).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { enqueueEmail } from '../../../platform/email/email-outbox.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { MAX_WEB_SESSIONS } from '../domain/constants.ts';
import { sessionsToEnd } from '../domain/session-limit.ts';
import type { IdentityEvent } from '../events.ts';
import { listOpenWebSessions, lockSessionStarts, revokeOwnSession } from '../infrastructure/account-queries.ts';
import { identityTables } from '../infrastructure/tables.ts';

export async function enforceSessionLimit(
  transaction: Kysely<Database>,
  events: EventBus,
  request: { readonly userId: string; readonly now: Date; readonly context: EventContext },
): Promise<void> {
  const { userId, now, context } = request;
  const db = identityTables(transaction);
  await lockSessionStarts(db, userId);
  const open = await listOpenWebSessions(db, userId, now);
  let ended = 0;
  for (const sessionId of sessionsToEnd(
    open.map((session) => session.id),
    MAX_WEB_SESSIONS,
  )) {
    if (!(await revokeOwnSession(db, userId, sessionId, 'session_limit', now))) continue;
    ended += 1;
    const event: IdentityEvent = {
      type: 'session.revoked',
      actor: { type: 'user', userId },
      outcome: 'success',
      reasonCode: 'session_limit',
      objectType: 'session',
      objectId: sessionId,
    };
    await events.publish(transaction, event, { ...context, sessionId });
  }
  if (ended > 0) await enqueueEmail(transaction, { kind: 'session_limit', variant: null, recipientUserId: userId, now });
}
