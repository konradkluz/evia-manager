export interface ZipItem {
  name: string;
  crc: number;
  size: number;
  offset: number;
  flags: number;
  body: Buffer;
}

/** A reader of an archive written independently of the writer under test: walks the central directory (ZIP64 aware). EVM-052: tests only. */
export function readZip(archive: Buffer): ZipItem[] {
  let end = archive.length - 22;
  while (archive.readUInt32LE(end) !== 0x06054b50) end -= 1;
  let count = archive.readUInt16LE(end + 10);
  let directory = archive.readUInt32LE(end + 16);
  if (count === 0xffff || directory === 0xffffffff) {
    const record = Number(archive.readBigUInt64LE(end - 20 + 8));
    count = Number(archive.readBigUInt64LE(record + 32));
    directory = Number(archive.readBigUInt64LE(record + 48));
  }
  const out: ZipItem[] = [];
  let at = directory;
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error('not a central header');
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
