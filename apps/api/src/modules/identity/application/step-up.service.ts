/**
 * Step-up: renewed authentication before a sensitive operation (EVM-029 AC1–AC4, EVM-023 AC7; SR-SESS-08, SR-SESS-02, SR-AUTH-05; ASVS V7.2.4, V7.5.3, V6.3.1;
 * CWE-384, CWE-287, CWE-294, CWE-307). Two methods: a passkey, or a code of the authenticator app (Editor and Read-only; never the Administrator in the
 * panel — P1). A recovery code is not accepted (decision 16).
 *
 * Passkey. The options store a one-time challenge (SHA-256 only, 5 minutes) of the purpose `passkey_step_up`, tied to the session of the request and to its
 * user; a registration challenge and a sign-in challenge can never serve (the database CHECK and the conditions of the queries). The key must belong to the
 * user of the session; the assertion is checked by the code shared with the sign-in (`verifyAssertionOfKey`). The challenge is spent by every verification,
 * failed ones too.
 *
 * Code of the app. The role is read from the database now (not from the session), the sealed secret is opened, the code is checked in a window of ±1 step and
 * the step is spent by a conditional UPDATE shared with the sign-in (a code that signed in, confirmed the setup or stepped up before is refused). A thief of a
 * session has no `loginToken` that runs out, so the failures are counted on the SESSION: the fifth wrong code ends it (`401 session_revoked`, reason
 * `step_up_failed`) — the limit per address alone would leave about 8 % of a guess per day for a thief behind one address.
 *
 * Success is one transaction: a conditional UPDATE ends the current session (`rotated`; a session that is already over gives `401 session_revoked` and no
 * new one), a new session of the same user, channel and state starts with a new token and a new CSRF token, the absolute 12-hour limit of the session is kept
 * (a step-up does not extend its life), the matching `…_authenticated_at` becomes now (the other column is not carried: a step-up with a code opens the window
 * by the code alone), and `session.revoked`, `session.created` and `step_up.succeeded` are audited. A refusal changes nothing but what it counts (the spent
 * challenge, the failed code) and leaves `step_up.failed` — the session stays as it was.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PasskeyAuthenticationOptions, StepUpRequestWritable } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { FieldEncryption } from '../../../platform/crypto/field-encryption.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS, FIELD_ENCRYPTION } from '../../../platform/tokens.ts';
import { totpAllowedForRole } from '../domain/channel-rules.ts';
import { CHALLENGE_TTL_MS, STEP_UP_MAX_FAILED_CODES } from '../domain/constants.ts';
import { slidIdleDeadline } from '../domain/session-policy.ts';
import { deriveCsrfToken, hashToken, newToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { claimTotpStep, findTotpFactor, recordFailedStepUp } from '../infrastructure/mfa-queries.ts';
import { PASSKEY_VERIFIER, type PasskeyVerifier } from '../infrastructure/ports.ts';
import {
  consumeStepUpChallenges,
  findPasskeyOfUser,
  insertSession,
  listPasskeysOfUser,
  recordKeyUse,
  revokeSessions,
  rotateSession,
  storeStepUpChallenge,
} from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import { TOTP_ENGINE, type TotpEngine } from '../infrastructure/totp-engine.ts';
import type { ClientInfo, NewSessionResult } from './activation.service.ts';
import { verifyAssertionOfKey } from './passkey-assertion.ts';
import { openTotpSecret } from './totp-secret.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

type Outcome = NewSessionResult | { readonly refusal: 'passkey_failed' | 'totp_failed' | 'session_revoked' | 'forbidden' };

type PasskeyBody = Extract<StepUpRequestWritable, { credential: unknown }>;
type TotpBody = Extract<StepUpRequestWritable, { method: 'totp' }>;

@Injectable()
export class StepUpService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #verifier: PasskeyVerifier;
  readonly #encryption: FieldEncryption;
  readonly #engine: TotpEngine;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(PASSKEY_VERIFIER) verifier: PasskeyVerifier,
    @Inject(FIELD_ENCRYPTION) encryption: FieldEncryption,
    @Inject(TOTP_ENGINE) engine: TotpEngine,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#verifier = verifier;
    this.#encryption = encryption;
    this.#engine = engine;
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

  async verify(principal: Principal, body: StepUpRequestWritable, client: ClientInfo): Promise<NewSessionResult> {
    const now = this.#clock.now();
    const outcome = await runInTransaction(this.#db, (transaction) =>
      'credential' in body
        ? this.#verifyPasskey(transaction, principal, body, client, now)
        : this.#verifyTotp(transaction, principal, body, client, now),
    );
    // The refusal is raised after the transaction committed: what it counted (the spent challenge, the failed code) and the audit event stay.
    if ('refusal' in outcome) throw new ProblemException(outcome.refusal);
    return outcome;
  }

  async #verifyPasskey(
    transaction: Kysely<Database>,
    principal: Principal,
    body: PasskeyBody,
    client: ClientInfo,
    now: Date,
  ): Promise<Outcome> {
    const tx = identityTables(transaction);

    const account = await tx
      .selectFrom('identity.users')
      .select('webauthn_user_handle')
      .where('id', '=', principal.userId)
      .executeTakeFirstOrThrow();
    // The challenge is spent by every verification, the failed ones too (a replayed assertion finds nothing open).
    const open = await consumeStepUpChallenges(tx, principal.sessionId, principal.userId, now);
    const key = await findPasskeyOfUser(tx, principal.userId, body.credential.id);
    const assertion = await verifyAssertionOfKey(this.#verifier, {
      credential: body.credential,
      key,
      userHandle: account.webauthn_user_handle,
      open,
    });
    if (assertion === null) {
      await this.#publishFailed(transaction, principal, client, 'passkey_failed');
      return { refusal: 'passkey_failed' };
    }

    const renewed = await this.#renewSession(transaction, principal, client, now, {
      passkeyAuthenticatedAt: now,
      totpAuthenticatedAt: null,
    });
    if (renewed === undefined) return { refusal: 'session_revoked' };
    await recordKeyUse(tx, assertion.passkeyId, assertion.newCounter, now);
    return renewed;
  }

  async #verifyTotp(transaction: Kysely<Database>, principal: Principal, body: TotpBody, client: ClientInfo, now: Date): Promise<Outcome> {
    const tx = identityTables(transaction);
    // The role is read now, from the database — the Administrator has no code of the app in the panel (P1), whatever the session says.
    const account = await tx.selectFrom('identity.users').select('role').where('id', '=', principal.userId).executeTakeFirstOrThrow();
    if (!totpAllowedForRole(account.role, principal.channel)) return { refusal: 'forbidden' };
    const factor = await findTotpFactor(tx, principal.userId);
    if (factor?.state !== 'active') return { refusal: 'forbidden' };

    const secret = openTotpSecret(this.#encryption, principal.userId, factor.secretCiphertext);
    const step = this.#engine.match(secret, body.code, now);
    secret.fill(0);
    if (step === null || !(await claimTotpStep(tx, principal.userId, step))) return this.#failedCode(transaction, principal, client, now);

    const renewed = await this.#renewSession(transaction, principal, client, now, {
      passkeyAuthenticatedAt: null,
      totpAuthenticatedAt: now,
    });
    return renewed ?? { refusal: 'session_revoked' };
  }

  /** A wrong code is counted on the session; the fifth ends it (the thief has to start from the password, which he does not have). */
  async #failedCode(transaction: Kysely<Database>, principal: Principal, client: ClientInfo, now: Date): Promise<Outcome> {
    const tx = identityTables(transaction);
    const failures = await recordFailedStepUp(tx, principal.sessionId);
    await this.#publishFailed(transaction, principal, client, 'totp_failed');
    if (failures < STEP_UP_MAX_FAILED_CODES) return { refusal: 'totp_failed' };
    for (const sessionId of await revokeSessions(tx, { sessionId: principal.sessionId }, 'step_up_failed', now)) {
      const ended: IdentityEvent = {
        type: 'session.revoked',
        actor: { type: 'user', userId: principal.userId },
        outcome: 'success',
        reasonCode: 'totp_failed',
        objectType: 'session',
        objectId: sessionId,
      };
      await this.#events.publish(transaction, ended, { ...client.context, sessionId });
    }
    return { refusal: 'session_revoked' };
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
