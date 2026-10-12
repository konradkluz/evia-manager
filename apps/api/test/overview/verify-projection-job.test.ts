import { describe, expect, it } from 'vitest';
import type { ProjectionMaintenance, VerifyReport } from '../../src/modules/overview/application/projection-maintenance.ts';
import {
  VERIFY_PROJECTION_FAILED,
  VERIFY_PROJECTION_JOB,
  VERIFY_PROJECTION_SCHEDULE,
  VerifyProjectionJob,
} from '../../src/modules/overview/application/verify-projection.job.ts';
import { InMemoryJobQueue, JobFailure } from '../../src/platform/jobs/index.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { LogCapture } from '../support/app.ts';
import { FixedClock } from '../support/clock.ts';
import { uuidv7 } from '../support/uuid.ts';

const EMPTY: VerifyReport['drift'] = { authorization: [], keys: [], waiting: [], deadline: [] };

function setup(verify: ProjectionMaintenance['verify']) {
  const logs = new LogCapture();
  const clock = new FixedClock('2026-10-13T01:30:00.000Z');
  const maintenance: Pick<ProjectionMaintenance, 'verify'> = { verify };
  const job = new VerifyProjectionJob(maintenance, createLogger({ level: 'info', destination: logs }), clock);
  return { job, logs, clock };
}

describe('the nightly verify of the projection (EVM-034 W11; ADR-0017 W11, T7)', () => {
  it('EVM-034 W11 the job is named, scheduled at 03:30 in Europe/Warsaw and registered through the interface of the queue', async () => {
    const { job } = setup(() => Promise.resolve({ checked: 0, inSync: 0, missing: [], drift: EMPTY }));
    const definition = job.definition();
    expect(definition.name).toBe(VERIFY_PROJECTION_JOB);
    expect(definition.schedule).toEqual(VERIFY_PROJECTION_SCHEDULE);
    expect(VERIFY_PROJECTION_SCHEDULE).toEqual({ cron: '30 3 * * *', timezone: 'Europe/Warsaw' });

    const queue = new InMemoryJobQueue();
    await queue.work(definition.name, definition.handler);
    queue.fire(definition.name);
    expect(await queue.runDue()).toEqual([{ checked: 0, inSync: 0, missing: 0, differing: 0, authz: 0 }]);
  });

  it('EVM-034 W11 03:30 Warsaw exists exactly once on a day of the change of time (the schedule skips 02:00–03:00)', () => {
    const wall = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    for (const day of ['2026-03-29', '2026-10-25', '2026-07-01']) {
      const start = Date.parse(`${day}T00:00:00Z`) - 3_600_000;
      const hits = Array.from({ length: 26 * 60 }, (_, minute) => start + minute * 60_000).filter((at) => wall.format(at) === '03:30');
      expect(hits, day).toHaveLength(1);
    }
  });

  it('EVM-034 W11 a projection in sync is a success: counts and the trace id in the log, no warning', async () => {
    const { job, logs } = setup(() => Promise.resolve({ checked: 12, inSync: 12, missing: [], drift: EMPTY }));
    expect(await job.run()).toEqual({ checked: 12, inSync: 12, missing: 0, differing: 0, authz: 0 });
    const entries = logs.entries;
    expect(entries.map((entry) => entry['msg'])).toEqual(['projection verify: start', 'projection verify: in sync']);
    expect(entries.at(-1)).toMatchObject({ traceId: expect.stringMatching(/^[0-9a-f]{32}$/) as string, checked: 12, level: 'info' });
    expect(logs.text).not.toContain('projection_drift_total');
  });

  it('EVM-034 W11 a difference is a RESULT: the job succeeds, one warning carries the metric, the value of this run and the trace id', async () => {
    const [first, second, third] = [uuidv7(), uuidv7(), uuidv7()];
    const { job, logs, clock } = setup((options) => {
      clock.advance(1500);
      expect(options.traceId).toMatch(/^[0-9a-f]{32}$/);
      return Promise.resolve({
        checked: 10,
        inSync: 6,
        missing: [third],
        // `first` differs in two groups and counts once
        drift: { authorization: [first], keys: [first, second], waiting: [], deadline: [] },
      });
    });
    expect(await job.run()).toEqual({ checked: 10, inSync: 6, missing: 1, differing: 2, authz: 1 });
    const warnings = logs.entries.filter((entry) => entry['level'] === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      metric: 'projection_drift_total',
      value: 3,
      missing: 1,
      differing: 2,
      authz: 1,
      durationMs: 1500,
      job: VERIFY_PROJECTION_JOB,
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/) as string,
    });
    // numbers only: no identifier of an order reaches the log
    expect(logs.text).not.toMatch(new RegExp(`${first}|${second}|${third}`));
  });

  it('EVM-034 W11 a failure leaves as a fixed code; the log holds the kind and the SQLSTATE, never the message, SQL or the detail of the driver', async () => {
    const { job, logs } = setup(() => {
      const driver = Object.assign(new Error('canceling statement due to statement timeout: select * from work_orders where email = $1'), {
        code: '57014',
        detail: 'Key (email)=(jan@example.invalid) is bad.',
      });
      return Promise.reject(driver);
    });
    const failure = await job.run().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(JobFailure);
    expect(failure).toMatchObject({ code: VERIFY_PROJECTION_FAILED, message: VERIFY_PROJECTION_FAILED });
    const entry = logs.entries.find((item) => item['msg'] === 'projection verify: failed');
    expect(entry).toMatchObject({ level: 'error', errorType: 'Error', errorCode: '57014' });
    expect(logs.text).not.toMatch(/select|example\.invalid|statement timeout|Key \(/i);
  });

  it('EVM-034 W11 a thrown value that is not an error is a failure of the kind unknown', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test: a value that is not an Error
    const { job, logs } = setup(() => Promise.reject(null));
    await expect(job.run()).rejects.toMatchObject({ code: VERIFY_PROJECTION_FAILED });
    expect(logs.entries.find((item) => item['level'] === 'error')).toMatchObject({ errorType: 'unknown' });
  });
});
