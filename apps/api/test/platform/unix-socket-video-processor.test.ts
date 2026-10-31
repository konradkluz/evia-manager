import { link, mkdir, mkdtemp, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { MediaConfig } from '../../src/platform/config/media-config.ts';
import { createVideoProcessor } from '../../src/platform/media-processing/create-video-processor.ts';
import { FakeVideoProcessor } from '../../src/platform/media-processing/fake-video-processor.ts';
import { UnixSocketVideoProcessor } from '../../src/platform/media-processing/unix-socket-video-processor.ts';
import { VideoProcessingError } from '../../src/platform/media-processing/video-processor.ts';
import { syntheticWebp } from '../../src/platform/media-processing/webp.ts';

const JOB = '0198a7a0-0000-7000-8000-000000000002';
const PROBE = { durationSeconds: 242.4, width: 1920, height: 1080, videoCodec: 'h264', hasAudio: true };
const PROBE_ANSWER = JSON.stringify({ ok: true, probe: PROBE });
const mp4 = (size = 64): Buffer => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(size - 12, 5)]);
const claimOf = (over: object = {}, sizeBytes = mp4().length): string =>
  JSON.stringify({ ok: true, video: { frame: { width: 320, height: 180 }, preview: { width: 1280, height: 720, sizeBytes }, ...over } });

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

type Behaviour = (
  dir: string,
  request: { jobId: string; contentType: string; step: string },
) => Promise<string | undefined> | string | undefined;

async function stub(behaviour: Behaviour, timeouts?: { connectMs: number; probeMs: number; transcodeMs: number }) {
  const workDir = await mkdtemp(join(tmpdir(), 'evia-api-vp-'));
  const socketDir = await mkdtemp(join(tmpdir(), 'evia-api-vs-'));
  const socketPath = join(socketDir, 'p.sock');
  const requests: string[] = [];
  const server = createServer((socket) => {
    let received = '';
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8');
      const end = received.indexOf('\n');
      if (end === -1) return;
      requests.push(received.slice(0, end));
      const request = JSON.parse(received.slice(0, end)) as { jobId: string; contentType: string; step: string };
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
    processor: new UnixSocketVideoProcessor({ socketPath, workDir, ...(timeouts === undefined ? {} : { timeouts }), reserveBytes: 0 }),
  };
}

const probe = (
  target: { processor: UnixSocketVideoProcessor },
  over: { body?: Buffer; maxBytes?: number; beforeProcessing?: () => void } = {},
) => {
  const body = over.body ?? Buffer.from('the original film');
  return target.processor.probe({
    jobId: JOB,
    contentType: 'video/mp4',
    original: Readable.from([body]),
    maxBytes: over.maxBytes ?? body.length,
    beforeProcessing: over.beforeProcessing ?? (() => undefined),
  });
};
const failsWith = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ name: 'VideoProcessingError', code });
};
const readAll = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
};

describe.skipIf(!unixSockets)(
  'EVM-046 AC2 AC5 the worker talks to the processor of films through a socket and a work area of its own',
  () => {
    it('EVM-046 AC2 stages the original, asks for the probe with the job id, the type and the STEP only, and returns the allow-listed fields', async () => {
      let staged: { content: string; mode: number } | undefined;
      const target = await stub(async (dir) => {
        staged = {
          content: (await import('node:fs')).readFileSync(join(dir, 'input'), 'utf8'),
          mode: (await stat(join(dir, 'input'))).mode & 0o777,
        };
        return PROBE_ANSWER;
      });
      expect(await probe(target)).toEqual(PROBE);
      expect(target.requests).toEqual([JSON.stringify({ jobId: JOB, contentType: 'video/mp4', step: 'probe' })]);
      expect(staged).toEqual({ content: 'the original film', mode: 0o640 });
    });

    it('EVM-046 AC2 the checksum check runs between the staging and the request; a verdict of the caller goes back unchanged and the processor is never asked', async () => {
      const target = await stub(() => PROBE_ANSWER);
      const verdict = new Error('the object is not the scanned one');
      await expect(
        probe(target, {
          beforeProcessing: () => {
            throw verdict;
          },
        }),
      ).rejects.toBe(verdict);
      expect(target.requests).toEqual([]);
    });

    it('EVM-046 AC2 an original longer than its recorded size is refused while it is staged; a stream that fails and a work area that is missing are internal', async () => {
      const target = await stub(() => PROBE_ANSWER);
      await failsWith(probe(target, { body: Buffer.alloc(100), maxBytes: 99 }), 'unsupported');
      const broken = new Readable({
        read() {
          this.destroy(new Error('hang up at /srv/secret'));
        },
      });
      await failsWith(
        target.processor.probe({ jobId: JOB, contentType: 'video/mp4', original: broken, maxBytes: 10, beforeProcessing: () => undefined }),
        'internal',
      );
      const missing = new UnixSocketVideoProcessor({ socketPath: target.socketPath, workDir: join(target.workDir, 'nowhere') });
      await failsWith(
        missing.probe({
          jobId: JOB,
          contentType: 'video/mp4',
          original: Readable.from([Buffer.from('x')]),
          maxBytes: 1,
          beforeProcessing: () => undefined,
        }),
        'internal',
      );
    });

    it.each([
      ['not JSON', 'garbage', 'unavailable'],
      ['a refusal of the rules', JSON.stringify({ ok: false, code: 'unsupported' }), 'unsupported'],
      ['a film that is too long', JSON.stringify({ ok: false, code: 'too_long' }), 'too_long'],
      ['an unknown code', JSON.stringify({ ok: false, code: 'rm -rf' }), 'internal'],
      ['a refusal with extra fields', JSON.stringify({ ok: false, code: 'timeout', note: '/etc' }), 'internal'],
      ['neither ok nor not ok', JSON.stringify({ ok: 'yes' }), 'internal'],
      ['an array', '[]', 'unavailable'],
      ['a probe with a tag of the container', JSON.stringify({ ok: true, probe: { ...PROBE, location: '+52.2+21.0' } }), 'invalid_output'],
      ['a probe without the duration', JSON.stringify({ ok: true, probe: { ...PROBE, durationSeconds: undefined } }), 'invalid_output'],
      ['a duration above 30 minutes', JSON.stringify({ ok: true, probe: { ...PROBE, durationSeconds: 1801 } }), 'invalid_output'],
      ['a duration of zero', JSON.stringify({ ok: true, probe: { ...PROBE, durationSeconds: 0 } }), 'invalid_output'],
      ['an enormous picture', JSON.stringify({ ok: true, probe: { ...PROBE, width: 9000 } }), 'invalid_output'],
      ['a codec outside the allow-list', JSON.stringify({ ok: true, probe: { ...PROBE, videoCodec: 'vp9' } }), 'invalid_output'],
      ['a flag that is not a boolean', JSON.stringify({ ok: true, probe: { ...PROBE, hasAudio: 'yes' } }), 'invalid_output'],
      ['an answer of the wrong shape', JSON.stringify({ ok: true, probe: PROBE, extra: 1 }), 'invalid_output'],
      ['no probe at all', JSON.stringify({ ok: true }), 'invalid_output'],
      ['an answer above 4 KB', 'x'.repeat(5000), 'internal'],
    ])('EVM-046 AC2 the answer is not trusted: %s', async (_name, answer, code) => {
      const target = await stub(() => answer);
      await failsWith(probe(target), code);
    });

    it('EVM-046 AC5 a processor that hangs up, hangs, or is not there is a fixed code', async () => {
      const hangup = await stub(() => 'close');
      await failsWith(probe(hangup), 'unavailable');
      const silent = await stub(() => undefined, { connectMs: 1000, probeMs: 150, transcodeMs: 150 });
      await failsWith(probe(silent), 'unavailable');
      const nobody = new UnixSocketVideoProcessor({ socketPath: join(silent.workDir, 'none.sock'), workDir: silent.workDir });
      await failsWith(
        nobody.probe({
          jobId: '0198a7a0-0000-7000-8000-000000000003',
          contentType: 'video/mp4',
          original: Readable.from([Buffer.from('x')]),
          maxBytes: 1,
          beforeProcessing: () => undefined,
        }),
        'unreachable',
      );
    });

    it('EVM-046 AC4 the transcoding returns the frame (read, checked) and the size of the preview; the preview is STREAMED from the work area, not read into memory; dispose removes the job', async () => {
      const target = await stub(async (dir, request) => {
        if (request.step === 'probe') return PROBE_ANSWER;
        await writeFile(join(dir, 'thumbnail.webp'), syntheticWebp(320, 180));
        await writeFile(join(dir, 'preview.mp4'), mp4());
        return claimOf();
      });
      await probe(target);
      const derived = await target.processor.transcode(JOB);
      expect(derived.frame.body.equals(syntheticWebp(320, 180))).toBe(true);
      expect([derived.frame.width, derived.frame.height]).toEqual([320, 180]);
      expect(derived.preview).toEqual({ sizeBytes: mp4().length, width: 1280, height: 720 });
      expect(target.requests[1]).toBe(JSON.stringify({ jobId: JOB, contentType: 'video/mp4', step: 'transcode' }));
      expect((await readAll(await target.processor.openPreview(JOB))).equals(mp4())).toBe(true);
      await target.processor.dispose(JOB);
      expect(await readdir(target.workDir)).toEqual([]);
      await failsWith(target.processor.transcode(JOB), 'internal');
      await failsWith(target.processor.openPreview(JOB), 'internal');
    });

    it.each([
      ['a claim with a picture larger than the box', claimOf({ preview: { width: 1920, height: 1080, sizeBytes: 64 } })],
      ['a claim of a preview above 1 GiB', claimOf({ preview: { width: 1280, height: 720, sizeBytes: 1_073_741_825 } })],
      ['a claim with a frame above the edge', claimOf({ frame: { width: 640, height: 360 } })],
      ['a claim with extra fields', claimOf({ path: '/etc/passwd' })],
      ['a claim of another shape', JSON.stringify({ ok: true, video: { frame: 1, preview: 2 } })],
      ['no claim', JSON.stringify({ ok: true })],
      ['a claim of a size that is not the size of the file', claimOf({}, 999)],
    ])('EVM-046 AC4 SR-FILE-06 the output is not trusted: %s', async (_name, answer) => {
      const target = await stub(async (dir, request) => {
        if (request.step === 'probe') return PROBE_ANSWER;
        await writeFile(join(dir, 'thumbnail.webp'), syntheticWebp(320, 180));
        await writeFile(join(dir, 'preview.mp4'), mp4());
        return answer;
      });
      await probe(target);
      await failsWith(target.processor.transcode(JOB), 'invalid_output');
    });

    it('EVM-046 AC4 SR-FILE-06 a link planted as an output, a second name of a file, a preview that is not an MP4 and a frame of another size are refused', async () => {
      const outside = join(await mkdtemp(join(tmpdir(), 'evia-secret-')), 'secret');
      await writeFile(outside, syntheticWebp(320, 180));
      const cases: Array<(dir: string) => Promise<void>> = [
        async (dir) => {
          await symlink(outside, join(dir, 'thumbnail.webp'));
          await writeFile(join(dir, 'preview.mp4'), mp4());
        },
        async (dir) => {
          await writeFile(join(dir, 'thumbnail.webp'), syntheticWebp(320, 180));
          await symlink(outside, join(dir, 'preview.mp4'));
        },
        async (dir) => {
          await link(outside, join(dir, 'thumbnail.webp'));
          await writeFile(join(dir, 'preview.mp4'), mp4());
        },
        async (dir) => {
          await writeFile(join(dir, 'thumbnail.webp'), syntheticWebp(320, 180));
          await writeFile(join(dir, 'preview.mp4'), Buffer.alloc(64, 1));
        },
        async (dir) => {
          await writeFile(join(dir, 'thumbnail.webp'), syntheticWebp(100, 100));
          await writeFile(join(dir, 'preview.mp4'), mp4());
        },
        async (dir) => {
          await writeFile(join(dir, 'thumbnail.webp'), Buffer.from('not a picture'));
          await writeFile(join(dir, 'preview.mp4'), mp4());
        },
        async (dir) => {
          await writeFile(join(dir, 'thumbnail.webp'), syntheticWebp(320, 180));
        },
      ];
      for (const plant of cases) {
        const target = await stub(async (dir, request) => {
          if (request.step === 'probe') return PROBE_ANSWER;
          await plant(dir);
          return claimOf();
        });
        await probe(target);
        await failsWith(target.processor.transcode(JOB), 'invalid_output');
      }
    });

    it('EVM-046 AC5 a code of the processor on the transcoding is passed on: a timeout stays a timeout', async () => {
      const target = await stub((_dir, request) =>
        request.step === 'probe' ? PROBE_ANSWER : JSON.stringify({ ok: false, code: 'timeout' }),
      );
      await probe(target);
      await failsWith(target.processor.transcode(JOB), 'timeout');
    });

    it('EVM-046 AC4 the preview that was swapped after the check is not streamed', async () => {
      const target = await stub(async (dir, request) => {
        if (request.step === 'probe') return PROBE_ANSWER;
        await writeFile(join(dir, 'thumbnail.webp'), syntheticWebp(320, 180));
        await writeFile(join(dir, 'preview.mp4'), mp4());
        return claimOf();
      });
      await probe(target);
      await target.processor.transcode(JOB);
      await writeFile(join(target.workDir, JOB, 'preview.mp4'), mp4(200));
      await failsWith(target.processor.openPreview(JOB), 'invalid_output');
      await failsWith(
        (async () => {
          await (await import('node:fs/promises')).rm(join(target.workDir, JOB, 'preview.mp4'));
          return target.processor.openPreview(JOB);
        })(),
        'invalid_output',
      );
    });

    it('EVM-046 AC5 cleanup removes the directories of jobs and leaves everything else; the room is judged from the free space', async () => {
      const target = await stub(() => PROBE_ANSWER);
      await mkdir(join(target.workDir, JOB));
      await writeFile(join(target.workDir, JOB, 'input'), 'x');
      await writeFile(join(target.workDir, 'keep.txt'), 'x');
      await target.processor.cleanup();
      expect(await readdir(target.workDir)).toEqual(['keep.txt']);
      expect(await target.processor.hasRoomFor(1000)).toBe(true);
      expect(await target.processor.hasRoomFor(Number.MAX_SAFE_INTEGER)).toBe(false);
      const missing = new UnixSocketVideoProcessor({ socketPath: target.socketPath, workDir: join(target.workDir, 'nowhere') });
      expect(await missing.hasRoomFor(1)).toBe(false);
      await missing.cleanup();
    });
  },
);

describe('EVM-046 AC5 the configuration and the double', () => {
  const media = (processor: MediaConfig['processor']): MediaConfig => ({ processor }) as MediaConfig;

  it('EVM-046 AC5 without the work area of videos there is no processor of films (they stay clean: fail closed)', () => {
    expect(createVideoProcessor(undefined)).toBeNull();
    expect(createVideoProcessor(media(undefined))).toBeNull();
    expect(createVideoProcessor(media({ socketPath: '/run/p.sock', workDir: '/run/w' }))).toBeNull();
    expect(createVideoProcessor(media({ socketPath: '/run/p.sock', workDir: '/run/w', videoWorkDir: '/var/v' }))).toBeInstanceOf(
      UnixSocketVideoProcessor,
    );
  });

  it('EVM-046 AC2 the double reads the original, runs the checks of the caller, and fails or hangs as told', async () => {
    const fake = new FakeVideoProcessor();
    const input = (beforeProcessing = () => undefined) => ({
      jobId: JOB,
      contentType: 'video/mp4' as const,
      original: Readable.from([Buffer.from('abc')]),
      maxBytes: 3,
      beforeProcessing,
    });
    expect((await fake.probe(input())).videoCodec).toBe('h264');
    expect(fake.jobs).toEqual([{ jobId: JOB, contentType: 'video/mp4', bytes: 3 }]);
    fake.probeBehaviour = new VideoProcessingError('unsupported');
    await failsWith(fake.probe(input()), 'unsupported');
    fake.probeBehaviour = () => Promise.resolve({ ...PROBE, videoCodec: 'hevc' } as never);
    expect((await fake.probe(input())).videoCodec).toBe('hevc');
    fake.transcodeBehaviour = new VideoProcessingError('timeout');
    await failsWith(fake.transcode(JOB), 'timeout');
    fake.transcodeBehaviour = () => Promise.reject(new Error('x'));
    await expect(fake.transcode(JOB)).rejects.toThrow('x');
    fake.transcodeBehaviour = 'ok';
    expect((await fake.transcode(JOB)).preview.width).toBe(1280);
    expect((await readAll(await fake.openPreview())).length).toBeGreaterThan(0);
    expect(await fake.hasRoomFor()).toBe(true);
    await fake.dispose(JOB);
    await fake.cleanup();
    expect([fake.disposed, fake.cleanups]).toEqual([[JOB], 1]);
  });
});
