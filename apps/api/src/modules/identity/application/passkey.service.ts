/**
 * Passkey enrolment of the Administrator (AC4; SR-AUTH-06, SR-AUTH-09; P1) — the only MFA method until EVM-023.
 *
 * Registration options store a one-time challenge (SHA-256 only, 5 minutes) tied to the session, the user and the
 * purpose. The response is verified before any transaction (origin and RP ID from the configuration, user verification
 * required). Then one transaction does everything or nothing: consumes the challenge atomically, locks the session,
 * consumes the activation link atomically (`used_at IS NULL AND superseded_at IS NULL AND expires_at > :now`), stores
 * the key, activates the account, revokes the enrolment session and creates the active one with a new identifier. Of two
 * concurrent registrations exactly one wins; a link that expired or was replaced meanwhile gives 401 session_revoked and
 * changes nothing (A1b). A response that fails verification leaves the account untouched and leaves an audit event.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Passkey, RegisterPasskeyRequest } from '@evia/contracts';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { sql, type Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { CHALLENGE_TTL_MS, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '../domain/constants.ts';
import { deriveCsrfToken, hashToken, newToken } from '../domain/tokens.ts';
import { claimedChallenge, toRegistrationResponse } from '../domain/webauthn-input.ts';
import type { IdentityEvent } from '../events.ts';
import { PASSKEY_VERIFIER, type PasskeyVerifier, type VerifiedPasskey } from '../infrastructure/ports.ts';
import { insertSession, revokeSessions } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo, NewSessionResult } from './activation.service.ts';

/** The challenge, the response or the key did not hold up — answered with 400 passkey_verification_failed. */
class RegistrationRejected extends Error {}
/** The enrolment session or its link is no longer valid — answered with 401 session_revoked, nothing is changed. */
class EnrolmentSessionGone extends Error {}

export interface RegisteredPasskey extends NewSessionResult {
  readonly passkey: Passkey;
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class PasskeyService {
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

  async registrationOptions(principal: Principal): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const tx = identityTables(this.#db);
    const user = await tx
      .selectFrom('identity.users')
      .select(['email', 'display_name', 'webauthn_user_handle'])
      .where('id', '=', principal.userId)
      .executeTakeFirstOrThrow();
    const existing = await tx.selectFrom('identity.passkeys').select('credential_id').where('user_id', '=', principal.userId).execute();
    const options = await this.#verifier.registrationOptions({
      userHandle: user.webauthn_user_handle,
      email: user.email,
      displayName: user.display_name,
      excludeCredentialIds: existing.map((row) => row.credential_id),
    });
    const now = this.#clock.now();
    await this.#db.transaction().execute(async (transaction) => {
      const handle = identityTables(transaction);
      // One open challenge per session: asking for new options retires the earlier ones.
      await handle
        .updateTable('identity.webauthn_challenges')
        .set({ used_at: now })
        .where('session_id', '=', principal.sessionId)
        .where('used_at', 'is', null)
        .execute();
      await handle
        .insertInto('identity.webauthn_challenges')
        .values({
          user_id: principal.userId,
          session_id: principal.sessionId,
          purpose: 'passkey_registration',
          challenge_hash: hashToken(options.challenge),
          created_at: now,
          expires_at: new Date(now.getTime() + CHALLENGE_TTL_MS),
          used_at: null,
        })
        .execute();
    });
    return options;
  }

  async register(principal: Principal, body: RegisterPasskeyRequest, client: ClientInfo): Promise<RegisteredPasskey> {
    requireEnrolment(principal);
    const challenge = claimedChallenge(body.credential.response.clientDataJSON);
    const verified = challenge === undefined ? null : await this.#verifier.verifyRegistration(toRegistrationResponse(body), challenge);
    if (challenge === undefined || verified === null) return this.#fail(principal, client);
    try {
      return await this.#complete(principal, verified, challenge, client);
    } catch (error) {
      if (error instanceof EnrolmentSessionGone) throw new ProblemException('session_revoked');
      if (error instanceof RegistrationRejected || (error as { code?: unknown }).code === UNIQUE_VIOLATION) {
        return this.#fail(principal, client);
      }
      throw error;
    }
  }

  async #complete(principal: Principal, verified: VerifiedPasskey, challenge: string, client: ClientInfo): Promise<RegisteredPasskey> {
    const sessionToken = newToken();
    const now = this.#clock.now();
    const result = await this.#db.transaction().execute(async (transaction) => {
      const tx = identityTables(transaction);
      const used = await tx
        .updateTable('identity.webauthn_challenges')
        .set({ used_at: now })
        .where('challenge_hash', '=', hashToken(challenge))
        .where('session_id', '=', principal.sessionId)
        .where('user_id', '=', principal.userId)
        .where('purpose', '=', 'passkey_registration')
        .where('used_at', 'is', null)
        .where('expires_at', '>', now)
        .returning('id')
        .executeTakeFirst();
      if (used === undefined) throw new RegistrationRejected();

      const session = await tx
        .selectFrom('identity.sessions')
        .select('one_time_link_id')
        .where('id', '=', principal.sessionId)
        .where('revoked_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (session === undefined || session.one_time_link_id === null) throw new EnrolmentSessionGone();
      const link = await tx
        .updateTable('identity.one_time_links')
        .set({ used_at: now })
        .where('id', '=', session.one_time_link_id)
        .where('used_at', 'is', null)
        .where('superseded_at', 'is', null)
        .where('expires_at', '>', now)
        .returning('id')
        .executeTakeFirst();
      if (link === undefined) throw new EnrolmentSessionGone();

      const passkey = await tx
        .insertInto('identity.passkeys')
        .values({
          user_id: principal.userId,
          credential_id: verified.credentialId,
          public_key: verified.publicKey,
          counter: verified.counter,
          transports: [...verified.transports],
          device_type: verified.deviceType,
          backed_up: verified.backedUp,
          created_at: now,
          last_used_at: null,
        })
        .returning(['id', 'created_at', 'device_type', 'backed_up'])
        .executeTakeFirstOrThrow();

      const activated = await tx
        .updateTable('identity.users')
        .set({ status: 'active', last_login_at: now, updated_at: now, version: sql`version + 1` })
        .where('id', '=', principal.userId)
        .where('status', '=', 'invited')
        .returning('id')
        .executeTakeFirst();
      if (activated === undefined) throw new EnrolmentSessionGone();

      // A new identifier after the change of authentication level (SR-SESS-02): the enrolment session ends here.
      await revokeSessions(tx, { sessionId: principal.sessionId }, 'rotated', now);
      const sessionId = await insertSession(tx, {
        userId: principal.userId,
        channel: principal.channel,
        state: 'active',
        tokenHash: hashToken(sessionToken),
        linkId: null,
        now,
        idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
        absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
        ip: client.context.ip,
        userAgent: client.userAgent,
      });

      const actor = { type: 'user', userId: principal.userId } as const;
      const publish = (event: IdentityEvent, context: EventContext) => this.#events.publish(transaction, event, context);
      const current = { ...client.context, sessionId: principal.sessionId };
      await publish({ type: 'passkey.registered', actor, outcome: 'success', objectType: 'passkey', objectId: passkey.id }, current);
      await publish({ type: 'account.activated', actor, outcome: 'success', objectType: 'user', objectId: principal.userId }, current);
      await publish(
        { type: 'session.revoked', actor, outcome: 'success', reasonCode: 'rotated', objectType: 'session', objectId: principal.sessionId },
        current,
      );
      await publish(
        { type: 'session.created', actor, outcome: 'success', objectType: 'session', objectId: sessionId },
        { ...client.context, sessionId },
      );
      return {
        id: passkey.id,
        createdAt: passkey.created_at.toISOString(),
        deviceType: passkey.device_type,
        backedUp: passkey.backed_up,
      };
    });
    return {
      passkey: result,
      sessionToken,
      csrfToken: deriveCsrfToken(sessionToken),
      maxAgeSeconds: Math.floor(SESSION_ABSOLUTE_MS / 1000),
    };
  }

  /** A failed attempt is audited (own transaction — the failed one was rolled back) and answered with 400. */
  async #fail(principal: Principal, client: ClientInfo): Promise<never> {
    const event: IdentityEvent = {
      type: 'passkey.registered',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'failed',
      reasonCode: 'verification_failed',
      objectType: 'user',
      objectId: principal.userId,
    };
    await this.#db
      .transaction()
      .execute((transaction) => this.#events.publish(transaction, event, { ...client.context, sessionId: principal.sessionId }));
    throw new ProblemException('passkey_verification_failed');
  }
}

/**
 * Registration belongs to the enrolment session; adding a further key to an active account is EVM-028 (the options of the
 * ceremony are harmless for any session — they only store a challenge — so only the registration itself is refused).
 */
function requireEnrolment(principal: Principal): void {
  if (principal.state !== 'mfa_enrollment') throw new ProblemException('forbidden');
}
