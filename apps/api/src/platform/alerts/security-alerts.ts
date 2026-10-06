/**
 * Security alerts through a durable outbox (EVM-016 AC2; SR-LOG-07, CWE-778). A process whose output the log collector
 * never sees (the server command, `docker exec -it`) cannot alert by logging. It writes an alert record in the same
 * transaction as the sensitive change; the API process — whose standard output is collected — emits pending records as
 * an `error` entry with the stable fields `alert: "security"` and `alertCode`, and marks them emitted (at least once).
 * The alert rule of EVM-007 matches on those fields. A record holds a code and times only: no e-mail, no token, no text.
 */
import type { Kysely } from 'kysely';
import type { Clock } from '../clock/clock.ts';
import type { Database } from '../database/database.ts';
import type { Logger } from '../logging/logger.ts';

export type SecurityAlertCode = 'emergency_reset';

export interface SecurityAlertsTable {
  id: string;
  alert_code: SecurityAlertCode;
  occurred_at: Date;
  trace_id: string;
  emitted_at: Date | null;
}

type PlatformTables = {
  'platform.security_alert_outbox': Omit<SecurityAlertsTable, 'id'> & { id?: string };
};

const tables = (db: Kysely<Database>): Kysely<PlatformTables> => db.$extendTables<PlatformTables>();

export interface SecurityAlert {
  readonly code: SecurityAlertCode;
  readonly occurredAt: Date;
  readonly traceId: string;
}

/** Writes the alert in the caller's transaction — the alert exists exactly when the change does. */
export async function enqueueSecurityAlert(tx: Kysely<Database>, alert: SecurityAlert): Promise<void> {
  await tables(tx)
    .insertInto('platform.security_alert_outbox')
    .values({ alert_code: alert.code, occurred_at: alert.occurredAt, trace_id: alert.traceId, emitted_at: null })
    .execute();
}

const BATCH_SIZE = 50;
export const POLL_INTERVAL_MS = 15_000;

export class SecurityAlertEmitter {
  readonly #db: Kysely<Database>;
  readonly #logger: Logger;
  readonly #clock: Clock;
  #stop: (() => void) | undefined;

  constructor(db: Kysely<Database>, logger: Logger, clock: Clock) {
    this.#db = db;
    this.#logger = logger;
    this.#clock = clock;
  }

  /** Emits pending alerts now and then (interval timer, never keeps the process alive). @returns a function that stops it */
  start(intervalMs: number = POLL_INTERVAL_MS): () => void {
    const timer = setInterval(() => {
      this.emitPending().catch((error: unknown) => {
        this.#logger.warn({ err: error }, 'security alert emission failed; will retry');
      });
    }, intervalMs);
    timer.unref();
    this.#stop?.();
    const stop = (): void => {
      clearInterval(timer);
    };
    this.#stop = stop;
    return stop;
  }

  /** Nest lifecycle hook: the timer stops with the application (graceful shutdown). */
  onApplicationShutdown(): void {
    this.#stop?.();
  }

  /** Emits pending alerts to the log and marks them emitted. @returns the number of alerts emitted */
  async emitPending(): Promise<number> {
    return this.#db.transaction().execute(async (tx) => {
      const handle = tables(tx);
      const pending = await handle
        .selectFrom('platform.security_alert_outbox')
        .select(['id', 'alert_code', 'occurred_at', 'trace_id'])
        .where('emitted_at', 'is', null)
        .orderBy('occurred_at')
        .limit(BATCH_SIZE)
        .forUpdate()
        .skipLocked()
        .execute();
      for (const alert of pending) {
        this.#logger.error(
          { alert: 'security', alertCode: alert.alert_code, occurredAt: alert.occurred_at.toISOString(), alertTraceId: alert.trace_id },
          'security alert',
        );
      }
      if (pending.length > 0) {
        await handle
          .updateTable('platform.security_alert_outbox')
          .set({ emitted_at: this.#clock.now() })
          .where(
            'id',
            'in',
            pending.map((alert) => alert.id as string),
          )
          .execute();
      }
      return pending.length;
    });
  }
}
