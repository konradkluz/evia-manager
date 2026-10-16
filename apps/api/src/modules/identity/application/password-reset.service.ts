/**
 * Reset of a forgotten password with a one-time link (EVM-025 AC1-AC6; SR-AUTH-11, SR-AUTH-15, SR-AUTH-05 by analogy, SR-API-04; ASVS V6.4.x;
 * CWE-204, CWE-208, CWE-640). Three steps of the panel, three methods:
 *
 * - `request` — ALWAYS the same answer (the caller returns `202 {}`) and the same shape of work for an active, an unknown, an invited, a
 *   deactivated and a deleted account, and for a request held back by the limit of the account; the answer never comes sooner than a floor after
 *   the start of the request (CWE-208). The e-mail goes only to an active account WITH a passkey (no second step → no link, K1); it is written
 *   as a row of the outbox (identifiers only) and the worker issues the token when it sends (see `PasswordEmailComposer`). The recipient is read
 *   from the account row by the worker — nothing of the request reaches the mail but the lookup key, which is normalised like at sign-in.
 *   A flood of one mailbox is held back silently: one message per minute and five per hour per account (K7).
 * - `check` — one query by the hash of the token and the purpose; never spends the link (a scanner of a mail client may open it).
 * - `complete` — token → local policy → Pwned Passwords → Argon2id → ONE transaction (the account is locked first, then the link): the link is
 *   re-checked under the lock, the password is saved, the link is spent, every open reset link and every first step (`loginToken`) of the account
 *   ends, every session of the account ends (`password_reset`, the caller's own included), the notice "password changed" is put in the outbox
 *   and the first step of a new sign-in is opened. The answer holds a `loginToken` and NO session or cookie: the reset does not skip the second
 *   step (AC4). An account without a passkey gets nothing (fail-closed) — the transaction is rolled back with the same code as any dead link.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { LoginSecondStep, PasswordResetLinkInfo } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { countRecentEmails, enqueueEmail, supersedePendingEmails } from '../../../platform/email/email-outbox.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { enforceResponseFloor, type Sleeper } from '../../../platform/http/response-floor.ts';
import { CLOCK, DATABASE, EVENT_BUS, SLEEPER } from '../../../platform/tokens.ts';
import { PASSWORD_RESET_HOURLY_LIMIT, PASSWORD_RESET_MIN_INTERVAL_MS, PASSWORD_RESET_RESPONSE_FLOOR_MS } from '../domain/constants.ts';
import { normalizeEmail } from '../domain/text.ts';
import { hashToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import {
  findLinkOfPurpose,
  findUserByEmail,
  findUserById,
  isResetLinkUsable,
  markLinkUsed,
  revokeLoginAttemptsOfUser,
  revokeSessions,
  supersedeOpenResetLinksOfUser,
  type LinkRecord,
  type UserRow,
} from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';
import { PasswordSetting } from './password-setting.ts';
import { openSecondStep, secondStepMethods } from './second-step.ts';

const HOUR_MS = 3_600_000;
const CONTROL_CHARACTER = /\p{Cc}/u;

const invalid = (): ProblemException => new ProblemException('password_reset_link_invalid');

@Injectable()
export class PasswordResetService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #sleeper: Sleeper;
  readonly #password: PasswordSetting;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(SLEEPER) sleeper: Sleeper,
    @Inject(PasswordSetting) password: PasswordSetting,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#sleeper = sleeper;
    this.#password = password;
  }

  /** Always returns normally for well-formed input: what happened (a message, a limit, nothing) is not the caller's to know. */
  async request(email: string, client: ClientInfo): Promise<void> {
    const startedAt = this.#clock.now();
    await runInTransaction(this.#db, (transaction) => this.#requestInTransaction(transaction, normalizeEmail(email), client));
    await enforceResponseFloor(this.#clock, this.#sleeper, startedAt, PASSWORD_RESET_RESPONSE_FLOOR_MS);
  }

  async #requestInTransaction(transaction: Kysely<Database>, email: string, client: ClientInfo): Promise<void> {
    // An address with a control character (a NUL, a line break) is no address of any account — and the database would refuse the NUL.
    if (CONTROL_CHARACTER.test(email)) return;
    const tx = identityTables(transaction);
    const found = await findUserByEmail(tx, email);
    if (found === undefined || found.deletedAt !== null) return;
    // The account is locked, then re-read: of two parallel requests the second sees the message of the first and is held back.
    const user = await findUserById(tx, found.id, true);
    if (user === undefined) return;

    const eligible = user.status === 'active' && (await secondStepMethods(transaction, user.id)).length > 0;
    if (!eligible) {
      await this.#publish(transaction, client, user, 'denied', user.status === 'active' ? 'other' : 'not_active');
      return;
    }
    const now = this.#clock.now();
    if (await this.#heldBack(transaction, user.id, now)) return;

    await supersedePendingEmails(transaction, user.id, 'password_reset');
    await enqueueEmail(transaction, { kind: 'password_reset', variant: null, recipientUserId: user.id, now });
    await this.#publish(transaction, client, user, 'success');
  }

  /** One message per minute and five per hour per account (every state counts); a held-back request writes nothing — not even an audit event. */
  async #heldBack(transaction: Kysely<Database>, userId: string, now: Date): Promise<boolean> {
    const lastMinute = await countRecentEmails(
      transaction,
      userId,
      'password_reset',
      new Date(now.getTime() - PASSWORD_RESET_MIN_INTERVAL_MS),
    );
    if (lastMinute > 0) return true;
    const lastHour = await countRecentEmails(transaction, userId, 'password_reset', new Date(now.getTime() - HOUR_MS));
    return lastHour >= PASSWORD_RESET_HOURLY_LIMIT;
  }

  #publish(
    transaction: Kysely<Database>,
    client: ClientInfo,
    user: UserRow,
    outcome: 'success' | 'denied',
    reasonCode?: 'other' | 'not_active',
  ): Promise<void> {
    const event: IdentityEvent = {
      type: 'password.reset_requested',
      actor: { type: 'anonymous' },
      outcome,
      ...(reasonCode === undefined ? {} : { reasonCode }),
      objectType: 'user',
      objectId: user.id,
    };
    return this.#events.publish(transaction, event, client.context);
  }

  /** @returns the e-mail of the account of a usable link (for W-12); never changes anything */
  async check(token: string): Promise<PasswordResetLinkInfo> {
    const link = await this.#usableLink(token);
    return { email: link.email };
  }

  async complete(token: string, password: string, client: ClientInfo): Promise<LoginSecondStep> {
    const link = await this.#usableLink(token);
    const passwordHash = await this.#password.hashAcceptable(password, link);

    return runInTransaction(this.#db, async (transaction): Promise<LoginSecondStep> => {
      const tx = identityTables(transaction);
      // The order of locks everywhere: the account first, then the link.
      await findUserById(tx, link.userId, true);
      const locked = await findLinkOfPurpose(tx, 'password_reset', hashToken(token), true);
      const now = this.#clock.now();
      if (locked === undefined || !isResetLinkUsable(locked, now)) throw invalid();
      const methods = await secondStepMethods(transaction, locked.userId);
      if (methods.length === 0) throw invalid();

      await tx
        .insertInto('identity.password_credentials')
        .values({ user_id: locked.userId, password_hash: passwordHash, updated_at: now })
        .onConflict((conflict) => conflict.column('user_id').doUpdateSet({ password_hash: passwordHash, updated_at: now }))
        .execute();
      if (!(await markLinkUsed(tx, locked.linkId, now))) throw invalid();
      await supersedeOpenResetLinksOfUser(tx, locked.userId, now);
      const revoked = await revokeSessions(tx, { userId: locked.userId }, 'password_reset', now);
      // Every earlier first step ends BEFORE the new one is opened: an old `loginToken` is dead, the new one works only for the key.
      await revokeLoginAttemptsOfUser(tx, locked.userId, now);
      const loginToken = await openSecondStep(transaction, locked.userId, now);
      await enqueueEmail(transaction, { kind: 'password_changed', variant: null, recipientUserId: locked.userId, now });

      const actor = { type: 'user', userId: locked.userId } as const;
      const publish = (event: IdentityEvent, context: EventContext = client.context) => this.#events.publish(transaction, event, context);
      await publish({ type: 'password.reset', actor, outcome: 'success', objectType: 'user', objectId: locked.userId });
      for (const id of revoked) {
        await publish({
          type: 'session.revoked',
          actor,
          outcome: 'success',
          reasonCode: 'password_reset',
          objectType: 'session',
          objectId: id,
        });
      }
      return { state: 'second_step', loginToken, methods };
    });
  }

  /** One answer for every kind of unusable link (unknown, used, superseded, expired, another purpose, an account that is not active). */
  async #usableLink(token: string): Promise<LinkRecord> {
    const link = await findLinkOfPurpose(identityTables(this.#db), 'password_reset', hashToken(token));
    if (link === undefined || !isResetLinkUsable(link, this.#clock.now())) throw invalid();
    return link;
  }
}
