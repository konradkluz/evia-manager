/**
 * The adapter of the video processor over a Unix socket and a shared work area of VIDEOS (EVM-046; ADR-0009; SR-FILE-04, SR-FILE-06, SR-INPUT-04,
 * SR-INFRA-11; TM-35, TM-36). The worker and the processor share a DISK volume for films (a film of 4 GiB does not fit in a tmpfs; the departure from P3
 * is recorded in media-pipeline.md) next to the socket of the photos; the volume is `noexec,nosuid,nodev` and only these two containers mount it.
 * - the directory of a job is `<videoWorkDir>/<jobId>` (a UUID of the server); the request carries no path, only the job id, the type and the STEP;
 * - the answer is NOT trusted: one line, at most 4 KB, exactly the shape of the protocol; the fields are re-checked against the limits of the pipeline;
 * - the outputs are NOT trusted either: the frame and the preview are read only under their fixed names by `lstat` (a plain file, ONE name, no link) and
 *   `O_NOFOLLOW`, compared with what was opened; the preview must be an MP4 (`ftyp`) of the size the answer claims and at most 1 GiB; the frame is a WebP
 *   of the claimed size and at most 2 MB. The preview is NOT read into memory: `openPreview` hands out a stream of the file that was verified;
 * - the directory of a job is removed by `dispose` on every path of the caller and by `cleanup` at the start;
 * - `hasRoomFor` reads the free space of the volume before a film is taken.
 * Nothing here logs: the caller logs a job id and a fixed code.
 */
import { constants, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rm, statfs } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  MAX_FRAME_BYTES,
  MAX_VIDEO_PREVIEW_BYTES,
  PREVIEW_LIMIT,
  VideoProcessingError,
  type ProbeInput,
  type VideoDerivatives,
  type VideoProbe,
  type VideoProcessingErrorCode,
  type VideoProcessor,
} from './video-processor.ts';
import { readWebpHeader } from './webp.ts';

export interface UnixSocketVideoSettings {
  readonly socketPath: string;
  readonly workDir: string;
  /** Overrides of the defaults (tests only). */
  readonly timeouts?: { readonly connectMs: number; readonly probeMs: number; readonly transcodeMs: number };
  /** The reserve kept free on top of the original and its preview (bytes); the default is 1 GiB. */
  readonly reserveBytes?: number;
}

/** ffprobe is killed after 30 s and ffmpeg after 15 min by the processor; the worker waits a little longer and then gives up (ordering of ADR-0009). */
export const DEFAULT_VIDEO_TIMEOUTS = { connectMs: 5000, probeMs: 60_000, transcodeMs: 16 * 60_000 } as const;
/** The room a preview needs: its maximum (1 GiB) and a margin for the frame and the file system. */
export const PREVIEW_ROOM_BYTES = MAX_VIDEO_PREVIEW_BYTES + 100 * 1024 * 1024;
export const DEFAULT_RESERVE_BYTES = 1024 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4096;
const REPORTED_CODES: readonly VideoProcessingErrorCode[] = ['unsupported', 'too_long', 'timeout', 'internal', 'invalid_output'];
const JOB_DIRECTORY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

type Answer = { readonly value: Record<string, unknown> } | { readonly code: VideoProcessingErrorCode };

/** One line of JSON in; @returns the object of an `ok` answer or the fixed code of a failure (an unknown code is `internal`). */
function parseAnswer(line: string): Answer {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { code: 'unavailable' };
  }
  if (!isRecord(value)) return { code: 'unavailable' };
  if (value['ok'] === false) {
    const code = value['code'];
    if (!hasOnly(value, ['ok', 'code']) || typeof code !== 'string') return { code: 'internal' };
    return { code: (REPORTED_CODES as readonly string[]).includes(code) ? (code as VideoProcessingErrorCode) : 'internal' };
  }
  return value['ok'] === true ? { value } : { code: 'internal' };
}

/** @returns the allow-listed fields of the probe, or `undefined` when the answer is not exactly that within the limits of the pipeline */
function readProbe(value: Record<string, unknown>): VideoProbe | undefined {
  const probe = value['probe'];
  if (!hasOnly(value, ['ok', 'probe']) || !isRecord(probe)) return undefined;
  if (!hasOnly(probe, ['durationSeconds', 'width', 'height', 'videoCodec', 'hasAudio'])) return undefined;
  const { durationSeconds, width, height, videoCodec, hasAudio } = probe;
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 1800)
    return undefined;
  if (!inRange(width, 1, 4096) || !inRange(height, 1, 4096)) return undefined;
  if (videoCodec !== 'h264' && videoCodec !== 'hevc') return undefined;
  if (typeof hasAudio !== 'boolean') return undefined;
  return { durationSeconds, width, height, videoCodec, hasAudio };
}

interface Claimed {
  readonly frame: { readonly width: number; readonly height: number };
  readonly preview: { readonly width: number; readonly height: number; readonly sizeBytes: number };
}

function readClaim(value: Record<string, unknown>): Claimed | undefined {
  const video = value['video'];
  if (!hasOnly(value, ['ok', 'video']) || !isRecord(video) || !hasOnly(video, ['frame', 'preview'])) return undefined;
  const { frame, preview } = video;
  if (!isRecord(frame) || !hasOnly(frame, ['width', 'height']) || !isRecord(preview) || !hasOnly(preview, ['width', 'height', 'sizeBytes']))
    return undefined;
  if (!inRange(frame['width'], 1, 320) || !inRange(frame['height'], 1, 320)) return undefined;
  if (!inRange(preview['width'], 1, PREVIEW_LIMIT.width) || !inRange(preview['height'], 1, PREVIEW_LIMIT.height)) return undefined;
  if (!inRange(preview['sizeBytes'], 1, MAX_VIDEO_PREVIEW_BYTES)) return undefined;
  return {
    frame: { width: frame['width'], height: frame['height'] },
    preview: { width: preview['width'], height: preview['height'], sizeBytes: preview['sizeBytes'] },
  };
}

/** What `beforeProcessing` threw: the verdict of the caller, which goes back to it unchanged. */
class CallerVerdict extends Error {
  readonly verdict: unknown;
  constructor(verdict: unknown) {
    super('caller verdict');
    this.verdict = verdict;
  }
}

/** Counts the bytes of the original and refuses a stream longer than its recorded size (a damaged or swapped object). */
function capped(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > limit) callback(new VideoProcessingError('unsupported'));
      else callback(null, chunk);
    },
  });
}

interface VerifiedFile {
  readonly ino: number;
  readonly dev: number;
  readonly size: number;
}

export class UnixSocketVideoProcessor implements VideoProcessor {
  readonly #settings: UnixSocketVideoSettings;
  readonly #types = new Map<string, 'video/mp4' | 'video/quicktime'>();
  readonly #previews = new Map<string, VerifiedFile>();

  constructor(settings: UnixSocketVideoSettings) {
    this.#settings = settings;
  }

  async probe(input: ProbeInput): Promise<VideoProbe> {
    const dir = join(this.#settings.workDir, input.jobId);
    try {
      await mkdir(dir, { mode: 0o770 });
      // mkdir's mode is cut by the umask; the processor runs as another user of the group and must write here
      await chmod(dir, 0o770);
      try {
        await pipeline(input.original, capped(input.maxBytes), createWriteStream(join(dir, 'input'), { flags: 'wx', mode: 0o640 }));
      } catch (error) {
        if (error instanceof VideoProcessingError) throw error;
        throw new VideoProcessingError('internal');
      }
      try {
        input.beforeProcessing();
      } catch (error) {
        throw new CallerVerdict(error);
      }
      this.#types.set(input.jobId, input.contentType);
      const answer = await this.#ask({ jobId: input.jobId, contentType: input.contentType, step: 'probe' }, this.#timeouts().probeMs);
      if ('code' in answer) throw new VideoProcessingError(answer.code);
      const probe = readProbe(answer.value);
      if (probe === undefined) throw new VideoProcessingError('invalid_output');
      return probe;
    } catch (error) {
      if (error instanceof CallerVerdict) throw error.verdict as Error;
      throw error instanceof VideoProcessingError ? error : new VideoProcessingError('internal');
    }
  }

  async transcode(jobId: string): Promise<VideoDerivatives> {
    const contentType = this.#types.get(jobId);
    if (contentType === undefined) throw new VideoProcessingError('internal');
    const dir = join(this.#settings.workDir, jobId);
    try {
      const answer = await this.#ask({ jobId, contentType, step: 'transcode' }, this.#timeouts().transcodeMs);
      if ('code' in answer) throw new VideoProcessingError(answer.code);
      const claim = readClaim(answer.value);
      if (claim === undefined) throw new VideoProcessingError('invalid_output');
      const frame = await this.#readFrame(join(dir, 'thumbnail.webp'), claim.frame);
      const verified = await this.#verifyPreview(join(dir, 'preview.mp4'), claim.preview.sizeBytes);
      this.#previews.set(jobId, verified);
      return { frame, preview: claim.preview };
    } catch (error) {
      throw error instanceof VideoProcessingError ? error : new VideoProcessingError('invalid_output');
    }
  }

  async openPreview(jobId: string): Promise<Readable> {
    const verified = this.#previews.get(jobId);
    if (verified === undefined) throw new VideoProcessingError('internal');
    try {
      const handle = await open(join(this.#settings.workDir, jobId, 'preview.mp4'), constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = await handle.stat();
      // the file that is streamed away is the file that was verified (not swapped between the check and the open)
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        opened.ino !== verified.ino ||
        opened.dev !== verified.dev ||
        opened.size !== verified.size
      ) {
        await handle.close();
        throw new VideoProcessingError('invalid_output');
      }
      return handle.createReadStream({ start: 0, end: verified.size - 1 });
    } catch (error) {
      throw error instanceof VideoProcessingError ? error : new VideoProcessingError('invalid_output');
    }
  }

  async hasRoomFor(originalBytes: number): Promise<boolean> {
    try {
      const stats = await statfs(this.#settings.workDir);
      const free = stats.bavail * stats.bsize;
      return free >= originalBytes + PREVIEW_ROOM_BYTES + (this.#settings.reserveBytes ?? DEFAULT_RESERVE_BYTES);
    } catch {
      return false;
    }
  }

  async dispose(jobId: string): Promise<void> {
    this.#types.delete(jobId);
    this.#previews.delete(jobId);
    await rm(join(this.#settings.workDir, jobId), { recursive: true, force: true }).catch(() => undefined);
  }

  async cleanup(): Promise<void> {
    for (const entry of await readdir(this.#settings.workDir).catch(() => [])) {
      if (JOB_DIRECTORY.test(entry)) await rm(join(this.#settings.workDir, entry), { recursive: true, force: true });
    }
    this.#types.clear();
    this.#previews.clear();
  }

  #timeouts(): { readonly connectMs: number; readonly probeMs: number; readonly transcodeMs: number } {
    return this.#settings.timeouts ?? DEFAULT_VIDEO_TIMEOUTS;
  }

  /** One line out, one line in (at most 4 KB); a failure before the connection is `unreachable` (the job never reached the processor), any later one `unavailable`. */
  #ask(request: object, exchangeMs: number): Promise<Answer> {
    const { connectMs } = this.#timeouts();
    return new Promise((resolve) => {
      const socket = createConnection(this.#settings.socketPath);
      let received = '';
      let settled = false;
      let connected = false;
      const finish = (value: Answer): void => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(exchangeTimer);
        socket.destroy();
        resolve(value);
      };
      const connectTimer = setTimeout(() => {
        finish({ code: 'unreachable' });
      }, connectMs);
      const exchangeTimer = setTimeout(() => {
        finish({ code: 'unavailable' });
      }, exchangeMs);
      socket.on('connect', () => {
        connected = true;
        clearTimeout(connectTimer);
        socket.write(`${JSON.stringify(request)}\n`);
      });
      socket.on('error', () => {
        finish({ code: connected ? 'unavailable' : 'unreachable' });
      });
      socket.on('data', (chunk) => {
        received += chunk.toString('utf8');
        if (received.length > MAX_RESPONSE_BYTES) finish({ code: 'internal' });
      });
      socket.on('close', () => {
        const end = received.indexOf('\n');
        finish(end === -1 ? { code: 'unavailable' } : parseAnswer(received.slice(0, end)));
      });
    });
  }

  /** The frame: a plain file with one name, opened without following a link, within the size limit, a WebP of the claimed size. */
  async #readFrame(path: string, claimed: { readonly width: number; readonly height: number }): Promise<VideoDerivatives['frame']> {
    try {
      const before = await lstat(path);
      if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > MAX_FRAME_BYTES)
        throw new VideoProcessingError('invalid_output');
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size)
          throw new VideoProcessingError('invalid_output');
        const body = Buffer.alloc(opened.size);
        const { bytesRead } = await handle.read(body, 0, opened.size, 0);
        const header = bytesRead === opened.size ? readWebpHeader(body) : undefined;
        if (header?.width !== claimed.width || header.height !== claimed.height) throw new VideoProcessingError('invalid_output');
        return { body, width: header.width, height: header.height };
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw error instanceof VideoProcessingError ? error : new VideoProcessingError('invalid_output');
    }
  }

  /** The preview: a plain file, one name, the size the answer claims, within 1 GiB, with `ftyp` where an MP4 has it. */
  async #verifyPreview(path: string, claimedSize: number): Promise<VerifiedFile> {
    try {
      const before = await lstat(path);
      if (!before.isFile() || before.nlink !== 1 || before.size !== claimedSize || before.size > MAX_VIDEO_PREVIEW_BYTES)
        throw new VideoProcessingError('invalid_output');
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size)
          throw new VideoProcessingError('invalid_output');
        const head = Buffer.alloc(12);
        const { bytesRead } = await handle.read(head, 0, 12, 0);
        if (bytesRead !== 12 || head.toString('latin1', 4, 8) !== 'ftyp') throw new VideoProcessingError('invalid_output');
        return { ino: opened.ino, dev: opened.dev, size: opened.size };
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw error instanceof VideoProcessingError ? error : new VideoProcessingError('invalid_output');
    }
  }
}
