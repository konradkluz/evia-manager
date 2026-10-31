/**
 * The rules of a video (EVM-046; ADR-0009; P5; SR-FILE-03, SR-FILE-04, SR-FILE-12). Pure functions of data, no framework.
 *
 * - A video lasts at most 30 minutes and weighs at most 4 GiB (`file-rules.ts`). The duration is judged by the processor (ffprobe), which reports only the
 *   fields of an allow-list; this module owns the numbers the API shares with the database.
 * - Above {@link SCAN_LIMIT_BYTES} the file is NOT scanned by the antivirus (P5): it is a video, its size was verified in the storage, and it carries
 *   `av_scanned = false`. The limit is 2 000 000 000 bytes, not 2 GiB: ClamAV does not scan streams of about 2^31 bytes and more, so the limit stays
 *   safely under that ceiling. Everything else is scanned, and a file the scanner cannot judge stays `scanning` (fail closed).
 * - The original of a video is handed out only after the structural check succeeded ({@link isVideoOriginalReleasable}), and for an unscanned one only
 *   in `ready`.
 */
import type { FileState, ReasonCode } from './scan-outcome.ts';

/** The number of seconds of the longest video (30 min); injectable in tests through the configuration of the worker. */
export const MAX_VIDEO_SECONDS = 1800;
/** The largest file that goes through the antivirus (2 GB, not 2 GiB). */
export const SCAN_LIMIT_BYTES = 2_000_000_000;

/** @returns whether a file of this size is left out of the antivirus scan (only the SIZE VERIFIED in the storage counts, never the declaration) */
export const skipsAntivirus = (verifiedBytes: number, limit: number = SCAN_LIMIT_BYTES): boolean => verifiedBytes > limit;

/** The whole seconds shown in the list and kept in the database: rounded up, at least 1 (a clip shorter than a second still has a duration). */
export const wholeSeconds = (seconds: number): number => Math.max(1, Math.ceil(seconds));

/** @returns whether the duration reported by the processor is a usable one (finite, positive, within the limit) */
export const isAcceptableDuration = (seconds: number, max: number = MAX_VIDEO_SECONDS): boolean =>
  Number.isFinite(seconds) && seconds > 0 && seconds <= max;

export interface VideoFileFacts {
  readonly state: FileState;
  readonly reason: ReasonCode | null;
  /** Set (in its own transaction) once the structural check passed; `null` until then. */
  readonly durationSeconds: number | null;
  /** `true` only after a scan; `false` for a file over the scan limit; `null` before the scan. */
  readonly avScanned: boolean | null;
}

/**
 * The original of a video may be handed out only when ffprobe passed (`duration_seconds` is set), and the state is `ready` or `failed` with
 * `processing_error` (the transcoding failed, the file did not). A video that was NOT scanned (or whose scan is not recorded) is released only in `ready`.
 * `clean` is never enough: before the probe, or after a new scan, a file of a wrong type would be available.
 */
export function isVideoOriginalReleasable(facts: VideoFileFacts): boolean {
  if (facts.durationSeconds === null) return false;
  if (facts.state === 'ready') return true;
  return facts.state === 'failed' && facts.reason === 'processing_error' && facts.avScanned === true;
}
