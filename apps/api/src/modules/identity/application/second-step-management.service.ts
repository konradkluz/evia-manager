/**
 * Removing a method of the second step from the account (EVM-028 AC3, AC4; SR-AUTH-10, SR-AUTH-15, SR-LOG-07, SR-AUTHZ-05; ASVS V7.5.1, V7.4.3; CWE-639, CWE-362).
 * Adding one is the work of the enrolment services (`PasskeyService`, `TotpEnrolmentService`) — the same mark of the full re-authentication guards both.
 *
 * One transaction, the account locked FIRST (so two parallel removals are serialised and the second sees the first — the rule of AC4 is decided under that
 * lock, never from a count read earlier): the key is looked up for THIS account only (a key of somebody else, a missing one and an already removed one are
 * the same `404 not_found`), then the mark `second_step_change` is spent (`403 reauthentication_required`), then the rule (`409 last_second_step_method`):
 * an Administrator keeps at least one PASSKEY (the code of the app does not count for him), every other account at least one METHOD (recovery codes are
 * none). A refusal rolls everything back, the mark included — the person may add the missing method and try again within the 5 minutes.
 *
 * The removal of a key deletes its row (its public key and its name go with it). The e-mail 5 names the kind of change, never the name of the key, and an
 * Administrator's account sends the alert 9 to every active Administrator.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { canRemoveMethod, type RemovableMethod } from '../domain/second-step-rules.ts';
import type { IdentityEvent } from '../events.ts';
import { consumeReauthMark, countPasskeys, deleteOwnPasskey, findOwnPasskey } from '../infrastructure/account-queries.ts';
import { deleteTotpFactor } from '../infrastructure/access-queries.ts';
import { findTotpFactor } from '../infrastructure/mfa-queries.ts';
import { findUserById } from '../infrastructure/queries.ts';
import { identityTables, type IdentityDb } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';
import { noticeSecondStepChange } from './second-step-notice.ts';

@Injectable()
export class SecondStepManagementService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(CLOCK) clock: Clock, @Inject(EVENT_BUS) events: EventBus) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
  }

  async removePasskey(principal: Principal, passkeyId: string, client: ClientInfo): Promise<void> {
    await runInTransaction(this.#db, async (transaction) => {
      const tx = identityTables(transaction);
      const now = this.#clock.now();
      const user = await this.#lockAccount(tx, principal);
      // The owner is in the WHERE: a key of somebody else is a key that does not exist (CWE-639).
      if ((await findOwnPasskey(tx, principal.userId, passkeyId, true)) === undefined) throw new ProblemException('not_found');
      await this.#spendMark(tx, principal, now);
      await this.#requireRule(tx, user.role, principal.userId, 'passkey');
      await deleteOwnPasskey(tx, principal.userId, passkeyId);
      await noticeSecondStepChange(transaction, { userId: principal.userId, role: user.role }, 'passkey_removed', now);
      await this.#publish(transaction, principal, client, { type: 'passkey.removed', objectType: 'passkey', objectId: passkeyId });
    });
  }

  async removeTotp(principal: Principal, client: ClientInfo): Promise<void> {
    await runInTransaction(this.#db, async (transaction) => {
      const tx = identityTables(transaction);
      const now = this.#clock.now();
      const user = await this.#lockAccount(tx, principal);
      await this.#spendMark(tx, principal, now);
      const factor = await findTotpFactor(tx, principal.userId, true);
      // A pending factor is no method: there is nothing to remove until the code is confirmed.
      if (factor?.state !== 'active') throw new ProblemException('not_found');
      await this.#requireRule(tx, user.role, principal.userId, 'totp');
      await deleteTotpFactor(tx, principal.userId);
      await noticeSecondStepChange(transaction, { userId: principal.userId, role: user.role }, 'totp_removed', now);
      await this.#publish(transaction, principal, client, { type: 'mfa.totp_removed', objectType: 'user', objectId: principal.userId });
    });
  }

  /** The account first — the order of locks of every unit of work that changes it; an account that is no longer active has no session. */
  async #lockAccount(tx: IdentityDb, principal: Principal) {
    const user = await findUserById(tx, principal.userId, true);
    if (user?.status !== 'active') throw new ProblemException('session_revoked');
    return user;
  }

  async #spendMark(tx: IdentityDb, principal: Principal, now: Date): Promise<void> {
    if (!(await consumeReauthMark(tx, principal.sessionId, 'second_step_change', now)))
      throw new ProblemException('reauthentication_required');
  }

  async #requireRule(
    tx: IdentityDb,
    role: 'administrator' | 'editor' | 'read_only',
    userId: string,
    target: RemovableMethod,
  ): Promise<void> {
    const totp = await findTotpFactor(tx, userId);
    const verdict = canRemoveMethod(role, { passkeys: await countPasskeys(tx, userId), totp: totp?.state === 'active' }, target);
    if (verdict.allowed) return;
    throw new ProblemException('last_second_step_method', {
      errors: [
        {
          pointer: target === 'passkey' ? '/passkeyId' : '/totp',
          code: verdict.required === 'passkey' ? 'passkey_required' : 'method_required',
        },
      ],
    });
  }

  #publish(
    transaction: Kysely<Database>,
    principal: Principal,
    client: ClientInfo,
    what: { readonly type: 'passkey.removed' | 'mfa.totp_removed'; readonly objectType: 'passkey' | 'user'; readonly objectId: string },
  ): Promise<void> {
    const event: IdentityEvent = { ...what, actor: { type: 'user', userId: principal.userId }, outcome: 'success' };
    return this.#events.publish(transaction, event, { ...client.context, sessionId: principal.sessionId });
  }
}
