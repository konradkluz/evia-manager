/**
 * Composes the password e-mails for the worker of the outbox (EVM-025 AC1, AC2, AC5; SR-AUTH-11, SR-AUTH-15, SR-CRYPTO-03, SR-LOG-02, TM-44).
 * Like the invitation, it runs inside the transaction of the job `email.send` (the account is locked FIRST — `lockRecipient` — the outbox row after):
 *
 * - `password_reset`: the account must still be `active`, not deleted, with a second step it may use in the panel (a passkey or a TOTP — fail-closed: an
 *   account without one gets no link — K1), and the request must not be older than the validity of a link (the worker was down: a link long after the request is
 *   `obsolete`, L2). Then, in this one transaction: the open reset links of THIS account are superseded (a newer link replaces them), a token is
 *   made (`newToken`, 256 bits of the CSPRNG), only its SHA-256 is stored (`issued_by: password_reset`, valid 30 minutes FROM THE SENDING), the
 *   audit event `password_reset_link.issued` is written (actor: the system) and the message is composed from the fixed template. The raw token
 *   exists only in memory, in that message, until the mail is handed over; it is in no row, no payload of a job, no log (K5).
 * - `password_changed`: the account must still be `active`; the text names the time of the change and no token.
 *
 * The recipient is ALWAYS the address of the account row read here — never a value from a request (CWE-640, CWE-93).
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
import { PASSWORD_RESET_LINK_TTL_MS } from '../domain/constants.ts';
import { passwordChangedText, passwordResetLink, passwordResetText } from '../domain/email-templates.ts';
import { hashToken, newToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { findUserById, insertResetLink, supersedeOpenResetLinksOfUser, type UserRow } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import { secondStepMethods } from './second-step.ts';

const KINDS: readonly EmailKind[] = ['password_reset', 'password_changed'];

@Injectable()
export class PasswordEmailComposer implements EmailComposer {
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
    if (user?.deletedAt !== null || user.status !== 'active') return { status: 'obsolete' };
    return message.kind === 'password_reset' ? this.#resetLink(tx, user, message) : this.#changed(user, message);
  }

  async #resetLink(tx: Kysely<Database>, user: UserRow, message: OutboxMessage): Promise<ComposedEmail> {
    const now = this.#clock.now();
    if (now.getTime() - message.createdAt.getTime() > PASSWORD_RESET_LINK_TTL_MS) return { status: 'obsolete' };
    const db = identityTables(tx);
    if ((await secondStepMethods(tx, user.id)).length === 0) return { status: 'obsolete' };
    const to = parseEmailAddress(user.email);
    if (to === undefined) throw new EmailPermanentError('recipient_rejected');

    await supersedeOpenResetLinksOfUser(db, user.id, now);
    const token = newToken();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_LINK_TTL_MS);
    await insertResetLink(db, { userId: user.id, tokenHash: hashToken(token), issuedAt: now, expiresAt });
    const context: EventContext = { origin: 'cli', traceId: newTraceId() };
    const issued: IdentityEvent = {
      type: 'password_reset_link.issued',
      actor: { type: 'system' },
      outcome: 'success',
      objectType: 'user',
      objectId: user.id,
    };
    await this.#events.publish(tx, issued, context);

    const { subject, text } = passwordResetText({
      panelOrigin: this.#panelOrigin,
      link: passwordResetLink(this.#panelOrigin, token),
      expiresAt,
    });
    return { status: 'ready', email: createOutgoingEmail({ to, subject, text }) };
  }

  #changed(user: UserRow, message: OutboxMessage): ComposedEmail {
    const to = parseEmailAddress(user.email);
    if (to === undefined) throw new EmailPermanentError('recipient_rejected');
    const { subject, text } = passwordChangedText({ panelOrigin: this.#panelOrigin, changedAt: message.createdAt });
    return { status: 'ready', email: createOutgoingEmail({ to, subject, text }) };
  }
}
