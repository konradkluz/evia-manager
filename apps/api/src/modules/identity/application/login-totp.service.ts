/**
 * Sign-in, second step with a code of the authenticator app (EVM-023 AC2, AC3; SR-AUTH-07, SR-AUTH-05, SR-AUTH-06, SR-SESS-02; ASVS V6.3.1, V6.5.1, V6.5.5;
 * CWE-287, CWE-294, CWE-307, CWE-362).
 *
 * The `loginToken` of the first step names the account; nothing else names it. One transaction does everything or nothing: the attempt is read, the account
 * (its role from the database now, not from any session) is read under a share lock, the sealed secret is opened, the code is checked in a window of ±1 step,
 * the step is spent by a conditional UPDATE (`last_used_step` must grow — a code used before, at sign-in, at step-up or at confirmation, is refused), the
 * `loginToken` is spent by an atomic UPDATE and the session is inserted. Two parallel requests with the same code create exactly one session.
 *
 * A wrong code, a replayed code, an account without an active factor and the Administrator in the panel (no TOTP there, P1) are all counted on the
 * `loginToken` like a wrong key (the fifth ends the attempt) and audited as `login.failed` with the account; the client sees 401 `totp_failed`, and the
 * Administrator 403 `forbidden`. A failed attempt does not spend the `loginToken`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { LoginTotpRequestWritable } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { FieldEncryption } from '../../../platform/crypto/field-encryption.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS, FIELD_ENCRYPTION } from '../../../platform/tokens.ts';
import { totpAllowedForRole } from '../domain/channel-rules.ts';
import type { IdentityEvent } from '../events.ts';
import { claimTotpStep, findTotpFactor } from '../infrastructure/mfa-queries.ts';
import { consumeLoginAttempt, recordLogin } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import { TOTP_ENGINE, type TotpEngine } from '../infrastructure/totp-engine.ts';
import type { ClientInfo } from './activation.service.ts';
import { openLoginAttempt, recordSecondStepFailure, type AttemptRefusal } from './login-attempt.ts';
import { LoginFailures } from './login-failures.ts';
import { startSession, type StartedSession } from './session-start.ts';
import { openTotpSecret } from './totp-secret.ts';

type Refusal = AttemptRefusal | 'totp_failed' | 'forbidden';

@Injectable()
export class LoginTotpService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #encryption: FieldEncryption;
  readonly #engine: TotpEngine;
  readonly #failures: LoginFailures;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(FIELD_ENCRYPTION) encryption: FieldEncryption,
    @Inject(TOTP_ENGINE) engine: TotpEngine,
    @Inject(LoginFailures) failures: LoginFailures,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#encryption = encryption;
    this.#engine = engine;
    this.#failures = failures;
  }

  async verify(body: LoginTotpRequestWritable, client: ClientInfo, previousSessionToken: string | undefined): Promise<StartedSession> {
    const now = this.#clock.now();
    const outcome = await runInTransaction(this.#db, (transaction) =>
      this.#verifyInTransaction(transaction, body, client, previousSessionToken, now),
    );
    // The refusal is raised after the transaction committed: the counter and the audit rows of a failed attempt stay.
    if ('refusal' in outcome) throw new ProblemException(outcome.refusal);
    return outcome;
  }

  async #verifyInTransaction(
    transaction: Kysely<Database>,
    body: LoginTotpRequestWritable,
    client: ClientInfo,
    previousSessionToken: string | undefined,
    now: Date,
  ): Promise<StartedSession | { readonly refusal: Refusal }> {
    const opened = await openLoginAttempt(transaction, this.#failures, body.loginToken, now, client.context);
    if ('refusal' in opened) return opened;
    const { attempt } = opened;
    const tx = identityTables(transaction);
    const fail = async (refusal: 'totp_failed' | 'forbidden'): Promise<{ readonly refusal: Refusal }> => {
      await recordSecondStepFailure(transaction, this.#failures, attempt, 'totp_failed', now, client.context);
      return { refusal };
    };

    // The account is locked FIRST (before the factor and the session rows): a deactivation cannot slip in between this check and the session insert,
    // and two parallel requests of one account queue here instead of deadlocking on the rows that follow (a share lock would be upgraded by `recordLogin`).
    const account = await tx
      .selectFrom('identity.users')
      .select(['status', 'role'])
      .where('id', '=', attempt.userId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (!totpAllowedForRole(account.role, 'web')) return fail('forbidden');

    const factor = await findTotpFactor(tx, attempt.userId);
    if (factor?.state !== 'active') return fail('totp_failed');
    const secret = openTotpSecret(this.#encryption, attempt.userId, factor.secretCiphertext);
    const step = this.#engine.match(secret, body.code, now);
    secret.fill(0);
    if (step === null || !(await claimTotpStep(tx, attempt.userId, step))) return fail('totp_failed');

    if (!(await consumeLoginAttempt(tx, attempt.id, now))) return { refusal: 'unauthenticated' };
    if (account.status !== 'active') {
      await this.#failures.record(transaction, 'not_active', attempt.userId, client.context);
      return { refusal: 'unauthenticated' };
    }
    await recordLogin(tx, attempt.userId, now);
    const session = await startSession(transaction, this.#events, {
      userId: attempt.userId,
      state: 'active',
      previousSessionToken,
      client,
      now,
      authenticatedWith: 'totp',
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
}
