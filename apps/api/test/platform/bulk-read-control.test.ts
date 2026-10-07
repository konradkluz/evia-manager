import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BULK_READ_ALERT_METRIC, BULK_READ_REJECTED_METRIC, BulkReadControl } from '../../src/platform/bulk-read/bulk-read-control.ts';
import { InMemoryBulkReadMeter } from '../../src/platform/bulk-read/bulk-read-meter.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { requestContext, requestContextMixin } from '../../src/platform/http/request-context.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { LogCapture } from '../support/app.ts';
import { FixedClock, MINUTE } from '../support/clock.ts';
import type { NextFunction, Request, Response } from 'express';

function harness() {
  const clock = new FixedClock('2026-10-07T08:00:00.000Z');
  const logs = new LogCapture();
  const metrics = new MetricsRegistry();
  const control = new BulkReadControl(
    new InMemoryBulkReadMeter(clock, { alertAt: 10, blockAt: 20 }),
    createLogger({ level: 'info', destination: logs, mixin: requestContextMixin }),
    metrics,
  );
  const counters = () => Object.fromEntries(metrics.snapshot().map((sample) => [sample.name, sample.value]));
  /** Runs `work` inside a request context, like a handler does. */
  const inRequest = <T>(work: () => T): T => {
    let result: T | undefined;
    requestContext(
      {} as Request,
      { locals: {} } as unknown as Response,
      (() => {
        result = work();
      }) as NextFunction,
    );
    return result as T;
  };
  return { clock, logs, control, counters, inRequest };
}

describe('mass-read control around a list (EVM-017 AC5; SR-API-02, SR-LOG-06, SR-LOG-07)', () => {
  it('EVM-017 AC5 below the thresholds nothing is logged and no counter exists', () => {
    const { control, logs, counters } = harness();
    const user = randomUUID();
    control.before(user);
    control.after(user, 9);
    control.before(user);
    expect(logs.entries).toEqual([]);
    expect(counters()).toEqual({});
  });

  it('EVM-017 AC5 the first read past the alert threshold logs ONE security alert with the trace id of the request and counts it, with no user and no value', () => {
    const { control, logs, counters, inRequest } = harness();
    const user = randomUUID();
    control.after(user, 10);
    inRequest(() => {
      control.before(user);
    });
    inRequest(() => {
      control.before(user);
    });
    const alerts = logs.entries.filter((entry) => entry['alert'] === 'security');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ alert: 'security', alertCode: 'bulk_read', msg: 'security alert', level: 'error' });
    expect(String(alerts[0]?.['traceId'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(logs.entries)).not.toContain(user);
    expect(counters()).toEqual({ [BULK_READ_ALERT_METRIC]: 1 });
  });

  it('EVM-017 AC5 past the block limit it throws rate_limited with the seconds to wait, and counts the rejection', () => {
    const { control, clock, counters } = harness();
    const user = randomUUID();
    control.after(user, 20);
    clock.advance(30_000);
    let thrown: unknown;
    try {
      control.before(user);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProblemException);
    expect(thrown).toMatchObject({ code: 'rate_limited', extras: { retryAfterSeconds: 570 } });
    expect(counters()).toEqual({ [BULK_READ_REJECTED_METRIC]: 1 });
    clock.advance(10 * MINUTE);
    expect(() => {
      control.before(user);
    }).not.toThrow();
  });
});
