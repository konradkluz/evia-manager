/**
 * Change of the own password (EVM-028 AC2; SR-AUTH-01, SR-AUTH-02, SR-AUTH-03, SR-AUTH-10, SR-AUTH-15; ASVS V6.2.x, V6.3.1, V7.4.3, V7.5.1; CWE-620, CWE-307).
 * The order is the one of the screen W-15, so the person sees the error of the new password BEFORE the dialog of the second step:
 *
 * 1. the current password — through the counter against guessing of the sign-in (`VerificationGate`, K2): the wait, one verification, a failure counted and
 *    audited (`password.changed` failed, `bad_password`) as `401 invalid_credentials`, or the reservation given back; a lock holding → `429` and the session ends;
 * 2. the new password — the rules of SR-AUTH-01 and SR-AUTH-02 (`PasswordSetting`: length, popular and contextual passwords, Pwned Passwords) and "not the same
 *    as the current one" (`400`, `/newPassword`, `same_as_current`);
 * 3. the mark of the full re-authentication with the purpose `password_change` (the second step alone), spent by a conditional UPDATE in the SAME transaction as
 *    the write — `403 reauthentication_required` without it, and nothing changes.
 *
 * The write is one transaction (the account locked first): the new Argon2id hash, the lock whose cause is the password lifted (a lock of the second step stays),
 * the register of the browsers of the account forgotten (EVM-026 AC5, as after a reset), the pending reset links and first steps of the account ended, e-mail 4
 * (variant `from_account`) and the audit event — no password, no hash, no address. The other sessions are NOT ended (the answer says how many there are, for
 * "Zakończ pozostałe sesje").
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ChangePasswordRequest, PasswordChanged } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { enqueueEmail } from '../../../platform/email/email-outbox.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { PASSWORD_CHANGE_ACCOUNT_VARIANT } from '../domain/email-templates.ts';
import type { IdentityEvent } from '../events.ts';
import { consumeReauthMark, countOtherAliveSessions, findPasswordHash, savePasswordHash } from '../infrastructure/account-queries.ts';
import { PASSWORD_HASHER, type PasswordHasher } from '../infrastructure/ports.ts';
import { findUserById, revokeLoginAttemptsOfUser, supersedeOpenResetLinksOfUser } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';
import { LoginThrottle } from './login-throttle.ts';
import { PasswordSetting } from './password-setting.ts';
import { VerificationGate, type VerificationTry } from './verification-gate.ts';

type Refusal = { readonly refusal: 'invalid_credentials' } | { readonly refusal: 'rate_limited'; readonly retryAfterSeconds: number };

@Injectable()
export class PasswordChangeService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #hasher: PasswordHasher;
  readonly #password: PasswordSetting;
  readonly #throttle: LoginThrottle;
  readonly #gate: VerificationGate;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(PASSWORD_HASHER) hasher: PasswordHasher,
    @Inject(PasswordSetting) password: PasswordSetting,
    @Inject(LoginThrottle) throttle: LoginThrottle,
    @Inject(VerificationGate) gate: VerificationGate,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#hasher = hasher;
    this.#password = password;
    this.#throttle = throttle;
    this.#gate = gate;
  }

  async change(
    principal: Principal,
    body: ChangePasswordRequest,
    client: ClientInfo,
    deviceToken: string | undefined,
  ): Promise<PasswordChanged> {
    const attempt = await this.#gate.begin(principal, deviceToken, client, 'password.changed');
    await this.#verifyCurrent(principal, body.currentPassword, client, attempt);

    const user = await findUserById(identityTables(this.#db), principal.userId);
    if (user === undefined) throw new ProblemException('session_revoked');
    if (body.newPassword.normalize('NFC') === body.currentPassword.normalize('NFC')) {
      throw new ProblemException('validation_failed', { errors: [{ pointer: '/newPassword', code: 'same_as_current' }] });
    }
    const passwordHash = await this.#password.hashAcceptable(
      body.newPassword,
      { email: user.email, displayName: user.displayName },
      '/newPassword',
    );

    return runInTransaction(this.#db, async (transaction): Promise<PasswordChanged> => {
      const tx = identityTables(transaction);
      const now = this.#clock.now();
      // The account first (the order of locks of every unit of work that changes it).
      const locked = await findUserById(tx, principal.userId, true);
      if (locked?.status !== 'active') throw new ProblemException('session_revoked');
      if (!(await consumeReauthMark(tx, principal.sessionId, 'password_change', now)))
        throw new ProblemException('reauthentication_required');

      await savePasswordHash(tx, principal.userId, passwordHash, now);
      // The new password ends the lock whose cause is the password (a lock of the second step in the window stays, EVM-026 AC7); the browsers the account
      // knew are forgotten (AC5) — the next sign-in comes from a browser the account does not know yet.
      await this.#throttle.liftPasswordLock(transaction, locked.email);
      await this.#throttle.forgetBrowsers(transaction, principal.userId);
      await supersedeOpenResetLinksOfUser(tx, principal.userId, now);
      await revokeLoginAttemptsOfUser(tx, principal.userId, now);
      await enqueueEmail(transaction, {
        kind: 'password_changed',
        variant: PASSWORD_CHANGE_ACCOUNT_VARIANT,
        recipientUserId: principal.userId,
        now,
      });
      const changed: IdentityEvent = {
        type: 'password.changed',
        actor: { type: 'user', userId: principal.userId },
        outcome: 'success',
        objectType: 'user',
        objectId: principal.userId,
      };
      await this.#events.publish(transaction, changed, { ...client.context, sessionId: principal.sessionId });
      return { otherActiveSessions: await countOtherAliveSessions(tx, principal.userId, principal.sessionId, now) };
    });
  }

  /** One verification of the current password: a wrong one is counted and refused, a right one gives its reservation back. */
  async #verifyCurrent(principal: Principal, currentPassword: string, client: ClientInfo, attempt: VerificationTry): Promise<void> {
    const hash = await findPasswordHash(identityTables(this.#db), principal.userId);
    const matches = hash !== undefined && (await this.#hasher.verify(hash, currentPassword.normalize('NFC')));
    const refusal = await runInTransaction(this.#db, async (transaction): Promise<Refusal | undefined> => {
      const now = this.#clock.now();
      if (matches) {
        await this.#gate.pass(transaction, attempt, now);
        return undefined;
      }
      const refused: IdentityEvent = {
        type: 'password.changed',
        actor: { type: 'user', userId: principal.userId },
        outcome: 'failed',
        reasonCode: 'bad_password',
        objectType: 'user',
        objectId: principal.userId,
      };
      await this.#events.publish(transaction, refused, { ...client.context, sessionId: principal.sessionId });
      const failed = await this.#gate.fail(transaction, attempt, 'bad_password', client, now);
      return failed.lockedForSeconds === undefined
        ? { refusal: 'invalid_credentials' }
        : { refusal: 'rate_limited', retryAfterSeconds: failed.lockedForSeconds };
    });
    if (refusal === undefined) return;
    throw new ProblemException(refusal.refusal, refusal.refusal === 'rate_limited' ? { retryAfterSeconds: refusal.retryAfterSeconds } : {});
  }
}
