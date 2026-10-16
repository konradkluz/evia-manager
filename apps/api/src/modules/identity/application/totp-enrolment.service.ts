/**
 * Enrolment of a code from an authenticator app (EVM-023 AC1, AC6, AC8; SR-AUTH-07, SR-CRYPTO-02, SR-AUTH-10, SR-SESS-02; ASVS V6.3.3, V6.4.4, V11.2.2;
 * CWE-308, CWE-362, CWE-312; AB-01). Only the session of an ACTIVATION LINK may enrol — the same rule as the registration of a passkey: a session that came
 * from the password alone has no link and can enrol nothing, so a stolen password cannot add the thief's own second step to an account that has none.
 *
 * `setup` — the session is in `mfa_enrollment` and bound to a link that is still usable (otherwise 403 / 401 `session_revoked`), the role is read from the
 * database (the Administrator in the panel has no TOTP, P1: 403), an account that already has an active second step (a passkey or a TOTP) is `409` and
 * its secret is never returned. A new secret (160 bits, CSPRNG) is sealed with the envelope of `platform/crypto` (the account is authenticated data) and
 * stored as PENDING — a second setup before the confirmation replaces only a pending secret. A pending factor is not a method of the second step.
 *
 * `confirm` — ONE transaction does everything or nothing: the session and then the account are locked, the pending secret is opened, the code is checked
 * (6 digits, ±1 step), the factor becomes active with the step of this code recorded (so the code of the confirmation can never sign in), the activation
 * link is spent by a conditional UPDATE, the account is activated, the enrolment session ends and a new `active` one starts with a new identifier and the
 * window of step-up operations open (the code was just proved). A wrong code changes nothing and leaves an audit event. Of two parallel confirmations
 * exactly one wins: the other waits for the lock of the session and finds it ended (401 `session_revoked`).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { TotpSetup } from '@evia/contracts';
import { sql, type Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { FieldEncryption } from '../../../platform/crypto/field-encryption.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { enqueueEmail } from '../../../platform/email/email-outbox.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS, FIELD_ENCRYPTION } from '../../../platform/tokens.ts';
import { totpAllowedForRole } from '../domain/channel-rules.ts';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '../domain/constants.ts';
import { deriveCsrfToken, hashToken, newToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { activateTotp, findTotpFactor, upsertPendingTotp } from '../infrastructure/mfa-queries.ts';
import { findUserById, hasPasskey, insertSession, revokeSessions } from '../infrastructure/queries.ts';
import { identityTables, type IdentityDb } from '../infrastructure/tables.ts';
import { TOTP_ENGINE, type TotpEngine } from '../infrastructure/totp-engine.ts';
import type { ClientInfo, NewSessionResult } from './activation.service.ts';
import { openTotpSecret, sealTotpSecret } from './totp-secret.ts';

/** The enrolment session or its link is no longer valid — answered with 401 session_revoked, nothing is changed. */
class EnrolmentSessionGone extends Error {}

type ConfirmOutcome = NewSessionResult | { readonly refusal: 'totp_verification_failed' };

@Injectable()
export class TotpEnrolmentService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #encryption: FieldEncryption;
  readonly #engine: TotpEngine;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(FIELD_ENCRYPTION) encryption: FieldEncryption,
    @Inject(TOTP_ENGINE) engine: TotpEngine,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#encryption = encryption;
    this.#engine = engine;
  }

  async setup(principal: Principal): Promise<TotpSetup> {
    const now = this.#clock.now();
    try {
      return await runInTransaction(this.#db, async (transaction) => {
        const tx = identityTables(transaction);
        await this.#lockEnrolment(tx, principal, now);
        const user = await findUserById(tx, principal.userId);
        if (user === undefined || !totpAllowedForRole(user.role, principal.channel)) throw new ProblemException('forbidden');
        // An account that already has an active second step never gets a second setup — and never sees a secret.
        if (await hasPasskey(tx, principal.userId)) throw new ProblemException('mfa_already_configured');

        const secret = this.#engine.newSecret();
        const stored = await upsertPendingTotp(tx, {
          userId: principal.userId,
          secretCiphertext: sealTotpSecret(this.#encryption, principal.userId, secret),
          now,
        });
        if (!stored) throw new ProblemException('mfa_already_configured');
        return { secret: this.#engine.base32(secret), otpauthUri: this.#engine.uri(secret, user.email) };
      });
    } catch (error) {
      if (error instanceof EnrolmentSessionGone) throw new ProblemException('session_revoked');
      throw error;
    }
  }

  async confirm(principal: Principal, code: string, client: ClientInfo): Promise<NewSessionResult> {
    const now = this.#clock.now();
    let outcome: ConfirmOutcome;
    try {
      outcome = await runInTransaction(this.#db, (transaction) => this.#confirmInTransaction(transaction, principal, code, client, now));
    } catch (error) {
      if (error instanceof EnrolmentSessionGone) throw new ProblemException('session_revoked');
      throw error;
    }
    // The refusal is raised after the transaction committed: the audit event of the failed attempt stays.
    if ('refusal' in outcome) throw new ProblemException(outcome.refusal);
    return outcome;
  }

  /**
   * Locks the session of the request and checks that it is an enrolment bound to a link that can still be used. Throws 403 for a session that came from
   * the password alone (no link) or is not an enrolment, `EnrolmentSessionGone` for one that has ended or whose link is spent, superseded or expired.
   * @returns the id of the link
   */
  async #lockEnrolment(tx: IdentityDb, principal: Principal, now: Date): Promise<string> {
    if (principal.state !== 'mfa_enrollment') throw new ProblemException('forbidden');
    const session = await tx
      .selectFrom('identity.sessions')
      .select('one_time_link_id')
      .where('id', '=', principal.sessionId)
      .where('revoked_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (session === undefined) throw new EnrolmentSessionGone();
    if (session.one_time_link_id === null) throw new ProblemException('forbidden');
    const link = await tx
      .selectFrom('identity.one_time_links')
      .select('id')
      .where('id', '=', session.one_time_link_id)
      .where('used_at', 'is', null)
      .where('superseded_at', 'is', null)
      .where('expires_at', '>', now)
      .executeTakeFirst();
    if (link === undefined) throw new EnrolmentSessionGone();
    return link.id;
  }

  async #confirmInTransaction(
    transaction: Kysely<Database>,
    principal: Principal,
    code: string,
    client: ClientInfo,
    now: Date,
  ): Promise<ConfirmOutcome> {
    const tx = identityTables(transaction);
    const linkId = await this.#lockEnrolment(tx, principal, now);
    const actor = { type: 'user', userId: principal.userId } as const;
    const current = { ...client.context, sessionId: principal.sessionId };
    const publish = (event: IdentityEvent, context: EventContext) => this.#events.publish(transaction, event, context);

    const user = await findUserById(tx, principal.userId, true);
    if (user === undefined || !totpAllowedForRole(user.role, principal.channel)) throw new ProblemException('forbidden');
    const factor = await findTotpFactor(tx, principal.userId, true);
    let step: number | null = null;
    if (factor?.state === 'pending') {
      const secret = openTotpSecret(this.#encryption, principal.userId, factor.secretCiphertext);
      step = this.#engine.match(secret, code, now);
      secret.fill(0);
    }
    if (step === null) {
      const failed: IdentityEvent = {
        type: 'mfa.totp_enrolled',
        actor,
        outcome: 'failed',
        reasonCode: 'totp_failed',
        objectType: 'user',
        objectId: principal.userId,
      };
      await publish(failed, current);
      return { refusal: 'totp_verification_failed' };
    }

    if (!(await activateTotp(tx, principal.userId, step, now))) throw new EnrolmentSessionGone();
    const link = await tx
      .updateTable('identity.one_time_links')
      .set({ used_at: now })
      .where('id', '=', linkId)
      .where('used_at', 'is', null)
      .where('superseded_at', 'is', null)
      .where('expires_at', '>', now)
      .returning('id')
      .executeTakeFirst();
    if (link === undefined) throw new EnrolmentSessionGone();
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
    const sessionToken = newToken();
    const sessionId = await insertSession(tx, {
      userId: principal.userId,
      channel: principal.channel,
      state: 'active',
      tokenHash: hashToken(sessionToken),
      linkId: null,
      now,
      passkeyAuthenticatedAt: null,
      // The code was just proved: the window of step-up operations opens (the third step of the setup needs it to make the recovery codes).
      totpAuthenticatedAt: now,
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      ip: client.context.ip,
      userAgent: client.userAgent,
    });
    await enqueueEmail(transaction, { kind: 'mfa_changed', variant: 'totp_enrolled', recipientUserId: principal.userId, now });

    await publish({ type: 'mfa.totp_enrolled', actor, outcome: 'success', objectType: 'user', objectId: principal.userId }, current);
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
      sessionToken,
      csrfToken: deriveCsrfToken(sessionToken),
      maxAgeSeconds: Math.floor(SESSION_ABSOLUTE_MS / 1000),
    };
  }
}
