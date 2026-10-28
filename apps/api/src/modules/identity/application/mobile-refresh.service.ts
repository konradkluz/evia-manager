/**
 * Renewal of the tokens of a phone (EVM-094 AC4, AC6, AC7; SR-SESS-09; ASVS V7.2.x; CWE-362, CWE-613). The token of refresh is used once. One transaction
 * with the row of the token and then of the session locked, so two requests with one token queue and the second sees what the first did:
 *
 * - a token never used and not superseded → the session moves on, a NEW pair is issued, this token is spent, and if it succeeds another token its siblings are
 *   invalidated (the first successor used wins);
 * - a token already spent that is the DIRECT predecessor of the newest, within 30 seconds and with no successor used yet → another pair is issued (the answer
 *   was lost in a garage);
 * - every other spent or superseded token (an older one, the predecessor after the 30 seconds or once a successor was used) is a REUSE: the session ends
 *   (reason `refresh_reuse`; the device stays registered, the queue of the phone stays — it must sign in again), the audit says so and the Administrators get
 *   ONE alert (the end of the session is a conditional UPDATE, so a replay of an already ended family sends nothing more);
 * - an unknown, expired or revoked token is the one answer `401 session_revoked` — except that a device ordered to wipe ALWAYS gets `device_wipe_required`
 *   (the record decides, even when the token was spent or revoked). The state of the session, of the account and of the device is read on every call.
 *
 * Finding the token is a lookup of its SHA-256 through a unique index (nothing is compared in a loop); the 256 bits of the token make the comparison one of equal
 * hashes, so there is no secret-dependent branch to time.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { enqueueEmail } from '../../../platform/email/email-outbox.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import type { ClientVersion } from '../domain/client-version.ts';
import { channelAllowedForRole } from '../domain/channel-rules.ts';
import { MOBILE_IDLE_MS, REFRESH_REUSE_WINDOW_MS } from '../domain/constants.ts';
import { isRefreshToken } from '../domain/mobile-tokens.ts';
import { hashToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { proveDeviceSecret, touchDevice } from '../infrastructure/device-queries.ts';
import {
  expireAccessTokens,
  lockRefreshSession,
  lockRefreshToken,
  markRefreshUsed,
  revokeMobileSession,
  slideMobileSession,
  successorsOf,
  supersedeSiblings,
  type RefreshRecord,
  type RefreshSession,
} from '../infrastructure/mobile-token-queries.ts';
import { findUserById, listActiveAdministratorIds } from '../infrastructure/queries.ts';
import { identityTables, type IdentityDb } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';
import { problemOf } from './login-attempt.ts';
import { issueTokenPair, type IssuedTokens } from './mobile-session.ts';

export interface RefreshedSession extends IssuedTokens {
  readonly deviceId: string;
  readonly user: { readonly id: string; readonly displayName: string; readonly role: 'administrator' | 'editor' | 'read_only' };
  readonly serverTime: Date;
}

type Refusal = { readonly refusal: 'session_revoked' | 'device_wipe_required' };
const REVOKED: Refusal = { refusal: 'session_revoked' };

@Injectable()
export class MobileRefreshService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(CLOCK) clock: Clock, @Inject(EVENT_BUS) events: EventBus) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
  }

  async refresh(refreshToken: string, version: ClientVersion, client: ClientInfo): Promise<RefreshedSession> {
    // A value that cannot be one of our tokens never reaches the database: the same answer as an unknown token.
    if (!isRefreshToken(refreshToken)) throw problemOf(REVOKED);
    const now = this.#clock.now();
    const outcome = await runInTransaction(this.#db, (transaction) =>
      this.#refreshInTransaction(transaction, refreshToken, version, client, now),
    );
    // After the commit: the end of the session, its audit rows and the alert of a reuse stay.
    if ('refusal' in outcome) throw problemOf(outcome);
    return outcome;
  }

  async #refreshInTransaction(
    transaction: Kysely<Database>,
    refreshToken: string,
    version: ClientVersion,
    client: ClientInfo,
    now: Date,
  ): Promise<RefreshedSession | Refusal> {
    const db = identityTables(transaction);
    const token = await lockRefreshToken(db, hashToken(refreshToken));
    if (token === undefined) return REVOKED;
    const session = await lockRefreshSession(db, token.sessionId);
    if (session === undefined) return REVOKED;
    // The wipe has precedence over everything, a spent or revoked token included.
    if (session.deviceState === 'wipe_required') return { refusal: 'device_wipe_required' };
    if (!this.#sessionUsable(session, now) || session.deviceId === null) return REVOKED;
    if (token.expiresAt <= now) return REVOKED;

    const standing = this.#standing(token);
    if (standing === 'reuse' || (standing === 'window' && !(await this.#windowOpen(db, token, now)))) {
      await this.#endOnReuse(transaction, session, client, now);
      return REVOKED;
    }

    const absoluteExpiresAt = session.absoluteExpiresAt;
    const issued = await issueTokenPair(transaction, { sessionId: session.sessionId, parentId: token.id, now, absoluteExpiresAt });
    if (token.usedAt === null) {
      await markRefreshUsed(db, token.id, now);
      // The first successor used invalidates its siblings.
      if (token.parentId !== null) await supersedeSiblings(db, token.parentId, token.id, now);
    }
    await slideMobileSession(db, session.sessionId, now, new Date(Math.min(now.getTime() + MOBILE_IDLE_MS, absoluteExpiresAt.getTime())));
    // A refresh with the tokens of the newest sign-in proves the newest installation secret (the previous one stops working).
    await proveDeviceSecret(db, session.deviceId);
    await touchDevice(db, session.deviceId, now, version.version);
    const user = await findUserById(db, session.userId);
    if (user === undefined) return REVOKED;
    return {
      accessToken: issued.accessToken,
      accessTokenExpiresAt: issued.accessTokenExpiresAt,
      refreshToken: issued.refreshToken,
      refreshTokenExpiresAt: issued.refreshTokenExpiresAt,
      deviceId: session.deviceId,
      user: { id: user.id, displayName: user.displayName, role: user.role },
      serverTime: now,
    };
  }

  /** The session, the account and the device still allow it (rechecked on every call, SR-SESS-09, SR-AUTHZ-12). */
  #sessionUsable(session: RefreshSession, now: Date): boolean {
    return (
      session.revokedAt === null &&
      session.userStatus === 'active' &&
      !session.userDeleted &&
      session.deviceState === 'active' &&
      !session.deviceRemoved &&
      session.idleExpiresAt > now &&
      session.absoluteExpiresAt > now &&
      channelAllowedForRole(session.role, 'mobile')
    );
  }

  /**
   * `fresh`: never used. `window`: used, not superseded — it MAY be the predecessor of the newest (decided by its age and its successors). `reuse`: it was
   * superseded (a sibling won), which no honest phone presents.
   */
  #standing(token: RefreshRecord): 'fresh' | 'window' | 'reuse' {
    if (token.supersededAt !== null) return 'reuse';
    return token.usedAt === null ? 'fresh' : 'window';
  }

  /** Within 30 seconds of its use, and no successor of it has been used yet. */
  async #windowOpen(db: IdentityDb, token: RefreshRecord, now: Date): Promise<boolean> {
    if (token.usedAt === null || now.getTime() - token.usedAt.getTime() > REFRESH_REUSE_WINDOW_MS) return false;
    return (await successorsOf(db, token.id)).used === 0;
  }

  async #endOnReuse(transaction: Kysely<Database>, session: RefreshSession, client: ClientInfo, now: Date): Promise<void> {
    const db = identityTables(transaction);
    // A conditional UPDATE ends the session once: only the request that did it audits and alerts; a replay of an ended family finds nothing.
    if (!(await revokeMobileSession(db, session.sessionId, 'refresh_reuse', now))) return;
    await expireAccessTokens(db, session.sessionId, now);
    const event: IdentityEvent = {
      type: 'session.revoked',
      actor: { type: 'user', userId: session.userId },
      outcome: 'denied',
      reasonCode: 'refresh_reuse',
      objectType: 'session',
      objectId: session.sessionId,
    };
    await this.#events.publish(transaction, event, { ...client.context, sessionId: session.sessionId });
    for (const recipientUserId of await listActiveAdministratorIds(db)) {
      await enqueueEmail(transaction, { kind: 'administrator_alert', variant: 'administrator_refresh_reuse', recipientUserId, now });
    }
  }
}
