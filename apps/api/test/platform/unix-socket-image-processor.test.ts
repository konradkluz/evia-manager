import { link, mkdir, mkdtemp, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeImageProcessor } from '../../src/platform/media-processing/fake-image-processor.ts';
import { ImageProcessingError, MAX_DERIVATIVE_BYTES } from '../../src/platform/media-processing/image-processor.ts';
import { UnixSocketImageProcessor } from '../../src/platform/media-processing/unix-socket-image-processor.ts';
import { readWebpHeader, syntheticWebp } from '../../src/platform/media-processing/webp.ts';
import { createImageProcessor } from '../../src/platform/media-processing/create-image-processor.ts';

const JOB = '0198a7a0-0000-7000-8000-000000000001';
const THUMB = { variant: 'thumbnail', width: 160, height: 320 } as const;
const PREVIEW = { variant: 'preview', width: 800, height: 1600 } as const;
const OK = JSON.stringify({ ok: true, outputs: [THUMB, PREVIEW] });

// Node on Windows cannot listen on a socket file (EACCES): these tests run in the Linux container (ADR-0015), where the worker and the processor run.
const unixSockets = process.platform !== 'win32';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>(
          (resolve) =>
            void server.close(() => {
              resolve();
            }),
        ),
    ),
  );
});

interface Stub {
  readonly workDir: string;
  readonly socketPath: string;
  readonly requests: string[];
  readonly processor: UnixSocketImageProcessor;
}

/** What the stub does with a job: write files into the job directory, then answer with this text (`undefined`: never answer; `'close'`: hang up). */
type Behaviour = (dir: string, request: { jobId: string; contentType: string }) => Promise<string | undefined> | string | undefined;

async function stub(behaviour: Behaviour, timeouts?: { connectMs: number; exchangeMs: number }): Promise<Stub> {
  const workDir = await mkdtemp(join(tmpdir(), 'evia-api-mp-'));
  const socketPath = join(workDir, 'p.sock');
  const requests: string[] = [];
  const server = createServer((socket) => {
    let received = '';
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8');
      const end = received.indexOf('\n');
      if (end === -1) return;
      requests.push(received.slice(0, end));
      const request = JSON.parse(received.slice(0, end)) as { jobId: string; contentType: string };
      void Promise.resolve(behaviour(join(workDir, request.jobId), request)).then((answer) => {
        if (answer === undefined) return;
        if (answer === 'close') socket.destroy();
        else socket.end(`${answer}\n`);
      });
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    workDir,
    socketPath,
    requests,
    processor: new UnixSocketImageProcessor({ socketPath, workDir, ...(timeouts === undefined ? {} : { timeouts }) }),
  };
}

const write = async (dir: string, name: string, body: Buffer): Promise<void> => writeFile(join(dir, name), body);
const writeBoth = async (dir: string): Promise<void> => {
  await write(dir, 'thumbnail.webp', syntheticWebp(THUMB.width, THUMB.height));
  await write(dir, 'preview.webp', syntheticWebp(PREVIEW.width, PREVIEW.height));
};

const derive = (target: Stub, options: { body?: Buffer; maxBytes?: number; beforeProcessing?: () => void; jobId?: string } = {}) => {
  const body = options.body ?? Buffer.from('the original');
  return target.processor.derive({
    jobId: options.jobId ?? JOB,
    contentType: 'image/jpeg',
    original: Readable.from([body]),
    maxBytes: options.maxBytes ?? body.length,
    beforeProcessing: options.beforeProcessing ?? (() => undefined),
  });
};

const failsWith = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ name: 'ImageProcessingError', code });
};

describe.skipIf(!unixSockets)(
  'EVM-068 AC5 the worker talks to the processor through a Unix socket and a work area of its own, with paths it chose',
  () => {
    it('EVM-068 AC5 stages the original as `input` of the directory of the job, sends ONE line with the job id and the type only, and cleans the directory', async () => {
      let staged: { content: string; mode: number } | undefined;
      const target = await stub(async (dir) => {
        staged = {
          content: (await import('node:fs')).readFileSync(join(dir, 'input'), 'utf8'),
          mode: (await stat(join(dir, 'input'))).mode & 0o777,
        };
        await writeBoth(dir);
        return OK;
      });
      const images = await derive(target);
      expect(target.requests).toEqual([JSON.stringify({ jobId: JOB, contentType: 'image/jpeg' })]);
      expect(staged).toEqual({ content: 'the original', mode: 0o640 });
      expect(images.map((image) => [image.variant, image.width, image.height])).toEqual([
        ['thumbnail', 160, 320],
        ['preview', 800, 1600],
      ]);
      expect(images[0]?.body.equals(syntheticWebp(160, 320))).toBe(true);
      expect(await readdir(target.workDir)).toEqual(['p.sock']);
    });

    it('EVM-068 AC1 the checksum check runs between the staging and the request; a verdict of the caller goes back unchanged and the processor is never asked', async () => {
      const target = await stub(() => OK);
      const verdict = new Error('the object is not the scanned one');
      await expect(
        derive(target, {
          beforeProcessing: () => {
            throw verdict;
          },
        }),
      ).rejects.toBe(verdict);
      expect(target.requests).toEqual([]);
      expect(await readdir(target.workDir)).toEqual(['p.sock']);
    });

    it('EVM-068 AC3 an original longer than its recorded size is refused while it is staged', async () => {
      const target = await stub(() => OK);
      await failsWith(derive(target, { body: Buffer.alloc(100), maxBytes: 99 }), 'unsupported');
      expect(target.requests).toEqual([]);
    });

    it('EVM-068 AC5 a work area that does not exist, and a directory of the job that already exists, are the fault of the system (internal), not a message with a path', async () => {
      const target = await stub(() => OK);
      await mkdir(join(target.workDir, JOB));
      await failsWith(derive(target), 'internal');
      const missing = new UnixSocketImageProcessor({
        socketPath: join(target.workDir, 'p.sock'),
        workDir: join(target.workDir, 'nowhere'),
      });
      await failsWith(
        missing.derive({
          jobId: JOB,
          contentType: 'image/jpeg',
          original: Readable.from([Buffer.from('x')]),
          maxBytes: 1,
          beforeProcessing: () => undefined,
        }),
        'internal',
      );
    });

    it('EVM-068 AC3 a stream of the original that fails is internal', async () => {
      const target = await stub(() => OK);
      const broken = new Readable({
        read() {
          this.destroy(new Error('socket hang up at /srv/secret'));
        },
      });
      await failsWith(
        target.processor.derive({
          jobId: JOB,
          contentType: 'image/jpeg',
          original: broken,
          maxBytes: 10,
          beforeProcessing: () => undefined,
        }),
        'internal',
      );
    });
  },
);

describe.skipIf(!unixSockets)('EVM-068 AC3 the answer of the processor is not trusted (TM-35)', () => {
  it('EVM-068 AC3 the fixed codes of the processor pass through; an unknown code, extra fields and text are internal', async () => {
    for (const code of ['pixel_limit', 'unsupported', 'timeout', 'internal']) {
      const target = await stub(() => JSON.stringify({ ok: false, code }));
      await failsWith(derive(target), code);
    }
    for (const answer of [
      JSON.stringify({ ok: false, code: 'disk_on_fire' }),
      JSON.stringify({ ok: false, code: 'internal', message: '/run/secrets/key' }),
      JSON.stringify({ ok: false, code: 7 }),
      JSON.stringify({ ok: 'maybe' }),
      JSON.stringify({ ok: true }),
      JSON.stringify({ ok: true, outputs: [], extra: 1 }),
    ]) {
      const target = await stub(() => answer);
      await failsWith(derive(target), 'internal');
    }
  });

  it('EVM-068 AC3 an answer that is not JSON, not an object, too long, or missing is unavailable or internal - never a crash of the worker', async () => {
    await failsWith(derive(await stub(() => 'this is not json')), 'unavailable');
    await failsWith(derive(await stub(() => '[1,2]')), 'unavailable');
    await failsWith(derive(await stub(() => 'close')), 'unavailable');
    await failsWith(derive(await stub(() => `{"pad":"${'x'.repeat(5000)}"}`)), 'internal');
  });

  it('EVM-068 AC3 a processor that does not answer is unavailable after the timeout (a hung socket never holds the worker); one that is not there is unreachable at once', async () => {
    const silent = await stub(() => undefined, { connectMs: 1000, exchangeMs: 150 });
    const started = Date.now();
    await failsWith(derive(silent), 'unavailable');
    expect(Date.now() - started).toBeLessThan(3000);
    const gone = await stub(() => OK);
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>(
            (resolve) =>
              void server.close(() => {
                resolve();
              }),
          ),
      ),
    );
    await failsWith(derive(gone, { jobId: '0198a7a0-0000-7000-8000-000000000009' }), 'unreachable');
  });

  it('EVM-068 AC3 the work directory is writable by the group whatever the umask (the processor is another user of the group)', async () => {
    const previous = process.umask(0o022);
    try {
      let mode = 0;
      const seen = await stub(async (dir) => {
        mode = (await stat(dir)).mode & 0o777;
        await writeBoth(dir);
        return OK;
      });
      await derive(seen);
      expect(mode.toString(8)).toBe('770');
    } finally {
      process.umask(previous);
    }
  });

  it('EVM-068 AC3 outputs that are not exactly the two variants within their edges are invalid_output', async () => {
    const bad: unknown[] = [
      { ok: true, outputs: [THUMB] },
      { ok: true, outputs: [THUMB, THUMB] },
      { ok: true, outputs: [THUMB, 'x'] },
      { ok: true, outputs: [THUMB, { ...PREVIEW, path: '/etc/passwd' }] },
      { ok: true, outputs: [THUMB, { ...PREVIEW, variant: 'original' }] },
      { ok: true, outputs: [{ ...THUMB, width: 321 }, PREVIEW] },
      { ok: true, outputs: [THUMB, { ...PREVIEW, height: 1601 }] },
      { ok: true, outputs: [THUMB, { ...PREVIEW, width: 0 }] },
      { ok: true, outputs: [THUMB, { ...PREVIEW, width: 1.5 }] },
    ];
    for (const answer of bad) {
      const target = await stub(async (dir) => {
        await writeBoth(dir);
        return JSON.stringify(answer);
      });
      await failsWith(derive(target), 'invalid_output');
    }
  });
});

describe.skipIf(!unixSockets)(
  'EVM-068 AC3 the files of the processor are not trusted either: a link, a large or a foreign file is never read as a thumbnail (CWE-59, TM-35)',
  () => {
    const withOutputs = (prepare: (dir: string, workDir: string) => Promise<void>) => async (dir: string) => {
      await mkdir(dir, { recursive: true });
      await writeBoth(dir);
      await prepare(dir, join(dir, '..'));
      return OK;
    };

    it('EVM-068 AC3 a symbolic link in the place of an output (to a file the worker can read) is invalid_output - the secret is never uploaded', async () => {
      const target = await stub(
        withOutputs(async (dir, workDir) => {
          await writeFile(join(workDir, 'a-secret-of-the-worker'), syntheticWebp(160, 320));
          const { rm } = await import('node:fs/promises');
          await rm(join(dir, 'thumbnail.webp'));
          await symlink(join(workDir, 'a-secret-of-the-worker'), join(dir, 'thumbnail.webp'));
        }),
      );
      await failsWith(derive(target), 'invalid_output');
    });

    it('EVM-068 AC3 a hard link (two names for one file) is invalid_output', async () => {
      const target = await stub(
        withOutputs(async (dir, workDir) => {
          await link(join(dir, 'preview.webp'), join(workDir, 'second-name'));
        }),
      );
      await failsWith(derive(target), 'invalid_output');
    });

    it('EVM-068 AC3 a file above 2 MB, an empty file, a missing file and a directory are invalid_output', async () => {
      const cases: Array<(dir: string) => Promise<void>> = [
        async (dir) => write(dir, 'thumbnail.webp', Buffer.alloc(MAX_DERIVATIVE_BYTES + 1)),
        async (dir) => write(dir, 'thumbnail.webp', Buffer.alloc(0)),
        async (dir) => (await import('node:fs/promises')).rm(join(dir, 'preview.webp')),
        async (dir) => {
          const { rm } = await import('node:fs/promises');
          await rm(join(dir, 'preview.webp'));
          await mkdir(join(dir, 'preview.webp'));
        },
      ];
      for (const change of cases) {
        const target = await stub(withOutputs(async (dir) => change(dir)));
        await failsWith(derive(target), 'invalid_output');
      }
    });

    it('EVM-068 AC3 a file that is not a WebP (a JPEG, text, a truncated container, a lie about the length) or has other dimensions than claimed is invalid_output', async () => {
      const truncated = syntheticWebp(160, 320).subarray(0, 25);
      const wrongLength = Buffer.from(syntheticWebp(160, 320));
      wrongLength.writeUInt32LE(999, 4);
      const text = Buffer.from('<html><script>alert(1)</script></html> padded to be long enough to pass the length check');
      const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]);
      for (const content of [truncated, wrongLength, text, jpeg, syntheticWebp(100, 100), syntheticWebp(1600, 1600)]) {
        const target = await stub(withOutputs(async (dir) => write(dir, 'thumbnail.webp', content)));
        await failsWith(derive(target), 'invalid_output');
      }
    });
  },
);

describe.skipIf(!unixSockets)('EVM-068 AC1 the work area is cleaned when the worker starts (P3)', () => {
  it('EVM-068 AC1 removes the directories of earlier jobs and leaves the socket and everything that is not a job', async () => {
    const target = await stub(() => OK);
    await mkdir(join(target.workDir, JOB));
    await writeFile(join(target.workDir, JOB, 'input'), 'a photo of a private site');
    await mkdir(join(target.workDir, '0198a7a0-0000-7000-8000-00000000000a'));
    await mkdir(join(target.workDir, 'keep-me'));
    await target.processor.cleanup();
    expect((await readdir(target.workDir)).sort()).toEqual(['keep-me', 'p.sock']);
    await new UnixSocketImageProcessor({ socketPath: 'x', workDir: join(target.workDir, 'nowhere') }).cleanup();
  });
});

describe('EVM-068 the WebP header, the double and the factory', () => {
  const riff = (chunk: Buffer): Buffer => {
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(4 + chunk.length, 4);
    header.write('WEBP', 8, 'latin1');
    return Buffer.concat([header, chunk]);
  };

  it('EVM-068 AC3 reads the dimensions of a lossless, a lossy and an extended container, and refuses everything else', () => {
    expect(readWebpHeader(syntheticWebp(160, 320))).toEqual({ width: 160, height: 320 });
    const lossy = Buffer.alloc(18 + 10);
    lossy.write('VP8 ', 0, 'latin1');
    lossy.writeUInt32LE(18, 4);
    lossy.set([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a], 8);
    lossy.writeUInt16LE(640, 14);
    lossy.writeUInt16LE(480, 16);
    expect(readWebpHeader(riff(lossy))).toEqual({ width: 640, height: 480 });
    const extended = Buffer.alloc(18 + 12);
    extended.write('VP8X', 0, 'latin1');
    extended.writeUInt32LE(10, 4);
    extended.writeUIntLE(799, 12, 3);
    extended.writeUIntLE(1599, 15, 3);
    expect(readWebpHeader(riff(extended))).toEqual({ width: 800, height: 1600 });
    expect(readWebpHeader(Buffer.alloc(10))).toBeUndefined();
    expect(readWebpHeader(Buffer.from('RIFX'.padEnd(40, '\0')))).toBeUndefined();
    const badSignature = Buffer.from(syntheticWebp(10, 10));
    badSignature[20] = 0;
    expect(readWebpHeader(badSignature)).toBeUndefined();
    const badLossy = Buffer.from(riff(lossy));
    badLossy[23] = 0;
    expect(readWebpHeader(badLossy)).toBeUndefined();
    const other = Buffer.from(riff(Buffer.concat([Buffer.from('ALPH'), Buffer.alloc(26)])));
    expect(readWebpHeader(other)).toBeUndefined();
  });

  it('EVM-068 AC1 the double reads the original, runs the check, and answers with synthetic WebP of the edges of the variants', async () => {
    const processor = new FakeImageProcessor();
    let checked = 0;
    const images = await processor.derive({
      jobId: JOB,
      contentType: 'image/png',
      original: Readable.from([Buffer.from('abc')]),
      maxBytes: 3,
      beforeProcessing: () => {
        checked += 1;
      },
    });
    expect(checked).toBe(1);
    expect(processor.jobs[0]?.bytes.toString()).toBe('abc');
    expect(images.map((image) => [image.variant, image.width, image.height])).toEqual([
      ['thumbnail', 320, 160],
      ['preview', 1000, 500],
    ]);
    processor.behaviour = new ImageProcessingError('timeout');
    await failsWith(
      processor.derive({
        jobId: JOB,
        contentType: 'image/png',
        original: Readable.from([Buffer.from('abc')]),
        maxBytes: 3,
        beforeProcessing: () => undefined,
      }),
      'timeout',
    );
    await processor.cleanup();
    expect(processor.cleanups).toBe(1);
  });

  it('EVM-068 AC5 the factory returns the adapter only with both settings', () => {
    expect(createImageProcessor(undefined)).toBeNull();
    const media = {
      s3: { endpoint: 'https://s3.invalid', region: 'fr-par', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's', forcePathStyle: false },
      clamd: undefined,
      processor: undefined,
      bucketOrigin: undefined,
      limits: { maxPendingPerUser: 1, maxPendingPerOrder: 1, abandonAfterDays: 1 },
    } as const;
    expect(createImageProcessor(media)).toBeNull();
    expect(createImageProcessor({ ...media, processor: { socketPath: '/run/p.sock', workDir: '/work' } })).toBeInstanceOf(
      UnixSocketImageProcessor,
    );
  });
});
