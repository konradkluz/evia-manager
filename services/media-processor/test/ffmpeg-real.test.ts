/**
 * The real ffprobe and ffmpeg against SYNTHETIC films made by ffmpeg itself (lavfi sources: no binary file in the repository, no real recording).
 * They run where the tools are installed (the image of the processor, the image of the tests) and are skipped elsewhere - the rules and the command
 * lines are covered without the tools by run-video.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { defaultTools, probeVideo, transcodeVideo } from '../src/run-video.ts';
import { JOB_ID } from './support/synthetic.ts';

const available = ((): boolean => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const tools = { ...defaultTools(), ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

async function directory(): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'evia-ffmpeg-')), JOB_ID);
  await mkdir(dir);
  return dir;
}

/** A synthetic film of `seconds` seconds with tags a phone would write (a place, a title, a time). */
function synthetic(target: string, options: { seconds?: number; size?: string; codec?: 'libx264' | 'libx265' } = {}): void {
  execFileSync(
    'ffmpeg',
    [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${options.size ?? '640x360'}:rate=15:duration=${options.seconds ?? 2}`],
      ...['-f', 'lavfi', '-i', `sine=frequency=440:duration=${options.seconds ?? 2}`],
      ...['-c:v', options.codec ?? 'libx264', '-c:a', 'aac', '-shortest'],
      ...['-metadata', 'location=+52.2297+021.0122/', '-metadata', 'com.apple.quicktime.location.ISO6709=+52.2297+021.0122/'],
      ...['-metadata', 'title=Synthetic title', '-metadata', 'creation_time=2026-10-31T08:00:00Z'],
      ...['-f', 'mp4', target],
    ],
    { stdio: 'ignore' },
  );
}

describe.skipIf(!available)('EVM-046 AC2 AC4 the real tools on synthetic films', () => {
  it('EVM-046 AC4 the preview and the frame carry none of the tags of the input (P3: no location, title or time)', async () => {
    const dir = await directory();
    synthetic(join(dir, 'input'));
    expect(await probeVideo(dir, tools)).toMatchObject({ ok: true, probe: { videoCodec: 'h264', hasAudio: true } });
    const result = await transcodeVideo(dir, tools);
    expect(result).toMatchObject({ ok: true, video: { preview: { width: 640, height: 360 } } });
    const preview = (await readFile(join(dir, 'preview.mp4'))).toString('latin1');
    for (const secret of ['52.2297', 'Synthetic title', 'ISO6709', '2026-10-31']) expect(preview).not.toContain(secret);
    const tags = execFileSync('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_entries',
      'format_tags:stream_tags',
      join(dir, 'preview.mp4'),
    ]);
    expect(tags.toString()).not.toMatch(/location|title|creation_time/i);
    expect((await sharp(join(dir, 'thumbnail.webp')).metadata()).exif).toBeUndefined();
  });

  it('EVM-046 AC2 a film larger than 720p is scaled down, H.265 is accepted', async () => {
    const dir = await directory();
    synthetic(join(dir, 'input'), { size: '1920x1080', codec: 'libx265' });
    expect(await probeVideo(dir, tools)).toMatchObject({ ok: true, probe: { videoCodec: 'hevc', width: 1920 } });
    expect(await transcodeVideo(dir, tools)).toMatchObject({ ok: true, video: { preview: { width: 1280, height: 720 } } });
  });

  it('EVM-046 AC2 a playlist, a concat script and plain text passed off as MP4 are never ready', async () => {
    for (const body of [
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:5,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n',
      "ffconcat version 1.0\nfile '/etc/passwd'\n",
      'plain text',
    ]) {
      const dir = await directory();
      await writeFile(join(dir, 'input'), body);
      expect((await probeVideo(dir, tools)).ok).toBe(false);
      expect((await transcodeVideo(dir, tools)).ok).toBe(false);
    }
  });
});
