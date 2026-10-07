/**
 * Sign-in, first step (AC1, AC2; SR-AUTH-05, SR-AUTH-01, SR-AUTH-14; ASVS V6.3.1, V6.2.x; CWE-204, CWE-208): e-mail and
 * password. Every failure — a wrong password, an unknown e-mail, an invited or a deactivated account — is the same
 * `401 invalid_credentials`, and costs the same: exactly one Argon2id verification, against the stored hash or against a
 * dummy hash created at start with the current parameters and verified through the same `verify` path. The password is
 * normalised to NFC as at activation and is otherwise left as typed (no trimming, no truncation, no case folding); the
 * policy of the minimum length is not applied here, only the shape of the data is (the contract). The client never
 * learns the reason: it goes to the audit trail and to a counter (`LoginFailures`).
 *
 * A correct password of an active account with a passkey gives a single-use `loginToken` (256 bits, only its SHA-256 is
 * stored, 5 minutes) for the second step; an active account without any second step gets a session in `mfa_enrollment`
 * that is not tied to a link and therefore cannot register a factor (AB-01: only an administrator's one-time link may).
 */
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { LOGIN_ATTEMPT_RETENTION_MS, LOGIN_ATTEMPT_TTL_MS } from '../domain/constants.ts';
import { normalizeEmail } from '../domain/text.ts';
import { hashToken, newToken } from '../domain/tokens.ts';
import { PASSWORD_HASHER, type PasswordHasher } from '../infrastructure/ports.ts';
import { deleteStaleLoginAttempts, findLoginUser, hasPasskey, insertLoginAttempt, type LoginUser } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';
import { LoginFailures, type LoginFailure } from './login-failures.ts';
import { startSession, type StartedSession } from './session-start.ts';

export type LoginOutcome =
  { readonly kind: 'second_step'; readonly loginToken: string } | { readonly kind: 'session'; readonly session: StartedSession };

type PasswordVerdict = { readonly failure: undefined; readonly user: LoginUser } | { readonly failure: LoginFailure };

@Injectable()
export class LoginService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #hasher: PasswordHasher;
  readonly #failures: LoginFailures;
  /** Created at start with the current parameters: the unknown-account and not-active paths verify against it. */
  readonly #dummyHash: Promise<string>;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(PASSWORD_HASHER) hasher: PasswordHasher,
    @Inject(LoginFailures) failures: LoginFailures,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#hasher = hasher;
    this.#failures = failures;
    this.#dummyHash = hasher.hash(randomBytes(32).toString('base64url'));
  }

  /** @param previousSessionToken the session token of the request's cookie (exactly one cookie), revoked on success */
  async login(email: string, password: string, client: ClientInfo, previousSessionToken: string | undefined): Promise<LoginOutcome> {
    const found = await findLoginUser(identityTables(this.#db), normalizeEmail(email));
    const verdict = await this.#checkPassword(found, password.normalize('NFC'));
    if (verdict.failure !== undefined) return this.#reject(verdict.failure, found?.userId, client);
    const { user } = verdict;

    const now = this.#clock.now();
    if (!(await hasPasskey(identityTables(this.#db), user.userId))) {
      const session = await this.#db.transaction().execute((transaction) =>
        startSession(transaction, this.#events, {
          userId: user.userId,
          state: 'mfa_enrollment',
          previousSessionToken,
          client,
          now,
          passkeyAuthenticatedAt: null,
        }),
      );
      return { kind: 'session', session };
    }
    const loginToken = newToken();
    await this.#db.transaction().execute(async (transaction) => {
      const tx = identityTables(transaction);
      await deleteStaleLoginAttempts(tx, new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_MS));
      await insertLoginAttempt(tx, {
        userId: user.userId,
        tokenHash: hashToken(loginToken),
        now,
        expiresAt: new Date(now.getTime() + LOGIN_ATTEMPT_TTL_MS),
      });
    });
    return { kind: 'second_step', loginToken };
  }

  /** Exactly one verification whatever the case: against the stored hash of an active account, otherwise against the dummy. */
  async #checkPassword(user: LoginUser | undefined, password: string): Promise<PasswordVerdict> {
    const storedHash = user?.status === 'active' ? user.passwordHash : null;
    const matches = await this.#hasher.verify(storedHash ?? (await this.#dummyHash), password);
    if (user === undefined) return { failure: 'unknown_user' };
    if (storedHash === null) return { failure: 'not_active' };
    return matches ? { failure: undefined, user } : { failure: 'bad_password' };
  }

  async #reject(reason: LoginFailure, userId: string | undefined, client: ClientInfo): Promise<never> {
    await this.#db.transaction().execute((transaction) => this.#failures.record(transaction, reason, userId, client.context));
    throw new ProblemException('invalid_credentials');
  }
}
