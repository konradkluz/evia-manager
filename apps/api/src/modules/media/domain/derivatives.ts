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
import type { VideoProcessingErrorCode } from '../../../platform/media-processing/video-processor.ts';
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
export function derivativeKey(originalKey: string, variant: DerivativeVariant, mediaType: 'photo' | 'video' = 'photo'): string | undefined {
  const match = ORIGINAL_KEY.exec(originalKey);
  return match === null ? undefined : `${match[1] ?? ''}${variant}.${videoPreview(variant, mediaType) ? 'mp4' : 'webp'}`;
}

/** The preview of a VIDEO is the 720p MP4; every other derivative (the frame of a video, both of a photo) is a WebP. */
const videoPreview = (variant: DerivativeVariant, mediaType: 'photo' | 'video'): boolean => mediaType === 'video' && variant === 'preview';

/** @returns the type of a derivative, as it is stored and as it is served (`Content-Type` of the signed address) */
export const derivativeContentType = (variant: DerivativeVariant, mediaType: 'photo' | 'video'): 'image/webp' | 'video/mp4' =>
  videoPreview(variant, mediaType) ? 'video/mp4' : DERIVATIVE_CONTENT_TYPE;

/**
 * VIDEO (EVM-046) has its own timings, because one transcoding takes minutes and the queue has a concurrency of ONE (ADR-0009):
 * - the order is: SIGKILL of the processor after 15 min < the timeout of the client of the API (16 min) < the stale period (20 min). Otherwise a transcoding
 *   that is still running would be taken a second time, or the client would give up before the processor has answered;
 * - a video that waits for its preview is reported after 2 hours (the second video waits for the first);
 * - a timeout of the transcoding is PERMANENT (the same file gives the same result): `failed` / `processing_error` at once, no retry (the rule for photos
 *   retries a timeout; the exception is described in media-pipeline.md);
 * - the in-process mutex that keeps the concurrency at one is enough for ONE replica of the worker (M1); the counter of takes stays in the database
 *   (compare-and-set), so a second replica could not take the same file twice, but it could run a second transcoding.
 */
export const VIDEO_PROBE_TIMEOUT_MS = 30_000;
export const VIDEO_TRANSCODE_TIMEOUT_MS = 15 * 60_000;
export const VIDEO_CLIENT_TIMEOUT_MS = 16 * 60_000;
export const STALE_VIDEO_PROCESSING_MS = 20 * 60_000;
export const VIDEO_PROCESSING_WARNING_MS = 2 * 3_600_000;
/** A crash of the processor (`internal`) is retried at most this many takes for a video: one hostile file must not hold the queue of concurrency one. */
export const MAX_VIDEO_PROCESSING_ATTEMPTS = 2;

/**
 * What a failure of the video processor means: `timeout`, `unsupported`, `too_long` and `invalid_output` are permanent; `internal` and `unavailable` are
 * retried up to {@link MAX_VIDEO_PROCESSING_ATTEMPTS}; `unreachable` gives the take back (no fault of the file).
 */
export function isPermanentVideo(code: VideoProcessingErrorCode): boolean {
  return code === 'unsupported' || code === 'too_long' || code === 'invalid_output' || code === 'timeout';
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
