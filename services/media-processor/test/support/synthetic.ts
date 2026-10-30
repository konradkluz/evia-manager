/**
 * Synthetic photos for the tests of the processor (EVM-068): nothing here is a real photograph or a real place. `photoWithMetadata` carries
 * EXIF with GPS coordinates, XMP, an ICC profile and an IPTC block, and the orientation 6 (rotate 90 degrees clockwise): the left half is red, the
 * right half blue, so a test can tell whether the orientation was APPLIED.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';

export const JOB_ID = '0198a7a0-0000-7000-8000-000000000001';

/** A work directory with one job directory; @returns both paths */
export async function jobDirectory(jobId = JOB_ID): Promise<{ workDir: string; dir: string }> {
  const workDir = await mkdtemp(join(tmpdir(), 'evia-mp-'));
  const dir = join(workDir, jobId);
  await mkdir(dir);
  return { workDir, dir };
}

export async function stage(dir: string, body: Buffer): Promise<void> {
  await writeFile(join(dir, 'input'), body);
}

function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/** Inserts segments right after the SOI marker of a JPEG. */
function withSegments(jpeg: Buffer, segments: readonly Buffer[]): Buffer {
  return Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)]);
}

export async function photoWithMetadata(width = 2000, height = 1000): Promise<Buffer> {
  const half = await sharp({ create: { width: width / 2, height, channels: 3, background: '#0000ff' } })
    .png()
    .toBuffer();
  const base = await sharp({ create: { width, height, channels: 3, background: '#ff0000' } })
    .composite([{ input: half, left: width / 2, top: 0 }])
    .jpeg({ quality: 90 })
    .withExif({
      IFD0: { Copyright: 'synthetic', Software: 'synthetic-camera' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 13/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '21/1 0/1 0/1' },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>')
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const iptc = Buffer.concat([
    Buffer.from('Photoshop 3.0\0', 'latin1'),
    Buffer.from('8BIM', 'latin1'),
    Buffer.from([0x04, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09]),
    Buffer.from([0x1c, 0x02, 0x05, 0x00, 0x04]),
    Buffer.from('test', 'latin1'),
    Buffer.from([0x00]),
  ]);
  return withSegments(base, [segment(0xed, iptc)]);
}

export async function plainPng(width = 100, height = 50): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A valid grey PNG of the given size whose rows are all zero: under a megabyte for 110 MP, so it is a pixel bomb, not a large upload. */
export function pixelBomb(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8);
  const rows = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
