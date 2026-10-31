/**
 * The conversion of ONE photo into the derivatives (EVM-068 AC2, AC3; SR-FILE-04, SR-FILE-06, SR-FILE-08; P3). Runs in a child process, never in
 * the server: a native hang or a crash of libvips costs the child, not the listener. Rules:
 * - parsers: every loader is blocked and only JPEG, PNG, WebP and HEIF are unblocked (SVG, PDF, TIFF… cannot be reached whatever the signature
 *   says); the format libvips recognises must be the one the type of the record says;
 * - limits: `limitInputPixels` 100 MP, `failOn: 'error'`, first page only, no cache, one thread;
 * - metadata: nothing of the input is carried over (no `withMetadata`/`keepMetadata`) — EXIF, GPS, XMP, IPTC and the ICC profile are gone —
 *   and the orientation is APPLIED (`rotate()`) before it is dropped;
 * - the files: the input must be a plain file (not a link, one name), the outputs are removed first and written under fixed names.
 */
import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  FORMAT_OF,
  INPUT_FILE,
  MAX_INPUT_PIXELS,
  VARIANTS,
  VARIANT_EDGES,
  outputFile,
  type ContentType,
  type ErrorCode,
  type JobResult,
  type OutputInfo,
} from './protocol.ts';

const LOADERS = ['Jpeg', 'Png', 'Webp', 'Heif'] as const;
const SOURCES = ['File', 'Buffer', 'Source'] as const;

/** Called once per process, before the first image: blocks all loaders, then allows the four of the allow-list. */
export function restrictParsers(): void {
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.block({ operation: ['VipsForeignLoad'] });
  sharp.unblock({ operation: LOADERS.flatMap((loader) => SOURCES.map((source) => `VipsForeignLoad${loader}${source}`)) });
}

class JobError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}

/** The text of the library is read here and only here, to choose a fixed code; it is never forwarded. */
function codeOf(error: unknown): ErrorCode {
  if (error instanceof JobError) return error.code;
  const system = (error as { code?: unknown } | null)?.code;
  if (typeof system === 'string' && /^E[A-Z]+$/.test(system)) return 'internal';
  const message = error instanceof Error ? error.message : '';
  return /pixel limit/i.test(message) ? 'pixel_limit' : 'unsupported';
}

async function requirePlainFile(path: string): Promise<void> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.nlink !== 1) throw new JobError('unsupported');
}

export async function convert(dir: string, contentType: ContentType): Promise<JobResult> {
  try {
    const input = join(dir, INPUT_FILE);
    await requirePlainFile(input);
    const header = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).metadata();
    if (header.format !== FORMAT_OF[contentType]) throw new JobError('unsupported');
    const outputs: OutputInfo[] = [];
    for (const variant of VARIANTS) {
      const target = join(dir, outputFile(variant));
      await rm(target, { force: true });
      const edge = VARIANT_EDGES[variant];
      const info = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(target);
      outputs.push({ variant, width: info.width, height: info.height });
    }
    return { ok: true, outputs };
  } catch (error) {
    return { ok: false, code: codeOf(error) };
  }
}
