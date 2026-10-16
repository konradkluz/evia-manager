/**
 * The invitation of a person and its resend (EVM-024 AC1, AC4, AC7, AC8; SR-AUTH-12, SR-SESS-08, SR-AUTHZ-05, SR-AUTHZ-11, SR-API-05, SR-LOG-03).
 * The guard has decided before this runs: only an Administrator with a fresh step-up on the web channel gets here, so a caller who may not
 * invite never reaches the validation, the conflict check or the table of idempotency records — nobody can tell, by the answer, whether an
 * address has an account before the right to ask (no enumeration of accounts).
 *
 * `invite` — order: the `Idempotency-Key` header and the strict body (`400`), the rules of the domain (`400`: pointers and codes, never
 * values); then ONE transaction: the idempotency port, the conflict of the address (`409 email_conflict`; the id of the account only when
 * it is visible in the list), the INSERT of the account in the state `invited` (an id that is taken — also a deleted account's — is
 * `409 id_conflict`; two invitations of one address at the same moment give one `201` and one `409`, never a 500), the row of the outbox
 * (ids only), the rows of the alerts when the role is Administrator, the audit event `user.invited` (no address, no name). No token is made
 * here: the worker makes it when it sends (the hash only is stored — notatka (c) of the story), so the answer holds none.
 *
 * `resend` — the account is locked FIRST, then the outbox rows (the order of the job `email.send`: no deadlock): an account that does not exist
 * or is deleted is `404`, one that is not `invited` is `409 invalid_state_transition` (no data of the account). The open links of THIS account
 * and the enrolment sessions started with them end NOW (`link_superseded`) — the earlier link stops working at once, whether or not the
 * mail service answers; a message still waiting is `superseded` and a new row replaces it.
 */
import { randomBytes } from 'node:crypto';
import { zInviteUserHeaders, zInviteUserRequest, zResendUserInvitationPath } from '@evia/contracts/zod';
import type { User } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { enqueueEmail, latestEmailStatus, supersedePendingEmails } from '../../../platform/email/email-outbox.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { normalizeInvitation, type InvitationInput, type NewInvitation } from '../domain/invitation-input.ts';
import type { IdentityEvent } from '../events.ts';
import {
  findLatestLink,
  findUserByEmail,
  findUserById,
  insertInvitedUser,
  listActiveAdministratorIds,
  revokeSessions,
  supersedeOpenLinksOfUser,
  type UserRow,
} from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import { toUser } from './user-representation.ts';

/** Method and route template: what an idempotency key is bound to besides the user. */
export const INVITE_USER_SCOPE = 'POST /api/v1/users';

const UNIQUE_VIOLATION = '23505';
const EMAIL_UNIQUE_CONSTRAINT = 'users_email_key';
const ALERT_VARIANT = 'administrator_invitation';

const inviteBody = strictObjects(zInviteUserRequest);
const resendPath = strictObjects(zResendUserInvitationPath);
const idempotencyKeySchema = zInviteUserHeaders.shape['Idempotency-Key'];

export interface InvitedUser {
  readonly user: User;
  /** True when the answer repeats an earlier invitation (same key and body): `Idempotent-Replayed: true`. */
  readonly replayed: boolean;
}

const isEmailRace = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === UNIQUE_VIOLATION &&
  (error as { constraint?: unknown }).constraint === EMAIL_UNIQUE_CONSTRAINT;

@Injectable()
export class InvitationService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
  }

  /** @param rawKey the `Idempotency-Key` header as received (`undefined` when absent) */
  async invite(principal: Principal, rawBody: unknown, rawKey: string | undefined, context: EventContext): Promise<InvitedUser> {
    const key = rawKey === undefined ? undefined : (parseInput(idempotencyKeySchema, rawKey) as string);
    const body = parseInput(inviteBody, rawBody) as InvitationInput;
    const normalized = normalizeInvitation(body);
    if (!normalized.ok) throw new ProblemException('validation_failed', { errors: normalized.errors });

    const request = { ...context, sessionId: principal.sessionId };
    return runInTransaction(this.#db, async (tx) => {
      const perform = async () => {
        const id = await this.#create(tx, principal, normalized.invitation, request);
        return { value: id, result: { status: 201, code: 'created', resourceId: id } };
      };
      let id: string;
      let replayed = false;
      if (key === undefined) {
        id = (await perform()).value;
      } else {
        const outcome = await this.#idempotency.run(
          tx,
          { userId: principal.userId, deviceId: null, key, scope: INVITE_USER_SCOPE, bodyHash: requestHash(body) },
          perform,
        );
        replayed = outcome.replayed;
        const known = outcome.replayed ? outcome.result.resourceId : outcome.value;
        if (known === null) throw new ProblemException('not_found');
        id = known;
      }
      const row = await findUserById(identityTables(tx), id);
      if (row === undefined || row.deletedAt !== null) throw new ProblemException('not_found');
      return { user: await this.#represent(tx, row, this.#clock.now()), replayed };
    });
  }

  /** @param rawParams the path parameters as parsed by the framework */
  async resend(principal: Principal, rawParams: unknown, context: EventContext): Promise<User> {
    const { userId } = parseInput(resendPath, rawParams) as { userId: string };
    const request = { ...context, sessionId: principal.sessionId };
    return runInTransaction(this.#db, async (tx) => {
      const db = identityTables(tx);
      const account = await findUserById(db, userId, true);
      if (account === undefined || account.deletedAt !== null) throw new ProblemException('not_found');
      if (account.status !== 'invited') throw new ProblemException('invalid_state_transition');

      const now = this.#clock.now();
      const publish = (event: IdentityEvent, eventContext: EventContext = request) => this.#events.publish(tx, event, eventContext);
      const superseded = await supersedeOpenLinksOfUser(db, userId, now);
      for (const id of await revokeSessions(db, { linkIds: superseded }, 'link_superseded', now)) {
        await publish({
          type: 'session.revoked',
          actor: { type: 'user', userId: principal.userId },
          outcome: 'success',
          reasonCode: 'link_superseded',
          objectType: 'session',
          objectId: id,
        });
      }
      await supersedePendingEmails(tx, userId, 'user_invitation');
      await enqueueEmail(tx, { kind: 'user_invitation', variant: null, recipientUserId: userId, now });
      if (account.role === 'administrator') await this.#alertAdministrators(tx, now);
      await publish({
        type: 'invitation.resent',
        actor: { type: 'user', userId: principal.userId },
        outcome: 'success',
        objectType: 'user',
        objectId: userId,
      });
      return this.#represent(tx, account, now);
    });
  }

  /** The account, its message and the alerts — and the audit event: all in the transaction of the caller. @returns the id of the account */
  async #create(tx: Kysely<Database>, principal: Principal, invitation: NewInvitation, context: EventContext): Promise<string> {
    const db = identityTables(tx);
    const existing = await findUserByEmail(db, invitation.email);
    if (existing !== undefined) throw emailConflict(existing);

    const now = this.#clock.now();
    let inserted: boolean;
    try {
      inserted = await insertInvitedUser(db, {
        id: invitation.id,
        email: invitation.email,
        displayName: invitation.displayName,
        role: invitation.role,
        webauthnUserHandle: randomBytes(32),
        createdBy: principal.userId,
        now,
      });
    } catch (error) {
      // The other invitation of this address committed between the check and the insert: a conflict, like the check itself — never a 500.
      if (isEmailRace(error)) throw new ProblemException('email_conflict');
      throw error;
    }
    if (!inserted) throw new ProblemException('id_conflict');

    await enqueueEmail(tx, { kind: 'user_invitation', variant: null, recipientUserId: invitation.id, now });
    if (invitation.role === 'administrator') await this.#alertAdministrators(tx, now);
    const event: IdentityEvent = {
      type: 'user.invited',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'user',
      objectId: invitation.id,
    };
    await this.#events.publish(tx, event, context);
    return invitation.id;
  }

  /** One alert per ACTIVE Administrator — the actor as well (SR-LOG-07); the text names no one. */
  async #alertAdministrators(tx: Kysely<Database>, now: Date): Promise<void> {
    for (const recipientUserId of await listActiveAdministratorIds(identityTables(tx))) {
      await enqueueEmail(tx, { kind: 'administrator_alert', variant: ALERT_VARIANT, recipientUserId, now });
    }
  }

  async #represent(tx: Kysely<Database>, row: UserRow, now: Date): Promise<User> {
    const link = await findLatestLink(identityTables(tx), row.id);
    const status = (await latestEmailStatus(tx, [row.id], 'user_invitation')).get(row.id);
    return toUser(
      row,
      link === undefined
        ? null
        : { issuedAt: link.issued_at, expiresAt: link.expires_at, usedAt: link.used_at, supersededAt: link.superseded_at },
      status,
      now,
    );
  }
}

/** `409 email_conflict`: the id of the account only when it is visible in the list (a deleted account's address is taken all the same, with no pointer to it). */
function emailConflict(existing: UserRow): ProblemException {
  return new ProblemException('email_conflict', existing.deletedAt === null ? { existingUserId: existing.id } : {});
}
