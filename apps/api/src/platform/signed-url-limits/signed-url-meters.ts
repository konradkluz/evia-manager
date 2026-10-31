/**
 * Limits of issuing signed addresses of files (EVM-045 AC5; SR-FILE-10, SR-LOG-07; policy P10; ASVS V2.4.1; CWE-362, CWE-770): per USER (never per
 * session or address), in a sliding window of 10 minutes, in two classes counted apart - `derivative` (thumbnails and previews together: 1000,
 * an alert from 600) and `original` (100, an alert from 50). Built on the meter of mass reads (minute buckets, bounded table, idle users swept).
 *
 * {@link SignedUrlMeters.reserve} CHECKS and RECORDS in one synchronous step - there is no `await` between the two, so concurrent requests cannot
 * all pass the check before any of them is counted (exactly `blockAt` addresses are ever issued in a window). The address is reserved BEFORE it is
 * signed: a request that fails afterwards (storage down, rollback of the audit) stays counted - the safe side of the error. A refusal adds nothing.
 * The counters live in the memory of the process (a restart zeroes them; with more processes the limit multiplies - the known residual risk of P10,
 * the same as the mass-read meter).
 */
import type { Clock } from '../clock/clock.ts';
import { InMemoryBulkReadMeter, type BulkReadDecision } from '../bulk-read/bulk-read-meter.ts';

export type VariantClass = 'derivative' | 'original';

export interface UrlLimits {
  readonly alertAt: number;
  readonly blockAt: number;
}

/** P10: derivatives 1000 / 10 min, alert from 600; originals 100 / 10 min, alert from 50. */
export const URL_LIMITS: Readonly<Record<VariantClass, UrlLimits>> = Object.freeze({
  derivative: Object.freeze({ alertAt: 600, blockAt: 1000 }),
  original: Object.freeze({ alertAt: 50, blockAt: 100 }),
});

export type UrlDecision = BulkReadDecision;

export interface SignedUrlMeters {
  /** Checks the limit of the class and, when it allows, counts the address - in one synchronous step. */
  reserve(userId: string, variantClass: VariantClass): UrlDecision;
}

export class InMemorySignedUrlMeters implements SignedUrlMeters {
  readonly #meters: Readonly<Record<VariantClass, InMemoryBulkReadMeter>>;

  constructor(clock: Clock, limits: Readonly<Record<VariantClass, UrlLimits>> = URL_LIMITS, maxUsers?: number) {
    this.#meters = {
      derivative: new InMemoryBulkReadMeter(clock, limits.derivative, maxUsers),
      original: new InMemoryBulkReadMeter(clock, limits.original, maxUsers),
    };
  }

  reserve(userId: string, variantClass: VariantClass): UrlDecision {
    const meter = this.#meters[variantClass];
    const decision = meter.check(userId);
    if (decision.allowed) meter.record(userId, 1);
    return decision;
  }
}
