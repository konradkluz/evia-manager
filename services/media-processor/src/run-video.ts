/**
 * The processing of ONE video (EVM-046 AC2, AC4, AC5; ADR-0009; SR-FILE-03, SR-FILE-04, SR-FILE-06, SR-FILE-08, SR-INPUT-04; P3). ffprobe and ffmpeg
 * parse a hostile container, so:
 * - they run with `spawn` of a fixed binary, an argument vector and NO shell, an EMPTY environment, no stdin, and stderr thrown away (it carries the
 *   tags of the file - a place, a title - and must never reach a log; CWE-532). A SIGKILL ends them after the timeout;
 * - the demuxer is FORCED (`-f mov`: no autodetection, so a playlist, a concat script or an image cannot be passed off as MP4), only the protocol
 *   `file` is open and the external references of a MOV (`dref`) are off, so the file cannot read another file of the container (CWE-73);
 * - what is mapped is one video stream and at most one audio stream (`-map 0:v:0 -map 0:a:0?`), no subtitles, data or attachments, and the output
 *   carries NO metadata at all (`-map_metadata -1 -map_chapters -1`, bitexact: no location, no title, no encoder tag);
 * - the limits of the INPUT (30 min, 4096 x 4096, 120 fps, H.264 or H.265) are judged from the probe BEFORE the transcoding, and the output is
 *   limited again (`-t`, because a duration in a container can be forged); the OUTPUT is probed again: MP4, H.264, within 1280 x 720, a size;
 * - what comes back is a fixed code or the fields of an allow-list - never a tag, a path or a line of the output of a tool.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  FRAME_EDGE,
  MAX_FRAME_BYTES,
  MAX_INPUT_EDGE,
  MAX_INPUT_FPS,
  MAX_PREVIEW_BYTES,
  MAX_PROBE_STDOUT_BYTES,
  MAX_VIDEO_SECONDS,
  PREVIEW_BOX,
  PROBE_TIMEOUT_MS,
  TRANSCODE_TIMEOUT_MS,
  VIDEO_FRAME_FILE,
  VIDEO_INPUT_FILE,
  VIDEO_PREVIEW_FILE,
  type VideoErrorCode,
  type VideoProbeInfo,
  type VideoResult,
} from './video-protocol.ts';

export interface CommandResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: Buffer;
  readonly timedOut: boolean;
  /** stdout was longer than allowed (the process was killed). */
  readonly overflow: boolean;
  /** The binary could not be started (missing, no permission). */
  readonly failedToStart: boolean;
}

export interface CommandOptions {
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
}

export type CommandRunner = (command: string, args: readonly string[], options: CommandOptions) => Promise<CommandResult>;

/** `spawn` without a shell, with an empty environment; stderr and stdin are not connected. */
export const spawnRunner: CommandRunner = (command, args, options) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], { shell: false, env: {}, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let overflow = false;
    let started = true;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxStdoutBytes) {
        overflow = true;
        child.kill('SIGKILL');
        return;
      }
      chunks.push(chunk);
    });
    child.on('error', () => {
      started = false;
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout: Buffer.concat(chunks), timedOut, overflow, failedToStart: !started });
    });
  });

export interface VideoTools {
  readonly ffmpeg: string;
  readonly ffprobe: string;
  readonly run: CommandRunner;
  readonly transcodeTimeoutMs: number;
  readonly probeTimeoutMs: number;
}

export const defaultTools = (): VideoTools => ({
  ffmpeg: '/usr/bin/ffmpeg',
  ffprobe: '/usr/bin/ffprobe',
  run: spawnRunner,
  transcodeTimeoutMs: TRANSCODE_TIMEOUT_MS,
  probeTimeoutMs: PROBE_TIMEOUT_MS,
});

class VideoJobError extends Error {
  readonly code: VideoErrorCode;
  constructor(code: VideoErrorCode) {
    super(code);
    this.code = code;
  }
}

/** A tool that did not finish cleanly: the code says whose fault it is (a timeout and a crash are the system's; a failed parse is the file's). */
function failureOf(result: CommandResult): VideoErrorCode | undefined {
  if (result.failedToStart) return 'internal';
  if (result.timedOut) return 'timeout';
  if (result.overflow) return 'unsupported';
  if (result.signal !== null) return 'internal';
  return result.exitCode === 0 ? undefined : 'unsupported';
}

async function requirePlainFile(path: string, maxBytes: number): Promise<number> {
  const stats = await lstat(path).catch(() => {
    throw new VideoJobError('invalid_output');
  });
  if (!stats.isFile() || stats.nlink !== 1 || stats.size < 1 || stats.size > maxBytes) throw new VideoJobError('invalid_output');
  return stats.size;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const asNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** The input flags that every call has: the demuxer forced, one protocol, no references to other files. */
const INPUT_FLAGS = ['-protocol_whitelist', 'file', '-enable_drefs', '0', '-f', 'mov'] as const;

/** ffprobe on one file: the structure, as the allow-list of fields. @throws VideoJobError */
async function probeFile(path: string, tools: VideoTools): Promise<VideoProbeInfo> {
  const result = await tools.run(
    tools.ffprobe,
    [
      ...['-v', 'error', '-probesize', '5000000', '-analyzeduration', '5000000'],
      ...INPUT_FLAGS,
      ...['-print_format', 'json'],
      ...['-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,width,height,duration,r_frame_rate'],
      ...['-i', path],
    ],
    { timeoutMs: tools.probeTimeoutMs, maxStdoutBytes: MAX_PROBE_STDOUT_BYTES },
  );
  const failure = failureOf(result);
  if (failure !== undefined) throw new VideoJobError(failure);
  return judgeProbe(result.stdout.toString('utf8'));
}

/** Strict reading of the JSON of ffprobe; the rules of the INPUT (AC2): container, codec, picture, frame rate, duration. */
export function judgeProbe(text: string): VideoProbeInfo {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new VideoJobError('unsupported');
  }
  if (!isRecord(document) || !isRecord(document['format']) || !Array.isArray(document['streams'])) throw new VideoJobError('unsupported');
  const formatName = document['format']['format_name'];
  if (typeof formatName !== 'string' || !formatName.split(',').includes('mov')) throw new VideoJobError('unsupported');
  const streams = (document['streams'] as unknown[]).filter(isRecord);
  const video = streams.find((stream) => stream['codec_type'] === 'video');
  if (video === undefined) throw new VideoJobError('unsupported');
  const codec = video['codec_name'];
  if (codec !== 'h264' && codec !== 'hevc') throw new VideoJobError('unsupported');
  const width = video['width'];
  const height = video['height'];
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new VideoJobError('unsupported');
  if ((width as number) < 1 || (height as number) < 1 || (width as number) > MAX_INPUT_EDGE || (height as number) > MAX_INPUT_EDGE)
    throw new VideoJobError('unsupported');
  const rate = typeof video['r_frame_rate'] === 'string' ? /^(\d+)\/(\d+)$/.exec(video['r_frame_rate']) : null;
  if (rate !== null && Number(rate[2]) > 0 && Number(rate[1]) / Number(rate[2]) > MAX_INPUT_FPS) throw new VideoJobError('unsupported');
  // the duration can be forged in one place: the longest of the container and the stream is the one that counts
  const durations = [asNumber(document['format']['duration']), asNumber(video['duration'])].filter((value) => value !== undefined);
  const seconds = Math.max(...durations);
  if (durations.length === 0 || !(seconds > 0)) throw new VideoJobError('unsupported');
  if (seconds > MAX_VIDEO_SECONDS) throw new VideoJobError('too_long');
  return {
    durationSeconds: seconds,
    width: width as number,
    height: height as number,
    videoCodec: codec,
    hasAudio: streams.some((stream) => stream['codec_type'] === 'audio'),
  };
}

/** The arguments of the transcoding: bounded output (30 fps, 720p, a capped bitrate), no metadata, only the streams we name (see the header). */
export function transcodeArguments(input: string, output: string): string[] {
  return [
    ...['-nostdin', '-hide_banner', '-loglevel', 'error', '-n'],
    ...INPUT_FLAGS,
    ...['-i', input],
    ...['-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn'],
    ...['-map_metadata', '-1', '-map_chapters', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact'],
    ...['-t', String(MAX_VIDEO_SECONDS), '-threads', '2'],
    ...['-fpsmax', '30'],
    ...[
      '-vf',
      `scale='min(${PREVIEW_BOX.width},iw)':'min(${PREVIEW_BOX.height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p`,
    ],
    ...['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-maxrate', '3M', '-bufsize', '6M', '-profile:v', 'high'],
    ...['-c:a', 'aac', '-b:a', '96k', '-ac', '2'],
    ...['-movflags', '+faststart', '-f', 'mp4', output],
  ];
}

/** The arguments of the frame: taken from OUR preview (not from the hostile input), one picture, no metadata. */
export function frameArguments(preview: string, output: string, atSecond: number): string[] {
  return [
    ...['-nostdin', '-hide_banner', '-loglevel', 'error', '-n'],
    ...['-protocol_whitelist', 'file', '-f', 'mov', '-ss', atSecond.toFixed(3), '-i', preview],
    ...['-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1', '-frames:v', '1'],
    ...['-vf', `scale='min(${FRAME_EDGE},iw)':'min(${FRAME_EDGE},ih)':force_original_aspect_ratio=decrease`],
    ...['-c:v', 'libwebp', '-quality', '75', '-f', 'webp', output],
  ];
}

async function hasFtyp(path: string): Promise<boolean> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const head = Buffer.alloc(12);
    const { bytesRead } = await handle.read(head, 0, 12, 0);
    return bytesRead === 12 && head.toString('latin1', 4, 8) === 'ftyp';
  } finally {
    await handle.close();
  }
}

/** The step `probe`: the structure of the original. */
export async function probeVideo(dir: string, tools: VideoTools = defaultTools()): Promise<VideoResult> {
  try {
    const input = join(dir, VIDEO_INPUT_FILE);
    await requirePlainFile(input, Number.MAX_SAFE_INTEGER).catch(() => {
      throw new VideoJobError('unsupported');
    });
    return { ok: true, probe: await probeFile(input, tools) };
  } catch (error) {
    return { ok: false, code: error instanceof VideoJobError ? error.code : 'internal' };
  }
}

/** The step `transcode`: the 720p preview and the frame; the original is probed again (the step does not trust an earlier call). */
export async function transcodeVideo(dir: string, tools: VideoTools = defaultTools()): Promise<VideoResult> {
  const input = join(dir, VIDEO_INPUT_FILE);
  const preview = join(dir, VIDEO_PREVIEW_FILE);
  const frame = join(dir, VIDEO_FRAME_FILE);
  try {
    await requirePlainFile(input, Number.MAX_SAFE_INTEGER).catch(() => {
      throw new VideoJobError('unsupported');
    });
    await probeFile(input, tools);
    await rm(preview, { force: true });
    await rm(frame, { force: true });
    const made = await tools.run(tools.ffmpeg, transcodeArguments(input, preview), {
      timeoutMs: tools.transcodeTimeoutMs,
      maxStdoutBytes: 0,
    });
    const failure = failureOf(made);
    if (failure !== undefined) throw new VideoJobError(failure);

    const sizeBytes = await requirePlainFile(preview, MAX_PREVIEW_BYTES);
    if (!(await hasFtyp(preview).catch(() => false))) throw new VideoJobError('invalid_output');
    const checked = await probeFile(preview, tools).catch((error: unknown) => {
      throw error instanceof VideoJobError && error.code === 'timeout' ? error : new VideoJobError('invalid_output');
    });
    if (checked.videoCodec !== 'h264' || checked.width > PREVIEW_BOX.width || checked.height > PREVIEW_BOX.height)
      throw new VideoJobError('invalid_output');

    const taken = await tools.run(tools.ffmpeg, frameArguments(preview, frame, Math.min(1, checked.durationSeconds / 2)), {
      timeoutMs: tools.probeTimeoutMs * 2,
      maxStdoutBytes: 0,
    });
    const frameFailure = failureOf(taken);
    if (frameFailure !== undefined) throw new VideoJobError(frameFailure === 'unsupported' ? 'invalid_output' : frameFailure);
    await requirePlainFile(frame, MAX_FRAME_BYTES);
    const picture = await sharp(frame, { limitInputPixels: FRAME_EDGE * FRAME_EDGE })
      .metadata()
      .catch(() => {
        throw new VideoJobError('invalid_output');
      });
    const { width, height } = picture;
    // a frame carries no EXIF and no XMP (P3); the dimensions are those of the file, not of a claim
    if (picture.format !== 'webp' || picture.exif !== undefined || picture.xmp !== undefined) throw new VideoJobError('invalid_output');
    if (!(width >= 1 && width <= FRAME_EDGE && height >= 1 && height <= FRAME_EDGE)) throw new VideoJobError('invalid_output');
    return {
      ok: true,
      video: { frame: { width, height }, preview: { width: checked.width, height: checked.height, sizeBytes } },
    };
  } catch (error) {
    return { ok: false, code: error instanceof VideoJobError ? error.code : 'internal' };
  }
}
