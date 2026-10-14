import { describe, expect, it } from 'vitest';
import { InMemoryJobQueue, JobFailure } from '../../src/platform/jobs/index.ts';
import type { IdempotencyPurger } from '../../src/platform/idempotency/idempotency-purger.ts';
import {
  BATCH_SIZE,
  PURGE_IDEMPOTENCY_FAILED,
  PURGE_IDEMPOTENCY_JOB,
  PURGE_IDEMPOTENCY_SCHEDULE,
  PurgeIdempotencyJob,
} from '../../src/platform/idempotency/purge-idempotency.job.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { LogCapture } from '../support/app.ts';
import { FixedClock } from '../support/clock.ts';

function setup(purgeBatch: IdempotencyPurger['purgeBatch']) {
  const logs = new LogCapture();
  const clock = new FixedClock('2026-10-14T02:10:00.000Z');
  const job = new PurgeIdempotencyJob({ purgeBatch }, createLogger({ level: 'info', destination: logs }), clock);
  return { job, logs, clock };
}

describe('the cleanup of expired idempotency records (EVM-079)', () => {
  it('EVM-079 AC2 the job is named, scheduled once a day at night in Europe/Warsaw and registered through the interface of the queue', async () => {
    const { job } = setup(() => Promise.resolve(0));
    const definition = job.definition();
    expect(definition.name).toBe(PURGE_IDEMPOTENCY_JOB);
    expect(definition.schedule).toEqual(PURGE_IDEMPOTENCY_SCHEDULE);
    expect(PURGE_IDEMPOTENCY_SCHEDULE).toEqual({ cron: '10 4 * * *', timezone: 'Europe/Warsaw' });
    const queue = new InMemoryJobQueue();
    await queue.work(definition.name, definition.handler);
    queue.fire(definition.name);
    expect(await queue.runDue()).toEqual([{ deleted: 0, batches: 1 }]);
  });

  it('EVM-079 AC2 04:10 Warsaw exists exactly once on a day of the change of time', () => {
    const wall = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    for (const day of ['2026-03-29', '2026-10-25', '2026-07-01']) {
      const start = Date.parse(`${day}T00:00:00Z`) - 3_600_000;
      const hits = Array.from({ length: 26 * 60 }, (_, minute) => start + minute * 60_000).filter((at) => wall.format(at) === '04:10');
      expect(hits, day).toHaveLength(1);
    }
  });

  it('EVM-079 AC2 a large backlog is deleted in batches until a batch is not full', async () => {
    const sizes: number[] = [];
    const answers = [BATCH_SIZE, BATCH_SIZE, 17];
    const { job } = setup((batch) => {
      sizes.push(batch);
      return Promise.resolve(answers.shift() ?? 0);
    });
    expect(await job.run()).toEqual({ deleted: 2 * BATCH_SIZE + 17, batches: 3 });
    expect(sizes).toEqual([BATCH_SIZE, BATCH_SIZE, BATCH_SIZE]);
  });

  it('EVM-079 AC4 the log holds the number deleted and the duration, and nothing that identifies a record', async () => {
    const { job, logs, clock } = setup(() => {
      clock.advance(1500);
      return Promise.resolve(5);
    });
    await job.run();
    expect(logs.entries.at(-1)).toMatchObject({
      msg: 'idempotency purge: done',
      level: 'info',
      job: PURGE_IDEMPOTENCY_JOB,
      deleted: 5,
      batches: 1,
      durationMs: 1500,
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/) as string,
    });
    expect(logs.text).not.toMatch(/user|key|hash/i);
  });

  it('EVM-079 AC2 AC4 a failed run is logged as a job error with the kind and the SQLSTATE only, and leaves as a JobFailure with a fixed code', async () => {
    let calls = 0;
    const { job, logs } = setup(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(BATCH_SIZE)
        : Promise.reject(Object.assign(new Error('secret detail: key (0198b0a0)'), { code: '57014' }));
    });
    const failure = await job.run().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(JobFailure);
    expect((failure as JobFailure).code).toBe(PURGE_IDEMPOTENCY_FAILED);
    expect(logs.entries.at(-1)).toMatchObject({
      msg: 'idempotency purge: failed',
      level: 'error',
      deleted: BATCH_SIZE,
      batches: 1,
      errorType: 'Error',
      errorCode: '57014',
    });
    expect(logs.text).not.toContain('secret detail');
  });

  it('EVM-079 AC2 a non-error rejection is logged as an unknown kind', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the test needs a rejection that is not an object
    const { job, logs } = setup(() => Promise.reject(null));
    await expect(job.run()).rejects.toBeInstanceOf(JobFailure);
    expect(logs.entries.at(-1)).toMatchObject({ errorType: 'unknown' });
  });
});
