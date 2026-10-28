/**
 * The outbox of transactional e-mails (EVM-024; ADR-0010 "plan wyjścia"; SR-DATA-01, TM-26, TM-72). A module that wants a message writes ONE
 * row in the transaction of its change (`enqueueEmail`): the message exists exactly when the change committed — a rolled-back invitation
 * leaves no row and no job. The row holds the kind, the recipient by IDENTIFIER and a state, never an address, a name, a token or a text.
 * The relay (`email-relay.ts`) hands pending rows to the queue; the job (`send-email.job.ts`) owns the state afterwards.
 *
 * States: `pending` → `sent` | `failed` (retries used up, or a permanent refusal) | `superseded` (a newer message replaced it, or the
 * account no longer needs it). Who writes a state decides it under a row lock; the order of locks everywhere is the row of the
 * recipient's account first, then the row of the outbox (no deadlock between the job and a resend).
 */
import type { Generated, Kysely } from 'kysely';
import type { Database } from '../database/database.ts';

export const EMAIL_KINDS = [
  'user_invitation',
  'administrator_alert',
  'password_reset',
  'password_changed',
  'mfa_changed',
  'recovery_code_used',
  // EVM-026: e-mail 3 (a lock of the sign-in) and e-mail 7 (a sign-in from a browser the account did not know)
  'account_locked',
  'new_browser',
  // EVM-028: e-mail 8 (the sixth sign-in ended the oldest session)
  'session_limit',
  // EVM-094: e-mail 7 for the phone (a sign-in from a device the account did not know; SR-AUTH-15)
  'new_device',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_STATES = ['pending', 'sent', 'failed', 'superseded'] as const;
export type EmailState = (typeof EMAIL_STATES)[number];

interface EmailOutboxTable {
  id: Generated<string>;
  kind: EmailKind;
  variant: string | null;
  recipient_user_id: string;
  subject_id: string | null;
  state: Generated<EmailState>;
  attempts: Generated<number>;
  enqueued_at: Date | null;
  sent_at: Date | null;
  created_at: Date;
}

type PlatformTables = { 'platform.email_outbox': EmailOutboxTable };

const outbox = (db: Kysely<Database>): Kysely<PlatformTables> => db.$extendTables<PlatformTables>();

/** The most recipients one lookup of statuses takes (a page of the list of users). */
export const STATUS_BATCH_LIMIT = 100;

export interface OutboxMessage {
  readonly id: string;
  readonly kind: EmailKind;
  readonly variant: string | null;
  readonly recipientUserId: string;
  /** The identifier of the thing an alert is about (EVM-049: the work order), or `null`. */
  readonly subjectId: string | null;
  readonly state: EmailState;
  readonly attempts: number;
  /** When the message was asked for (the time of the event an alert tells about). */
  readonly createdAt: Date;
}

export interface NewEmail {
  readonly kind: EmailKind;
  /** Selects the text of an alert; `null` for a kind that has one text. */
  readonly variant: string | null;
  readonly recipientUserId: string;
  /** What the message is about (EVM-049: the work order of a quarantined file); `undefined` for a message about nothing in particular. */
  readonly subjectId?: string;
  readonly now: Date;
}

/** Writes a pending message in the caller's transaction. @returns the id of the row (the only thing a job carries) */
export async function enqueueEmail(tx: Kysely<Database>, email: NewEmail): Promise<string> {
  const row = await outbox(tx)
    .insertInto('platform.email_outbox')
    .values({
      kind: email.kind,
      variant: email.variant,
      recipient_user_id: email.recipientUserId,
      subject_id: email.subjectId ?? null,
      state: 'pending',
      attempts: 0,
      enqueued_at: null,
      sent_at: null,
      created_at: email.now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Writes a pending message unless one with the same recipient, kind, variant and subject is already pending (EVM-049: a batch of infected
 * files of one order must not flood the mailboxes — the pending message says it all). @returns whether a row was written
 */
export async function enqueueEmailOnce(tx: Kysely<Database>, email: NewEmail & { readonly subjectId: string }): Promise<boolean> {
  const pending = await outbox(tx)
    .selectFrom('platform.email_outbox')
    .select('id')
    .where('recipient_user_id', '=', email.recipientUserId)
    .where('kind', '=', email.kind)
    .where('variant', '=', email.variant)
    .where('subject_id', '=', email.subjectId)
    .where('state', '=', 'pending')
    .limit(1)
    .executeTakeFirst();
  if (pending !== undefined) return false;
  await enqueueEmail(tx, email);
  return true;
}

/** A pending message of the recipient and kind is replaced by a newer one: it is never sent after the fact. @returns the ids replaced */
export async function supersedePendingEmails(tx: Kysely<Database>, recipientUserId: string, kind: EmailKind): Promise<string[]> {
  const rows = await outbox(tx)
    .updateTable('platform.email_outbox')
    .set({ state: 'superseded' })
    .where('recipient_user_id', '=', recipientUserId)
    .where('kind', '=', kind)
    .where('state', '=', 'pending')
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

/**
 * How many messages of the kind were asked for the recipient since the given instant — every state counts (a superseded or failed one was still a request).
 * It serves a limit per mailbox (EVM-025: a flood of reset links); the answer holds no address.
 */
export async function countRecentEmails(tx: Kysely<Database>, recipientUserId: string, kind: EmailKind, since: Date): Promise<number> {
  const row = await outbox(tx)
    .selectFrom('platform.email_outbox')
    .select((eb) => eb.fn.countAll<string>().as('total'))
    .where('recipient_user_id', '=', recipientUserId)
    .where('kind', '=', kind)
    .where('created_at', '>=', since)
    .executeTakeFirstOrThrow();
  return Number(row.total);
}

export interface EmailStatus {
  readonly state: Exclude<EmailState, 'superseded'>;
  readonly sentAt: Date | null;
}

/**
 * The latest message of each recipient (of one kind) that still counts — ONE query for the whole page (no query per row). The module that
 * owns the accounts asks here instead of reading the table (ADR-0001: a module never reads the tables of another).
 */
export async function latestEmailStatus(
  tx: Kysely<Database>,
  recipientUserIds: readonly string[],
  kind: EmailKind,
): Promise<ReadonlyMap<string, EmailStatus>> {
  const ids = [...new Set(recipientUserIds)];
  if (ids.length === 0) return new Map();
  if (ids.length > STATUS_BATCH_LIMIT) throw new RangeError('too many recipients for one lookup');
  const rows = await outbox(tx)
    .selectFrom('platform.email_outbox')
    .select(['recipient_user_id', 'state', 'sent_at'])
    .distinctOn('recipient_user_id')
    .where('recipient_user_id', 'in', ids)
    .where('kind', '=', kind)
    .where('state', '<>', 'superseded')
    .orderBy('recipient_user_id')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return new Map(rows.map((row) => [row.recipient_user_id, { state: row.state as EmailStatus['state'], sentAt: row.sent_at }]));
}

function toMessage(row: {
  id: string;
  kind: EmailKind;
  variant: string | null;
  recipient_user_id: string;
  subject_id: string | null;
  state: EmailState;
  attempts: number;
  created_at: Date;
}): OutboxMessage {
  return {
    id: row.id,
    kind: row.kind,
    variant: row.variant,
    recipientUserId: row.recipient_user_id,
    subjectId: row.subject_id,
    state: row.state,
    attempts: row.attempts,
    createdAt: row.created_at,
  };
}

/** @param lock `FOR UPDATE` — only after the lock of the recipient's account (the order of locks) */
export async function findOutboxMessage(tx: Kysely<Database>, id: string, lock: boolean): Promise<OutboxMessage | undefined> {
  let query = outbox(tx)
    .selectFrom('platform.email_outbox')
    .select(['id', 'kind', 'variant', 'recipient_user_id', 'subject_id', 'state', 'attempts', 'created_at'])
    .where('id', '=', id);
  if (lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  return row === undefined ? undefined : toMessage(row);
}

/** Counts an attempt before the message is sent (a crash after the send is a repeat, never a message that was not counted). */
export async function recordAttempt(tx: Kysely<Database>, id: string): Promise<number> {
  const row = await outbox(tx)
    .updateTable('platform.email_outbox')
    .set((eb) => ({ attempts: eb('attempts', '+', 1) }))
    .where('id', '=', id)
    .where('state', '=', 'pending')
    .returning('attempts')
    .executeTakeFirstOrThrow();
  return row.attempts;
}

/** `pending` → a final state, conditionally: a row that is no longer pending (superseded in the meantime) is left alone. @returns whether it changed */
export async function settleEmail(tx: Kysely<Database>, id: string, to: 'sent' | 'failed' | 'superseded', now: Date): Promise<boolean> {
  const rows = await outbox(tx)
    .updateTable('platform.email_outbox')
    .set({ state: to, sent_at: to === 'sent' ? now : null })
    .where('id', '=', id)
    .where('state', '=', 'pending')
    .returning('id')
    .execute();
  return rows.length === 1;
}

/** The rows the relay has to hand to the queue: never handed over, or handed over long ago and still pending (a job that was lost). */
export async function selectToRelay(tx: Kysely<Database>, handedOverBefore: Date, limit: number): Promise<string[]> {
  const rows = await outbox(tx)
    .selectFrom('platform.email_outbox')
    .select('id')
    .where('state', '=', 'pending')
    .where((eb) => eb.or([eb('enqueued_at', 'is', null), eb('enqueued_at', '<', handedOverBefore)]))
    .orderBy('created_at')
    .orderBy('id')
    .limit(limit)
    .forUpdate()
    .skipLocked()
    .execute();
  return rows.map((row) => row.id);
}

export async function markHandedOver(tx: Kysely<Database>, id: string, now: Date): Promise<void> {
  await outbox(tx).updateTable('platform.email_outbox').set({ enqueued_at: now }).where('id', '=', id).execute();
}
