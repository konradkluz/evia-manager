import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { InMemoryJobQueue, type JobDefinition, type JobQueue } from '../../src/platform/jobs/index.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { EXIT_FAILED, EXIT_OK, runWorker } from '../../src/worker/run-worker.ts';
import { LogCapture } from '../support/app.ts';

const job: JobDefinition = {
  name: 'overview.verify-projection',
  schedule: { cron: '30 3 * * *', timezone: 'Europe/Warsaw' },
  handler: () => Promise.resolve({ checked: 0 }),
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the worker process (EVM-034 W11; ADR-0010)', () => {
  it('EVM-034 W11 it starts the queue, takes and schedules the jobs, waits, and on SIGTERM stops the queue gracefully and exits 0', async () => {
    const queue = new InMemoryJobQueue();
    const signals = new EventEmitter();
    const logs = new LogCapture();
    const running = runWorker({ queue, jobs: [job], signals, logger: createLogger({ level: 'info', destination: logs }) });
    await settle();
    expect(queue.started).toBe(true);
    expect(queue.handlers.has(job.name)).toBe(true);
    expect(queue.schedules.get(job.name)).toEqual(job.schedule);
    expect(queue.stopped).toBe(false);
    signals.emit('SIGTERM');
    expect(await running).toBe(EXIT_OK);
    expect(queue.stopped).toBe(true);
    expect(logs.entries.map((entry) => entry['msg'])).toEqual(['worker: ready', 'worker: stopping']);
  });

  it('EVM-034 W11 SIGINT stops it as well, and a job without a schedule is only taken', async () => {
    const queue = new InMemoryJobQueue();
    const signals = new EventEmitter();
    const running = runWorker({
      queue,
      jobs: [{ name: 'email.send', handler: job.handler }],
      signals,
      logger: createLogger({ level: 'fatal' }),
    });
    await settle();
    expect(queue.schedules.size).toBe(0);
    signals.emit('SIGINT');
    expect(await running).toBe(EXIT_OK);
  });

  it('EVM-034 W11 a failure to start is exit code 1: the queue is released, the log holds the kind of the error and not its message', async () => {
    const base = new InMemoryJobQueue();
    let stopped = 0;
    const queue: JobQueue = {
      start: () => Promise.reject(new Error('connect ECONNREFUSED postgres://evia:secret-synthetic@db/evia')),
      stop: () => {
        stopped += 1;
        return Promise.reject(new Error('already closed'));
      },
      work: (name, handler) => base.work(name, handler),
      schedule: (name, schedule) => base.schedule(name, schedule),
      send: (name, ids) => base.send(name, ids),
    };
    const logs = new LogCapture();
    const code = await runWorker({
      queue,
      jobs: [job],
      signals: new EventEmitter(),
      logger: createLogger({ level: 'info', destination: logs }),
    });
    expect(code).toBe(EXIT_FAILED);
    expect(stopped).toBe(1);
    expect(logs.entries).toEqual([expect.objectContaining({ msg: 'worker: start failed', errorType: 'Error' })]);
    expect(logs.text).not.toMatch(/secret-synthetic|ECONNREFUSED/);
  });

  it('EVM-034 W11 a failure to stop is exit code 1 as well', async () => {
    const base = new InMemoryJobQueue();
    const queue: JobQueue = {
      start: () => base.start(),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test: a value that is not an Error
      stop: () => Promise.reject('not an error'),
      work: (name, handler) => base.work(name, handler),
      schedule: (name, schedule) => base.schedule(name, schedule),
      send: (name, ids) => base.send(name, ids),
    };
    const signals = new EventEmitter();
    const logs = new LogCapture();
    const running = runWorker({ queue, jobs: [], signals, logger: createLogger({ level: 'info', destination: logs }) });
    await settle();
    signals.emit('SIGTERM');
    expect(await running).toBe(EXIT_FAILED);
    expect(logs.entries.at(-1)).toMatchObject({ msg: 'worker: stop failed', errorType: 'unknown' });
  });
});
