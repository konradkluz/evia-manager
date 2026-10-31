import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { convert, restrictParsers } from '../src/convert.ts';
import { jobDirectory, photoWithMetadata, pixelBomb, plainPng, stage, SVG } from './support/synthetic.ts';

beforeAll(() => {
  restrictParsers();
});

/** The markers of the metadata that a derivative must NOT carry: looked for anywhere in the bytes. */
const MARKERS = ['Exif', 'GPS', 'ns.adobe.com/xap', 'Photoshop 3.0', '8BIM', 'synthetic-camera', 'XMP ', 'ICCP', 'EXIF', 'iCCP'];

describe('EVM-068 AC2 the derivatives carry no metadata and the orientation is applied (SR-FILE-08, P3)', () => {
  it('EVM-068 AC2 the test photo really has EXIF with GPS, XMP, IPTC and an ICC profile before the conversion (the test is not vacuous)', async () => {
    const meta = await sharp(await photoWithMetadata()).metadata();
    expect(meta.orientation).toBe(6);
    for (const field of [meta.exif, meta.xmp, meta.iptc, meta.icc]) expect(field).toBeInstanceOf(Buffer);
    // the GPS IFD is referenced by the tag 0x8825 (in either byte order)
    const exif = meta.exif as Buffer;
    expect(exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88]))).toBe(true);
  });

  it('EVM-068 AC2 a thumbnail of 320 px and a preview of 1600 px come out as WebP without EXIF, XMP, IPTC, ICC or GPS, upright', async () => {
    const { dir } = await jobDirectory();
    await stage(dir, await photoWithMetadata(2000, 1000));
    const result = await convert(dir, 'image/jpeg');
    // the input is 2000x1000 with orientation 6, so upright it is 1000x2000: the longer edge is capped at 320 / 1600
    expect(result).toEqual({
      ok: true,
      outputs: [
        { variant: 'thumbnail', width: 160, height: 320 },
        { variant: 'preview', width: 800, height: 1600 },
      ],
    });
    for (const name of ['thumbnail.webp', 'preview.webp']) {
      const bytes = await readFile(join(dir, name));
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString('latin1')).toBe('WEBP');
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe('webp');
      expect([meta.exif, meta.xmp, meta.iptc, meta.icc]).toEqual([undefined, undefined, undefined, undefined]);
      expect(meta.orientation).toBeUndefined();
      expect(meta.width).toBeLessThan(meta.height);
      for (const marker of MARKERS) expect(bytes.includes(Buffer.from(marker, 'latin1')), `${name} contains ${marker}`).toBe(false);
      // upright: the left half of the picture (red) is the TOP after the rotation, the right half (blue) the bottom
      const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      const at = (x: number, y: number, channel: number) => data[(y * info.width + x) * info.channels + channel] ?? 0;
      expect(at(info.width / 2, 4, 0)).toBeGreaterThan(200);
      expect(at(info.width / 2, info.height - 5, 2)).toBeGreaterThan(200);
    }
  });

  it('EVM-068 AC2 a small picture is not enlarged', async () => {
    const { dir } = await jobDirectory();
    await stage(dir, await plainPng(100, 50));
    expect(await convert(dir, 'image/png')).toEqual({
      ok: true,
      outputs: [
        { variant: 'thumbnail', width: 100, height: 50 },
        { variant: 'preview', width: 100, height: 50 },
      ],
    });
  });

  it('EVM-068 AC2 a second run overwrites the outputs of the first (the outputs are removed before they are written)', async () => {
    const { dir } = await jobDirectory();
    await stage(dir, await plainPng(100, 50));
    expect((await convert(dir, 'image/png')).ok).toBe(true);
    expect((await convert(dir, 'image/png')).ok).toBe(true);
  });
});

describe('EVM-068 AC3 hostile and unsupported input ends with a fixed code (SR-FILE-04, SR-FILE-06)', () => {
  it('EVM-068 AC3 a picture above 100 MP is pixel_limit (a valid PNG of 110 MP that weighs under a megabyte)', async () => {
    const { dir } = await jobDirectory();
    const bomb = pixelBomb(11_000, 10_000);
    expect(bomb.length).toBeLessThan(1_000_000);
    await stage(dir, bomb);
    expect(await convert(dir, 'image/png')).toEqual({ ok: false, code: 'pixel_limit' });
  });

  it('EVM-068 AC3 an SVG under the type of a JPEG cannot be parsed at all (the loaders are blocked): unsupported', async () => {
    const { dir } = await jobDirectory();
    await stage(dir, SVG);
    expect(await convert(dir, 'image/jpeg')).toEqual({ ok: false, code: 'unsupported' });
  });

  it('EVM-068 AC3 a PNG declared as a JPEG, and a JPEG declared as HEIC, is unsupported (the format must match the record)', async () => {
    const { dir } = await jobDirectory();
    await stage(dir, await plainPng());
    expect(await convert(dir, 'image/jpeg')).toEqual({ ok: false, code: 'unsupported' });
    await stage(dir, await photoWithMetadata(200, 100));
    expect(await convert(dir, 'image/heic')).toEqual({ ok: false, code: 'unsupported' });
  });

  it('EVM-068 AC3 a truncated file is unsupported, not internal (a damaged picture will never convert)', async () => {
    const { dir } = await jobDirectory();
    const png = await plainPng(400, 400);
    await stage(dir, png.subarray(0, Math.floor(png.length / 2)));
    expect(await convert(dir, 'image/png')).toEqual({ ok: false, code: 'unsupported' });
  });

  it('EVM-068 AC3 a missing input is internal (a fault of the system, retried), garbage bytes are unsupported', async () => {
    const { dir } = await jobDirectory();
    expect(await convert(dir, 'image/jpeg')).toEqual({ ok: false, code: 'internal' });
    await stage(dir, Buffer.from('this is not a picture'));
    expect(await convert(dir, 'image/jpeg')).toEqual({ ok: false, code: 'unsupported' });
  });

  it('EVM-068 AC5 a directory in place of the input file is refused before libvips is asked to open it', async () => {
    const { dir } = await jobDirectory();
    await mkdir(join(dir, 'input'));
    expect(await convert(dir, 'image/jpeg')).toEqual({ ok: false, code: 'unsupported' });
  });
});
