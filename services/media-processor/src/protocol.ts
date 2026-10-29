/**
 * The protocol between the worker and the media processor (EVM-068; ADR-0009; SR-FILE-06, SR-INPUT-04). One request and one answer per
 * connection, each ONE line of JSON, small and strictly validated on both sides (the worker has its own copy of the shapes: the two sides share no
 * code, so a compromised processor cannot reach the worker through a shared module). Nothing in the request is a path: the directory of a job is
 * `<workdir>/<jobId>` (a UUID chosen by the worker), the input is `input` and the outputs are `<variant>.webp` — names fixed here.
 */

/** The variants and the longest edge of each (px). */
export const VARIANT_EDGES = { thumbnail: 320, preview: 1600 } as const;
export type Variant = keyof typeof VARIANT_EDGES;
export const VARIANTS = Object.keys(VARIANT_EDGES) as Variant[];

/** The formats of the allow-list of the upload (`file-rules.ts` of the API). */
export const CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** What `sharp(...).metadata().format` must say for each declared type (a mismatch is `unsupported`: SVG, PDF or TIFF under a JPEG signature). */
export const FORMAT_OF: Readonly<Record<ContentType, string>> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heif',
};

/** Fixed codes: the text of a library is never forwarded (it may name a path or a version). */
export const ERROR_CODES = ['pixel_limit', 'unsupported', 'timeout', 'internal'] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const INPUT_FILE = 'input';
export const outputFile = (variant: Variant): string => `${variant}.webp`;

/** The limit of the pixels of an input (SR-FILE-04): 100 MP. */
export const MAX_INPUT_PIXELS = 100_000_000;
/** The life of one job; after it the child process is killed (SIGKILL), whatever libvips is doing. */
export const JOB_TIMEOUT_MS = 60_000;
export const MAX_REQUEST_BYTES = 1024;
export const MAX_RESPONSE_BYTES = 4096;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface JobRequest {
  readonly jobId: string;
  readonly contentType: ContentType;
}

export interface OutputInfo {
  readonly variant: Variant;
  readonly width: number;
  readonly height: number;
}

export type JobResult = { readonly ok: true; readonly outputs: readonly OutputInfo[] } | { readonly ok: false; readonly code: ErrorCode };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);

/** @returns the request, or `undefined` when it is not exactly `{ jobId, contentType }` of the allowed values */
export function parseRequest(line: string): JobRequest | undefined {
  if (Buffer.byteLength(line) > MAX_REQUEST_BYTES) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || !hasOnly(value, ['jobId', 'contentType'])) return undefined;
  const { jobId, contentType } = value;
  if (typeof jobId !== 'string' || !UUID.test(jobId)) return undefined;
  if (typeof contentType !== 'string' || !(CONTENT_TYPES as readonly string[]).includes(contentType)) return undefined;
  return { jobId, contentType: contentType as ContentType };
}

/** @returns the result a child process reported, or `undefined` for anything that is not exactly a result */
export function parseResult(value: unknown): JobResult | undefined {
  if (!isRecord(value)) return undefined;
  if (value['ok'] === false) {
    const code = value['code'];
    return hasOnly(value, ['ok', 'code']) && typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code)
      ? { ok: false, code: code as ErrorCode }
      : undefined;
  }
  const outputs = value['outputs'];
  if (value['ok'] !== true || !hasOnly(value, ['ok', 'outputs']) || !Array.isArray(outputs) || outputs.length !== VARIANTS.length)
    return undefined;
  const parsed: OutputInfo[] = [];
  for (const item of outputs as unknown[]) {
    if (!isRecord(item) || !hasOnly(item, ['variant', 'width', 'height'])) return undefined;
    const { variant, width, height } = item;
    if (typeof variant !== 'string' || !VARIANTS.includes(variant as Variant)) return undefined;
    const edge = VARIANT_EDGES[variant as Variant];
    if (!Number.isInteger(width) || !Number.isInteger(height)) return undefined;
    if ((width as number) < 1 || (width as number) > edge || (height as number) < 1 || (height as number) > edge) return undefined;
    parsed.push({ variant: variant as Variant, width: width as number, height: height as number });
  }
  return new Set(parsed.map((item) => item.variant)).size === VARIANTS.length ? { ok: true, outputs: parsed } : undefined;
}
