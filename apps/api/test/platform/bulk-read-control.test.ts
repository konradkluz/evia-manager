import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { BulkReadEvent } from '../../src/platform/bulk-read/bulk-read-event.ts';
import { BULK_READ_ALERT_METRIC, BULK_READ_REJECTED_METRIC, BulkReadControl } from '../../src/platform/bulk-read/bulk-read-control.ts';
import { InMemoryBulkReadMeter } from '../../src/platform/bulk-read/bulk-read-meter.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { requestContext, requestContextMixin } from '../../src/platform/http/request-context.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { LogCapture } from '../support/app.ts';
import { FixedClock, MINUTE } from '../support/clock.ts';
import type { EventContext } from '../../src/platform/events/event-bus.ts';
import type { NextFunction, Request, Response } from 'express';

function harness() {
  const clock = new FixedClock('2026-10-07T08:00:00.000Z');
  const logs = new LogCapture();
  const metrics = new MetricsRegistry();
  const published: Array<{ event: BulkReadEvent; context: EventContext }> = [];
  const control = new BulkReadControl(
    new InMemoryBulkReadMeter(clock, { alertAt: 10, blockAt: 20 }),
    createLogger({ level: 'info', destination: logs, mixin: requestContextMixin }),
    metrics,
    (event, context) => {
      published.push({ event, context });
      return Promise.resolve();
    },
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
  return { clock, logs, control, counters, inRequest, published };
}

const CONTEXT: EventContext = { origin: 'web', traceId: 'a'.repeat(32), sessionId: randomUUID() };

describe('mass-read control around a list (EVM-017 AC5; SR-API-02, SR-LOG-06, SR-LOG-07)', () => {
  it('EVM-017 AC5 below the thresholds nothing is logged, audited or counted', async () => {
    const { control, logs, counters, published } = harness();
    const user = randomUUID();
    await control.before(user, CONTEXT);
    control.after(user, 9);
    await control.before(user, CONTEXT);
    expect(logs.entries).toEqual([]);
    expect(published).toEqual([]);
    expect(counters()).toEqual({});
  });

  it('EVM-017 AC5 the first read past the alert threshold logs ONE alert without the user and audits it ONCE with the actor', async () => {
    const { control, logs, counters, inRequest, published } = harness();
    const user = randomUUID();
    control.after(user, 10);
    await inRequest(() => control.before(user, CONTEXT));
    await inRequest(() => control.before(user, CONTEXT));
    const alerts = logs.entries.filter((entry) => entry['alert'] === 'security');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ alert: 'security', alertCode: 'bulk_read', msg: 'security alert', level: 'error' });
    expect(String(alerts[0]?.['traceId'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(logs.entries)).not.toContain(user);
    expect(counters()).toEqual({ [BULK_READ_ALERT_METRIC]: 1 });
    expect(published).toEqual([
      {
        event: { type: 'bulk_read.alerted', actor: { type: 'user', userId: user }, outcome: 'success', objectType: 'work_order' },
        context: CONTEXT,
      },
    ]);
  });

  it('EVM-017 AC5 past the block limit it throws rate_limited, counts every rejection and audits the first one of the window', async () => {
    const { control, clock, counters, published } = harness();
    const user = randomUUID();
    control.after(user, 20);
    clock.advance(30_000);
    const refuse = async () => {
      try {
        await control.before(user, CONTEXT);
      } catch (error) {
        return error;
      }
      return undefined;
    };
    const thrown = await refuse();
    expect(thrown).toBeInstanceOf(ProblemException);
    expect(thrown).toMatchObject({ code: 'rate_limited', extras: { retryAfterSeconds: 570 } });
    expect(await refuse()).toBeInstanceOf(ProblemException);
    expect(counters()).toEqual({ [BULK_READ_REJECTED_METRIC]: 2 });
    expect(published.map((entry) => entry.event)).toEqual([
      { type: 'bulk_read.rejected', actor: { type: 'user', userId: user }, outcome: 'denied', objectType: 'work_order' },
    ]);
    clock.advance(10 * MINUTE);
    await expect(control.before(user, CONTEXT)).resolves.toBeUndefined();
  });
});
