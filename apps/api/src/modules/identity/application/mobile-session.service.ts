/**
 * The session of the phone on every request (EVM-094 AC1, AC4, AC7, AC8; SR-SESS-09, SR-AUTHZ-12; ASVS V7.2.x): turning `Authorization: Bearer` into a
 * principal, and the logout of the device. The header is parsed strictly BEFORE the database is asked (one space, `Bearer`, the whole shape of a token). The
 * validity is never read from the token's own row: the session (not revoked, within its deadlines), the account (active) and the device (in use) are read
 * with it in one query, so a logout, a reset of the password or MFA, a deactivation or a wipe ends the token at once.
 *
 * Fail closed, in a fixed order: a device ordered to wipe → `device_wipe_required` (before everything, a revoked session included); a revoked session, an
 * account that is not active, a device that is wiped or removed, a session past a deadline → `session_revoked`; only a token that has simply run out of its
 * 15 minutes → `unauthenticated` (the app refreshes). The user, the role and the device of the principal come from the session — never from the request.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { ANONYMOUS, type Authentication, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { parseBearer } from '../domain/mobile-tokens.ts';
import { touchDue } from '../domain/session-policy.ts';
import { hashToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { proveDeviceSecret, touchDevice } from '../infrastructure/device-queries.ts';
import {
  expireAccessTokens,
  findAccessContext,
  revokeMobileSession,
  touchMobileSession,
  type AccessContext,
} from '../infrastructure/mobile-token-queries.ts';
import { identityTables } from '../infrastructure/tables.ts';

const REVOKED: Authentication = { principal: null, reason: 'revoked' };
const WIPE_REQUIRED: Authentication = { principal: null, reason: 'wipe_required' };

@Injectable()
export class MobileSessionService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(CLOCK) clock: Clock, @Inject(EVENT_BUS) events: EventBus) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
  }

  /** @param authorization the raw `Authorization` header of the request */
  async authenticate(authorization: string | undefined): Promise<Authentication> {
    const token = parseBearer(authorization);
    if (token === undefined) return ANONYMOUS;
    const now = this.#clock.now();
    const record = await findAccessContext(identityTables(this.#db), hashToken(token));
    if (record?.channel !== 'mobile') return ANONYMOUS;
    if (record.deviceState === 'wipe_required') return WIPE_REQUIRED;
    if (!this.#sessionUsable(record, now)) return REVOKED;
    if (record.tokenExpiresAt <= now) return ANONYMOUS;
    const principal: Principal = {
      userId: record.userId,
      role: record.role,
      channel: 'mobile',
      sessionId: record.sessionId,
      state: 'active',
      // The Bearer token is no ambient credential: there is no CSRF token to expect (the guard exempts the mobile channel by the manifest).
      csrfToken: '',
      passkeyAuthenticatedAt: null,
      totpAuthenticatedAt: record.totpAuthenticatedAt,
      lastSeenAt: record.lastSeenAt,
      idleExpiresAt: record.idleExpiresAt,
      absoluteExpiresAt: record.absoluteExpiresAt,
      ...(record.deviceId === null ? {} : { deviceId: record.deviceId }),
    };
    return { principal, touch: () => this.#touch(record) };
  }

  #sessionUsable(record: AccessContext, now: Date): boolean {
    return (
      record.revokedAt === null &&
      record.userStatus === 'active' &&
      !record.userDeleted &&
      record.deviceId !== null &&
      record.deviceState === 'active' &&
      !record.deviceRemoved &&
      record.idleExpiresAt > now &&
      record.absoluteExpiresAt > now
    );
  }

  /**
   * Activity: the contact of the device and the session is written at most every 30 seconds; the proof of the newest installation secret is a conditional
   * UPDATE that writes only once (the first request with the tokens of the newest sign-in). Not a write per request.
   */
  async #touch(record: AccessContext): Promise<void> {
    if (record.deviceId === null) return;
    const now = this.#clock.now();
    const db = identityTables(this.#db);
    if (!record.secretProven) await proveDeviceSecret(db, record.deviceId);
    if (!touchDue(record.deviceLastContactAt ?? record.lastSeenAt, now)) return;
    await touchDevice(db, record.deviceId, now);
    await touchMobileSession(db, record.sessionId, now);
  }

  /** Ends the session of the request — only that one: the device and the user come from the principal, nothing from the request. */
  async logout(principal: Principal, context: EventContext): Promise<void> {
    const now = this.#clock.now();
    await runInTransaction(this.#db, async (transaction) => {
      const db = identityTables(transaction);
      if (!(await revokeMobileSession(db, principal.sessionId, 'logout', now))) throw new ProblemException('session_revoked');
      await expireAccessTokens(db, principal.sessionId, now);
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
