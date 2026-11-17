/**
 * Composes the reminder of a site survey for the worker of the outbox (EVM-140 AC1, AC5; ADR-0024 pt 9; SR-DATA-01, SR-INPUT-07, SR-LOG-03, DO-K). Like the other
 * composers it runs inside the transaction of the job `email.send`, the account of the recipient locked first (`lockRecipient`) and the outbox row after. The row
 * holds the kind, the recipient and the survey (`subject_id`); EVERYTHING else is read here, at the moment of sending:
 *
 * - the recipient must still be an ACTIVE account, and still entitled to the survey: an Administrator, or the creator of the survey while an Editor (Tylko odczyt does
 *   not see a survey, EVM-135) - otherwise the message is `obsolete` and nothing is sent;
 * - the survey must still be open (no customer, not cancelled, not deleted, with its deadline) - assigned, rejected, deleted or purged in the meantime it is `obsolete`;
 * - the text is the number and the date of the deletion and a link to the order in the panel - NO address, NO phone, NO title (see `domain/site-survey-reminder.ts`).
 * A subject that is no identifier is a permanent error (the link is made of it).
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
import { EmailRecipientDirectory } from '../../identity/index.ts';
import { siteSurveyReminderText } from '../domain/site-survey-reminder.ts';
import { surveyForReminder } from '../infrastructure/site-survey-reminder-store.ts';
import { workOrderTables } from '../infrastructure/tables.ts';

const KINDS: readonly EmailKind[] = ['site_survey_expiring'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Injectable()
export class SiteSurveyReminderComposer implements EmailComposer {
  readonly kinds = KINDS;
  readonly #panelOrigin: string;
  readonly #recipients: EmailRecipientDirectory;

  constructor(@Inject(APP_CONFIG) config: AppConfig, @Inject(EmailRecipientDirectory) recipients: EmailRecipientDirectory) {
    this.#panelOrigin = config.panelOrigin;
    this.#recipients = recipients;
  }

  async lockRecipient(tx: Kysely<Database>, recipientUserId: string): Promise<void> {
    await this.#recipients.lock(tx, recipientUserId);
  }

  async compose(tx: Kysely<Database>, message: OutboxMessage): Promise<ComposedEmail> {
    const surveyId = message.subjectId ?? '';
    if (!UUID.test(surveyId)) throw new EmailPermanentError('invalid_message');
    const recipient = await this.#recipients.findActive(tx, message.recipientUserId);
    if (recipient === undefined) return { status: 'obsolete' };
    const survey = await surveyForReminder(workOrderTables(tx), surveyId);
    if (survey === undefined || survey.customer_id !== null || survey.status === 'cancelled' || survey.deleted_at !== null) {
      return { status: 'obsolete' };
    }
    const expiresAt = survey.site_survey_expires_at;
    if (expiresAt === null) return { status: 'obsolete' };
    const entitled = recipient.role === 'administrator' || (recipient.role === 'editor' && survey.created_by === message.recipientUserId);
    if (!entitled) return { status: 'obsolete' };

    const to = parseEmailAddress(recipient.address);
    if (to === undefined) throw new EmailPermanentError('recipient_rejected');
    const { subject, text } = siteSurveyReminderText({
      panelOrigin: this.#panelOrigin,
      number: survey.number,
      workOrderId: survey.id,
      expiresAt,
      extensions: survey.site_survey_extensions,
    });
    return { status: 'ready', email: createOutgoingEmail({ to, subject, text }) };
  }
}
