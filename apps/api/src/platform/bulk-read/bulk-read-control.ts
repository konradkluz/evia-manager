/**
 * What a list or a search does around its query to answer policy P10 (EVM-017 AC5; SR-API-02, SR-LOG-06, SR-LOG-07):
 * `before` asks the meter and refuses with `429 rate_limited` + `Retry-After`; at the first read above the alert threshold it
 * emits the security alert; `after` adds the number of records returned. Shared by the lists and searches of later stories.
 *
 * The alert is written straight to the log of the API process in the shape the alert rule of EVM-007 matches
 * (`alert: "security"`, `alertCode`, the trace identifier of the request from the logging context) — not to the outbox of
 * `platform.security_alert_outbox`, which serves processes whose output is not collected (the server command). Its code has a type
 * of its own, so it cannot be written to the outbox. The entry and the counters carry no user, no title and no filter value.
 */
import type { Logger } from '../logging/logger.ts';
import type { Counter, MetricsRegistry } from '../metrics/metrics.ts';
import { ProblemException } from '../http/problem.ts';
import type { BulkReadMeter } from './bulk-read-meter.ts';

/** Alerts raised by the API process while it serves a request (never stored in the outbox). */
export type RequestSecurityAlertCode = 'bulk_read';

export const BULK_READ_ALERT_METRIC = 'bulk_read_alert';
export const BULK_READ_REJECTED_METRIC = 'bulk_read_rejected';

export class BulkReadControl {
  readonly #meter: BulkReadMeter;
  readonly #logger: Logger;
  readonly #alerts: Counter;
  readonly #rejections: Counter;

  constructor(meter: BulkReadMeter, logger: Logger, metrics: MetricsRegistry) {
    this.#meter = meter;
    this.#logger = logger;
    this.#alerts = metrics.counter(BULK_READ_ALERT_METRIC, []);
    this.#rejections = metrics.counter(BULK_READ_REJECTED_METRIC, []);
  }

  /** @throws ProblemException `rate_limited` with the seconds to wait, when the user has read too much in the window */
  before(userId: string): void {
    const decision = this.#meter.check(userId);
    if (!decision.allowed) {
      this.#rejections.increment({});
      throw new ProblemException('rate_limited', { retryAfterSeconds: decision.retryAfterSeconds });
    }
    if (decision.alert) {
      const code: RequestSecurityAlertCode = 'bulk_read';
      this.#alerts.increment({});
      this.#logger.error({ alert: 'security', alertCode: code }, 'security alert');
    }
  }

  after(userId: string, returned: number): void {
    this.#meter.record(userId, returned);
  }
}
