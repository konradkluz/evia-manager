/**
 * Step-up: renewed authentication of the Administrator with a passkey before a sensitive operation (EVM-029 AC1–AC4;
 * SR-SESS-08, SR-SESS-02; ASVS V7.2.4, V7.5.3; CWE-384, CWE-287, CWE-294). The only method is a passkey — a recovery code is
 * not accepted (decision 16).
 *
 * The options store a one-time challenge (SHA-256 only, 5 minutes) of the purpose `passkey_step_up`, tied to the session of
 * the request and to its user; a registration challenge and a sign-in challenge can never serve (the database CHECK and the
 * conditions of the queries). The key must belong to the user of the session; the assertion is checked by the code shared
 * with the sign-in (`verifyAssertionOfKey`). The challenge is spent by every verification, failed ones too.
 *
 * Success is one transaction: a conditional UPDATE ends the current session (`rotated`; a session that is already over gives
 * `401 session_revoked` and no new one), a new session of the same user, channel and state starts with a new token and a new
 * CSRF token, the absolute 12-hour limit of the session is kept (a step-up does not extend its life), `passkey_authenticated_at`
 * becomes now, the key counter moves, and `session.revoked`, `session.created` and `step_up.succeeded` are audited. Of two
 * parallel verifications exactly one succeeds (the other finds the challenge spent). A refusal changes nothing but the spent
 * challenge and leaves `step_up.failed` — the session stays as it was.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PasskeyAuthenticationOptions, StepUpRequest } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { CHALLENGE_TTL_MS } from '../domain/constants.ts';
import { slidIdleDeadline } from '../domain/session-policy.ts';
import { deriveCsrfToken, hashToken, newToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { PASSKEY_VERIFIER, type PasskeyVerifier } from '../infrastructure/ports.ts';
import {
  consumeStepUpChallenges,
  findPasskeyOfUser,
  insertSession,
  listPasskeysOfUser,
  recordKeyUse,
  rotateSession,
  storeStepUpChallenge,
} from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo, NewSessionResult } from './activation.service.ts';
import { verifyAssertionOfKey } from './passkey-assertion.ts';

type Outcome = NewSessionResult | { readonly refusal: 'passkey_failed' | 'session_revoked' };

@Injectable()
export class StepUpService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #verifier: PasskeyVerifier;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(PASSKEY_VERIFIER) verifier: PasskeyVerifier,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#verifier = verifier;
  }

  /** Options restricted to the keys of the user of the session; stores the one open challenge of the session. */
  async options(principal: Principal): Promise<PasskeyAuthenticationOptions> {
    const now = this.#clock.now();
    return this.#db.transaction().execute(async (transaction) => {
      const tx = identityTables(transaction);
      const keys = await listPasskeysOfUser(tx, principal.userId);
      // An Administrator in an active session has a key; none means the account is not in a state a step-up can serve.
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

  async verify(principal: Principal, body: StepUpRequest, client: ClientInfo): Promise<NewSessionResult> {
    const now = this.#clock.now();
    const outcome = await this.#db
      .transaction()
      .execute((transaction) => this.#verifyInTransaction(transaction, principal, body, client, now));
    // The refusal is raised after the transaction committed: the spent challenge and the audit event stay.
    if ('refusal' in outcome) throw new ProblemException(outcome.refusal);
    return outcome;
  }

  async #verifyInTransaction(
    transaction: Kysely<Database>,
    principal: Principal,
    body: StepUpRequest,
    client: ClientInfo,
    now: Date,
  ): Promise<Outcome> {
    const tx = identityTables(transaction);
    const actor = { type: 'user', userId: principal.userId } as const;

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
      const failed: IdentityEvent = {
        type: 'step_up.failed',
        actor,
        outcome: 'failed',
        reasonCode: 'passkey_failed',
        objectType: 'session',
        objectId: principal.sessionId,
      };
      await this.#events.publish(transaction, failed, { ...client.context, sessionId: principal.sessionId });
      return { refusal: 'passkey_failed' };
    }

    const previous = await rotateSession(tx, principal.sessionId, principal.userId, now);
    if (previous === undefined) return { refusal: 'session_revoked' };

    await recordKeyUse(tx, assertion.passkeyId, assertion.newCounter, now);
    const sessionToken = newToken();
    const sessionId = await insertSession(tx, {
      userId: principal.userId,
      channel: previous.channel,
      state: previous.state,
      tokenHash: hashToken(sessionToken),
      linkId: null,
      now,
      passkeyAuthenticatedAt: now,
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
