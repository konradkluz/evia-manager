/**
 * The port of the video processor (EVM-046; ADR-0009; SR-FILE-04, SR-FILE-06, SR-INPUT-04; TM-35, TM-36). A video goes through the processor in TWO
 * separate calls over the same job directory: `probe` (the structure: ffprobe, about 30 s) and `transcode` (ffmpeg, up to 15 min). The result of the
 * probe is recorded by the caller BEFORE the transcoding starts, so a timeout of the transcoding does not lose it and the original of the video can
 * be released only after a probe that passed.
 *
 * What comes back is NOT trusted and carries only an allow-list of fields: the duration, the size of the picture, the codecs. Tags of the container
 * (a location, a title, a device) never leave the processor, and the text of ffprobe or ffmpeg is never forwarded (CWE-532, P3).
 */
import type { Readable } from 'node:stream';

export const VIDEO_PROCESSOR = Symbol('VIDEO_PROCESSOR');

/** `too_long` is a code of the processor and stays inside the pipeline: publicly a video that is too long is `type_mismatch` (contract). */
export type VideoProcessingErrorCode =
  'unsupported' | 'too_long' | 'invalid_output' | 'timeout' | 'internal' | 'unavailable' | 'unreachable';

export class VideoProcessingError extends Error {
  readonly code: VideoProcessingErrorCode;

  constructor(code: VideoProcessingErrorCode) {
    super(code);
    this.name = 'VideoProcessingError';
    this.code = code;
  }
}

/** The box of the 720p preview (px). */
export const PREVIEW_LIMIT = { width: 1280, height: 720 } as const;
/** The preview of a video is at most 1 GiB (the bitrate of the transcoding is capped, so 30 minutes is about 600 MB). */
export const MAX_VIDEO_PREVIEW_BYTES = 1_073_741_824;
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;

export interface VideoProbe {
  /** Seconds, as ffprobe reports them (finite, positive, at most the limit): the caller rounds them up with `wholeSeconds`. */
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly videoCodec: 'h264' | 'hevc';
  /** `aac` or `null` (a video without sound). */
  readonly audioCodec: 'aac' | null;
}

export interface ProbeInput {
  /** A UUID chosen by the server for THIS try: names the directory of the job; never taken from the data. */
  readonly jobId: string;
  readonly contentType: 'video/mp4' | 'video/quicktime';
  readonly original: Readable;
  /** The most bytes the original may have (its recorded size); a longer stream is refused. */
  readonly maxBytes: number;
  /** Called when the original is whole in the work area and BEFORE the processor opens it: the caller verifies the checksum of the bytes there. */
  readonly beforeProcessing: () => void;
}

/** The result of the transcoding: the frame (small, in memory) and the preview as a file that the caller streams away (`openPreview`). */
export interface VideoDerivatives {
  readonly frame: { readonly body: Buffer; readonly width: number; readonly height: number };
  readonly preview: { readonly sizeBytes: number; readonly width: number; readonly height: number };
}

export interface VideoProcessor {
  /** Writes the original into the directory of the job and asks the processor for the probe. @throws VideoProcessingError a fixed code */
  probe(input: ProbeInput): Promise<VideoProbe>;
  /** Transcodes the original written by `probe` (the same job). @throws VideoProcessingError a fixed code */
  transcode(jobId: string): Promise<VideoDerivatives>;
  /** Opens the preview of a job for reading, without following a link; the size is the one that `transcode` verified. */
  openPreview(jobId: string): Promise<Readable>;
  /** Removes the directory of a job (after the job, on every path). */
  dispose(jobId: string): Promise<void>;
  /** Removes whatever an earlier process left in the work area (the start of the worker). */
  cleanup(): Promise<void>;
}
