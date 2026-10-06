/**
 * Activation of an account with a one-time link (AC3, AC5; W-13): checking the link and setting the password.
 *
 * Checking never consumes the link (a mail scanner opening it must not burn it). Setting the password does not consume
 * it either — the link is spent when the passkey is registered (decision D1, A1): a session in `mfa_enrollment` is tied
 * to the link and dies with it. Order of work is chosen so that an invalid link costs no CPU and no outbound traffic:
 * token → local policy → Pwned Passwords → Argon2id → transaction (re-validation under a row lock).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ActivationLinkInfo } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { CLOCK, DATABASE, EVENT_BUS, LOGGER } from '../../../platform/tokens.ts';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '../domain/constants.ts';
import { checkPassword } from '../domain/password-policy.ts';
import { deriveCsrfToken, hashToken, newToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { BREACHED_PASSWORD_CHECK, PASSWORD_HASHER, type BreachedPasswordCheck, type PasswordHasher } from '../infrastructure/ports.ts';
import { findLinkByTokenHash, insertSession, isLinkUsable, revokeSessions, type LinkRecord } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';

export interface NewSessionResult {
  /** The opaque token for the cookie. */
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly maxAgeSeconds: number;
}

export interface ClientInfo {
  readonly context: EventContext;
  readonly userAgent: string | undefined;
}

const invalid = (): ProblemException => new ProblemException('activation_link_invalid');

@Injectable()
export class ActivationService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #logger: Logger;
  readonly #hasher: PasswordHasher;
  readonly #breaches: BreachedPasswordCheck;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(LOGGER) logger: Logger,
    @Inject(PASSWORD_HASHER) hasher: PasswordHasher,
    @Inject(BREACHED_PASSWORD_CHECK) breaches: BreachedPasswordCheck,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#logger = logger;
    this.#hasher = hasher;
    this.#breaches = breaches;
  }

  /** @returns the account of a usable link (e-mail and role to show in W-13); never changes anything */
  async checkLink(token: string): Promise<ActivationLinkInfo> {
    const link = await this.#usableLink(token);
    return { email: link.email, role: link.role };
  }

  async setPassword(token: string, password: string, client: ClientInfo): Promise<NewSessionResult> {
    const link = await this.#usableLink(token);
    const fault = checkPassword(password, { email: link.email, displayName: link.displayName, now: this.#clock.now() });
    if (fault !== null) throw new ProblemException('validation_failed', { errors: [{ pointer: '/password', code: fault }] });
    await this.#rejectBreached(password);
    // Hash the NFC form: the same password typed with a different Unicode composition must verify (EVM-067).
    const passwordHash = await this.#hasher.hash(password.normalize('NFC'));

    const sessionToken = newToken();
    const now = this.#clock.now();
    const csrfToken = deriveCsrfToken(sessionToken);
    await this.#db.transaction().execute(async (transaction) => {
      const tx = identityTables(transaction);
      const locked = await findLinkByTokenHash(tx, hashToken(token), true);
      if (locked === undefined || !isLinkUsable(locked, now)) throw invalid();

      await tx
        .insertInto('identity.password_credentials')
        .values({ user_id: locked.userId, password_hash: passwordHash, updated_at: now })
        .onConflict((conflict) => conflict.column('user_id').doUpdateSet({ password_hash: passwordHash, updated_at: now }))
        .execute();

      // Setting the password again with the same link replaces the password and ends every session of the account (A1c).
      const revoked = await revokeSessions(tx, { userId: locked.userId }, 'rotated', now);
      const sessionId = await insertSession(tx, {
        userId: locked.userId,
        channel: 'web',
        state: 'mfa_enrollment',
        tokenHash: hashToken(sessionToken),
        linkId: locked.linkId,
        now,
        idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
        absoluteExpiresAt: new Date(Math.min(now.getTime() + SESSION_ABSOLUTE_MS, locked.expiresAt.getTime())),
        ip: client.context.ip,
        userAgent: client.userAgent,
      });

      const publish = (event: IdentityEvent, context: EventContext = client.context) => this.#events.publish(transaction, event, context);
      await publish({
        type: 'account.password_set',
        actor: { type: 'anonymous' },
        outcome: 'success',
        objectType: 'user',
        objectId: locked.userId,
      });
      for (const id of revoked) {
        await publish({
          type: 'session.revoked',
          actor: { type: 'anonymous' },
          outcome: 'success',
          reasonCode: 'rotated',
          objectType: 'session',
          objectId: id,
        });
      }
      await publish(
        {
          type: 'session.created',
          actor: { type: 'user', userId: locked.userId },
          outcome: 'success',
          objectType: 'session',
          objectId: sessionId,
        },
        { ...client.context, sessionId },
      );
    });
    return { sessionToken, csrfToken, maxAgeSeconds: Math.floor(SESSION_ABSOLUTE_MS / 1000) };
  }

  /** One answer for every kind of unusable link (unknown, used, superseded, expired, wrong account state). */
  async #usableLink(token: string): Promise<LinkRecord> {
    const link = await findLinkByTokenHash(identityTables(this.#db), hashToken(token));
    if (link === undefined || !isLinkUsable(link, this.#clock.now())) throw invalid();
    return link;
  }

  /** Pwned Passwords is a second opinion: when it cannot be reached the local checks stand and the activation goes on. */
  async #rejectBreached(password: string): Promise<void> {
    const result = await this.#breaches.check(password.normalize('NFC'));
    if (result === 'breached') throw new ProblemException('validation_failed', { errors: [{ pointer: '/password', code: 'too_weak' }] });
    if (result === 'unavailable') this.#logger.warn('pwned passwords unavailable; the local password checks were used');
  }
}
