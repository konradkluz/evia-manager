/**
 * The inspection of an OOXML document (DOCX, XLSX) for macros and for its real kind, without a new dependency (EVM-047 AC6; SR-FILE-03, SR-FILE-04,
 * SR-FILE-06; CWE-434, CWE-409; threat model TM-36, AB-05). A PURE function of two buffers the scan already holds from its ONE pass over the pinned
 * version of the object: the first bytes (`head`, where `[Content_Types].xml` lives) and the last ones (`tail`, where the central directory of the
 * ZIP lives). No second read of the object happens, so there is no window to swap it.
 *
 * What it looks at: the NAMES of the entries of the central directory, compared case-insensitively after normalising the path (`vbaProject.bin`,
 * `vbaProjectSignature.bin`, `vbaData.xml`, `macrosheets/`, `activeX/`), and the text of `[Content_Types].xml` (a bounded inflate of that ONE entry:
 * `macroEnabled`, `vbaProject`). The archive is never unpacked otherwise.
 *
 * FAIL CLOSED: anything that cannot be judged with certainty is a refusal (`ok: false`), never a "clean": ZIP64, several or inconsistent end-of-
 * directory records, a multi-disk archive, a damaged or truncated directory, offsets outside the file, a path that leaves the archive, an entry that
 * is encrypted or uses an unknown method, a missing `[Content_Types].xml`, a bomb in it, and every limit exceeded. The limits: the end record is
 * searched in the last 64 KiB + 22 B, at most 10 000 entries, a central directory of at most 1 MiB, `[Content_Types].xml` of at most 1 MiB inflated.
 * The caller turns every refusal into the quarantine reason `type_mismatch`.
 */
import { inflateRawSync } from 'node:zlib';

export const MAX_ENTRIES = 10_000;
export const MAX_DIRECTORY_BYTES = 1_048_576;
export const MAX_CONTENT_TYPES_BYTES = 1_048_576;
/** How much of the END of the file the scan keeps: the largest central directory plus the longest end record (64 KiB comment + 22 B). */
export const TAIL_BYTES = MAX_DIRECTORY_BYTES + 65_535 + 22;
/** How much of the START of the file the scan keeps for a document: room for the local header and the compressed `[Content_Types].xml`. */
export const HEAD_BYTES = 65_536;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN = 22;
const CENTRAL_MIN = 46;
const LOCAL_MIN = 30;
const MAX_COMMENT = 65_535;
const CONTENT_TYPES = '[content_types].xml';

export type OoxmlRefusal = 'not_zip' | 'zip64' | 'malformed' | 'limits' | 'no_content_types' | 'unsupported_entry';
export type OoxmlKind = 'docx' | 'xlsx' | 'unknown';

export type OoxmlInspection =
  { readonly ok: true; readonly kind: OoxmlKind; readonly macros: boolean } | { readonly ok: false; readonly reason: OoxmlRefusal };

const refuse = (reason: OoxmlRefusal): OoxmlInspection => ({ ok: false, reason });

interface Entry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

/** Lower case, `/` as the separator, no leading `./` and `/`. */
const normalise = (raw: string): string =>
  raw
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '');

const isMacroName = (name: string): boolean => {
  const base = name.slice(name.lastIndexOf('/') + 1);
  return (
    base === 'vbaproject.bin' ||
    base === 'vbaprojectsignature.bin' ||
    base === 'vbadata.xml' ||
    name.startsWith('macrosheets/') ||
    name.includes('/macrosheets/') ||
    name.split('/').includes('activex')
  );
};

const leavesArchive = (name: string): boolean => name.split('/').includes('..') || /^[a-z]:/.test(name) || name.includes('\0');

/** @returns the position of the ONLY consistent end-of-directory record in the tail, or a refusal */
function findEndRecord(tail: Buffer): number | OoxmlRefusal {
  const from = Math.max(0, tail.length - (EOCD_MIN + MAX_COMMENT));
  const found: number[] = [];
  for (let position = tail.length - EOCD_MIN; position >= from; position -= 1) {
    if (tail.readUInt32LE(position) !== EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(position + 20);
    if (position + EOCD_MIN + commentLength === tail.length) found.push(position);
  }
  if (found.length === 0) return 'not_zip';
  // a second consistent record means the comment of the first one imitates another: the archive is ambiguous
  return found.length === 1 ? (found[0] as number) : 'malformed';
}

function readDirectory(tail: Buffer, start: number, size: number, count: number, fileSize: number): Entry[] | OoxmlRefusal {
  const entries: Entry[] = [];
  let position = start;
  const end = start + size;
  for (let index = 0; index < count; index += 1) {
    if (position + CENTRAL_MIN > end || tail.readUInt32LE(position) !== CENTRAL_SIGNATURE) return 'malformed';
    const flags = tail.readUInt16LE(position + 8);
    const method = tail.readUInt16LE(position + 10);
    const compressedSize = tail.readUInt32LE(position + 20);
    const uncompressedSize = tail.readUInt32LE(position + 24);
    const nameLength = tail.readUInt16LE(position + 28);
    const extraLength = tail.readUInt16LE(position + 30);
    const commentLength = tail.readUInt16LE(position + 32);
    const localOffset = tail.readUInt32LE(position + 42);
    const next = position + CENTRAL_MIN + nameLength + extraLength + commentLength;
    if (next > end) return 'malformed';
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) return 'zip64';
    if (localOffset >= fileSize) return 'malformed';
    const name = normalise(tail.toString('latin1', position + CENTRAL_MIN, position + CENTRAL_MIN + nameLength));
    if (leavesArchive(name)) return 'malformed';
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localOffset });
    position = next;
  }
  // the directory is exactly as long as its header says (nothing hidden after the last entry)
  return position === end ? entries : 'malformed';
}

/** The text of `[Content_Types].xml`: from the start of the file, the stored or deflated data of that ONE entry, bounded. */
function readContentTypes(head: Buffer, entry: Entry): { readonly text: string } | { readonly refusal: OoxmlRefusal } {
  if ((entry.flags & 1) !== 0) return { refusal: 'unsupported_entry' }; // encrypted
  if (entry.method !== 0 && entry.method !== 8) return { refusal: 'unsupported_entry' };
  if (entry.uncompressedSize > MAX_CONTENT_TYPES_BYTES) return { refusal: 'limits' };
  const at = entry.localOffset;
  if (at + LOCAL_MIN > head.length || head.readUInt32LE(at) !== LOCAL_SIGNATURE) return { refusal: 'malformed' };
  const dataStart = at + LOCAL_MIN + head.readUInt16LE(at + 26) + head.readUInt16LE(at + 28);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > head.length) return { refusal: 'limits' }; // the entry is not within the bytes the scan kept: it cannot be judged
  const data = head.subarray(dataStart, dataEnd);
  if (entry.method === 0) {
    return data.length === entry.uncompressedSize ? { text: data.toString('utf8').toLowerCase() } : { refusal: 'malformed' };
  }
  try {
    return { text: inflateRawSync(data, { maxOutputLength: MAX_CONTENT_TYPES_BYTES }).toString('utf8').toLowerCase() };
  } catch {
    return { refusal: 'limits' }; // a bomb (more than the limit) or damaged data: both are refused, neither is read further
  }
}

const refusalOf = (value: unknown): OoxmlRefusal | undefined => (typeof value === 'string' ? (value as OoxmlRefusal) : undefined);

/**
 * @param head the first bytes of the file (at least those of the local header and the compressed `[Content_Types].xml`)
 * @param tail the last bytes of the file (at most {@link TAIL_BYTES}); `tail.length <= fileSize`
 * @param fileSize the exact number of bytes the scan read
 */
export function inspectOoxml(head: Uint8Array, tail: Uint8Array, fileSize: number): OoxmlInspection {
  const headBuffer = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  const tailBuffer = Buffer.from(tail.buffer, tail.byteOffset, tail.byteLength);
  if (fileSize < EOCD_MIN || tailBuffer.length < EOCD_MIN || tailBuffer.length > fileSize) return refuse('not_zip');

  const eocd = findEndRecord(tailBuffer);
  if (typeof eocd !== 'number') return refuse(eocd);
  if (eocd >= 20 && tailBuffer.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIGNATURE) return refuse('zip64');
  const disk = tailBuffer.readUInt16LE(eocd + 4);
  const directoryDisk = tailBuffer.readUInt16LE(eocd + 6);
  const onDisk = tailBuffer.readUInt16LE(eocd + 8);
  const count = tailBuffer.readUInt16LE(eocd + 10);
  const size = tailBuffer.readUInt32LE(eocd + 12);
  const offset = tailBuffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) return refuse('zip64');
  if (disk !== 0 || directoryDisk !== 0 || onDisk !== count) return refuse('malformed');
  if (count > MAX_ENTRIES) return refuse('limits');
  if (size > MAX_DIRECTORY_BYTES) return refuse('limits');

  const tailStart = fileSize - tailBuffer.length;
  const eocdAbsolute = tailStart + eocd;
  // the directory lies before its end record, inside the file, and inside the bytes the scan kept
  if (offset + size > eocdAbsolute) return refuse('malformed');
  if (offset < tailStart) return refuse('limits');
  const entries = readDirectory(tailBuffer, offset - tailStart, size, count, fileSize);
  const refusal = refusalOf(entries);
  if (refusal !== undefined) return refuse(refusal);

  const list = entries as Entry[];
  const contentTypes = list.filter((entry) => entry.name === CONTENT_TYPES);
  if (contentTypes.length !== 1) return refuse('no_content_types');
  const read = readContentTypes(headBuffer, contentTypes[0] as Entry);
  if ('refusal' in read) return refuse(read.refusal);
  return classify(list, read.text);
}

function classify(entries: readonly Entry[], contentTypes: string): OoxmlInspection {
  const names = new Set(entries.map((entry) => entry.name));
  const macros =
    entries.some((entry) => isMacroName(entry.name)) || contentTypes.includes('macroenabled') || contentTypes.includes('vbaproject');
  const hasWord = names.has('word/document.xml');
  const hasExcel = names.has('xl/workbook.xml');
  const kind: OoxmlKind = hasWord && !hasExcel ? 'docx' : hasExcel && !hasWord ? 'xlsx' : 'unknown';
  return { ok: true, kind, macros };
}
