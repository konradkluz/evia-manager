/** A minimal ZIP writer for tests: valid archives and deliberately broken ones (synthetic data only). */
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
  /** 0 = store, 8 = deflate, anything else = an unsupported method. */
  readonly method?: number;
  /** Overrides the declared uncompressed size (an understated or overstated header). */
  readonly declaredSize?: number;
  readonly flags?: number;
  /** Overrides the compressed payload (e.g. a deflate bomb). */
  readonly payload?: Uint8Array;
  readonly crc?: number;
}

export function makeZip(entries: readonly ZipEntry[], comment = ''): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const payload = entry.payload ?? (method === 8 ? deflateRawSync(entry.data) : Buffer.from(entry.data));
    const name = Buffer.from(entry.name, 'utf8');
    const crc = entry.crc ?? crc32(entry.data);
    const size = entry.declaredSize ?? entry.data.byteLength;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.byteLength, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.byteLength, 26);
    locals.push(local, name, payload);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.byteLength, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.byteLength + payload.byteLength;
  }
  const centralDirectory = Buffer.concat(centrals);
  const commentBytes = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBytes.byteLength, 20);
  return new Uint8Array(Buffer.concat([...locals, centralDirectory, end, commentBytes]));
}
