/**
 * Configuration of the media pipeline (EVM-044; ADR-0009; P5 fail closed). ALL OR NOTHING: no media variable at all means the feature is off
 * (the upload answers `503 media_storage_unavailable`, the service stays healthy and the worker registers no scan); some of them without the
 * others is a start error that names the missing keys (never a value). The clamd address is optional on its own: without it files are stored
 * but never leave `uploaded`/`scanning`, so none becomes `clean` (SR-FILE-05). The secret comes from `MEDIA_S3_SECRET_ACCESS_KEY_FILE` (see
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
const MEDIA_OPTIONAL_KEYS = ['CLAMD_SOCKET', 'S3_FORCE_PATH_STYLE', 'MEDIA_BUCKET_ORIGIN'] as const;

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
}

const endpoint = z.string().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === ''
  );
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

export class MediaConfigError extends Error {
  readonly keys: readonly string[];

  constructor(keys: readonly string[]) {
    super(`Invalid media configuration: ${keys.join(', ')}`);
    this.name = 'MediaConfigError';
    this.keys = keys;
  }
}

const blank = (value: string | undefined): boolean => value === undefined || value === '';

/** @returns `undefined` when no media variable is set at all (the feature is off); throws {@link MediaConfigError} on a partial or invalid setting */
export function loadMediaConfig(env: Env): MediaConfig | undefined {
  const required = MEDIA_REQUIRED_KEYS.filter((key) => !blank(env[key]));
  if (required.length === 0 && MEDIA_OPTIONAL_KEYS.every((key) => blank(env[key]))) return undefined;
  const missing = MEDIA_REQUIRED_KEYS.filter((key) => blank(env[key]));
  if (missing.length > 0) throw new MediaConfigError(missing);

  const invalid: string[] = [];
  const check = (key: string, ok: boolean): void => {
    if (!ok) invalid.push(key);
  };
  const value = (key: string): string => env[key] ?? '';
  check('S3_ENDPOINT', endpoint.safeParse(value('S3_ENDPOINT')).success);
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
  if (invalid.length > 0) throw new MediaConfigError(invalid.sort());

  return {
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
  };
}
