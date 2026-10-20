/**
 * Sign-in, first step (AC1, AC2; SR-AUTH-05, SR-AUTH-01, SR-AUTH-14; ASVS V6.3.1, V6.2.x; CWE-204, CWE-208): e-mail and
 * password. Every failure — a wrong password, an unknown e-mail, an invited or a deactivated account — is the same
 * `401 invalid_credentials`, and costs the same: exactly one Argon2id verification, against the stored hash or against a
 * dummy hash created at start with the current parameters and verified through the same `verify` path. The password is
 * normalised to NFC as at activation and is otherwise left as typed (no trimming, no truncation, no case folding); the
 * policy of the minimum length is not applied here, only the shape of the data is (the contract). The client never
 * learns the reason: it goes to the audit trail and to a counter (`LoginFailures`).
 *
 * Protection against guessing (EVM-026; SR-AUTH-05): before anything is verified a try is RESERVED in the counter of its scope — the browser the account
 * knows (the cookie `__Host-evia_device` that belongs to THIS account) or else the account — and the eleventh is refused (`429 rate_limited`, still exactly
 * one Argon2id verification, against the dummy hash, so a lock costs what every other answer costs and says nothing about the account). From the sixth
 * try the answer waits 1, 2, 4, 8 and 10 s, OUTSIDE a transaction and BEFORE the verification. The tenth failure is still the `401`. A correct password
 * gives back only its own reservation — it does not zero the counter (RR-26).
 *
 * A correct password of an active account with a second step it may use here (a passkey, an active code of the authenticator app — never an
 * Administrator's TOTP in the panel) gives a single-use `loginToken` (256 bits, only its SHA-256 is stored, 5 minutes) for the second step; an
 * active account without any gets a session in `mfa_enrollment` that is not tied to a link and therefore cannot register a factor (AB-01: only
 * an administrator's one-time link may; EVM-023 B1).
 */
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { Sleeper } from '../../../platform/http/response-floor.ts';
import { CLOCK, DATABASE, EVENT_BUS, SLEEPER } from '../../../platform/tokens.ts';
import { normalizeEmail } from '../domain/text.ts';
import type { Reserved } from '../domain/throttle-policy.ts';
import { PASSWORD_HASHER, type PasswordHasher } from '../infrastructure/ports.ts';
import { findOpenSetupWindow } from '../infrastructure/access-queries.ts';
import { findLoginUser, type LoginUser } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';
import { BrowserRegister } from './browser-register.ts';
import { LoginFailures, type LoginFailure } from './login-failures.ts';
import { LoginThrottle, type ThrottleScope, type ThrottleTicket } from './login-throttle.ts';
import { openSecondStep, secondStepMethods, type SecondStepMethod } from './second-step.ts';
import { startSession, type StartedSession } from './session-start.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

export type LoginOutcome =
  | { readonly kind: 'second_step'; readonly loginToken: string; readonly methods: readonly SecondStepMethod[] }
  | { readonly kind: 'session'; readonly session: StartedSession };

type PasswordVerdict = { readonly failure: undefined; readonly user: LoginUser } | { readonly failure: LoginFailure };

@Injectable()
export class LoginService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #hasher: PasswordHasher;
  readonly #failures: LoginFailures;
  readonly #throttle: LoginThrottle;
  readonly #browsers: BrowserRegister;
  readonly #sleeper: Sleeper;
  /** Created at start with the current parameters: the unknown-account and not-active paths verify against it. */
  readonly #dummyHash: Promise<string>;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(PASSWORD_HASHER) hasher: PasswordHasher,
    @Inject(LoginFailures) failures: LoginFailures,
    @Inject(LoginThrottle) throttle: LoginThrottle,
    @Inject(BrowserRegister) browsers: BrowserRegister,
    @Inject(SLEEPER) sleeper: Sleeper,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#hasher = hasher;
    this.#failures = failures;
    this.#throttle = throttle;
    this.#browsers = browsers;
    this.#sleeper = sleeper;
    this.#dummyHash = hasher.hash(randomBytes(32).toString('base64url'));
  }

  /**
   * @param previousSessionToken the session token of the request's cookie (exactly one cookie), revoked on success
   * @param deviceToken the token of the cookie `__Host-evia_device` when the request carried exactly one well-formed cookie
   */
  async login(
    email: string,
    password: string,
    client: ClientInfo,
    previousSessionToken: string | undefined,
    deviceToken: string | undefined,
  ): Promise<LoginOutcome> {
    const normalized = normalizeEmail(email);
    const found = await findLoginUser(identityTables(this.#db), normalized);
    // A browser the ACCOUNT knows has its own counter; a cookie of another account, a stale one or none is the account's counter (M5).
    const known = found === undefined ? undefined : await this.#browsers.known(found.userId, deviceToken);
    const scope = known === undefined ? this.#throttle.accountScope(normalized) : this.#throttle.browserScope(known.id);
    const reservation = await runInTransaction(this.#db, (transaction) => this.#throttle.reserve(transaction, scope, this.#clock.now()));
    if (!reservation.granted) {
      // One verification here too, against the dummy: a lock costs what every other answer costs and says nothing about the account.
      await this.#hasher.verify(await this.#dummyHash, password.normalize('NFC'));
      throw new ProblemException('rate_limited', { retryAfterSeconds: reservation.retryAfterSeconds });
    }
    // The wait comes BEFORE the verification and outside any transaction (a client that drops the connection after it gains nothing).
    if (reservation.delayMs > 0) await this.#sleeper.sleep(reservation.delayMs);
    const ticket: ThrottleTicket = { scope, reserved: reservation.reserved, active: found?.status === 'active' };

    const verdict = await this.#checkPassword(found, password.normalize('NFC'));
    if (verdict.failure !== undefined) return this.#reject(verdict.failure, found?.userId, client, ticket);
    const { user } = verdict;

    const now = this.#clock.now();
    // The methods the account really has in this channel, for its role now — the same function as the end of a password reset (B2). An account
    // whose only factor is a pending TOTP, or a TOTP the role may not use here, has none: it gets the enrolment session, which cannot register anything.
    const methods = await secondStepMethods(this.#db, user.userId);
    if (methods.length === 0) return this.#withoutSecondStep(user, client, previousSessionToken, now, scope, reservation.reserved);
    const loginToken = await runInTransaction(this.#db, async (transaction) => {
      await this.#throttle.release(transaction, scope, reservation.reserved, now);
      return openSecondStep(transaction, user.userId, now, scope.key);
    });
    return { kind: 'second_step', loginToken, methods };
  }

  /**
   * An active account with no second step it may use. Only the WINDOW that a reset by an Administrator opened (EVM-027 D1) gives it a way to set one up: a
   * session `mfa_enrollment` bound to the window, which ends with it. Without an open window — after its end, or for an account that never had a second
   * step — the correct password gives nothing but `403 mfa_setup_expired` (D2): a session that cannot enrol anything would only be a thing to steal, and
   * nobody may add a second step to an account by the password alone (AB-01; ASVS V6.4.4). The refusal is audited and counted; no session is made.
   */
  async #withoutSecondStep(
    user: LoginUser,
    client: ClientInfo,
    previousSessionToken: string | undefined,
    now: Date,
    scope: ThrottleScope,
    reserved: Reserved,
  ): Promise<LoginOutcome> {
    const windowId = await findOpenSetupWindow(identityTables(this.#db), user.userId, now);
    if (windowId === undefined) {
      await runInTransaction(this.#db, async (transaction) => {
        await this.#throttle.release(transaction, scope, reserved, now);
        await this.#failures.record(transaction, 'mfa_setup_expired', user.userId, client.context);
      });
      throw new ProblemException('mfa_setup_expired');
    }
    const session = await runInTransaction(this.#db, async (transaction) => {
      await this.#throttle.release(transaction, scope, reserved, now);
      return startSession(transaction, this.#events, {
        userId: user.userId,
        state: 'mfa_enrollment',
        linkId: windowId,
        previousSessionToken,
        client,
        now,
        authenticatedWith: 'none',
      });
    });
    return { kind: 'session', session };
  }

  /** Exactly one verification whatever the case: against the stored hash of an active account, otherwise against the dummy. */
  async #checkPassword(user: LoginUser | undefined, password: string): Promise<PasswordVerdict> {
    const storedHash = user?.status === 'active' ? user.passwordHash : null;
    const matches = await this.#hasher.verify(storedHash ?? (await this.#dummyHash), password);
    if (user === undefined) return { failure: 'unknown_user' };
    if (storedHash === null) return { failure: 'not_active' };
    return matches ? { failure: undefined, user } : { failure: 'bad_password' };
  }

  async #reject(reason: LoginFailure, userId: string | undefined, client: ClientInfo, ticket: ThrottleTicket): Promise<never> {
    await runInTransaction(this.#db, (transaction) => this.#failures.record(transaction, reason, userId, client.context, ticket));
    throw new ProblemException('invalid_credentials');
  }
}
