/**
 * Composes the e-mails about the security of the sign-in for the worker of the outbox (EVM-026 AC4, AC5; SR-AUTH-15, SR-INPUT-07, SR-LOG-02). Like the other
 * composers it runs inside the transaction of the job `email.send`, the account locked first:
 *
 * - `account_locked` (variant `password` | `second_step` | `browser_password` | `browser_second_step`): e-mail 3 — the sign-in was locked for 15 minutes; the
 *   variant says which browsers (the unknown ones, or one the account knows) and whether a new password lifts the lock. The link leads to the form "Zresetuj hasło" and carries NO token;
 * - `new_browser`: e-mail 7 — a full sign-in from a browser the account did not know (the time only: no IP, no place, no device is stored);
 * - `session_limit`: e-mail 8 (EVM-028 AC6) — the sixth sign-in ended the oldest session. The outbox row holds nothing but the moment; the two sessions are read
 *   from their rows here (the one revoked at that moment with the reason `session_limit`, the one that began at it), and described by the closed dictionary of
 *   browsers and systems — never the raw user agent, never an IP address. When the ended session is gone (retention) the message is `obsolete`.
 *
 * The account must still be `active` and not deleted — otherwise the message is `obsolete`. The recipient is ALWAYS the address of the account row read here,
 * never a value of a request (CWE-640). No data of a customer is anywhere in these texts.
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
import { accountLockedText, isLockVariant, newBrowserText, sessionLimitText } from '../domain/email-templates.ts';
import { describeUserAgent } from '../domain/user-agent.ts';
import { findSessionEndedByLimit, findSessionStartedAt } from '../infrastructure/account-queries.ts';
import { THROTTLE_LOCK_MS } from '../domain/throttle-policy.ts';
import { findUserById } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';

const KINDS: readonly EmailKind[] = ['account_locked', 'new_browser', 'session_limit'];

@Injectable()
export class LoginSecurityEmailComposer implements EmailComposer {
  readonly kinds = KINDS;
  readonly #panelOrigin: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.#panelOrigin = config.panelOrigin;
  }

  async lockRecipient(tx: Kysely<Database>, recipientUserId: string): Promise<void> {
    await findUserById(identityTables(tx), recipientUserId, true);
  }

  async compose(tx: Kysely<Database>, message: OutboxMessage): Promise<ComposedEmail> {
    const user = await findUserById(identityTables(tx), message.recipientUserId);
    if (user?.deletedAt !== null || user.status !== 'active') return { status: 'obsolete' };
    const to = parseEmailAddress(user.email);
    if (to === undefined) throw new EmailPermanentError('recipient_rejected');

    if (message.kind === 'session_limit') {
      const db = identityTables(tx);
      const ended = await findSessionEndedByLimit(db, user.id, message.createdAt);
      if (ended === undefined) return { status: 'obsolete' };
      const started = await findSessionStartedAt(db, user.id, message.createdAt);
      const { subject, text } = sessionLimitText({
        panelOrigin: this.#panelOrigin,
        ended: { ...describeUserAgent(ended.userAgent), lastSeenAt: ended.lastSeenAt },
        signedIn: { ...describeUserAgent(started?.userAgent), at: message.createdAt },
      });
      return { status: 'ready', email: createOutgoingEmail({ to, subject, text }) };
    }
    if (message.kind === 'new_browser') {
      const { subject, text } = newBrowserText({ panelOrigin: this.#panelOrigin, signedInAt: message.createdAt });
      return { status: 'ready', email: createOutgoingEmail({ to, subject, text }) };
    }
    if (!isLockVariant(message.variant)) throw new EmailPermanentError('invalid_message');
    const { subject, text } = accountLockedText({
      panelOrigin: this.#panelOrigin,
      variant: message.variant,
      lockedAt: message.createdAt,
      lockedUntil: new Date(message.createdAt.getTime() + THROTTLE_LOCK_MS),
    });
    return { status: 'ready', email: createOutgoingEmail({ to, subject, text }) };
  }
}
