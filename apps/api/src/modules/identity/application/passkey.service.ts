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
 *
 * A key added from the ACCOUNT (EVM-028 AC3; SR-AUTH-09, SR-AUTH-10; ASVS V7.5.1): the session is `active` and needs the one-time mark of the full
 * re-authentication (`second_step_change`). The options only LOOK at the mark (they spend nothing), the registration spends it in the SAME transaction that
 * spends the challenge and inserts the key — a refused registration spends nothing. The challenge is the same one-time, session-bound, purpose-bound kind
 * as in the enrolment, the options exclude the keys the account already has and require user verification. The session is not rotated (the level of
 * authentication did not change), the account is not activated, and the e-mail 5 (and for an Administrator the alert 9) go out; the name the person gave the
 * key is stored with it and goes nowhere else.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Passkey, RegisterPasskeyRequest } from '@evia/contracts';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { sql, type Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { enqueueEmail } from '../../../platform/email/email-outbox.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { normalizePasskeyName } from '../domain/account-input.ts';
import { CHALLENGE_TTL_MS, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '../domain/constants.ts';
import { deriveCsrfToken, hashToken, newToken } from '../domain/tokens.ts';
import { claimedChallenge, toRegistrationResponse } from '../domain/webauthn-input.ts';
import type { IdentityEvent } from '../events.ts';
import { consumeReauthMark, hasReauthMark } from '../infrastructure/account-queries.ts';
import { PASSKEY_VERIFIER, type PasskeyVerifier, type VerifiedPasskey } from '../infrastructure/ports.ts';
import { findUserById, insertSession, revokeSessions } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo, NewSessionResult } from './activation.service.ts';
import { enforceSessionLimit } from './session-limit.ts';
import { noticeSecondStepChange } from './second-step-notice.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';

/** The challenge, the response or the key did not hold up — answered with 400 passkey_verification_failed. */
class RegistrationRejected extends Error {}
/** The enrolment session or its link is no longer valid — answered with 401 session_revoked, nothing is changed. */
class EnrolmentSessionGone extends Error {}
/** A key from the account without the mark of the full re-authentication (spent, too old, of another purpose) — answered with 403, nothing is changed. */
class ReauthenticationMissing extends Error {}

/** The session cookie is new only when the key finished an enrolment; a key added from the account leaves the session as it is. */
export interface RegisteredPasskey extends Partial<NewSessionResult> {
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
    // An `active` session asks for the options only after the full re-authentication; looking at the mark spends nothing (EVM-028 K10).
    if (principal.state === 'active' && !(await hasReauthMark(tx, principal.sessionId, 'second_step_change', this.#clock.now()))) {
      throw new ProblemException('reauthentication_required');
    }
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
    await runInTransaction(this.#db, async (transaction) => {
      const handle = identityTables(transaction);
      // One open registration challenge per session: asking for new options retires the earlier ones.
      await handle
        .updateTable('identity.webauthn_challenges')
        .set({ used_at: now })
        .where('session_id', '=', principal.sessionId)
        .where('purpose', '=', 'passkey_registration')
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
    const name = normalizePasskeyName(body.name);
    if (!name.ok) throw new ProblemException('validation_failed', { errors: name.errors });
    const challenge = claimedChallenge(body.credential.response.clientDataJSON);
    const verified = challenge === undefined ? null : await this.#verifier.verifyRegistration(toRegistrationResponse(body), challenge);
    if (challenge === undefined || verified === null) return this.#fail(principal, client);
    try {
      return principal.state === 'active'
        ? await this.#addToAccount(principal, verified, challenge, name.value, client)
        : await this.#complete(principal, verified, challenge, name.value, client);
    } catch (error) {
      if (error instanceof EnrolmentSessionGone) throw new ProblemException('session_revoked');
      if (error instanceof ReauthenticationMissing) throw new ProblemException('reauthentication_required');
      if (error instanceof RegistrationRejected || (error as { code?: unknown }).code === UNIQUE_VIOLATION) {
        return this.#fail(principal, client);
      }
      throw error;
    }
  }

  /** A key from the account: the challenge, the mark and the insert in ONE transaction (the first refusal rolls the others back). */
  async #addToAccount(
    principal: Principal,
    verified: VerifiedPasskey,
    challenge: string,
    name: string,
    client: ClientInfo,
  ): Promise<RegisteredPasskey> {
    const now = this.#clock.now();
    return runInTransaction(this.#db, async (transaction) => {
      const tx = identityTables(transaction);
      const user = await findUserById(tx, principal.userId, true);
      if (user?.status !== 'active') throw new EnrolmentSessionGone();
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
      if (!(await consumeReauthMark(tx, principal.sessionId, 'second_step_change', now))) throw new ReauthenticationMissing();

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
          name,
        })
        .returning(['id', 'created_at', 'device_type', 'backed_up'])
        .executeTakeFirstOrThrow();
      await noticeSecondStepChange(transaction, { userId: principal.userId, role: user.role }, 'passkey_enrolled', now);
      const registered: IdentityEvent = {
        type: 'passkey.registered',
        actor: { type: 'user', userId: principal.userId },
        outcome: 'success',
        objectType: 'passkey',
        objectId: passkey.id,
      };
      await this.#events.publish(transaction, registered, { ...client.context, sessionId: principal.sessionId });
      return {
        passkey: {
          id: passkey.id,
          name,
          createdAt: passkey.created_at.toISOString(),
          deviceType: passkey.device_type,
          backedUp: passkey.backed_up,
        },
      };
    });
  }

  async #complete(
    principal: Principal,
    verified: VerifiedPasskey,
    challenge: string,
    name: string,
    client: ClientInfo,
  ): Promise<RegisteredPasskey> {
    const sessionToken = newToken();
    const now = this.#clock.now();
    const result = await runInTransaction(this.#db, async (transaction) => {
      const tx = identityTables(transaction);
      // The account is locked FIRST — the order of locks of every unit of work that changes the account or ends its sessions (an Administrator's reset or
      // deactivation holds this lock before it touches a session, a ceremony or a link), so the two never wait for each other's rows (EVM-027).
      await findUserById(tx, principal.userId, true);
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
        .returning(['id', 'purpose'])
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
          name,
        })
        .returning(['id', 'created_at', 'device_type', 'backed_up'])
        .executeTakeFirstOrThrow();

      // The link of an invitation activates the account (`invited` → `active`, the first activation); the WINDOW of a reset by an Administrator belongs to an
      // account that is `active` already — it only gets its second step back (EVM-027 D1). Anything else is no enrolment at all.
      const activation = link.purpose === 'account_activation';
      if (!activation && link.purpose !== 'mfa_setup') throw new EnrolmentSessionGone();
      const activated = await tx
        .updateTable('identity.users')
        .set(
          activation
            ? { status: 'active', last_login_at: now, activated_at: now, updated_at: now, version: sql`version + 1` }
            : { last_login_at: now, updated_at: now },
        )
        .where('id', '=', principal.userId)
        .where('status', '=', activation ? 'invited' : 'active')
        .returning('id')
        .executeTakeFirst();
      if (activated === undefined) throw new EnrolmentSessionGone();
      if (!activation) {
        await enqueueEmail(transaction, { kind: 'mfa_changed', variant: 'passkey_enrolled', recipientUserId: principal.userId, now });
      }

      // A new identifier after the change of authentication level (SR-SESS-02): the enrolment session ends here.
      await revokeSessions(tx, { sessionId: principal.sessionId }, 'rotated', now);
      await enforceSessionLimit(transaction, this.#events, { userId: principal.userId, now, context: client.context });
      const sessionId = await insertSession(tx, {
        userId: principal.userId,
        channel: principal.channel,
        state: 'active',
        tokenHash: hashToken(sessionToken),
        linkId: null,
        now,
        // Enrolling a key does not open the step-up window (conservative: the key was registered, not asserted).
        passkeyAuthenticatedAt: null,
        totpAuthenticatedAt: null,
        idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
        absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
        ip: client.context.ip,
        userAgent: client.userAgent,
      });

      const actor = { type: 'user', userId: principal.userId } as const;
      const publish = (event: IdentityEvent, context: EventContext) => this.#events.publish(transaction, event, context);
      const current = { ...client.context, sessionId: principal.sessionId };
      await publish({ type: 'passkey.registered', actor, outcome: 'success', objectType: 'passkey', objectId: passkey.id }, current);
      if (activation) {
        await publish({ type: 'account.activated', actor, outcome: 'success', objectType: 'user', objectId: principal.userId }, current);
      }
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
        name,
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
    await runInTransaction(this.#db, (transaction) =>
      this.#events.publish(transaction, event, { ...client.context, sessionId: principal.sessionId }),
    );
    throw new ProblemException('passkey_verification_failed');
  }
}
