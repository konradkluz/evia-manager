/**
 * Composes the e-mails of the identity module for the worker of the outbox (EVM-024 AC1, AC4; SR-AUTH-12, SR-CRYPTO-03, SR-LOG-02, TM-44, TM-80).
 * It runs inside the transaction of the job `email.send` (the platform locks the account FIRST — `lockRecipient` — and the outbox row after):
 *
 * - `user_invitation`: the account must still be `invited` (a late or replaced message for an account that is active, deactivated or deleted
 *   is `obsolete` — NO token is made and nothing is sent: SR-AUTH-12). Then, in this one transaction: the address is checked (a malformed one
 *   is a permanent refusal BEFORE any token exists), the open links of THIS account and the enrolment sessions started with them are
 *   superseded (`link_superseded`), a token is made (`newToken`, 256 bits of the CSPRNG), only its SHA-256 is stored (`issued_by:
 *   invitation`, valid 72 hours FROM THE SENDING), the audit event `activation_link.issued` is written (actor: the system) and the message is
 *   composed from the fixed template. The raw token exists only in memory, in that message, until the mail is handed over.
 * - `administrator_alert`: the recipient must be an active Administrator at the moment of sending; no token, a text without a person.
 *
 * The address is read here, from the account, at the moment of sending — the outbox holds ids only (SR-DATA-01).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { AppConfig } from '../../../platform/config/config.ts';
import type { Database } from '../../../platform/database/database.ts';
import { createOutgoingEmail, parseEmailAddress } from '../../../platform/email/email-address.ts';
import type { ComposedEmail, EmailComposer } from '../../../platform/email/email-composer.ts';
import { EmailPermanentError } from '../../../platform/email/email-errors.ts';
import type { EmailKind, OutboxMessage } from '../../../platform/email/email-outbox.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { newTraceId } from '../../../platform/http/request-context.ts';
import { APP_CONFIG, CLOCK, EVENT_BUS } from '../../../platform/tokens.ts';
import { ACTIVATION_LINK_TTL_MS } from '../domain/constants.ts';
import { activationLink, alertText, invitationText, isAlertVariant } from '../domain/email-templates.ts';
import { hashToken, newToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { findUserById, insertLink, revokeSessions, supersedeOpenLinksOfUser, type UserRow } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';

const KINDS: readonly EmailKind[] = ['user_invitation', 'administrator_alert'];

@Injectable()
export class InvitationEmailComposer implements EmailComposer {
  readonly kinds = KINDS;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #panelOrigin: string;

  constructor(@Inject(CLOCK) clock: Clock, @Inject(EVENT_BUS) events: EventBus, @Inject(APP_CONFIG) config: AppConfig) {
    this.#clock = clock;
    this.#events = events;
    this.#panelOrigin = config.panelOrigin;
  }

  async lockRecipient(tx: Kysely<Database>, recipientUserId: string): Promise<void> {
    await findUserById(identityTables(tx), recipientUserId, true);
  }

  async compose(tx: Kysely<Database>, message: OutboxMessage): Promise<ComposedEmail> {
    const user = await findUserById(identityTables(tx), message.recipientUserId);
    if (user === undefined || user.deletedAt !== null) return { status: 'obsolete' };
    return message.kind === 'user_invitation' ? this.#invitation(tx, user) : this.#alert(user, message);
  }

  async #invitation(tx: Kysely<Database>, user: UserRow): Promise<ComposedEmail> {
    if (user.status !== 'invited') return { status: 'obsolete' };
    const to = parseEmailAddress(user.email);
    if (to === undefined) throw new EmailPermanentError('recipient_rejected');

    const db = identityTables(tx);
    const now = this.#clock.now();
    const context: EventContext = { origin: 'cli', traceId: newTraceId() };
    const publish = (event: IdentityEvent) => this.#events.publish(tx, event, context);

    const superseded = await supersedeOpenLinksOfUser(db, user.id, now);
    for (const id of await revokeSessions(db, { linkIds: superseded }, 'link_superseded', now)) {
      await publish({
        type: 'session.revoked',
        actor: { type: 'system' },
        outcome: 'success',
        reasonCode: 'link_superseded',
        objectType: 'session',
        objectId: id,
      });
    }

    const token = newToken();
    const expiresAt = new Date(now.getTime() + ACTIVATION_LINK_TTL_MS);
    await insertLink(db, { userId: user.id, tokenHash: hashToken(token), issuedAt: now, expiresAt, issuedBy: 'invitation' });
    await publish({ type: 'activation_link.issued', actor: { type: 'system' }, outcome: 'success', objectType: 'user', objectId: user.id });

    const { subject, text } = invitationText({
      panelOrigin: this.#panelOrigin,
      role: user.role,
      link: activationLink(this.#panelOrigin, token),
      expiresAt,
    });
    return { status: 'ready', email: createOutgoingEmail({ to, subject, text }) };
  }

  #alert(user: UserRow, message: OutboxMessage): ComposedEmail {
    if (user.status !== 'active' || user.role !== 'administrator') return { status: 'obsolete' };
    if (!isAlertVariant(message.variant)) throw new EmailPermanentError('invalid_message');
    const to = parseEmailAddress(user.email);
    if (to === undefined) throw new EmailPermanentError('recipient_rejected');
    const { subject, text } = alertText({ panelOrigin: this.#panelOrigin, variant: message.variant, occurredAt: message.createdAt });
    return { status: 'ready', email: createOutgoingEmail({ to, subject, text }) };
  }
}
