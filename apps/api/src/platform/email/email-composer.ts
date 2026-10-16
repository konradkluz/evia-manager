/**
 * The port through which a module composes the message of an outbox row (EVM-024; ADR-0001): `platform` knows WHEN a message is sent
 * (queue, retries, states), the module that owns the data knows WHAT it says and WHO the recipient is. The composer reads the address of
 * the recipient from its own tables at the moment of sending (it is never copied to the outbox), and — for an invitation — creates the
 * one-time token there and stores only its hash, so a raw token exists only in memory, in the message, until the mail is handed over.
 *
 * The worker (the composition root) registers the composers; the job calls them in a fixed order of locks:
 * `lockRecipient` (the row of the account `FOR UPDATE`), then the job locks the outbox row, then `compose` runs in the same transaction.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../database/database.ts';
import type { OutgoingEmail } from './email-address.ts';
import type { EmailKind, OutboxMessage } from './email-outbox.ts';

export type ComposedEmail =
  /** The message is ready; nothing else changed in the database except what the composer owns (a link, its hash). */
  | { readonly status: 'ready'; readonly email: OutgoingEmail }
  /** The message is no longer needed (the account is not in the state it requires): the row is `superseded`, nothing is sent. */
  | { readonly status: 'obsolete' };

export interface EmailComposer {
  readonly kinds: readonly EmailKind[];
  /** Locks the account of the recipient (`FOR UPDATE`) — the first lock of the unit of work. */
  lockRecipient(tx: Kysely<Database>, recipientUserId: string): Promise<void>;
  /** Composes the message in the same transaction (the outbox row is locked); an account that is not in the required state is `obsolete`. */
  compose(tx: Kysely<Database>, message: OutboxMessage): Promise<ComposedEmail>;
}
