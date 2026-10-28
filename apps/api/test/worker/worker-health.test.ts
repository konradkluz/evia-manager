import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryJobQueue } from '../../src/platform/jobs/index.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { runWorker, type BackgroundTask } from '../../src/worker/run-worker.ts';
import { HEALTH_INTERVAL_MS, HEALTH_MAX_AGE_MS, healthTask, isWorkerHealthy, writeHealth } from '../../src/worker/worker-health.ts';
import { LogCapture } from '../support/app.ts';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'evia-worker-health-'));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

const NOW = new Date('2026-10-16T08:00:00.000Z');

describe('the health file of the worker (EVM-024 AC6; SR-API-12)', () => {
  it('EVM-024 AC6 a worker with a transport that can send is healthy right after it wrote the file, and not when the file is older than two minutes or comes from the future', async () => {
    const path = join(directory, 'health');
    await writeHealth(path, 'smtp', NOW);
    expect(await isWorkerHealthy(path, NOW)).toBe(true);
    expect(await isWorkerHealthy(path, new Date(NOW.getTime() + HEALTH_MAX_AGE_MS))).toBe(true);
    expect(await isWorkerHealthy(path, new Date(NOW.getTime() + HEALTH_MAX_AGE_MS + 1))).toBe(false);
    expect(await isWorkerHealthy(path, new Date(NOW.getTime() - HEALTH_MAX_AGE_MS - 1))).toBe(false);
  });

  it('EVM-024 AC6 fail closed: the transport none is never healthy, and neither is a missing, an empty or a damaged file', async () => {
    const path = join(directory, 'health');
    await writeHealth(path, 'none', NOW);
    expect(await isWorkerHealthy(path, NOW)).toBe(false);
    expect(await isWorkerHealthy(join(directory, 'missing'), NOW)).toBe(false);
    for (const content of [
      '',
      '{',
      'null',
      '[]',
      '{"at":"yesterday","transport":"smtp"}',
      '{"at":"2026-10-16T08:00:00.000Z"}',
      '{"transport":"smtp"}',
    ]) {
      await writeFile(path, content);
      expect(await isWorkerHealthy(path, NOW), content).toBe(false);
    }
  });

  it('EVM-024 AC6 the file holds the time and the kind of the transport and nothing else, and is replaced atomically', async () => {
    const path = join(directory, 'nested', 'health');
    await writeHealth(path, 'smtp', NOW);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ at: NOW.toISOString(), transport: 'smtp' });
    expect(await readdir(join(directory, 'nested'))).toEqual(['health']);
  });

  it('EVM-024 AC6 the task writes the file at once and every 30 seconds, and stops with the worker', async () => {
    const path = join(directory, 'health');
    let now = NOW;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const stop = healthTask(path, 'smtp', () => now).start();
    await vi.waitFor(async () => {
      expect(await isWorkerHealthy(path, now)).toBe(true);
    });
    now = new Date(NOW.getTime() + HEALTH_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS);
    await vi.waitFor(async () => {
      expect((JSON.parse(await readFile(path, 'utf8')) as { at: string }).at).toBe(now.toISOString());
    });
    await stop();
    now = new Date(NOW.getTime() + 2 * HEALTH_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS);
    expect((JSON.parse(await readFile(path, 'utf8')) as { at: string }).at).not.toBe(now.toISOString());
  });
});

describe('the background tasks of the worker (EVM-024; ADR-0010)', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('EVM-024 a task starts when the jobs are taken and stops BEFORE the queue is stopped', async () => {
    const queue = new InMemoryJobQueue();
    const signals = new EventEmitter();
    const order: string[] = [];
    const task: BackgroundTask = {
      start: () => {
        order.push('start');
        return () => {
          order.push(queue.stopped ? 'stop after the queue' : 'stop');
        };
      },
    };
    const running = runWorker({ queue, jobs: [], tasks: [task], signals, logger: createLogger({ level: 'fatal' }) });
    await settle();
    expect(order).toEqual(['start']);
    signals.emit('SIGTERM');
    expect(await running).toBe(0);
    expect(order).toEqual(['start', 'stop']);
  });

  it('EVM-044 AC3 the worker waits for an asynchronous stop of a task before it stops the queue', async () => {
    const queue = new InMemoryJobQueue();
    const signals = new EventEmitter();
    const order: string[] = [];
    const task: BackgroundTask = {
      start: () => async () => {
        await settle();
        order.push(queue.stopped ? 'finished after the queue' : 'finished');
      },
    };
    const running = runWorker({ queue, jobs: [], tasks: [task], signals, logger: createLogger({ level: 'fatal' }) });
    await settle();
    signals.emit('SIGTERM');
    expect(await running).toBe(0);
    expect(order).toEqual(['finished']);
  });

  it('EVM-024 a worker that fails to start stops the tasks it had started and exits 1', async () => {
    const queue = new InMemoryJobQueue();
    const stopped: string[] = [];
    const logs = new LogCapture();
    const first: BackgroundTask = {
      start: () => () => {
        stopped.push('first');
      },
    };
    const second: BackgroundTask = {
      start: () => {
        throw new Error('synthetic failure with postgres://secret');
      },
    };
    const exit = await runWorker({
      queue,
      jobs: [],
      tasks: [first, second],
      signals: new EventEmitter(),
      logger: createLogger({ level: 'info', destination: logs }),
    });
    expect(exit).toBe(1);
    expect(stopped).toEqual(['first']);
    expect(JSON.stringify(logs.entries)).not.toContain('secret');
  });

  it('EVM-024 a job takes its retry policy to the queue', async () => {
    const queue = new InMemoryJobQueue();
    const signals = new EventEmitter();
    const retry = { retryLimit: 5, retryDelaySeconds: 30, retryBackoff: true, retryDelayMaxSeconds: 480 };
    const running = runWorker({
      queue,
      jobs: [
        { name: 'email.send', handler: () => Promise.resolve({}), retry },
        { name: 'overview.other', handler: () => Promise.resolve({}) },
      ],
      signals,
      logger: createLogger({ level: 'fatal' }),
    });
    await settle();
    expect(queue.retryPolicies.get('email.send')).toEqual(retry);
    expect(queue.retryPolicies.has('overview.other')).toBe(false);
    signals.emit('SIGTERM');
    await running;
  });
});
