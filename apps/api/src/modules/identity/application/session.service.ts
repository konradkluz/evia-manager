/**
 * Sessions (SR-SESS-01, SR-SESS-03, SR-SESS-05; EVM-016 W2, EVM-067): turning the session cookie into a principal, the
 * current-session view, the extension of the idle time and logout. The lookup is one query by the unique token hash per
 * request. Fail closed: a missing, ambiguous or unknown cookie means no principal; a recognised cookie of a revoked
 * session, a deactivated account, or an enrolment session whose link is no longer valid (used, superseded, expired)
 * means `revoked` (401 session_revoked).
 *
 * Expiry (SR-SESS-03; ASVS V7.3.1, V7.3.2; CWE-613) applies to every state of a session — active, enrolment with a link
 * and enrolment without one. The order of the checks is fixed: revoked, then expired, and only then may the idle
 * deadline move. A session that ran out is revoked with the reason `expired` by a conditional UPDATE … RETURNING, so
 * `session.expired` is audited exactly once however many requests find it; later requests keep answering
 * `session_expired`. The idle deadline moves only through a conditional UPDATE (`revoked_at IS NULL AND idle_expires_at >
 * now AND absolute_expires_at > now`), so a session that ran out never comes back — whatever a request read earlier.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CurrentSession, SessionExpiry } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { ANONYMOUS, type Authentication, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { isExpired, slidIdleDeadline, touchDue } from '../domain/session-policy.ts';
import { deriveCsrfToken, hashToken } from '../domain/tokens.ts';
import { findSessionByTokenHash, revokeSessions, slideSession, type SessionRecord } from '../infrastructure/queries.ts';
import type { IdentityEvent } from '../events.ts';
import { identityTables } from '../infrastructure/tables.ts';
import { readSessionCookie } from '../http/session-cookie.ts';

const REVOKED: Authentication = { principal: null, reason: 'revoked' };
const EXPIRED: Authentication = { principal: null, reason: 'expired' };

type Verdict = 'valid' | 'revoked' | 'expired';

/** Does the record still grant a session at `now`? Revocation first, then expiry. */
function judge(record: SessionRecord, now: Date): Verdict {
  if (record.revokedAt !== null) return record.revokeReason === 'expired' ? 'expired' : 'revoked';
  if (!accountAllows(record, now)) return 'revoked';
  return isExpired(record, now) ? 'expired' : 'valid';
}

function accountAllows(record: SessionRecord, now: Date): boolean {
  if (record.state === 'active') return record.userStatus === 'active';
  // An enrolment session of an invitation lives as long as its link is valid (A1a). One without a link comes from a
  // password sign-in of an active account that has no second step yet (EVM-067): it has no link to depend on.
  const { link } = record;
  if (link === null) return record.userStatus === 'active';
  return record.userStatus === 'invited' && link.usedAt === null && link.supersededAt === null && link.expiresAt > now;
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

  /**
   * @param cookieHeader the raw `Cookie` header of the request (the `Authorization` header is ignored in M1)
   * @param context the request, for the audit event of a session found expired
   */
  async authenticate(cookieHeader: string | undefined, context: EventContext): Promise<Authentication> {
    const cookie = readSessionCookie(cookieHeader);
    if (cookie.kind !== 'token') return ANONYMOUS;
    const now = this.#clock.now();
    const record = await findSessionByTokenHash(identityTables(this.#db), hashToken(cookie.token));
    if (record === undefined) return ANONYMOUS;
    const verdict = judge(record, now);
    if (verdict === 'revoked') return REVOKED;
    if (verdict === 'expired') {
      if (record.revokedAt === null) await this.#expire(record, now, context);
      return EXPIRED;
    }
    const principal: Principal = {
      userId: record.userId,
      role: record.role,
      channel: record.channel,
      sessionId: record.sessionId,
      state: record.state,
      csrfToken: deriveCsrfToken(cookie.token),
      lastSeenAt: record.lastSeenAt,
      idleExpiresAt: record.idleExpiresAt,
      absoluteExpiresAt: record.absoluteExpiresAt,
    };
    return { principal, touch: () => this.#touch(principal) };
  }

  /** Activity: the idle deadline moves on, written at most every 30 seconds. A session that has just run out stays out. */
  async #touch(principal: Principal): Promise<void> {
    const now = this.#clock.now();
    if (!touchDue(principal.lastSeenAt, now)) return;
    await slideSession(identityTables(this.#db), principal.sessionId, now, slidIdleDeadline(now, principal.absoluteExpiresAt));
  }

  async #expire(record: SessionRecord, now: Date, context: EventContext): Promise<void> {
    await this.#db.transaction().execute(async (transaction) => {
      // The conditional UPDATE revokes a session once: the request that did it audits it, the others find nothing.
      const revoked = await revokeSessions(identityTables(transaction), { sessionId: record.sessionId }, 'expired', now);
      for (const sessionId of revoked) {
        const event: IdentityEvent = {
          type: 'session.expired',
          actor: { type: 'user', userId: record.userId },
          outcome: 'success',
          reasonCode: 'expired',
          objectType: 'session',
          objectId: sessionId,
        };
        await this.#events.publish(transaction, event, { ...context, sessionId });
      }
    });
  }

  /** Passive: reading the session never moves its deadlines (the warning of P-11 must not keep the session alive). */
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
      idleExpiresAt: principal.idleExpiresAt.toISOString(),
      absoluteExpiresAt: principal.absoluteExpiresAt.toISOString(),
    };
  }

  /** The idle time starts again, never beyond the absolute limit; only the session of the request (no identifier is read from the body). */
  async extend(principal: Principal): Promise<SessionExpiry> {
    const now = this.#clock.now();
    const slid = await slideSession(identityTables(this.#db), principal.sessionId, now, slidIdleDeadline(now, principal.absoluteExpiresAt));
    if (slid === undefined) throw new ProblemException('session_expired');
    return { idleExpiresAt: slid.idleExpiresAt.toISOString(), absoluteExpiresAt: slid.absoluteExpiresAt.toISOString() };
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
