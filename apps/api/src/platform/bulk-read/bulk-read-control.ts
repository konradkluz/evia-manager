/**
 * What a list or a search does around its query to answer policy P10 (EVM-017 AC5; SR-API-02, SR-LOG-06, SR-LOG-07):
 * `before` asks the meter and refuses with `429 rate_limited` + `Retry-After`; at the first read above the alert threshold it
 * emits the security alert; `after` adds the number of records returned. Shared by the lists and searches of later stories.
 *
 * The alert is written straight to the log of the API process in the shape the alert rule of EVM-007 matches
 * (`alert: "security"`, `alertCode`, the trace identifier of the request from the logging context) — not to the outbox of
 * `platform.security_alert_outbox`, which serves processes whose output is not collected (the server command). Its code has a type
 * of its own, so it cannot be written to the outbox. The entry and the counters carry no user, no title and no filter value — the
 * person is named only in the audit trail: the first alert and the first refusal of a window publish `bulk_read.alerted` /
 * `bulk_read.rejected` with the actor (SR-LOG-03), so the Administrator can find the account and revoke its sessions.
 */
import type { Logger } from '../logging/logger.ts';
import type { Counter, MetricsRegistry } from '../metrics/metrics.ts';
import type { EventContext } from '../events/event-bus.ts';
import { ProblemException } from '../http/problem.ts';
import type { BulkReadEvent, BulkReadObjectType } from './bulk-read-event.ts';
import type { BulkReadMeter } from './bulk-read-meter.ts';

/** Alerts raised by the API process while it serves a request (never stored in the outbox). */
export type RequestSecurityAlertCode = 'bulk_read';

export const BULK_READ_ALERT_METRIC = 'bulk_read_alert';
export const BULK_READ_REJECTED_METRIC = 'bulk_read_rejected';

/** Publishes an event in a transaction of its own (the audit subscriber writes with it); an audit failure fails the request. */
export type BulkReadPublisher = (event: BulkReadEvent, context: EventContext) => Promise<void>;

const eventOf = (
  type: BulkReadEvent['type'],
  outcome: BulkReadEvent['outcome'],
  userId: string,
  objectType: BulkReadObjectType,
): BulkReadEvent => ({ type, actor: { type: 'user', userId }, outcome, objectType });

export class BulkReadControl {
  readonly #meter: BulkReadMeter;
  readonly #logger: Logger;
  readonly #alerts: Counter;
  readonly #rejections: Counter;
  readonly #publish: BulkReadPublisher;

  constructor(meter: BulkReadMeter, logger: Logger, metrics: MetricsRegistry, publish: BulkReadPublisher) {
    this.#publish = publish;
    this.#meter = meter;
    this.#logger = logger;
    this.#alerts = metrics.counter(BULK_READ_ALERT_METRIC, []);
    this.#rejections = metrics.counter(BULK_READ_REJECTED_METRIC, []);
  }

  /** @throws ProblemException `rate_limited` with the seconds to wait, when the user has read too much in the window */
  async before(userId: string, context: EventContext, objectType: BulkReadObjectType = 'work_order'): Promise<void> {
    const decision = this.#meter.check(userId);
    if (!decision.allowed) {
      this.#rejections.increment({});
      if (decision.firstRejection) await this.#publish(eventOf('bulk_read.rejected', 'denied', userId, objectType), context);
      throw new ProblemException('rate_limited', { retryAfterSeconds: decision.retryAfterSeconds });
    }
    if (decision.alert) {
      const code: RequestSecurityAlertCode = 'bulk_read';
      this.#alerts.increment({});
      this.#logger.error({ alert: 'security', alertCode: code }, 'security alert');
      await this.#publish(eventOf('bulk_read.alerted', 'success', userId, objectType), context);
    }
  }

  after(userId: string, returned: number): void {
    this.#meter.record(userId, returned);
  }
}
