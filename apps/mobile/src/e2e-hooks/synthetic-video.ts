/**
 * The synthetic film of the e2e hook (EVM-110 AC8; SEC-110-18) - bundled ONLY in the e2e variant (imported by the panel of the hooks and by nothing else).
 * It stands in for the file that `expo-camera` leaves in `cacheDir/Camera/<uuid>.mp4`: the hook writes it THERE and hands its `file://` URI to the same
 * capture pipeline as the real recording, so the native import (a `ftyp` at offset 4, the MOVE into the originals, no copy) and the registration run
 * exactly as for a film.
 *
 * The bytes are an MP4 box structure that a reader accepts as far as it goes: `ftyp` (`isom`), then one `mdat` that carries pseudo-random content up to the
 * requested size; there is NO `moov`, so no sound track and no location atom - the real recording is judged for those by the check of tools/mobile-e2e,
 * not this file. The content depends on the seed only, so every film has its own SHA-256. It is written in chunks (64 MiB never sits in memory).
 */
import { Directory, File, FileMode, Paths } from 'expo-file-system';

const MIB = 1024 * 1024;
/** One write: 1 MiB (a fixed buffer reused for the whole file, refilled from the stream of the seed). */
export const CHUNK_BYTES = MIB;
const FTYP = [
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34,
  0x31,
];
const MDAT = [0x6d, 0x64, 0x61, 0x74];
const HEADER_BYTES = FTYP.length + 8;

/** xorshift32 (deterministic, not a secret). */
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

/** The first bytes of the file: `ftyp` and the header of the `mdat` that covers the rest of a file of [size] bytes. */
export function syntheticMp4Header(size: number): Uint8Array {
  const total = Math.max(Math.trunc(size), HEADER_BYTES + 1);
  const header = new Uint8Array(HEADER_BYTES);
  header.set(FTYP, 0);
  const mdat = total - FTYP.length;
  header.set([(mdat >>> 24) & 0xff, (mdat >>> 16) & 0xff, (mdat >>> 8) & 0xff, mdat & 0xff, ...MDAT], FTYP.length);
  return header;
}

/** The whole file as a list of chunks (for tests and small files); `size` bytes in total. */
export function* syntheticMp4Chunks(seed: number, size: number): Generator<Uint8Array> {
  const total = Math.max(Math.trunc(size), HEADER_BYTES + 1);
  const next = stream(seed);
  yield syntheticMp4Header(total);
  let left = total - HEADER_BYTES;
  while (left > 0) {
    const chunk = new Uint8Array(Math.min(left, CHUNK_BYTES));
    for (let i = 0; i < chunk.length; i += 1) chunk[i] = next();
    yield chunk;
    left -= chunk.length;
  }
}

/**
 * Writes the film of `seed` and `size` bytes as `cacheDir/Camera/<id>.mp4` and returns its `file://` URI - the place and the name the camera uses (the native
 * import accepts nothing else). `id` is a lowercase UUID.
 */
export async function saveSyntheticVideo(id: string, seed: number, size: number): Promise<{ readonly uri: string }> {
  const directory = new Directory(Paths.cache, 'Camera');
  directory.create({ idempotent: true });
  const file = new File(directory, `${id}.mp4`);
  file.create();
  const handle = file.open(FileMode.WriteOnly);
  try {
    for (const chunk of syntheticMp4Chunks(seed, size)) await handle.writeBytes(chunk);
  } finally {
    handle.close();
  }
  return { uri: file.uri };
}
