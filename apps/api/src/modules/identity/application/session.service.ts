/**
 * Sessions (SR-SESS-01, SR-SESS-05; EVM-016 W2): turning the session cookie into a principal, the current-session view
 * and logout. The lookup is one query by the unique token hash per request. Fail closed: a missing, ambiguous or unknown
 * cookie means no principal; a recognised cookie of a revoked session, a deactivated account, or an enrolment session
 * whose link is no longer valid (used, superseded, expired) means `revoked` (401 session_revoked). Idle and absolute
 * expiry of active sessions are enforced by EVM-067 (decision D4).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CurrentSession } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { ANONYMOUS, type Authentication, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { deriveCsrfToken, hashToken } from '../domain/tokens.ts';
import { findSessionByTokenHash, revokeSessions, type SessionRecord } from '../infrastructure/queries.ts';
import type { IdentityEvent } from '../events.ts';
import { identityTables } from '../infrastructure/tables.ts';
import { readSessionCookie } from '../http/session-cookie.ts';

const REVOKED: Authentication = { principal: null, reason: 'revoked' };

/** Does the record still grant a session at `now`? */
function stillValid(record: SessionRecord, now: Date): boolean {
  if (record.revokedAt !== null) return false;
  if (record.state === 'active') return record.userStatus === 'active';
  // An enrolment session lives exactly as long as its link is valid (A1a).
  const { link } = record;
  return record.userStatus === 'invited' && link !== null && link.usedAt === null && link.supersededAt === null && link.expiresAt > now;
}

@Injectable()
export class SessionService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(CLOCK) clock: Clock, @Inject(EVENT_BUS) events: EventBus) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
  }

  /** @param cookieHeader the raw `Cookie` header of the request (the `Authorization` header is ignored in M1) */
  async authenticate(cookieHeader: string | undefined): Promise<Authentication> {
    const cookie = readSessionCookie(cookieHeader);
    if (cookie.kind !== 'token') return ANONYMOUS;
    const record = await findSessionByTokenHash(identityTables(this.#db), hashToken(cookie.token));
    if (record === undefined) return ANONYMOUS;
    if (!stillValid(record, this.#clock.now())) return REVOKED;
    return {
      principal: {
        userId: record.userId,
        role: record.role,
        channel: record.channel,
        sessionId: record.sessionId,
        state: record.state,
        csrfToken: deriveCsrfToken(cookie.token),
      },
    };
  }

  async current(principal: Principal): Promise<CurrentSession> {
    const user = await identityTables(this.#db)
      .selectFrom('identity.users')
      .select(['id', 'display_name'])
      .where('id', '=', principal.userId)
      .executeTakeFirstOrThrow();
    return {
      user: { id: user.id, displayName: user.display_name, role: principal.role },
      state: principal.state,
      channel: principal.channel,
      csrfToken: principal.csrfToken,
    };
  }

  /** Revokes the session in the database; the audit event is written in the same transaction. */
  async logout(principal: Principal, context: EventContext): Promise<void> {
    const now = this.#clock.now();
    await this.#db.transaction().execute(async (transaction) => {
      const revoked = await revokeSessions(identityTables(transaction), { sessionId: principal.sessionId }, 'logout', now);
      if (revoked.length === 0) throw new ProblemException('session_revoked');
      const event: IdentityEvent = {
        type: 'session.revoked',
        actor: { type: 'user', userId: principal.userId },
        outcome: 'success',
        reasonCode: 'logout',
        objectType: 'session',
        objectId: principal.sessionId,
      };
      await this.#events.publish(transaction, event, { ...context, sessionId: principal.sessionId });
    });
  }
}
