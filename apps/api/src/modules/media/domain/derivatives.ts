/**
 * The derivatives of a photo and the rules of their processing (EVM-068; ADR-0009; domain-model.md D6). Pure functions, no framework.
 *
 * - Two variants: `thumbnail` (320 px) and `preview` (1600 px), always WebP, always without metadata (P3). The names are those of the contract.
 * - The key of a derivative is derived from the key of the ORIGINAL by the server and never from data: `media/{year}/{month}/{fileId}/{variant}.webp`
 *   shares the prefix `media/{year}/{month}/{fileId}/` with `.../original`, so the removal of a file by prefix (EVM-051, the register of deletions)
 *   covers its derivatives, and the bucket policy of the key of the worker allows `PutObject` only for these two names (TM-76).
 * - A derivative is available only when the file is `ready` (`clean` is enough for the ORIGINAL — {@link isDownloadable} — never for a derivative).
 *   Invariant for EVM-045: `failed` with `processing_error` is a file that PASSED the scan, so its original stays downloadable (AC4).
 * - What a failure of the processor means for the file: {@link isPermanent}.
 */
import {
  DERIVATIVE_VARIANTS,
  VARIANT_EDGES,
  type DerivativeVariant,
  type ImageProcessingErrorCode,
} from '../../../platform/media-processing/image-processor.ts';
import type { FileState } from './scan-outcome.ts';

export { DERIVATIVE_VARIANTS, VARIANT_EDGES, type DerivativeVariant };

export const DERIVATIVE_CONTENT_TYPE = 'image/webp';
/** The browser may keep a derivative for as long as its address lives, and no longer (P3: the picture of a private site stays in the shared cache of nobody). */
export const DERIVATIVE_CACHE_CONTROL = 'private, max-age=300';

/** How many times the loop TAKES a file (raised when it is taken, so a processor that crashes on a file still uses an attempt). */
export const MAX_PROCESSING_ATTEMPTS = 3;
/** A file in `processing` that nobody has touched for this long is taken again (the worker died): the retry is slow enough to be a backoff. */
export const STALE_PROCESSING_MS = 5 * 60_000;
/** A file still waiting for its derivatives after this long is reported (warning with a count). */
export const PROCESSING_WARNING_MS = 30 * 60_000;

/** The derivatives of a file exist only for `ready`. */
export const hasDerivatives = (state: FileState): boolean => state === 'ready';

const ORIGINAL_KEY = /^(media\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\/)original$/;

/** @returns the key of a derivative; `undefined` when the key of the original does not have the shape the server assigns (never guessed) */
export function derivativeKey(originalKey: string, variant: DerivativeVariant): string | undefined {
  const match = ORIGINAL_KEY.exec(originalKey);
  return match === null ? undefined : `${match[1] ?? ''}${variant}.webp`;
}

/**
 * Codes of the processor and what they mean for the file:
 * - permanent (`pixel_limit`, `unsupported`, `invalid_output`): the same file will give the same result — `failed` / `processing_error` at once;
 *   this includes HEIC (a prebuilt libvips does not decode HEVC) — EVM-068 "Uwagi do rozważenia";
 * - transient (`timeout`, `internal`, `unavailable`, and any fault of the storage): retried after {@link STALE_PROCESSING_MS}, at most
 *   {@link MAX_PROCESSING_ATTEMPTS} takes in all, then `failed` / `processing_error`;
 * - `unreachable` (the socket of the processor cannot be connected): the job never reached the processor, so it is no fault of the file - the take
 *   is given back (the attempt is not used) and the file waits for the stale period; an outage of the processor does not fail photos.
 */
export function isPermanent(code: ImageProcessingErrorCode): boolean {
  return code === 'pixel_limit' || code === 'unsupported' || code === 'invalid_output';
}
