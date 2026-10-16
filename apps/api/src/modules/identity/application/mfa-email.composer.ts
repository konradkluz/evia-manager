/**
 * Composes the e-mails about the second step for the worker of the outbox (EVM-023 AC5, AC6; SR-AUTH-10, SR-AUTH-15, SR-INPUT-07, SR-LOG-02).
 * Like the other composers it runs inside the transaction of the job `email.send`, the account locked first:
 *
 * - `mfa_changed` (variant `totp_enrolled` | `recovery_codes_generated`): what changed and when (the time the change was asked for) — never the secret,
 *   the address of the authenticator, a code or the position of a code;
 * - `recovery_code_used`: a recovery code signed in at that time; the number of codes still unused is read when the message is composed.
 *
 * The account must still be `active` and not deleted — otherwise the message is `obsolete`. The recipient is ALWAYS the address of the account row
 * read here, never a value of a request (CWE-640). No data of a customer is anywhere in these texts.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { AppConfig } from '../../../platform/config/config.ts';
import type { Database } from '../../../platform/database/database.ts';
import { createOutgoingEmail, parseEmailAddress } from '../../../platform/email/email-address.ts';
import type { ComposedEmail, EmailComposer } from '../../../platform/email/email-composer.ts';
import { EmailPermanentError } from '../../../platform/email/email-errors.ts';
import type { EmailKind, OutboxMessage } from '../../../platform/email/email-outbox.ts';
import { APP_CONFIG } from '../../../platform/tokens.ts';
import { isSecondStepChange, recoveryCodeUsedText, secondStepChangedText } from '../domain/email-templates.ts';
import { countAvailableRecoveryCodes } from '../infrastructure/mfa-queries.ts';
import { findUserById } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';

const KINDS: readonly EmailKind[] = ['mfa_changed', 'recovery_code_used'];

@Injectable()
export class MfaEmailComposer implements EmailComposer {
  readonly kinds = KINDS;
  readonly #panelOrigin: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.#panelOrigin = config.panelOrigin;
  }

  async lockRecipient(tx: Kysely<Database>, recipientUserId: string): Promise<void> {
    await findUserById(identityTables(tx), recipientUserId, true);
  }

  async compose(tx: Kysely<Database>, message: OutboxMessage): Promise<ComposedEmail> {
    const db = identityTables(tx);
    const user = await findUserById(db, message.recipientUserId);
    if (user?.deletedAt !== null || user.status !== 'active') return { status: 'obsolete' };
    const to = parseEmailAddress(user.email);
    if (to === undefined) throw new EmailPermanentError('recipient_rejected');

    if (message.kind === 'mfa_changed') {
      if (!isSecondStepChange(message.variant)) throw new EmailPermanentError('invalid_message');
      const { subject, text } = secondStepChangedText({
        panelOrigin: this.#panelOrigin,
        change: message.variant,
        changedAt: message.createdAt,
      });
      return { status: 'ready', email: createOutgoingEmail({ to, subject, text }) };
    }
    const remaining = await countAvailableRecoveryCodes(db, user.id);
    const { subject, text } = recoveryCodeUsedText({ panelOrigin: this.#panelOrigin, usedAt: message.createdAt, remaining });
    return { status: 'ready', email: createOutgoingEmail({ to, subject, text }) };
  }
}
