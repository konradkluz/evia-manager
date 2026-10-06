/**
 * The server-side command behind the first Administrator and the emergency mode (AC1, AC2; SR-AUTH-12, RR-16). There is
 * no HTTP endpoint for it (SR-AUTH-14): it runs inside the API container, started by a person with SSH access
 * (`docker exec -it`), and prints the link on the terminal only (src/cli). Everything below is one transaction behind an
 * advisory lock, so two runs never interleave:
 *
 * - no active Administrator: the account (`invited`, role Administrator) is created or reused and a 72-hour link is
 *   issued; every earlier unused link — of any account — and the sessions started with it are ended, so a second
 *   bootstrap cannot keep a second valid way in (A1d, W8); an earlier pending Administrator with another address is
 *   deactivated;
 * - an active Administrator exists: refusal without any change — unless the emergency mode names that account: it goes
 *   back to "requires activation" (credentials deleted for real, all sessions ended, `401 session_revoked`), a new link
 *   is issued, and an audit event and a durable security alert are written (the alert outbox, A2).
 * Refusals do not tell an unknown address from an account that is not an active Administrator.
 */
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { enqueueSecurityAlert } from '../../../platform/alerts/security-alerts.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { ACTIVATION_LINK_TTL_MS, ADMINISTRATOR_LOCK_KEY } from '../domain/constants.ts';
import { displayNameFromEmail } from '../domain/text.ts';
import { hashToken, newToken } from '../domain/tokens.ts';
import type { EmergencyReason, IdentityEvent } from '../events.ts';
import { insertLink, lockAdministrators, revokeSessions, supersedeOpenLinks } from '../infrastructure/queries.ts';
import { identityTables, type IdentityDb } from '../infrastructure/tables.ts';

export type BootstrapRequest =
  | { readonly mode: 'activation'; readonly email: string }
  | { readonly mode: 'emergency'; readonly email: string; readonly reason: EmergencyReason };

export type BootstrapResult =
  | { readonly kind: 'issued'; readonly token: string; readonly expiresAt: Date }
  | { readonly kind: 'refused'; readonly reason: 'active_administrator_exists' | 'account_unavailable' };

const refused = (reason: 'active_administrator_exists' | 'account_unavailable'): BootstrapResult => ({ kind: 'refused', reason });

@Injectable()
export class AdministratorBootstrap {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(CLOCK) clock: Clock, @Inject(EVENT_BUS) events: EventBus) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
  }

  /** @param email already normalised (NFC, trimmed, lower case) and validated by the caller */
  async run(request: BootstrapRequest, context: EventContext): Promise<BootstrapResult> {
    return this.#db.transaction().execute(async (transaction) => {
      const tx = identityTables(transaction);
      await lockAdministrators(tx, ADMINISTRATOR_LOCK_KEY);
      const now = this.#clock.now();
      const publish = (event: IdentityEvent) => this.#events.publish(transaction, event, context);

      const activeAdministrators = await tx
        .selectFrom('identity.users')
        .select(['id', 'email'])
        .where('role', '=', 'administrator')
        .where('status', '=', 'active')
        .execute();

      let userId: string;
      if (request.mode === 'activation') {
        if (activeAdministrators.length > 0) return refused('active_administrator_exists');
        const target = await this.#invitedAdministrator(tx, request.email, now);
        if (target === undefined) return refused('account_unavailable');
        userId = target;
        // An earlier pending Administrator with another address would keep an account nobody can activate.
        await tx
          .updateTable('identity.users')
          .set({ status: 'deactivated', deactivated_at: now, updated_at: now, version: sql`version + 1` })
          .where('role', '=', 'administrator')
          .where('status', '=', 'invited')
          .where('id', '<>', userId)
          .execute();
      } else {
        const target = activeAdministrators.find((administrator) => administrator.email === request.email);
        if (target === undefined) return refused('account_unavailable');
        userId = target.id;
        await this.#resetAccount(tx, userId, now);
        const revoked = await revokeSessions(tx, { userId }, 'emergency_reset', now);
        await publish({
          type: 'account.emergency_reset',
          actor: { type: 'system' },
          outcome: 'success',
          reasonCode: request.reason,
          objectType: 'user',
          objectId: userId,
        });
        for (const id of revoked) await publish(sessionRevoked(id, 'emergency_reset'));
        await enqueueSecurityAlert(transaction, { code: 'emergency_reset', occurredAt: now, traceId: context.traceId });
      }

      const superseded = await supersedeOpenLinks(tx, now);
      for (const id of await revokeSessions(tx, { linkIds: superseded }, 'link_superseded', now)) {
        await publish(sessionRevoked(id, 'link_superseded'));
      }

      const token = newToken();
      const expiresAt = new Date(now.getTime() + ACTIVATION_LINK_TTL_MS);
      await insertLink(tx, { userId, tokenHash: hashToken(token), issuedAt: now, expiresAt });
      await publish({
        type: 'activation_link.issued',
        actor: { type: 'system' },
        outcome: 'success',
        objectType: 'user',
        objectId: userId,
      });
      return { kind: 'issued', token, expiresAt };
    });
  }

  /** The pending Administrator with this address (created when new); undefined when the address belongs to another kind of account. */
  async #invitedAdministrator(tx: IdentityDb, email: string, now: Date): Promise<string | undefined> {
    const existing = await tx.selectFrom('identity.users').select(['id', 'role', 'status']).where('email', '=', email).executeTakeFirst();
    if (existing !== undefined) return existing.role === 'administrator' && existing.status === 'invited' ? existing.id : undefined;
    const created = await tx
      .insertInto('identity.users')
      .values({
        email,
        display_name: displayNameFromEmail(email),
        role: 'administrator',
        status: 'invited',
        webauthn_user_handle: randomBytes(32),
        last_login_at: null,
        deactivated_at: null,
        created_at: now,
        created_by: null,
        updated_at: now,
        updated_by: null,
        deleted_at: null,
        deleted_by: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return created.id;
  }

  /** Back to "requires activation": password and passkeys are secrets, so they are deleted, not flagged. */
  async #resetAccount(tx: IdentityDb, userId: string, now: Date): Promise<void> {
    await tx.deleteFrom('identity.password_credentials').where('user_id', '=', userId).execute();
    await tx.deleteFrom('identity.passkeys').where('user_id', '=', userId).execute();
    await tx
      .updateTable('identity.users')
      .set({ status: 'invited', updated_at: now, version: sql`version + 1` })
      .where('id', '=', userId)
      .execute();
  }
}

const sessionRevoked = (sessionId: string, reason: 'emergency_reset' | 'link_superseded'): IdentityEvent => ({
  type: 'session.revoked',
  actor: { type: 'system' },
  outcome: 'success',
  reasonCode: reason,
  objectType: 'session',
  objectId: sessionId,
});
