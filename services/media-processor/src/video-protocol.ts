/**
 * The protocol of a VIDEO job (EVM-046; ADR-0009; SR-FILE-03, SR-FILE-04, SR-FILE-06, SR-INPUT-04). Same rules as the protocol of photos: one line of
 * JSON per request and per answer, strictly validated, no path anywhere (the directory of a job is `<videoWorkDir>/<jobId>`; the files in it are
 * `input`, `thumbnail.webp` and `preview.mp4`). A video goes through TWO calls over the same directory: `probe` (ffprobe: the structure) and `transcode`
 * (ffmpeg: the 720p preview and a frame). Tags of the container never leave the processor: the answer carries only the fields of an allow-list.
 */

export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime'] as const;
export type VideoContentType = (typeof VIDEO_CONTENT_TYPES)[number];
export const VIDEO_STEPS = ['probe', 'transcode'] as const;
export type VideoStep = (typeof VIDEO_STEPS)[number];

/** Fixed codes: stderr of ffmpeg and ffprobe is NEVER forwarded (it carries tags - a place, a title - CWE-532). */
export const VIDEO_ERROR_CODES = ['unsupported', 'too_long', 'timeout', 'internal', 'invalid_output'] as const;
export type VideoErrorCode = (typeof VIDEO_ERROR_CODES)[number];

export const VIDEO_INPUT_FILE = 'input';
export const VIDEO_PREVIEW_FILE = 'preview.mp4';
export const VIDEO_FRAME_FILE = 'thumbnail.webp';

/** The limits of an input (checked BEFORE the transcoding; SR-FILE-04): 30 min, 4096 x 4096, 120 fps. */
export const MAX_VIDEO_SECONDS = 1800;
export const MAX_INPUT_EDGE = 4096;
export const MAX_INPUT_FPS = 120;
/** The box of the preview and the edge of the frame. */
export const PREVIEW_BOX = { width: 1280, height: 720 } as const;
export const FRAME_EDGE = 320;
/** The preview is at most 1 GiB (`file_derivatives` CHECK); the bitrate is capped so that 30 min is far below it. */
export const MAX_PREVIEW_BYTES = 1_073_741_824;
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** SIGKILL of ffmpeg after 15 min (ADR-0009); of ffprobe after 30 s. */
export const TRANSCODE_TIMEOUT_MS = 15 * 60_000;
export const PROBE_TIMEOUT_MS = 30_000;
/** The most ffprobe may print (its JSON is a few KB; more is a hostile file). */
export const MAX_PROBE_STDOUT_BYTES = 1_048_576;

export interface VideoRequest {
  readonly jobId: string;
  readonly contentType: VideoContentType;
  readonly step: VideoStep;
}

export interface VideoProbeInfo {
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly videoCodec: 'h264' | 'hevc';
  readonly hasAudio: boolean;
}

export type VideoResult =
  | { readonly ok: true; readonly probe: VideoProbeInfo }
  | {
      readonly ok: true;
      readonly video: {
        readonly frame: { readonly width: number; readonly height: number };
        readonly preview: { readonly width: number; readonly height: number; readonly sizeBytes: number };
      };
    }
  | { readonly ok: false; readonly code: VideoErrorCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_REQUEST_BYTES = 1024;

/** @returns the request, or `undefined` when it is not exactly `{ jobId, contentType, step }` of the allowed values */
export function parseVideoRequest(line: string): VideoRequest | undefined {
  if (Buffer.byteLength(line) > MAX_REQUEST_BYTES) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 3 || !['jobId', 'contentType', 'step'].every((key) => keys.includes(key))) return undefined;
  const { jobId, contentType, step } = record;
  if (typeof jobId !== 'string' || !UUID.test(jobId)) return undefined;
  if (typeof contentType !== 'string' || !(VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)) return undefined;
  if (typeof step !== 'string' || !(VIDEO_STEPS as readonly string[]).includes(step)) return undefined;
  return { jobId, contentType: contentType as VideoContentType, step: step as VideoStep };
}
