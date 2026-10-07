/**
 * Sign-in, second step with a passkey (AC1, AC4; SR-AUTH-06, SR-AUTH-09, SR-SESS-02; ASVS V6.3.3, V7.2.4, V11.6.1;
 * CWE-287, CWE-294, CWE-639).
 *
 * The `loginToken` of the first step names the account; everything else is checked against it. The key is looked up by
 * its credential id AND the account of the token (a key of another account is no key at all: otherwise a password
 * obtained by stuffing plus the attacker's own passkey would be a session of the victim — MFA bypass), `allowCredentials`
 * lists only the keys of that account, and a `userHandle` that arrives must be the account's. User verification is
 * required, origin and RP ID come from the configuration (the adapter).
 *
 * One use of a challenge and of a `loginToken`: the challenge (≥ 128 bits, 5 minutes) is spent by an atomic
 * UPDATE … RETURNING on every verification, failed ones too, and asking for new options retires the earlier challenge; the
 * `loginToken` is spent by an atomic UPDATE in the same transaction that inserts the session. A failed key does not spend
 * the `loginToken` (the user may retry, AC4) but is counted: the fifth ends the attempt. The state of the account is read
 * under a share lock in that transaction, so an account deactivated meanwhile gets no session (and a deactivation that
 * races with the sign-in waits and then revokes the new session). Two parallel verifications of the same assertion create
 * exactly one session.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PasskeyAuthenticationOptions, VerifyLoginPasskeyRequest } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { CHALLENGE_TTL_MS, LOGIN_MAX_FAILED_PASSKEYS } from '../domain/constants.ts';
import { hashToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { PASSKEY_VERIFIER, type PasskeyVerifier } from '../infrastructure/ports.ts';
import {
  consumeLoginAttempt,
  consumeLoginChallenges,
  findLoginAttempt,
  findPasskeyOfUser,
  recordFailedKey,
  recordKeyUse,
  recordLogin,
  storeLoginChallenge,
  type LoginAttemptRecord,
} from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';
import { LoginFailures } from './login-failures.ts';
import { verifyAssertionOfKey } from './passkey-assertion.ts';
import { startSession, type StartedSession } from './session-start.ts';

/** How a transaction that created no session ended: the refusal is raised after it commits (its audit rows stay). */
type Refusal = 'unauthenticated' | 'login_expired' | 'passkey_failed';
type Opened = { readonly attempt: LoginAttemptRecord } | { readonly refusal: Refusal };

@Injectable()
export class LoginPasskeyService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #verifier: PasskeyVerifier;
  readonly #failures: LoginFailures;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(PASSKEY_VERIFIER) verifier: PasskeyVerifier,
    @Inject(LoginFailures) failures: LoginFailures,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#verifier = verifier;
    this.#failures = failures;
  }

  async options(loginToken: string, client: ClientInfo): Promise<PasskeyAuthenticationOptions> {
    const now = this.#clock.now();
    const result = await this.#db.transaction().execute(async (transaction) => {
      const opened = await this.#open(transaction, loginToken, now, client.context);
      if ('refusal' in opened) return opened;
      const { attempt } = opened;
      const tx = identityTables(transaction);
      const keys = await tx
        .selectFrom('identity.passkeys')
        .select(['credential_id', 'transports'])
        .where('user_id', '=', attempt.userId)
        .execute();
      if (keys.length === 0) return { refusal: 'unauthenticated' as const };
      const options = await this.#verifier.authenticationOptions(
        keys.map((key) => ({ credentialId: key.credential_id, transports: key.transports })),
      );
      await storeLoginChallenge(tx, {
        userId: attempt.userId,
        attemptId: attempt.id,
        challengeHash: hashToken(options.challenge),
        now,
        expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
      });
      return { options };
    });
    if ('refusal' in result) throw new ProblemException(result.refusal);
    return result.options as PasskeyAuthenticationOptions;
  }

  async verify(body: VerifyLoginPasskeyRequest, client: ClientInfo, previousSessionToken: string | undefined): Promise<StartedSession> {
    const now = this.#clock.now();
    const outcome = await this.#db
      .transaction()
      .execute((transaction) => this.#verifyInTransaction(transaction, body, client, previousSessionToken, now));
    if ('refusal' in outcome) throw new ProblemException(outcome.refusal);
    return outcome;
  }

  async #verifyInTransaction(
    transaction: Kysely<Database>,
    body: VerifyLoginPasskeyRequest,
    client: ClientInfo,
    previousSessionToken: string | undefined,
    now: Date,
  ): Promise<StartedSession | { readonly refusal: Refusal }> {
    const opened = await this.#open(transaction, body.loginToken, now, client.context);
    if ('refusal' in opened) return opened;
    const { attempt } = opened;
    const tx = identityTables(transaction);

    // The account is read under a share lock: a deactivation cannot slip in between this check and the session insert.
    const account = await tx
      .selectFrom('identity.users')
      .select(['status', 'webauthn_user_handle'])
      .where('id', '=', attempt.userId)
      .forShare()
      .executeTakeFirstOrThrow();
    // The challenge is spent by every verification, the failed ones too (a replayed assertion finds nothing open).
    const open = await consumeLoginChallenges(tx, attempt.id, now);
    const key = await findPasskeyOfUser(tx, attempt.userId, body.credential.id);
    const assertion = await verifyAssertionOfKey(this.#verifier, {
      credential: body.credential,
      key,
      userHandle: account.webauthn_user_handle,
      open,
    });
    if (assertion === null) {
      await recordFailedKey(tx, attempt.id, now, LOGIN_MAX_FAILED_PASSKEYS);
      await this.#failures.record(transaction, 'passkey_failed', attempt.userId, client.context);
      return { refusal: 'passkey_failed' };
    }

    if (!(await consumeLoginAttempt(tx, attempt.id, now))) return { refusal: 'unauthenticated' };
    if (account.status !== 'active') {
      await this.#failures.record(transaction, 'not_active', attempt.userId, client.context);
      return { refusal: 'unauthenticated' };
    }
    await recordKeyUse(tx, assertion.passkeyId, assertion.newCounter, now);
    await recordLogin(tx, attempt.userId, now);
    const session = await startSession(transaction, this.#events, {
      userId: attempt.userId,
      state: 'active',
      previousSessionToken,
      client,
      now,
      passkeyAuthenticatedAt: now,
    });
    const succeeded: IdentityEvent = {
      type: 'login.succeeded',
      actor: { type: 'user', userId: attempt.userId },
      outcome: 'success',
      objectType: 'session',
      objectId: session.sessionId,
    };
    await this.#events.publish(transaction, succeeded, { ...client.context, sessionId: session.sessionId });
    return session;
  }

  /**
   * An attempt that is unknown or already spent is no first step (`unauthenticated`); one that ran out is `login_expired`
   * and is audited.
   */
  async #open(transaction: Kysely<Database>, loginToken: string, now: Date, context: EventContext): Promise<Opened> {
    const attempt = await findLoginAttempt(identityTables(transaction), hashToken(loginToken));
    if (attempt === undefined || attempt.usedAt !== null) return { refusal: 'unauthenticated' };
    if (attempt.expiresAt > now) return { attempt };
    await this.#failures.record(transaction, 'login_expired', attempt.userId, context);
    return { refusal: 'login_expired' };
  }
}
