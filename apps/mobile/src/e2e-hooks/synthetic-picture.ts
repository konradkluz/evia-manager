/**
 * The synthetic picture of the e2e hook (EVM-108 AC7; security requirement 20) — bundled ONLY in the e2e variant (it is imported by the
 * panel of the hooks and by nothing else). It stands in for the file that `expo-camera` leaves in `cacheDir/Camera/<uuid>.jpg`:
 * the hook writes it THERE and hands its `file://` URI to the same capture pipeline as the real camera, so `importOriginal` (the native
 * checks, the copy with `fsync`, the removal of the source) and the registration run exactly as for a photograph.
 *
 * The bytes are a syntactically valid JPEG marker structure — SOI, a JFIF header, comment segments of pseudo-random content, EOI — and
 * deliberately carry NO EXIF segment at all (so no GPS; the check `original-exif-clean` of tools/mobile-e2e finds nothing to object to).
 * The content depends on the seed only, so every shot of a batch has its own SHA-256 and the server can tell 30 objects from one.
 * Nothing binary is kept in the repository.
 */
import { Directory, File, Paths } from 'expo-file-system';

/** About 300 KiB: big enough to take several parts of the scenario server's part size, small enough for 30 shots in a minute. */
export const SYNTHETIC_PICTURE_BYTES = 300 * 1024;
const COMMENT_PAYLOAD_MAX = 0xff_ff - 2;
const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
/** APP0 / JFIF 1.01, no thumbnail — an APP0 segment, never APP1 (EXIF / XMP). */
const JFIF = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];

/** xorshift32: deterministic pseudo-random bytes (not a secret — the file is a test picture). */
function stream(seed: number): () => number {
  let state = (Math.trunc(seed) ^ 0x9e_37_79_b9) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state & 0xff;
  };
}

/** The bytes of the synthetic picture of `seed` (different seeds give different content, hence a different SHA-256). */
export function syntheticJpeg(seed: number, size: number = SYNTHETIC_PICTURE_BYTES): Uint8Array {
  const total = Math.max(Math.trunc(size), SOI.length + JFIF.length + EOI.length + 4);
  const bytes = new Uint8Array(total);
  const next = stream(seed);
  let at = 0;
  for (const part of [SOI, JFIF]) {
    bytes.set(part, at);
    at += part.length;
  }
  while (at < total - EOI.length) {
    const room = total - EOI.length - at - 4;
    let length = Math.min(room, COMMENT_PAYLOAD_MAX);
    // a rest of 1..3 bytes cannot hold another segment (4 bytes of header at least): leave 5..7 for the next one instead
    const rest = room - length;
    if (rest > 0 && rest < 4) length -= 4;
    bytes.set([0xff, 0xfe, (length + 2) >> 8, (length + 2) & 0xff], at);
    at += 4;
    for (let i = 0; i < length; i += 1) bytes[at + i] = next();
    at += length;
  }
  bytes.set(EOI, total - EOI.length);
  return bytes;
}

/**
 * Writes the picture of `seed` as `cacheDir/Camera/<id>.jpg` and returns its `file://` URI — the place and the name the camera uses (the
 * native import accepts nothing else). `id` is a lowercase UUID (the name pattern of the camera files).
 */
export async function saveSyntheticPicture(id: string, seed: number): Promise<{ readonly uri: string }> {
  const directory = new Directory(Paths.cache, 'Camera');
  directory.create({ idempotent: true });
  const file = new File(directory, `${id}.jpg`);
  file.create();
  await file.write(syntheticJpeg(seed));
  return { uri: file.uri };
}
