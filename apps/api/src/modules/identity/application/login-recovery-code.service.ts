/**
 * Sign-in, second step with a recovery code (EVM-023 AC5; SR-AUTH-08, SR-AUTH-15, SR-AUTH-05, SR-SESS-02, SR-SESS-08; ASVS V6.5.1–V6.5.4, V6.3.1;
 * CWE-307, CWE-362, CWE-400). The order of the checks is the point:
 *
 * 1. the `loginToken` — known, not spent, not expired (an unknown, foreign, spent or expired token is the same answer and costs no hash at all);
 * 2. the shape of the code (20 characters of base32 after dropping case, spaces and hyphens) — an input that cannot be a code is a counted failure,
 *    again without a hash;
 * 3. only then Argon2id, against the unused codes of the account (at most ten verifications, stopping at the first match — the time shows the position of a
 *    code, never the secret). This runs OUTSIDE any transaction, so a database connection is not held during the CPU work;
 * 4. one transaction spends the code (`UPDATE … WHERE id = ? AND used_at IS NULL AND superseded_at IS NULL RETURNING`), spends the `loginToken`, puts the
 *    e-mail about the use in the outbox, counts the codes that are left AFTER this use and inserts the session. Of two parallel requests with the same
 *    code exactly one gets a session.
 *
 * The session has no window of step-up operations (a recovery code opens none, SR-SESS-08) and a recovery code is never accepted at step-up. A wrong
 * code is counted on the `loginToken` with the other methods (the fifth ends the attempt) and audited with the account; the answer is 401
 * `recovery_code_failed`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { LoginRecoveryCodeRequestWritable } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { enqueueEmail } from '../../../platform/email/email-outbox.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { normalizeRecoveryCode } from '../domain/recovery-codes.ts';
import type { IdentityEvent } from '../events.ts';
import { consumeRecoveryCode, countAvailableRecoveryCodes, listAvailableRecoveryCodes } from '../infrastructure/mfa-queries.ts';
import { PASSWORD_HASHER, type PasswordHasher } from '../infrastructure/ports.ts';
import { consumeLoginAttempt, findLoginAttempt, recordLogin } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import { hashToken } from '../domain/tokens.ts';
import type { ClientInfo } from './activation.service.ts';
import { openLoginAttempt, recordSecondStepFailure, type AttemptRefusal } from './login-attempt.ts';
import { LoginFailures } from './login-failures.ts';
import { startSession, type StartedSession } from './session-start.ts';

export interface RecoveryCodeSession {
  readonly session: StartedSession;
  /** The codes that are still unused, counted after this use. */
  readonly remainingCodes: number;
}

type Refusal = AttemptRefusal | 'recovery_code_failed';

@Injectable()
export class LoginRecoveryCodeService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #hasher: PasswordHasher;
  readonly #failures: LoginFailures;

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
  }

  async verify(
    body: LoginRecoveryCodeRequestWritable,
    client: ClientInfo,
    previousSessionToken: string | undefined,
  ): Promise<RecoveryCodeSession> {
    const now = this.#clock.now();
    // 1. The token first: nothing below costs anything for a caller who does not hold a first step.
    const candidates = await runInTransaction(this.#db, (transaction) => this.#candidates(transaction, body.loginToken, now, client));
    if ('refusal' in candidates) throw new ProblemException(candidates.refusal);

    // 2 and 3. The shape, then at most ten Argon2id verifications — outside of any transaction.
    const code = normalizeRecoveryCode(body.code);
    const matched = code === undefined ? undefined : await this.#match(candidates.codes, code);

    // 4. One transaction decides — at the instant of the decision (the hashes took time: a token that ran out meanwhile is no first step).
    const outcome = await runInTransaction(this.#db, (transaction) =>
      this.#finish(transaction, body.loginToken, matched, client, previousSessionToken, this.#clock.now()),
    );
    if ('refusal' in outcome) throw new ProblemException(outcome.refusal);
    return outcome;
  }

  /** The unused codes of the account of a usable `loginToken` (an expired token is audited, like at the other methods). */
  async #candidates(
    transaction: Kysely<Database>,
    loginToken: string,
    now: Date,
    client: ClientInfo,
  ): Promise<{ readonly codes: readonly { id: string; hash: string }[] } | { readonly refusal: AttemptRefusal }> {
    const opened = await openLoginAttempt(transaction, this.#failures, loginToken, now, client.context);
    if ('refusal' in opened) return opened;
    return { codes: await listAvailableRecoveryCodes(identityTables(transaction), opened.attempt.userId) };
  }

  /** @returns the id of the code that matches, or undefined; stops at the first match */
  async #match(codes: readonly { id: string; hash: string }[], code: string): Promise<string | undefined> {
    for (const candidate of codes) {
      if (await this.#hasher.verify(candidate.hash, code)) return candidate.id;
    }
    return undefined;
  }

  async #finish(
    transaction: Kysely<Database>,
    loginToken: string,
    matchedId: string | undefined,
    client: ClientInfo,
    previousSessionToken: string | undefined,
    now: Date,
  ): Promise<RecoveryCodeSession | { readonly refusal: Refusal }> {
    const tx = identityTables(transaction);
    // The attempt is read again: it may have been spent, ended by five failures or have expired while the hashes were computed.
    const attempt = await findLoginAttempt(tx, hashToken(loginToken));
    if (attempt === undefined || attempt.usedAt !== null || attempt.expiresAt <= now) return { refusal: 'unauthenticated' };

    // The account is locked FIRST (before the code and the session rows): see `LoginTotpService` — two parallel requests queue here, they do not deadlock.
    const account = await tx
      .selectFrom('identity.users')
      .select('status')
      .where('id', '=', attempt.userId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const spent = matchedId !== undefined && (await consumeRecoveryCode(tx, matchedId, now));
    if (!spent) {
      await recordSecondStepFailure(transaction, this.#failures, attempt, 'recovery_code_failed', now, client.context);
      return { refusal: 'recovery_code_failed' };
    }
    if (!(await consumeLoginAttempt(tx, attempt.id, now))) throw new ProblemException('unauthenticated');
    if (account.status !== 'active') {
      await this.#failures.record(transaction, 'not_active', attempt.userId, client.context);
      throw new ProblemException('unauthenticated');
    }

    await recordLogin(tx, attempt.userId, now);
    const session = await startSession(transaction, this.#events, {
      userId: attempt.userId,
      state: 'active',
      previousSessionToken,
      client,
      now,
      authenticatedWith: 'none',
    });
    await enqueueEmail(transaction, { kind: 'recovery_code_used', variant: null, recipientUserId: attempt.userId, now });
    const actor = { type: 'user', userId: attempt.userId } as const;
    const context = { ...client.context, sessionId: session.sessionId };
    const used: IdentityEvent = {
      type: 'login.recovery_code_used',
      actor,
      outcome: 'success',
      objectType: 'user',
      objectId: attempt.userId,
    };
    await this.#events.publish(transaction, used, context);
    const succeeded: IdentityEvent = {
      type: 'login.succeeded',
      actor,
      outcome: 'success',
      objectType: 'session',
      objectId: session.sessionId,
    };
    await this.#events.publish(transaction, succeeded, context);
    return { session, remainingCodes: await countAvailableRecoveryCodes(tx, attempt.userId) };
  }
}
