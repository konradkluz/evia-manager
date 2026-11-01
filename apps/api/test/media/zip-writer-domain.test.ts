import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  centralHeader,
  dosDateTime,
  endRecords,
  isSafeEntryName,
  zipSize,
  zipStream,
  ZipSourceError,
  type ZipEntry,
} from '../../src/modules/media/domain/zip-writer.ts';

const AT = new Date('2026-11-01T10:20:30Z');
const entry = (name: string, content: Buffer, override?: Partial<ZipEntry>): ZipEntry => ({
  name,
  size: content.length,
  open: () => Promise.resolve(Readable.from([content.subarray(0, 3), content.subarray(3)], { objectMode: false })),
  ...override,
});
async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

interface ReadEntry {
  name: string;
  crc: number;
  size: number;
  offset: number;
  flags: number;
  body: Buffer;
}

/** A reader of the archive written independently of the writer: walks the central directory (ZIP64 aware). */
function read(archive: Buffer): ReadEntry[] {
  let end = archive.length - 22;
  while (archive.readUInt32LE(end) !== 0x06054b50) end -= 1;
  let count = archive.readUInt16LE(end + 10);
  let directory = archive.readUInt32LE(end + 16);
  if (count === 0xffff || directory === 0xffffffff) {
    const record = Number(archive.readBigUInt64LE(end - 20 + 8));
    count = Number(archive.readBigUInt64LE(record + 32));
    directory = Number(archive.readBigUInt64LE(record + 48));
  }
  const out: ReadEntry[] = [];
  let at = directory;
  for (let index = 0; index < count; index += 1) {
    expect(archive.readUInt32LE(at)).toBe(0x02014b50);
    const flags = archive.readUInt16LE(at + 8);
    const crc = archive.readUInt32LE(at + 16);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const offset = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const localName = archive.readUInt16LE(offset + 26);
    const start = offset + 30 + localName + archive.readUInt16LE(offset + 28);
    out.push({ name, crc, size, offset, flags, body: archive.subarray(start, start + size) });
    at += 46 + nameLength + extraLength;
  }
  return out;
}

describe('EVM-052 AC1 the streaming ZIP writer (STORE, data descriptors, UTF-8 names)', () => {
  it('EVM-052 AC1 the archive read by an independent reader holds exactly the entries, bytes and CRC-32; the declared size is the real size', async () => {
    const entries = [
      entry('001-a.jpg', Buffer.from('first photo')),
      entry('002-zażółć.png', Buffer.from('second')),
      entry('003-empty.webp', Buffer.alloc(0)),
    ];
    const archive = await collect(zipStream(entries, AT));
    expect(archive.length).toBe(zipSize(entries));
    const items = read(archive);
    expect(items.map((e) => e.name)).toEqual(['001-a.jpg', '002-zażółć.png', '003-empty.webp']);
    expect(items.map((e) => e.body.toString())).toEqual(['first photo', 'second', '']);
    expect(items.map((e) => e.crc)).toEqual([crc32(Buffer.from('first photo')), crc32(Buffer.from('second')), 0]);
    for (const e of items) expect(e.flags & 0x0800, 'UTF-8 flag').toBe(0x0800);
  });

  it('EVM-052 AC1 an archive of 70 000 empty entries uses the ZIP64 end records and its declared size is exact', async () => {
    const entries = Array.from({ length: 70_000 }, (_, index) => entry(`${String(index).padStart(6, '0')}-x.jpg`, Buffer.alloc(0)));
    const archive = await collect(zipStream(entries, AT));
    expect(archive.length).toBe(zipSize(entries));
    expect(archive.readUInt32LE(archive.length - 22 - 20 - 56)).toBe(0x06064b50);
    expect(read(archive)).toHaveLength(70_000);
  });

  it('EVM-052 AC1 the offset of an entry beyond 4 GiB goes to the ZIP64 extra field, the end records say ZIP64 and the size arithmetic follows', () => {
    const name = Buffer.from('001-a.jpg');
    const small = centralHeader(name, 10, 1, 100, dosDateTime(AT));
    const big = centralHeader(name, 10, 1, 5 * 1024 ** 3, dosDateTime(AT));
    expect(small.readUInt16LE(30)).toBe(0);
    expect(big.readUInt16LE(30)).toBe(12);
    expect(big.readUInt32LE(42)).toBe(0xffffffff);
    expect(Number(big.readBigUInt64LE(46 + name.length + 4))).toBe(5 * 1024 ** 3);
    expect(endRecords(2, 100, 200).length).toBe(22);
    const zip64 = endRecords(2, 100, 5 * 1024 ** 3);
    expect(zip64.length).toBe(56 + 20 + 22);
    expect(zip64.readUInt32LE(0)).toBe(0x06064b50);
    expect(zip64.readUInt16LE(56 + 20 + 8)).toBe(0xffff);
    const huge = Array.from({ length: 5 }, (_, i) => ({ name: `00${i}-a.jpg`, size: 1024 ** 3 }));
    const plain = Array.from({ length: 5 }, (_, i) => ({ name: `00${i}-a.jpg`, size: 10 }));
    expect(zipSize(huge)).toBeGreaterThan(5 * 1024 ** 3);
    // the extra field of the entry that starts beyond 4 GiB and the ZIP64 end records are counted
    expect(zipSize(huge) - 5 * 1024 ** 3).toBeGreaterThan(zipSize(plain) - 50);
  });

  it('EVM-052 AC1 a source that delivers fewer or more bytes than the database says aborts the stream (a damaged archive is never completed)', async () => {
    const short = entry('001-a.jpg', Buffer.from('abcdef'), { size: 7 });
    await expect(collect(zipStream([short], AT))).rejects.toBeInstanceOf(ZipSourceError);
    const long = entry('001-a.jpg', Buffer.from('abcdef'), { size: 5 });
    await expect(collect(zipStream([long], AT))).rejects.toBeInstanceOf(ZipSourceError);
  });

  it('EVM-052 AC1 a failure of a source stops the archive and closes the source', async () => {
    let destroyed = false;
    const broken = entry('001-a.jpg', Buffer.from('abc'), {
      open: () => {
        const source = new Readable({
          read() {
            this.destroy(new Error('boom'));
          },
        });
        source.on('close', () => {
          destroyed = true;
        });
        return Promise.resolve(source);
      },
    });
    await expect(collect(zipStream([broken], AT))).rejects.toThrow('boom');
    expect(destroyed).toBe(true);
  });

  it('EVM-052 AC1 names that could point out of the directory are refused by the writer (CWE-22)', () => {
    const unsafe = [
      '',
      '../x.jpg',
      'a/b.jpg',
      'a\\b.jpg',
      '/etc/passwd',
      'C:x.jpg',
      '.hidden',
      'a\u0000b.jpg',
      'a\nb.jpg',
      'a‮b.jpg',
      `${'x'.repeat(300)}.jpg`,
      'a..b.jpg',
    ];
    for (const name of unsafe) expect(isSafeEntryName(name), JSON.stringify(name)).toBe(false);
    expect(isSafeEntryName('001-IMG 1.jpg')).toBe(true);
    expect(() => zipStream([entry('../x', Buffer.from('a'))], AT)).toThrow(RangeError);
    expect(() => zipSize([{ name: 'a/b', size: 1 }])).toThrow(RangeError);
  });

  it('EVM-052 AC1 the date of the entries is the instant of the export, never before 1980', () => {
    expect(dosDateTime(AT)).toEqual({ date: ((2026 - 1980) << 9) | (11 << 5) | 1, time: (10 << 11) | (20 << 5) | 15 });
    expect(dosDateTime(new Date('1970-01-01T00:00:00Z')).date >> 9).toBe(0);
  });

  it('EVM-052 AC1 a reader of another implementation (python zipfile, when the environment has it) tests the archive as sound', async () => {
    const probe = spawnSync('python3', ['-I', '-c', 'import zipfile'], { encoding: 'utf8' });
    if (probe.status !== 0) return; // the own reader above is the check where python is absent
    const dir = mkdtempSync(join(tmpdir(), 'evia-zip-'));
    try {
      const entries = [entry('001-a.jpg', Buffer.from('first photo')), entry('002-zażółć.png', Buffer.from('second'))];
      writeFileSync(join(dir, 'a.zip'), await collect(zipStream(entries, AT)));
      const result = spawnSync('python3', ['-I', '-m', 'zipfile', '-t', join(dir, 'a.zip')], { encoding: 'utf8' });
      expect(result.status, result.stdout + result.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
