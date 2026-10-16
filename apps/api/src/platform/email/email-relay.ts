/**
 * The relay of the outbox (EVM-024 AC1, AC5; ADR-0010 "plan wyjścia"): the API process writes a row in the transaction of the change, and
 * the API does not run the queue — so the worker polls the table and hands pending rows to the queue `email.send`, a job per row.
 * The same pattern as the emitter of security alerts: `FOR UPDATE SKIP LOCKED`, so two workers never take the same row, and a row is marked
 * `enqueued_at` only AFTER the queue accepted the job (a failure leaves it for the next round).
 *
 * The job id is the id of the row, so handing a row over twice (a lost mark, a second worker, the re-handover below) creates ONE job: the
 * second `send` is a no-op and a message can never be doubled by the relay. A row still `pending` long after its handover (a job that was
 * lost — the queue deletes a job it has not run after its retention) is handed over again; with the deterministic id that is harmless.
 * Nothing here reads an address or a token: the relay sees ids.
 */
import type { Kysely } from 'kysely';
import type { Clock } from '../clock/clock.ts';
import type { Database } from '../database/database.ts';
import { runInTransaction } from '../database/transactional.ts';
import type { JobQueue } from '../jobs/index.ts';
import type { Logger } from '../logging/logger.ts';
import { markHandedOver, selectToRelay } from './email-outbox.ts';
import { EMAIL_QUEUE } from './send-email.job.ts';

export const RELAY_INTERVAL_MS = 5_000;
export const RELAY_BATCH_SIZE = 50;
/** A row pending this long after its handover is handed over again. */
export const REHANDOVER_AFTER_MS = 20 * 60_000;

export class EmailRelay {
  readonly #db: Kysely<Database>;
  readonly #queue: JobQueue;
  readonly #clock: Clock;
  readonly #logger: Logger;

  constructor(db: Kysely<Database>, queue: JobQueue, clock: Clock, logger: Logger) {
    this.#db = db;
    this.#queue = queue;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** Starts the polling (an interval timer that never keeps the process alive). @returns a function that stops it */
  start(intervalMs: number = RELAY_INTERVAL_MS): () => void {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      this.relayPending()
        .catch((error: unknown) => {
          this.#logger.warn({ errorType: error instanceof Error ? error.name : 'unknown' }, 'email relay failed; will retry');
        })
        .finally(() => {
          running = false;
        });
    }, intervalMs);
    timer.unref();
    return () => {
      clearInterval(timer);
    };
  }

  /** Hands the pending rows over to the queue. @returns the number of rows handed over in this round */
  relayPending(): Promise<number> {
    return runInTransaction(this.#db, async (tx) => {
      const now = this.#clock.now();
      const ids = await selectToRelay(tx, new Date(now.getTime() - REHANDOVER_AFTER_MS), RELAY_BATCH_SIZE);
      let handedOver = 0;
      for (const id of ids) {
        try {
          await this.#queue.send(EMAIL_QUEUE, [id], { jobId: id });
        } catch (error) {
          // The queue is not reachable: the rows handed over so far keep their mark, the rest waits for the next round.
          this.#logger.warn(
            { errorType: error instanceof Error ? error.name : 'unknown', handedOver },
            'email relay: the queue refused a job',
          );
          break;
        }
        await markHandedOver(tx, id, now);
        handedOver += 1;
      }
      return handedOver;
    });
  }
}
