/**
 * Step-up: renewed authentication before a sensitive operation (EVM-029 AC1–AC4, EVM-023 AC7; SR-SESS-08, SR-SESS-02, SR-AUTH-05; ASVS V7.2.4, V7.5.3, V6.3.1;
 * CWE-384, CWE-287, CWE-294, CWE-307). Two methods: a passkey, or a code of the authenticator app (Editor and Read-only; never the Administrator in the
 * panel — P1). A recovery code is not accepted (decision 16).
 *
 * Passkey. The options store a one-time challenge (SHA-256 only, 5 minutes) of the purpose `passkey_step_up`, tied to the session of the request and to its
 * user; a registration challenge and a sign-in challenge can never serve (the database CHECK and the conditions of the queries). The proof itself — the key,
 * the code of the app, the budget of wrong codes of the session — is `SecondStepProof`, shared with the full re-authentication of the account (EVM-028).
 *
 * Counter against guessing (EVM-028 K2): since EVM-028 every verification goes through the counter of the sign-in (`VerificationGate`), so a thief of a session
 * has no way around the lock: ten wrong tries lock the scope, a try during the lock verifies nothing and ends the session (`429 rate_limited`).
 *
 * Success is one transaction: a conditional UPDATE ends the current session (`rotated`; a session that is already over gives `401 session_revoked` and no
 * new one), a new session of the same user, channel and state starts with a new token and a new CSRF token, the absolute 12-hour limit of the session is kept
 * (a step-up does not extend its life), the matching `…_authenticated_at` becomes now (the other column is not carried: a step-up with a code opens the window
 * by the code alone), and `session.revoked`, `session.created` and `step_up.succeeded` are audited. The one-time mark of the full re-authentication is NOT
 * carried to the new session (EVM-028 K5). A refusal changes nothing but what it counts (the spent challenge, the failed code) and leaves `step_up.failed` —
 * the session stays as it was.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PasskeyAuthenticationOptions, StepUpRequestWritable } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { CHALLENGE_TTL_MS } from '../domain/constants.ts';
import { slidIdleDeadline } from '../domain/session-policy.ts';
import { deriveCsrfToken, hashToken, newToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { PASSKEY_VERIFIER, type PasskeyVerifier } from '../infrastructure/ports.ts';
import { insertSession, listPasskeysOfUser, rotateSession, storeStepUpChallenge } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo, NewSessionResult } from './activation.service.ts';
import { SecondStepProof } from './second-step-proof.ts';
import { VerificationGate, type VerificationTry } from './verification-gate.ts';

type Outcome =
  | NewSessionResult
  | { readonly refusal: 'passkey_failed' | 'totp_failed' | 'session_revoked' | 'forbidden' }
  | { readonly refusal: 'rate_limited'; readonly retryAfterSeconds: number };

@Injectable()
export class StepUpService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #verifier: PasskeyVerifier;
  readonly #proof: SecondStepProof;
  readonly #gate: VerificationGate;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(PASSKEY_VERIFIER) verifier: PasskeyVerifier,
    @Inject(SecondStepProof) proof: SecondStepProof,
    @Inject(VerificationGate) gate: VerificationGate,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#verifier = verifier;
    this.#proof = proof;
    this.#gate = gate;
  }

  /** Options restricted to the keys of the user of the session; stores the one open challenge of the session. */
  async options(principal: Principal): Promise<PasskeyAuthenticationOptions> {
    const now = this.#clock.now();
    return runInTransaction(this.#db, async (transaction) => {
      const tx = identityTables(transaction);
      const keys = await listPasskeysOfUser(tx, principal.userId);
      // An account in an active session that has no key has nothing to do here (it may have a code of the app instead).
      if (keys.length === 0) throw new ProblemException('forbidden');
      const options = await this.#verifier.authenticationOptions(
        keys.map((key) => ({ credentialId: key.credential_id, transports: key.transports })),
      );
      await storeStepUpChallenge(tx, {
        userId: principal.userId,
        sessionId: principal.sessionId,
        challengeHash: hashToken(options.challenge),
        now,
        expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
      });
      return options as PasskeyAuthenticationOptions;
    });
  }

  async verify(
    principal: Principal,
    body: StepUpRequestWritable,
    client: ClientInfo,
    deviceToken: string | undefined,
  ): Promise<NewSessionResult> {
    // The wait that the failures so far demand comes first, outside any transaction and before the proof is looked at (EVM-026 M1, EVM-028 K2).
    const attempt = await this.#gate.begin(principal, deviceToken, client, 'step_up.failed');
    const now = this.#clock.now();
    const outcome = await runInTransaction(this.#db, (transaction) =>
      this.#verifyInTransaction(transaction, principal, body, client, attempt, now),
    );
    // The refusal is raised after the transaction committed: what it counted (the spent challenge, the failed code) and the audit event stay.
    if ('refusal' in outcome) {
      throw new ProblemException(
        outcome.refusal,
        outcome.refusal === 'rate_limited' ? { retryAfterSeconds: outcome.retryAfterSeconds } : {},
      );
    }
    return outcome;
  }

  async #verifyInTransaction(
    transaction: Kysely<Database>,
    principal: Principal,
    body: StepUpRequestWritable,
    client: ClientInfo,
    attempt: VerificationTry,
    now: Date,
  ): Promise<Outcome> {
    const proof = await this.#proof.verify(transaction, principal, body, now, client.context);
    if (!proof.ok) {
      if (proof.reason === 'forbidden') {
        // No such method for the account: not a guess, the reservation goes back.
        await this.#gate.pass(transaction, attempt, now);
        return { refusal: 'forbidden' };
      }
      const reason = proof.reason === 'session_revoked' ? 'totp_failed' : proof.reason;
      await this.#publishFailed(transaction, principal, client, reason);
      const failed = await this.#gate.fail(transaction, attempt, reason, client, now);
      if (failed.lockedForSeconds !== undefined) return { refusal: 'rate_limited', retryAfterSeconds: failed.lockedForSeconds };
      return { refusal: proof.reason };
    }
    await this.#gate.pass(transaction, attempt, now);
    const withKey = 'credential' in body;
    const renewed = await this.#renewSession(transaction, principal, client, now, {
      passkeyAuthenticatedAt: withKey ? now : null,
      totpAuthenticatedAt: withKey ? null : now,
    });
    return renewed ?? { refusal: 'session_revoked' };
  }

  #publishFailed(
    transaction: Kysely<Database>,
    principal: Principal,
    client: ClientInfo,
    reason: 'passkey_failed' | 'totp_failed',
  ): Promise<void> {
    const failed: IdentityEvent = {
      type: 'step_up.failed',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'failed',
      reasonCode: reason,
      objectType: 'session',
      objectId: principal.sessionId,
    };
    return this.#events.publish(transaction, failed, { ...client.context, sessionId: principal.sessionId });
  }

  /**
   * Ends the session of the request and starts its replacement (same user, channel, state and absolute deadline) — the common end of a successful step-up.
   * @returns the new session, or undefined when the session was already over (nothing is created)
   */
  async #renewSession(
    transaction: Kysely<Database>,
    principal: Principal,
    client: ClientInfo,
    now: Date,
    authenticated: { readonly passkeyAuthenticatedAt: Date | null; readonly totpAuthenticatedAt: Date | null },
  ): Promise<NewSessionResult | undefined> {
    const tx = identityTables(transaction);
    const actor = { type: 'user', userId: principal.userId } as const;
    const previous = await rotateSession(tx, principal.sessionId, principal.userId, now);
    if (previous === undefined) return undefined;

    const sessionToken = newToken();
    const sessionId = await insertSession(tx, {
      userId: principal.userId,
      channel: previous.channel,
      state: previous.state,
      tokenHash: hashToken(sessionToken),
      linkId: null,
      now,
      ...authenticated,
      idleExpiresAt: slidIdleDeadline(now, previous.absoluteExpiresAt),
      absoluteExpiresAt: previous.absoluteExpiresAt,
      ip: client.context.ip,
      userAgent: client.userAgent,
    });

    const revoked: IdentityEvent = {
      type: 'session.revoked',
      actor,
      outcome: 'success',
      reasonCode: 'rotated',
      objectType: 'session',
      objectId: principal.sessionId,
    };
    await this.#events.publish(transaction, revoked, { ...client.context, sessionId: principal.sessionId });
    const created: IdentityEvent = { type: 'session.created', actor, outcome: 'success', objectType: 'session', objectId: sessionId };
    await this.#events.publish(transaction, created, { ...client.context, sessionId });
    const succeeded: IdentityEvent = { type: 'step_up.succeeded', actor, outcome: 'success', objectType: 'session', objectId: sessionId };
    await this.#events.publish(transaction, succeeded, { ...client.context, sessionId });

    return {
      sessionToken,
      csrfToken: deriveCsrfToken(sessionToken),
      maxAgeSeconds: Math.max(1, Math.floor((previous.absoluteExpiresAt.getTime() - now.getTime()) / 1000)),
    };
  }
}
