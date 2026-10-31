/**
 * The check of a WebP file that comes back from the processor (EVM-068; SR-FILE-06, SR-WEB-04). The processor is not trusted — a derivative is
 * served inline from the bucket, so it must be an image of the size it claims and nothing else. This reads only the container (RIFF/WEBP) and the
 * header of the first chunk (`VP8 `, `VP8L`, `VP8X`); it does not decode the image.
 */

export interface WebpHeader {
  readonly width: number;
  readonly height: number;
}

/** @returns the dimensions in the header, or `undefined` when the bytes are not a well-formed WebP container */
export function readWebpHeader(bytes: Buffer): WebpHeader | undefined {
  if (bytes.length < 30) return undefined;
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return undefined;
  if (bytes.readUInt32LE(4) !== bytes.length - 8) return undefined;
  const chunk = bytes.toString('latin1', 12, 16);
  let width: number;
  let height: number;
  if (chunk === 'VP8X') {
    width = bytes.readUIntLE(24, 3) + 1;
    height = bytes.readUIntLE(27, 3) + 1;
  } else if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return undefined;
    const bits = bytes.readUInt32LE(21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined;
    width = bytes.readUInt16LE(26) & 0x3fff;
    height = bytes.readUInt16LE(28) & 0x3fff;
  } else {
    return undefined;
  }
  return width >= 1 && height >= 1 ? { width, height } : undefined;
}

/** A minimal WebP container (a lossless header of the given size, no pixel data): a double of the processor puts it where a derivative is expected. */
export function syntheticWebp(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload[0] = 0x2f;
  payload.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
  const header = Buffer.alloc(20);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + 8 + payload.length, 4);
  header.write('WEBP', 8, 'latin1');
  header.write('VP8L', 12, 'latin1');
  header.writeUInt32LE(payload.length, 16);
  return Buffer.concat([header, payload]);
}
