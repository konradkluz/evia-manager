/**
 * A streaming ZIP writer without compression (method STORE) for the export of the photos of an order (EVM-052; SR-FILE-07, SR-INFRA-11). Pure: no framework, no
 * file system. The photos are already compressed, so STORE costs nothing and makes the size of the archive known BEFORE the first byte is written
 * ({@link zipSize}) - the storage adapter streams the archive in parts of a fixed size, never holding it in memory or in a temporary file.
 *
 * Layout: for every entry a local header (flag bits 3 = a data descriptor follows, 11 = UTF-8 name; the sizes are known and written, the CRC-32 is not),
 * the bytes, a data descriptor; then the central directory and the end record. The ZIP64 structures are written only where a field no longer fits: the offset of
 * an entry from 4 GiB on (an extra field of the central header), and the end record when the archive has 65 535 entries or more or the directory lies beyond
 * 4 GiB. One photo is at most 50 MB, so the sizes of an entry always fit 32 bits.
 *
 * The count of the bytes of EVERY entry is compared with the size declared in the database: a difference aborts the stream with {@link ZipSourceError}, so
 * a damaged archive is never completed (the uploader aborts the multipart upload).
 */
import { crc32 } from 'node:zlib';
import { Readable } from 'node:stream';

const UINT32_MAX = 0xffff_ffff;
const UINT16_MAX = 0xffff;
const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const FLAGS = 0x0808;
const VERSION = 45;
const VERSION_STORE = 20;

/** The longest name of an entry in bytes (the format allows 65 535; the names of the export are short). */
export const MAX_ENTRY_NAME_BYTES = 255;

export interface ZipEntryPlan {
  /** The name of the entry: a flat, cleaned name (see `export-plan.ts`); validated here as well. */
  readonly name: string;
  /** The exact number of bytes of the content. */
  readonly size: number;
}

export interface ZipEntry extends ZipEntryPlan {
  /** Opens the content; the stream must deliver exactly `size` bytes. */
  readonly open: () => Promise<Readable>;
}

/** The content of an entry is not what the database says (a different number of bytes): the archive is not completed. */
export class ZipSourceError extends Error {
  constructor() {
    super('zip_source_mismatch');
    this.name = 'ZipSourceError';
  }
}

/** A name that is unsafe for the receiver (CWE-22): a separator, `..`, a control character, an absolute path or a drive. */
export function isSafeEntryName(name: string): boolean {
  if (name === '' || Buffer.byteLength(name, 'utf8') > MAX_ENTRY_NAME_BYTES) return false;
  if (/[/\\\p{Cc}\p{Cf}]/u.test(name)) return false;
  if (name === '.' || name === '..' || name.includes('..') || /^[A-Za-z]:/.test(name)) return false;
  return !name.startsWith('.');
}

const nameBytes = (name: string): Buffer => {
  if (!isSafeEntryName(name)) throw new RangeError('unsafe name of an entry');
  return Buffer.from(name, 'utf8');
};

/** MS-DOS date and time of the entries: the instant of the export in UTC (not before 1980). */
export function dosDateTime(at: Date): { readonly date: number; readonly time: number } {
  const year = Math.max(1980, at.getUTCFullYear());
  return {
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
  };
}

interface Stamp {
  readonly date: number;
  readonly time: number;
}

function localHeader(name: Buffer, size: number, stamp: Stamp): Buffer {
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(LOCAL_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_STORE, 4);
  header.writeUInt16LE(FLAGS, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return header;
}

function descriptor(crc: number, size: number): Buffer {
  const out = Buffer.alloc(16);
  out.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
  out.writeUInt32LE(crc, 4);
  out.writeUInt32LE(size, 8);
  out.writeUInt32LE(size, 12);
  return out;
}

/** @internal exported for the unit test of the ZIP64 structures */
export function centralHeader(name: Buffer, size: number, crc: number, offset: number, stamp: Stamp): Buffer {
  const big = offset >= UINT32_MAX;
  const extra = big ? Buffer.alloc(12) : Buffer.alloc(0);
  if (big) {
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(8, 2);
    extra.writeBigUInt64LE(BigInt(offset), 4);
  }
  const header = Buffer.alloc(46 + name.length + extra.length);
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  header.writeUInt16LE(big ? VERSION : VERSION_STORE, 4);
  header.writeUInt16LE(big ? VERSION : VERSION_STORE, 6);
  header.writeUInt16LE(FLAGS, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(stamp.time, 12);
  header.writeUInt16LE(stamp.date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(big ? UINT32_MAX : offset, 42);
  name.copy(header, 46);
  extra.copy(header, 46 + name.length);
  return header;
}

/** @internal exported for the unit test of the ZIP64 structures */
export function endRecords(count: number, directorySize: number, directoryOffset: number): Buffer {
  const zip64 = count >= UINT16_MAX || directorySize >= UINT32_MAX || directoryOffset >= UINT32_MAX;
  const parts: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(ZIP64_END_SIGNATURE, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(VERSION, 12);
    record.writeUInt16LE(VERSION, 14);
    record.writeUInt32LE(0, 16);
    record.writeUInt32LE(0, 20);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directorySize), 40);
    record.writeBigUInt64LE(BigInt(directoryOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(ZIP64_LOCATOR_SIGNATURE, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(directoryOffset + directorySize), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(zip64 ? UINT16_MAX : count, 8);
  end.writeUInt16LE(zip64 ? UINT16_MAX : count, 10);
  end.writeUInt32LE(zip64 ? UINT32_MAX : directorySize, 12);
  end.writeUInt32LE(zip64 ? UINT32_MAX : directoryOffset, 16);
  end.writeUInt16LE(0, 20);
  parts.push(end);
  return Buffer.concat(parts);
}

/** The exact size in bytes of the archive of these entries - known before anything is written (the same arithmetic as the writer). */
export function zipSize(entries: readonly ZipEntryPlan[]): number {
  let offset = 0;
  let directory = 0;
  for (const entry of entries) {
    const length = nameBytes(entry.name).length;
    directory += 46 + length + (offset >= UINT32_MAX ? 12 : 0);
    offset += 30 + length + entry.size + 16;
  }
  return offset + directory + endRecords(entries.length, directory, offset).length;
}

/** Counts the bytes of a content and its CRC-32 on the way; ends the stream with {@link ZipSourceError} when the count differs. */
async function* contentOf(entry: ZipEntry, result: { crc: number }): AsyncGenerator<Buffer> {
  const source = await entry.open();
  let crc = 0;
  let seen = 0;
  try {
    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      seen += buffer.length;
      if (seen > entry.size) throw new ZipSourceError();
      crc = crc32(buffer, crc);
      yield buffer;
    }
  } finally {
    source.destroy();
  }
  if (seen !== entry.size) throw new ZipSourceError();
  result.crc = crc;
}

async function* archive(entries: readonly ZipEntry[], stamp: Stamp): AsyncGenerator<Buffer> {
  let offset = 0;
  const directory: Buffer[] = [];
  for (const entry of entries) {
    const name = nameBytes(entry.name);
    const header = localHeader(name, entry.size, stamp);
    const start = offset;
    yield header;
    offset += header.length;
    const result = { crc: 0 };
    for await (const chunk of contentOf(entry, result)) {
      offset += chunk.length;
      yield chunk;
    }
    yield descriptor(result.crc, entry.size);
    offset += 16;
    directory.push(centralHeader(name, entry.size, result.crc, start, stamp));
  }
  const central = Buffer.concat(directory);
  yield central;
  yield endRecords(entries.length, central.length, offset);
}

/** The archive as a stream; its length is {@link zipSize} of the same entries. Errors of a source surface on the stream. */
export function zipStream(entries: readonly ZipEntry[], at: Date): Readable {
  for (const entry of entries) nameBytes(entry.name);
  return Readable.from(archive(entries, dosDateTime(at)), { objectMode: false });
}
