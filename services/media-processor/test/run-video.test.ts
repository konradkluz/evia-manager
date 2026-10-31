import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createRunner, settingsOf } from '../src/main.ts';
import {
  defaultTools,
  frameArguments,
  judgeProbe,
  probeVideo,
  spawnRunner,
  transcodeArguments,
  transcodeVideo,
  type CommandResult,
  type CommandRunner,
  type VideoTools,
} from '../src/run-video.ts';
import { parseVideoRequest } from '../src/video-protocol.ts';
import { JOB_ID } from './support/synthetic.ts';

const OK: CommandResult = { exitCode: 0, signal: null, stdout: Buffer.alloc(0), timedOut: false, overflow: false, failedToStart: false };
const probeJson = (overrides: { format?: object; video?: object; streams?: object[] } = {}): string =>
  JSON.stringify({
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '242.5', ...overrides.format },
    streams: overrides.streams ?? [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30/1', duration: '242.4', ...overrides.video },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  });

describe('EVM-046 AC2 AC5 the rules of the input (judged from the probe, before the transcoding)', () => {
  it('EVM-046 AC2 accepts H.264 and H.265 in MP4/MOV and reports only the fields of the allow-list', () => {
    expect(judgeProbe(probeJson())).toEqual({ durationSeconds: 242.5, width: 1920, height: 1080, videoCodec: 'h264', hasAudio: true });
    expect(
      judgeProbe(
        probeJson({ video: { codec_name: 'hevc' }, streams: [{ codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160 }] }),
      ),
    ).toMatchObject({
      videoCodec: 'hevc',
      hasAudio: false,
    });
  });

  it.each([
    ['not JSON', 'ffprobe: moov atom not found', 'unsupported'],
    ['a document of another shape', '[]', 'unsupported'],
    ['a container that is not MOV/MP4 (a playlist, a Matroska)', probeJson({ format: { format_name: 'matroska,webm' } }), 'unsupported'],
    ['a container without a name', probeJson({ format: { format_name: 7 } }), 'unsupported'],
    ['no video stream', probeJson({ streams: [{ codec_type: 'audio', codec_name: 'aac' }] }), 'unsupported'],
    ['a codec outside the allow-list', probeJson({ video: { codec_name: 'vp9' } }), 'unsupported'],
    ['a cover picture instead of a video', probeJson({ video: { codec_name: 'mjpeg' } }), 'unsupported'],
    ['no dimensions', probeJson({ video: { width: undefined } }), 'unsupported'],
    ['an enormous picture', probeJson({ video: { width: 8192, height: 8192 } }), 'unsupported'],
    ['a zero picture', probeJson({ video: { width: 0 } }), 'unsupported'],
    ['more than 120 frames per second', probeJson({ video: { r_frame_rate: '240/1' } }), 'unsupported'],
    [
      'no duration at all',
      JSON.stringify({ format: { format_name: 'mov' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 8, height: 8 }] }),
      'unsupported',
    ],
    ['a longer video than 30 minutes', probeJson({ format: { duration: '1800.5' } }), 'too_long'],
    [
      'a forged duration of the container (the stream says more)',
      probeJson({ format: { duration: '10' }, video: { duration: '4000' } }),
      'too_long',
    ],
    [
      'a forged duration of the stream (the container says more)',
      probeJson({ format: { duration: '4000' }, video: { duration: '10' } }),
      'too_long',
    ],
  ])('EVM-046 AC2 refuses %s', (_name, text, code) => {
    expect(() => judgeProbe(text)).toThrow(expect.objectContaining({ code }));
  });

  it('EVM-046 AC5 accepts exactly 30 minutes and an unknown frame rate (0/0)', () => {
    expect(
      judgeProbe(probeJson({ format: { duration: '1800' }, video: { r_frame_rate: '0/0', duration: undefined } })).durationSeconds,
    ).toBe(1800);
  });
});

describe('EVM-046 AC4 AC5 the command lines (no shell, no other file, nothing but the named streams, no metadata)', () => {
  it('EVM-046 AC4 the transcoding is bounded and strips everything', () => {
    const args = transcodeArguments('/w/j/input', '/w/j/preview.mp4');
    const joined = args.join(' ');
    // the demuxer is forced, one protocol, no references to other files
    expect(joined).toContain('-protocol_whitelist file -enable_drefs 0 -f mov -i /w/j/input');
    // only a video and at most one audio stream; no subtitles, no data
    expect(joined).toContain('-map 0:v:0 -map 0:a:0? -sn -dn');
    expect(joined).toContain('-map_metadata -1 -map_chapters -1');
    expect(joined).toContain('+bitexact');
    // bounded output: the time, the frame rate, the size of the picture, the bitrate, a start without waiting
    expect(joined).toContain('-t 1800');
    expect(joined).toContain('-fpsmax 30');
    expect(joined).toContain("scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease");
    expect(joined).toContain('-maxrate 3M -bufsize 6M');
    expect(joined).toContain('-movflags +faststart');
    expect(joined).toContain('-nostdin');
    expect(args.at(-1)).toBe('/w/j/preview.mp4');
  });

  it('EVM-046 AC4 the frame comes from the preview that the processor made, as one picture without metadata', () => {
    const joined = frameArguments('/w/j/preview.mp4', '/w/j/thumbnail.webp', 1).join(' ');
    expect(joined).toContain('-i /w/j/preview.mp4');
    expect(joined).toContain('-map_metadata -1');
    expect(joined).toContain('-frames:v 1');
    expect(joined).toContain('-ss 1.000');
    expect(joined).toContain("scale='min(320,iw)':'min(320,ih)'");
  });
});

describe('EVM-046 AC2 the request of a video job', () => {
  const line = (value: object): string => JSON.stringify(value);
  it('EVM-046 AC2 is exactly { jobId, contentType, step } with the allowed values', () => {
    expect(parseVideoRequest(line({ jobId: JOB_ID, contentType: 'video/mp4', step: 'probe' }))).toEqual({
      jobId: JOB_ID,
      contentType: 'video/mp4',
      step: 'probe',
    });
    for (const bad of [
      'not json',
      '[]',
      line({ jobId: JOB_ID, contentType: 'video/mp4' }),
      line({ jobId: JOB_ID, contentType: 'video/mp4', step: 'probe', path: '/etc' }),
      line({ jobId: '../x', contentType: 'video/mp4', step: 'probe' }),
      line({ jobId: JOB_ID, contentType: 'video/webm', step: 'probe' }),
      line({ jobId: JOB_ID, contentType: 'video/mp4', step: 'burn' }),
      line({ jobId: JOB_ID, contentType: 5, step: 'probe' }),
      line({ jobId: JOB_ID, contentType: 'video/mp4', step: 'probe', pad: 'x'.repeat(2000) }),
    ])
      expect(parseVideoRequest(bad), bad).toBeUndefined();
  });
});

async function jobDir(withInput = true): Promise<string> {
  const area = await mkdtemp(join(tmpdir(), 'evia-video-'));
  const dir = join(area, JOB_ID);
  await mkdir(dir);
  if (withInput) await writeFile(join(dir, 'input'), Buffer.from('synthetic'));
  return dir;
}

/** A double of ffprobe and ffmpeg: it answers a probe from `probes` (in order), writes the files a successful run would write. */
function tools(options: {
  probes?: readonly (string | CommandResult)[];
  preview?: Buffer | null;
  frame?: Buffer | null;
  ffmpeg?: CommandResult;
  frameRun?: CommandResult;
}): { tools: VideoTools; calls: Array<{ command: string; args: readonly string[] }> } {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const probes = [...(options.probes ?? [])];
  const run: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === 'ffprobe') {
      const next = probes.shift() ?? probeJson();
      return typeof next === 'string' ? { ...OK, stdout: Buffer.from(next) } : next;
    }
    const output = args.at(-1) ?? '';
    if (output.endsWith('preview.mp4')) {
      if (options.ffmpeg !== undefined) return options.ffmpeg;
      if (options.preview !== null) await writeFile(output, options.preview ?? mp4());
      return OK;
    }
    if (options.frameRun !== undefined) return options.frameRun;
    if (options.frame !== null) await writeFile(output, options.frame ?? (await webp()));
    return OK;
  };
  return { tools: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', run, transcodeTimeoutMs: 1000, probeTimeoutMs: 1000 }, calls };
}

const mp4 = (): Buffer => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(32, 1)]);
const webp = (): Promise<Buffer> =>
  sharp({ create: { width: 320, height: 180, channels: 3, background: '#223344' } })
    .webp()
    .toBuffer();
const previewProbe = (overrides: object = {}): string =>
  probeJson({ video: { width: 1280, height: 720, ...overrides }, format: { duration: '242.5' } });

describe('EVM-046 AC2 the step probe', () => {
  it('EVM-046 AC2 returns the probe of an input that passes, from the forced demuxer, with an empty environment of the tool', async () => {
    const { tools: t, calls } = tools({});
    const result = await probeVideo(await jobDir(), t);
    expect(result).toMatchObject({ ok: true, probe: { videoCodec: 'h264', width: 1920 } });
    expect(JSON.stringify(result)).not.toMatch(/location|title|creation_time/);
    expect(calls[0]?.args.join(' ')).toContain('-protocol_whitelist file -enable_drefs 0 -f mov');
    expect(calls[0]?.args.join(' ')).toContain('-probesize 5000000 -analyzeduration 5000000');
  });

  it('EVM-046 AC2 an input that is missing is unsupported; the verdict of the rules is the code', async () => {
    expect(await probeVideo(await jobDir(false), tools({}).tools)).toEqual({ ok: false, code: 'unsupported' });
    expect(await probeVideo(await jobDir(), tools({ probes: [probeJson({ video: { codec_name: 'av1' } })] }).tools)).toEqual({
      ok: false,
      code: 'unsupported',
    });
    expect(await probeVideo(await jobDir(), tools({ probes: [probeJson({ format: { duration: '1801' } })] }).tools)).toEqual({
      ok: false,
      code: 'too_long',
    });
  });

  it.each([
    ['the tool cannot be started', { ...OK, failedToStart: true, exitCode: null }, 'internal'],
    ['the tool hangs and is killed', { ...OK, timedOut: true, exitCode: null, signal: 'SIGKILL' }, 'timeout'],
    ['the tool prints too much', { ...OK, overflow: true, exitCode: null, signal: 'SIGKILL' }, 'unsupported'],
    ['the tool is killed by a signal (the OOM killer)', { ...OK, signal: 'SIGKILL', exitCode: null }, 'internal'],
    ['the tool fails on the file', { ...OK, exitCode: 1 }, 'unsupported'],
  ] as const)('EVM-046 AC5 %s: %s', async (_name, result, code) => {
    expect(await probeVideo(await jobDir(), tools({ probes: [result] }).tools)).toEqual({ ok: false, code });
  });
});

describe('EVM-046 AC4 AC5 the step transcode', () => {
  it('EVM-046 AC4 makes the 720p preview and the frame; the output is probed again and the answer carries sizes only', async () => {
    const { tools: t, calls } = tools({ probes: [probeJson(), previewProbe()] });
    const result = await transcodeVideo(await jobDir(), t);
    expect(result).toEqual({
      ok: true,
      video: { frame: { width: 320, height: 180 }, preview: { width: 1280, height: 720, sizeBytes: mp4().length } },
    });
    // the input is probed, then ffmpeg, then the preview is probed, then the frame
    expect(calls.map((call) => call.command)).toEqual(['ffprobe', 'ffmpeg', 'ffprobe', 'ffmpeg']);
  });

  it('EVM-046 AC5 the input is judged again before the transcoding (a step does not trust an earlier call): a file that is too long never reaches ffmpeg', async () => {
    const { tools: t, calls } = tools({ probes: [probeJson({ format: { duration: '4000' } })] });
    expect(await transcodeVideo(await jobDir(), t)).toEqual({ ok: false, code: 'too_long' });
    expect(calls.map((call) => call.command)).toEqual(['ffprobe']);
  });

  it('EVM-046 AC5 a missing input is unsupported', async () => {
    expect(await transcodeVideo(await jobDir(false), tools({}).tools)).toEqual({ ok: false, code: 'unsupported' });
  });

  it.each([
    ['ffmpeg hangs: SIGKILL', { ffmpeg: { ...OK, timedOut: true, exitCode: null, signal: 'SIGKILL' } }, 'timeout'],
    ['ffmpeg fails on the stream', { ffmpeg: { ...OK, exitCode: 1 } }, 'unsupported'],
    ['ffmpeg writes no preview', { preview: null }, 'invalid_output'],
    ['the preview is not an MP4 (no ftyp)', { preview: Buffer.from('this is not a movie at all') }, 'invalid_output'],
    ['the preview is too short to have a header', { preview: Buffer.from('ftyp') }, 'invalid_output'],
    ['the preview is wider than 1280', { probes: [probeJson(), previewProbe({ width: 1920 })] }, 'invalid_output'],
    ['the preview is not H.264', { probes: [probeJson(), previewProbe({ codec_name: 'hevc' })] }, 'invalid_output'],
    ['the preview cannot be probed', { probes: [probeJson(), { ...OK, exitCode: 1 }] }, 'invalid_output'],
    ['the probe of the preview hangs', { probes: [probeJson(), { ...OK, timedOut: true, exitCode: null, signal: 'SIGKILL' }] }, 'timeout'],
    ['the frame is not made', { frame: null }, 'invalid_output'],
    ['the frame run fails', { frameRun: { ...OK, exitCode: 1 } }, 'invalid_output'],
    ['the frame run hangs', { frameRun: { ...OK, timedOut: true, exitCode: null, signal: 'SIGKILL' } }, 'timeout'],
    ['the frame is not a picture', { frame: Buffer.from('not a picture') }, 'invalid_output'],
  ] as const)('EVM-046 AC5 %s', async (_name, options, code) => {
    expect(await transcodeVideo(await jobDir(), tools({ probes: [probeJson(), previewProbe()], ...options }).tools)).toEqual({
      ok: false,
      code,
    });
  });

  it('EVM-046 AC4 a frame that carries EXIF is refused (P3: no metadata leaves the processor)', async () => {
    const withExif = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#112233' } })
      .webp()
      .withExif({ IFD0: { Copyright: 'synthetic' } })
      .toBuffer();
    expect(await transcodeVideo(await jobDir(), tools({ probes: [probeJson(), previewProbe()], frame: withExif }).tools)).toEqual({
      ok: false,
      code: 'invalid_output',
    });
  });

  it('EVM-046 AC4 a frame larger than the edge is refused', async () => {
    const big = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#112233' } })
      .webp()
      .toBuffer();
    expect((await transcodeVideo(await jobDir(), tools({ probes: [probeJson(), previewProbe()], frame: big }).tools)).ok).toBe(false);
  });
});

describe('EVM-046 AC5 the runner of the processor and the tools', () => {
  it('EVM-046 AC5 the settings admit an absolute work area of videos only', () => {
    const base = { MEDIA_PROCESSOR_SOCKET: '/run/p.sock', MEDIA_PROCESSOR_WORKDIR: '/work' };
    expect(settingsOf({ ...base, MEDIA_PROCESSOR_VIDEO_WORKDIR: 'video' })).toBeUndefined();
    expect(settingsOf({ ...base, MEDIA_PROCESSOR_VIDEO_WORKDIR: '/video' })).toEqual({
      socketPath: '/run/p.sock',
      workDir: '/work',
      videoWorkDir: '/video',
    });
  });

  it('EVM-046 AC5 a video job without a work area of videos is refused; with one it is run in the directory of the job under that area', async () => {
    const refused = createRunner({ socketPath: '/run/p.sock', workDir: '/work' });
    expect(await refused({ jobId: JOB_ID, contentType: 'video/mp4', step: 'probe' })).toEqual({ ok: false, code: 'internal' });
    const dir = await jobDir();
    const area = join(dir, '..');
    const { tools: t } = tools({ probes: [probeJson(), probeJson(), previewProbe()] });
    const runner = createRunner({ socketPath: '/run/p.sock', workDir: '/work', videoWorkDir: area }, undefined, t);
    expect(await runner({ jobId: JOB_ID, contentType: 'video/mp4', step: 'probe' })).toMatchObject({ ok: true });
    expect(await runner({ jobId: JOB_ID, contentType: 'video/quicktime', step: 'transcode' })).toMatchObject({ ok: true });
  });

  it('EVM-046 AC5 the real runner starts no shell: a missing binary is a failure to start, never an exception; the default tools name fixed paths', async () => {
    const result = await spawnRunner(join(tmpdir(), 'evia-no-such-binary'), [], { timeoutMs: 1000, maxStdoutBytes: 10 });
    expect(result.failedToStart).toBe(true);
    expect(defaultTools()).toMatchObject({ ffmpeg: '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe' });
  });

  it('EVM-046 AC5 the real runner kills a process that outlives its time, and one that prints too much', async () => {
    const hang = await spawnRunner(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 200, maxStdoutBytes: 10 });
    expect(hang).toMatchObject({ timedOut: true });
    const loud = await spawnRunner(process.execPath, ['-e', "process.stdout.write('x'.repeat(5000)); setTimeout(() => {}, 60000)"], {
      timeoutMs: 20_000,
      maxStdoutBytes: 100,
    });
    expect(loud.overflow).toBe(true);
    const quiet = await spawnRunner(process.execPath, ['-e', "process.stdout.write('{}')"], { timeoutMs: 20_000, maxStdoutBytes: 100 });
    expect(quiet).toMatchObject({ exitCode: 0, overflow: false, timedOut: false });
    expect(quiet.stdout.toString()).toBe('{}');
  });
});
