/**
 * Synthetic ZIP / OOXML files built in memory for the tests of the document scan (EVM-047) - no real document, no sample from a customer. The builder
 * writes what a tool would (local headers, central directory, end record) and can also write the broken variants the inspector must refuse.
 */
import { deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  readonly name: string;
  readonly data: string | Buffer;
  readonly method?: 'store' | 'deflate';
  /** Raw general purpose flags (bit 0 = encrypted). */
  readonly flags?: number;
}

export interface ZipOptions {
  /** Bytes of the comment of the end record (it may imitate another end record). */
  readonly comment?: Buffer;
  /** Written into the end record instead of the real value. */
  readonly overrideCount?: number;
  readonly overrideDirectoryOffset?: number;
  readonly overrideDirectorySize?: number;
  /** A ZIP64 locator before the end record. */
  readonly zip64Locator?: boolean;
}

function localHeader(entry: ZipEntry, compressed: Buffer, size: number): Buffer {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(entry.flags ?? 0, 6);
  header.writeUInt16LE(entry.method === 'store' ? 0 : 8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, compressed]);
}

export function buildZip(entries: readonly ZipEntry[], options: ZipOptions = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = Buffer.from(entry.data);
    const compressed = entry.method === 'store' ? raw : deflateRawSync(raw);
    const local = localHeader(entry, compressed, raw.length);
    const name = Buffer.from(entry.name, 'utf8');
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(entry.flags ?? 0, 8);
    record.writeUInt16LE(entry.method === 'store' ? 0 : 8, 10);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([record, name]));
    parts.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  const comment = options.comment ?? Buffer.alloc(0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.overrideCount ?? entries.length, 8);
  end.writeUInt16LE(options.overrideCount ?? entries.length, 10);
  end.writeUInt32LE(options.overrideDirectorySize ?? directory.length, 12);
  end.writeUInt32LE(options.overrideDirectoryOffset ?? offset, 16);
  end.writeUInt16LE(comment.length, 20);
  const locator = Buffer.alloc(options.zip64Locator === true ? 20 : 0);
  if (options.zip64Locator === true) locator.writeUInt32LE(0x07064b50, 0);
  return Buffer.concat([...parts, directory, locator, end, comment]);
}

const CONTENT_TYPES_DOCX =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const CONTENT_TYPES_XLSX =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';

export interface OoxmlOptions {
  readonly kind?: 'docx' | 'xlsx';
  /** Extra entries (a macro project, ActiveX, ...). */
  readonly extra?: readonly ZipEntry[];
  /** Replaces the text of `[Content_Types].xml`. */
  readonly contentTypes?: string;
}

/** A minimal synthetic DOCX or XLSX: `[Content_Types].xml` first, then the main part. */
export function buildOoxml(options: OoxmlOptions = {}): Buffer {
  const xlsx = options.kind === 'xlsx';
  const main: ZipEntry = xlsx
    ? { name: 'xl/workbook.xml', data: '<workbook/>' }
    : { name: 'word/document.xml', data: '<w:document xmlns:w="urn:synthetic"/>' };
  return buildZip([
    { name: '[Content_Types].xml', data: options.contentTypes ?? (xlsx ? CONTENT_TYPES_XLSX : CONTENT_TYPES_DOCX) },
    { name: '_rels/.rels', data: '<Relationships/>' },
    main,
    ...(options.extra ?? []),
  ]);
}

/** The first bytes and the last bytes of a buffer, the way the scan keeps them. */
export const headAndTail = (file: Buffer, head = 65_536, tail = 1_048_576 + 65_557): { head: Buffer; tail: Buffer; size: number } => ({
  head: file.subarray(0, head),
  tail: file.subarray(Math.max(0, file.length - tail)),
  size: file.length,
});
