/**
 * Configuration of the media pipeline (EVM-044; ADR-0009; P5 fail closed). ALL OR NOTHING: no media variable at all means the feature is off
 * (the upload answers `503 media_storage_unavailable`, the service stays healthy and the worker registers no scan); some of them without the
 * others is a start error that names the missing keys (never a value). The clamd address is optional on its own: without it files are stored
 * but never leave `uploaded`/`scanning`, so none becomes `clean` (SR-FILE-05). A plain `http` endpoint is accepted only for a loopback host or
 * with `S3_FORCE_PATH_STYLE=true` (the S3 server of the tests): signed requests and the credentials never travel in clear text otherwise. The secret comes from `MEDIA_S3_SECRET_ACCESS_KEY_FILE` (see
 * FILE_KEYS) or, in development, from the plain variable.
 */
import { z } from 'zod';

type Env = Readonly<Record<string, string | undefined>>;

export const MEDIA_REQUIRED_KEYS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'MEDIA_BUCKET',
  'MEDIA_S3_ACCESS_KEY_ID',
  'MEDIA_S3_SECRET_ACCESS_KEY',
] as const;
const SHARED_KEYS: readonly string[] = ['S3_ENDPOINT', 'S3_REGION'];
const LIMIT_KEYS = ['MEDIA_MAX_PENDING_PER_USER', 'MEDIA_MAX_PENDING_PER_ORDER', 'MEDIA_ABANDON_AFTER_DAYS'] as const;
const MEDIA_OPTIONAL_KEYS = ['CLAMD_SOCKET', 'S3_FORCE_PATH_STYLE', 'MEDIA_BUCKET_ORIGIN', ...LIMIT_KEYS] as const;

/** The limits of unfinished media (EVM-049 D9, RR-NOC-T1-4) and the age after which an unfinished upload without a session is abandoned. */
export interface MediaLimits {
  /** Files of one creator still in `pending_upload`. */
  readonly maxPendingPerUser: number;
  /** Files of one order still in `pending_upload`. */
  readonly maxPendingPerOrder: number;
  /** Days a file waits in `pending_upload` without an active session before it is marked `abandoned`. */
  readonly abandonAfterDays: number;
}

export const DEFAULT_MEDIA_LIMITS: MediaLimits = { maxPendingPerUser: 200, maxPendingPerOrder: 500, abandonAfterDays: 7 };

/** The address of clamd: a TCP endpoint (staging: a container of the `evia-scan` network) or a unix socket (a local daemon). */
export type ClamdAddress =
  { readonly kind: 'tcp'; readonly host: string; readonly port: number } | { readonly kind: 'unix'; readonly path: string };

export interface MediaConfig {
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    /** `false` on Scaleway (virtual-hosted, so the CSP can pin the host of the bucket); `true` only for the S3 server of the tests. */
    readonly forcePathStyle: boolean;
  };
  readonly clamd: ClamdAddress | undefined;
  /** The single https origin of the bucket for the CSP `connect-src` of the panel; `undefined` = `'self'` only. */
  readonly bucketOrigin: string | undefined;
  readonly limits: MediaLimits;
}

const LOOPBACK_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;

/** @param allowPlainHttp the S3 server of the tests (`S3_FORCE_PATH_STYLE=true`): `http` is then fine for any host */
const endpointOf = (allowPlainHttp: boolean) =>
  z.string().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    const protocolOk = url.protocol === 'https:' || (url.protocol === 'http:' && (allowPlainHttp || LOOPBACK_HOST.test(url.hostname)));
    return protocolOk && url.username === '' && url.password === '' && url.search === '' && url.hash === '';
  });
const region = z.string().regex(/^[a-z0-9-]{2,32}$/);
const bucket = z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/);
const accessKeyId = z.string().regex(/^[A-Za-z0-9_-]{3,128}$/);
const secretAccessKey = z.string().min(8).max(256);
/** Exactly one https origin: no path, no wildcard, no credentials (SR-WEB-01: a wildcard host would be an exfiltration channel). */
const bucketOrigin = z.string().refine((value) => {
  if (!URL.canParse(value) || value.includes('*')) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && url.origin === value;
});

/** `tcp://host:port` or `unix:///absolute/path`. */
export function parseClamdAddress(value: string): ClamdAddress | undefined {
  if (value.startsWith('unix://')) {
    const path = value.slice('unix://'.length);
    return /^\/[^\0]{1,200}$/.test(path) && !path.includes('..') ? { kind: 'unix', path } : undefined;
  }
  const match = /^tcp:\/\/([a-z0-9][a-z0-9.-]{0,252}|\[[0-9a-f:]+\]):(\d{1,5})$/.exec(value);
  if (match === null) return undefined;
  const port = Number(match[2]);
  return port >= 1 && port <= 65_535 ? { kind: 'tcp', host: match[1] as string, port } : undefined;
}

const blank = (value: string | undefined): boolean => value === undefined || value === '';

/** A whole number from 1 to `max` written in digits only (no sign, no exponent, no spaces); `undefined` for anything else. */
function boundedInteger(value: string | undefined, max: number): number | undefined {
  if (value === undefined || !/^[0-9]{1,6}$/.test(value)) return undefined;
  const number = Number(value);
  return number >= 1 && number <= max ? number : undefined;
}

/** The media settings: absent (the feature is off), valid, or the names of the settings that are missing or invalid (never a value). */
export type MediaConfigResult =
  { readonly ok: true; readonly media: MediaConfig | undefined } | { readonly ok: false; readonly keys: readonly string[] };

export function loadMediaConfig(env: Env): MediaConfigResult {
  // S3_ENDPOINT and S3_REGION are shared with the register of deletions (EVM-040): on their own they do not switch the media on.
  const required = MEDIA_REQUIRED_KEYS.filter((key) => !SHARED_KEYS.includes(key) && !blank(env[key]));
  if (required.length === 0 && MEDIA_OPTIONAL_KEYS.every((key) => blank(env[key]))) return { ok: true, media: undefined };
  const missing = MEDIA_REQUIRED_KEYS.filter((key) => blank(env[key]));
  if (missing.length > 0) return { ok: false, keys: missing };

  const invalid: string[] = [];
  const check = (key: string, ok: boolean): void => {
    if (!ok) invalid.push(key);
  };
  const value = (key: string): string => env[key] ?? '';
  check('S3_ENDPOINT', endpointOf(env['S3_FORCE_PATH_STYLE'] === 'true').safeParse(value('S3_ENDPOINT')).success);
  check('S3_REGION', region.safeParse(value('S3_REGION')).success);
  check('MEDIA_BUCKET', bucket.safeParse(value('MEDIA_BUCKET')).success);
  check('MEDIA_S3_ACCESS_KEY_ID', accessKeyId.safeParse(value('MEDIA_S3_ACCESS_KEY_ID')).success);
  check('MEDIA_S3_SECRET_ACCESS_KEY', secretAccessKey.safeParse(value('MEDIA_S3_SECRET_ACCESS_KEY')).success);
  const clamd = blank(env['CLAMD_SOCKET']) ? undefined : parseClamdAddress(value('CLAMD_SOCKET'));
  check('CLAMD_SOCKET', blank(env['CLAMD_SOCKET']) || clamd !== undefined);
  const forcePathStyle = env['S3_FORCE_PATH_STYLE'];
  check('S3_FORCE_PATH_STYLE', blank(forcePathStyle) || forcePathStyle === 'true' || forcePathStyle === 'false');
  const origin = env['MEDIA_BUCKET_ORIGIN'];
  check('MEDIA_BUCKET_ORIGIN', blank(origin) || bucketOrigin.safeParse(origin).success);
  const limit = (key: (typeof LIMIT_KEYS)[number], fallback: number, max: number): number => {
    if (blank(env[key])) return fallback;
    const parsed = boundedInteger(env[key], max);
    check(key, parsed !== undefined);
    return parsed ?? fallback;
  };
  const limits: MediaLimits = {
    maxPendingPerUser: limit('MEDIA_MAX_PENDING_PER_USER', DEFAULT_MEDIA_LIMITS.maxPendingPerUser, 10_000),
    maxPendingPerOrder: limit('MEDIA_MAX_PENDING_PER_ORDER', DEFAULT_MEDIA_LIMITS.maxPendingPerOrder, 10_000),
    abandonAfterDays: limit('MEDIA_ABANDON_AFTER_DAYS', DEFAULT_MEDIA_LIMITS.abandonAfterDays, 365),
  };
  if (invalid.length > 0) return { ok: false, keys: invalid.sort() };

  const media: MediaConfig = {
    s3: {
      endpoint: value('S3_ENDPOINT'),
      region: value('S3_REGION'),
      bucket: value('MEDIA_BUCKET'),
      accessKeyId: value('MEDIA_S3_ACCESS_KEY_ID'),
      secretAccessKey: value('MEDIA_S3_SECRET_ACCESS_KEY'),
      forcePathStyle: forcePathStyle === 'true',
    },
    clamd,
    bucketOrigin: blank(origin) ? undefined : value('MEDIA_BUCKET_ORIGIN'),
    limits,
  };
  return { ok: true, media };
}
