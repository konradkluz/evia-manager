/**
 * The release-manifest artifact is untrusted data (EVM-007 AC3; ADR-0018 m2; architect 8, security-engineer B "ZIP"):
 * parsed in memory, never written to disk, exactly ONE entry with the expected name, methods store (0) or deflate (8)
 * only, no encryption, no ZIP64, no directories or paths; the inflated size is limited while inflating
 * (`inflateRawSync` with `maxOutputLength`) and must equal the declared size, and the CRC-32 must match.
 */
import { crc32, inflateRawSync } from 'node:zlib';
import { Rejection, ensure } from './errors.ts';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;

/** Offset of the end-of-central-directory record; its comment must end exactly at the end of the archive. */
function findEndOfCentralDirectory(view: DataView): number {
  const start = Math.max(0, view.byteLength - EOCD_SIZE - MAX_COMMENT);
  for (let offset = view.byteLength - EOCD_SIZE; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD && offset + EOCD_SIZE + view.getUint16(offset + 20, true) === view.byteLength) return offset;
  }
  throw new Rejection('zip-format', 'no end of central directory');
}

/** The bytes of the single entry `name` of the archive, at most `limit` bytes once inflated. */
export function readSingleEntry(archive: Uint8Array, name: string, limit: number): Uint8Array {
  ensure(archive.byteLength >= EOCD_SIZE && archive.byteLength <= limit, 'zip-size', `${String(archive.byteLength)} bytes`);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = findEndOfCentralDirectory(view);
  const disk = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const entriesOnDisk = view.getUint16(end + 8, true);
  const entries = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  ensure(disk === 0 && centralDisk === 0, 'zip-format', 'multi-disk archive');
  ensure(entries === 1 && entriesOnDisk === 1, 'zip-entries', `${String(entries)} entries`);
  ensure(centralOffset + centralSize <= end && centralSize >= 46, 'zip-format', 'central directory out of bounds');
  ensure(view.getUint32(centralOffset, true) === CENTRAL, 'zip-format', 'central directory signature');
  const flags = view.getUint16(centralOffset + 8, true);
  const method = view.getUint16(centralOffset + 10, true);
  const crc = view.getUint32(centralOffset + 16, true);
  const compressedSize = view.getUint32(centralOffset + 20, true);
  const size = view.getUint32(centralOffset + 24, true);
  const nameLength = view.getUint16(centralOffset + 28, true);
  const extraLength = view.getUint16(centralOffset + 30, true);
  const commentLength = view.getUint16(centralOffset + 32, true);
  const localOffset = view.getUint32(centralOffset + 42, true);
  ensure(46 + nameLength + extraLength + commentLength === centralSize, 'zip-format', 'central directory size');
  ensure((flags & 0x0001) === 0 && (flags & 0x0040) === 0, 'zip-encrypted');
  ensure(method === 0 || method === 8, 'zip-method', String(method));
  ensure(compressedSize !== 0xffffffff && size !== 0xffffffff && localOffset !== 0xffffffff, 'zip-format', 'ZIP64');
  ensure(size <= limit, 'zip-too-large', `declared ${String(size)} bytes`);
  const entryName = new TextDecoder('utf-8', { fatal: true }).decode(archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength));
  ensure(entryName === name, 'zip-name', 'unexpected entry name');
  ensure(localOffset + 30 <= centralOffset && view.getUint32(localOffset, true) === LOCAL, 'zip-format', 'local header');
  const localNameLength = view.getUint16(localOffset + 26, true);
  const localExtraLength = view.getUint16(localOffset + 28, true);
  ensure(view.getUint16(localOffset + 8, true) === method && localNameLength === nameLength, 'zip-format', 'local header differs');
  const localName = new TextDecoder('utf-8', { fatal: true }).decode(
    archive.subarray(localOffset + 30, localOffset + 30 + localNameLength),
  );
  ensure(localName === name, 'zip-name', 'local entry name differs');
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  ensure(dataStart + compressedSize <= centralOffset, 'zip-format', 'entry data out of bounds');
  const data = archive.subarray(dataStart, dataStart + compressedSize);
  let content: Uint8Array;
  if (method === 0) {
    content = data;
  } else {
    try {
      content = inflateRawSync(data, { maxOutputLength: limit });
    } catch (error) {
      const tooLarge = error instanceof RangeError || (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE';
      throw new Rejection(tooLarge ? 'zip-too-large' : 'zip-format', 'inflate');
    }
  }
  ensure(content.byteLength === size, 'zip-size-mismatch', `declared ${String(size)}, actual ${String(content.byteLength)}`);
  ensure(crc32(content) === crc, 'zip-crc');
  return content;
}
