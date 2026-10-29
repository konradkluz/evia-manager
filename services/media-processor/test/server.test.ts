import { mkdtemp } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isListening } from '../src/healthcheck.ts';
import { settingsOf, startProcessor } from '../src/main.ts';
import { MAX_REQUEST_BYTES, type JobRequest, type JobResult } from '../src/protocol.ts';
import { createProcessorServer } from '../src/server.ts';
import { JOB_ID, jobDirectory, photoWithMetadata, stage } from './support/synthetic.ts';

const servers: Array<{ close: (callback?: () => void) => unknown }> = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

async function socketPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'evia-sock-')), 'p.sock');
}

/** Sends `payload` and returns everything the server wrote before it closed the connection. */
function exchange(path: string, payload: string): Promise<string> {
  return new Promise((resolve) => {
    let received = '';
    const socket = createConnection(path);
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8');
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      resolve(received);
    });
    socket.write(payload);
  });
}

async function listen(run: (request: JobRequest) => Promise<JobResult>, log: (entry: object) => void = () => undefined): Promise<string> {
  const path = await socketPath();
  const server = createProcessorServer(run, log);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return path;
}

const LINE = JSON.stringify({ jobId: JOB_ID, contentType: 'image/jpeg' });

describe('EVM-068 AC5 the processor listens on a Unix socket and runs one job at a time', () => {
  it('EVM-068 AC5 answers a valid request with one line of JSON and logs only the job id and a code', async () => {
    const log: object[] = [];
    const path = await listen(
      () => Promise.resolve({ ok: false, code: 'unsupported' }),
      (entry) => log.push(entry),
    );
    expect(JSON.parse(await exchange(path, `${LINE}\n`))).toEqual({ ok: false, code: 'unsupported' });
    expect(log).toEqual([{ event: 'done', jobId: JOB_ID, code: 'unsupported' }]);
  });

  it('EVM-068 AC5 closes a request that is not the protocol, one that is too long and a runner that throws is internal', async () => {
    const path = await listen(() => Promise.reject(new Error('secret path /srv/x')));
    expect(await exchange(path, 'GET / HTTP/1.1\n')).toBe('');
    expect(await exchange(path, `${'x'.repeat(MAX_REQUEST_BYTES + 100)}\n`)).toBe('');
    const answer = await exchange(path, `${LINE}\n`);
    expect(JSON.parse(answer)).toEqual({ ok: false, code: 'internal' });
    expect(answer).not.toContain('secret');
  });

  it('EVM-068 AC5 serves the jobs one after another, in the order they arrived', async () => {
    const order: string[] = [];
    let running = 0;
    let most = 0;
    const path = await listen(async (request) => {
      running += 1;
      most = Math.max(most, running);
      order.push(request.contentType);
      await new Promise((resolve) => setTimeout(resolve, 50));
      running -= 1;
      return { ok: false, code: 'internal' };
    });
    const line = (contentType: string) => `${JSON.stringify({ jobId: JOB_ID, contentType })}\n`;
    await Promise.all([exchange(path, line('image/jpeg')), exchange(path, line('image/png')), exchange(path, line('image/webp'))]);
    expect(most).toBe(1);
    expect(order).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});

describe('EVM-068 AC5 the process: settings from the environment, a real job over the socket, the health check', () => {
  it('EVM-068 AC5 needs two absolute paths', () => {
    expect(settingsOf({})).toBeUndefined();
    expect(settingsOf({ MEDIA_PROCESSOR_SOCKET: '/run/p.sock' })).toBeUndefined();
    expect(settingsOf({ MEDIA_PROCESSOR_SOCKET: 'p.sock', MEDIA_PROCESSOR_WORKDIR: '/work' })).toBeUndefined();
    expect(settingsOf({ MEDIA_PROCESSOR_SOCKET: '/run/p.sock', MEDIA_PROCESSOR_WORKDIR: 'work' })).toBeUndefined();
    expect(settingsOf({ MEDIA_PROCESSOR_SOCKET: '/run/p.sock', MEDIA_PROCESSOR_WORKDIR: '/work' })).toEqual({
      socketPath: '/run/p.sock',
      workDir: '/work',
    });
  });

  it('EVM-068 AC1 converts a staged photo over the socket and the health check sees the listener', async () => {
    const { workDir, dir } = await jobDirectory();
    await stage(dir, await photoWithMetadata(800, 400));
    const path = await socketPath();
    const log: object[] = [];
    const server = await startProcessor({ socketPath: path, workDir }, (entry) => log.push(entry));
    servers.push(server);
    expect(await isListening(path)).toBe(true);
    const answer = JSON.parse(await exchange(path, `${LINE}\n`)) as JobResult;
    expect(answer).toMatchObject({ ok: true });
    expect(log).toEqual([{ event: 'listening' }, { event: 'done', jobId: JOB_ID, code: 'ok' }]);
  });

  it('EVM-068 AC5 the health check fails when nothing listens', async () => {
    expect(await isListening(await socketPath(), 500)).toBe(false);
  });

  it('EVM-068 AC3 a job that exceeds the timeout of the process is answered with timeout', async () => {
    const { workDir, dir } = await jobDirectory();
    await stage(dir, await photoWithMetadata(800, 400));
    const path = await socketPath();
    const server = await startProcessor({ socketPath: path, workDir }, () => undefined, 1);
    servers.push(server);
    expect(JSON.parse(await exchange(path, `${LINE}\n`))).toEqual({ ok: false, code: 'timeout' });
  });
});
