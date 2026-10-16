/**
 * The job `email.send` (EVM-024 AC1, AC4, AC5; ADR-0010; SR-AUTH-12, SR-ERR-02, SR-LOG-02): sends the message of ONE outbox row. The payload
 * of the job is the id of the row and nothing else (TM-26, TM-72); the state of the row, not the state of the queue, decides the outcome.
 *
 * Three steps, so that nothing slow happens inside a transaction and nothing is sent twice by a lost race:
 * 1. a transaction that LOCKS first the account of the recipient (the composer), then the outbox row, checks that the row is still
 *    `pending` and that the account still needs the message (else the row is `superseded`: no token, no mail), counts the attempt and lets
 *    the composer create the message — for an invitation: the token (its hash is stored), the previous links and enrolment sessions
 *    superseded — then COMMITS;
 * 2. the message is handed to the port OUTSIDE any transaction (the adapter has hard time limits, below the expiry of a job);
 * 3. a second transaction writes the result: `sent`, or `failed` (a permanent refusal, or the fifth failed attempt — then the handler does
 *    NOT throw: the row is final), or the row stays `pending` and the job throws a fixed code so the queue retries with growing breaks.
 * A crash between 2 and 3 repeats the send with a newer token (at least once): only the newest link works, the older one is superseded.
 *
 * What is logged: the id of the row, the kind and a fixed code. Never the address, the subject, the text or the token — and a failure of the
 * port is already a class with a fixed code, so nothing of the driver reaches the job error or the dead-letter queue (SR-LOG-02).
 */
import type { Kysely } from 'kysely';
import type { Clock } from '../clock/clock.ts';
import type { Database } from '../database/database.ts';
import { runInTransaction } from '../database/transactional.ts';
import { JobFailure, type JobCounts, type JobDefinition, type JobPayload, type QueueRetryPolicy } from '../jobs/index.ts';
import type { Logger } from '../logging/logger.ts';
import type { OutgoingEmail } from './email-address.ts';
import type { EmailComposer } from './email-composer.ts';
import { EmailPermanentError, EmailTransientError } from './email-errors.ts';
import { findOutboxMessage, recordAttempt, settleEmail, type OutboxMessage } from './email-outbox.ts';
import type { EmailSender } from './email-sender.ts';

export const EMAIL_QUEUE = 'email.send';
/** The attempts a message gets before its row is `failed` (AC5: "Nie wysłano" in W-16). */
export const MAX_SEND_ATTEMPTS = 5;
/** The code the job fails with so the queue retries; the library's own limit is only a safety net above the attempts the row counts. */
export const EMAIL_RETRY_CODE = 'email_retry';

/** Breaks of about 30, 60, 120, 240 and 480 seconds (with the jitter of the library); `retryLimit` is not below the attempts. */
export const EMAIL_RETRY: QueueRetryPolicy = Object.freeze({
  retryLimit: MAX_SEND_ATTEMPTS,
  retryDelaySeconds: 30,
  retryBackoff: true,
  retryDelayMaxSeconds: 480,
});

export interface SendEmailJobDependencies {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly sender: EmailSender;
  readonly composers: readonly EmailComposer[];
}

type Outcome = 'sent' | 'failed' | 'retry' | 'superseded' | 'skipped';

type Prepared =
  | { readonly kind: 'done'; readonly outcome: 'superseded' | 'skipped' }
  | { readonly kind: 'ready'; readonly message: OutboxMessage; readonly email: OutgoingEmail; readonly attempts: number };

export class SendEmailJob {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #sender: EmailSender;
  readonly #composers: readonly EmailComposer[];

  constructor(dependencies: SendEmailJobDependencies) {
    this.#db = dependencies.db;
    this.#clock = dependencies.clock;
    this.#logger = dependencies.logger;
    this.#sender = dependencies.sender;
    this.#composers = dependencies.composers;
  }

  definition(): JobDefinition {
    return { name: EMAIL_QUEUE, handler: (payload) => this.run(payload), retry: EMAIL_RETRY };
  }

  /** @throws JobFailure `email_retry` when a message could not be sent and has attempts left (the queue retries the job) */
  async run(payload: JobPayload): Promise<JobCounts> {
    const counts: Record<Outcome, number> = { sent: 0, failed: 0, retry: 0, superseded: 0, skipped: 0 };
    for (const id of payload.ids) counts[await this.#process(id)] += 1;
    if (counts.retry > 0) throw new JobFailure(EMAIL_RETRY_CODE);
    return counts;
  }

  async #process(id: string): Promise<Outcome> {
    let prepared: Prepared;
    try {
      prepared = await this.#prepare(id);
    } catch (error) {
      // A defect of the template (a message that breaks the rules of the type) is permanent: no token was kept, the row is final.
      if (!(error instanceof EmailPermanentError)) throw error;
      await this.#fail(id, undefined, error.code);
      return 'failed';
    }
    if (prepared.kind === 'done') return prepared.outcome;

    const { message, email, attempts } = prepared;
    try {
      await this.#sender.send(email);
    } catch (error) {
      return this.#afterFailure(message, attempts, error);
    }
    await this.#settle(message.id, 'sent');
    this.#logger.info({ outboxId: message.id, kind: message.kind }, 'email: sent');
    return 'sent';
  }

  /** Step 1: the locks (account, then row), the checks, the attempt and the message — one transaction. */
  #prepare(id: string): Promise<Prepared> {
    return runInTransaction(this.#db, async (tx) => {
      const head = await findOutboxMessage(tx, id, false);
      if (head?.state !== 'pending') return { kind: 'done', outcome: 'skipped' };
      const composer = this.#composers.find((candidate) => candidate.kinds.includes(head.kind));
      if (composer === undefined) throw new Error('no composer for the kind of the message');

      await composer.lockRecipient(tx, head.recipientUserId);
      const message = await findOutboxMessage(tx, id, true);
      if (message?.state !== 'pending') return { kind: 'done', outcome: 'skipped' };

      const composed = await composer.compose(tx, message);
      if (composed.status === 'obsolete') {
        await settleEmail(tx, id, 'superseded', this.#clock.now());
        return { kind: 'done', outcome: 'superseded' };
      }
      const attempts = await recordAttempt(tx, id);
      return { kind: 'ready', message, email: composed.email, attempts };
    });
  }

  /** Step 3 for a failure: a permanent one, or the last attempt, is final; otherwise the row stays pending and the queue retries. */
  async #afterFailure(message: OutboxMessage, attempts: number, error: unknown): Promise<Outcome> {
    const permanent = error instanceof EmailPermanentError;
    const code = error instanceof EmailPermanentError || error instanceof EmailTransientError ? error.code : 'send_failed';
    if (permanent || attempts >= MAX_SEND_ATTEMPTS) {
      await this.#fail(message.id, message.kind, code);
      return 'failed';
    }
    this.#logger.warn({ outboxId: message.id, kind: message.kind, code, attempt: attempts }, 'email: attempt failed; will retry');
    return 'retry';
  }

  async #fail(id: string, kind: OutboxMessage['kind'] | undefined, code: string): Promise<void> {
    await this.#settle(id, 'failed');
    this.#logger.warn({ outboxId: id, kind, code }, 'email: not sent');
  }

  #settle(id: string, to: 'sent' | 'failed'): Promise<boolean> {
    return runInTransaction(this.#db, (tx) => settleEmail(tx, id, to, this.#clock.now()));
  }
}
