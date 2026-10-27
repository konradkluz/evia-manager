/**
 * Configuration from environment variables, validated once at startup (12-factor; ADR-0002). Fail-fast: an invalid
 * value stops the process. Errors name the keys only, never the values — DATABASE_URL holds a password (SR-LOG-02).
 * The minimum supported app version uses the Semver schema generated from the contract (one source of the pattern);
 * EVM-009 (meta/client-config, 426) reads the same `minSupportedAppVersion` object.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { zSemver } from '@evia/contracts/zod';
import { z } from 'zod';
import { parseFieldEncryptionKeys, type FieldKey } from '../crypto/field-encryption.ts';
import { parseEmailAddress } from '../email/email-address.ts';
import { loadMediaConfig, MediaConfigError, type MediaConfig } from './media-config.ts';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
const VERBOSE_LEVELS: readonly LogLevel[] = ['debug', 'trace'];

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly databaseUrl: string;
  readonly minSupportedAppVersion: { readonly android: string; readonly ios: string };
  /** Origin of the panel (`https://panel.example`): expected by CSRF checks and WebAuthn, and used in activation links. */
  readonly panelOrigin: string;
  readonly webauthn: { readonly rpId: string; readonly rpName: string };
  /** Addresses or CIDR ranges of reverse proxies whose X-Forwarded-For is trusted (empty: none; SR-API-02, CWE-348). */
  readonly trustedProxies: readonly string[];
  /** 32-byte key of the opaque cursors (AES-256-GCM, EVM-017). A secret: never logged, rotation invalidates cursors. */
  readonly cursorKey: Buffer;
  /**
   * Master keys of the envelope encryption of database fields (EVM-023; SR-CRYPTO-02): the first seals, all open. A secret: never logged. Empty only
   * outside production — everything that needs a key is then refused (fail closed).
   */
  readonly fieldEncryptionKeys: readonly FieldKey[];
  /**
   * The release this process runs (EVM-007 AC4; GET /api/version): the commit baked into the image (`EVIA_RELEASE_COMMIT`, public) and the SHA-256
   * of the release manifest written by the deployment channel (`EVIA_RELEASE_MANIFEST_SHA256_FILE`). `null` outside the channel (locally).
   */
  readonly release: { readonly commit: string | null; readonly manifestSha256: string | null };
  /**
   * Key of the HMAC under which the counters against guessing passwords are keyed (EVM-026; at least 32 bytes). A secret: never logged, a different one
   * from the other keys. Required in production; elsewhere an absent key is a random key of this process (the counters of an earlier process are
   * then never found again — acceptable for development and tests, never for a server).
   */
  readonly loginThrottleKey: Buffer;
  /** Thresholds of the alerts about guessing (SR-LOG-07): failed passwords of all accounts in 5 minutes (more than) / failures of the second step of one scope in its window (at least). */
  readonly loginAlerts: { readonly passwordFailures: number; readonly secondStepFailures: number };
  /** The media pipeline (EVM-044): absent when no media variable is set — the upload then answers 503 and the service stays healthy. */
  readonly media?: MediaConfig;
}

/**
 * Settings that may come from a file instead of the environment (`<KEY>_FILE`, EVM-007 AC7): the deployment channel mounts the secrets as files
 * (tmpfs, 0400, one directory per service), never as values of the compose file. Only these keys — a `_FILE` of any other key is not read.
 */
export const FILE_KEYS = [
  'DATABASE_URL',
  'CURSOR_KEY',
  'FIELD_ENCRYPTION_KEYS',
  'LOGIN_THROTTLE_KEY',
  'EVIA_RELEASE_MANIFEST_SHA256',
  'MEDIA_S3_SECRET_ACCESS_KEY',
] as const;
const MAX_FILE_BYTES = 64 * 1024;
/** Reads the file of a `<KEY>_FILE` setting (tests pass their own). */
export type ReadConfigFile = (path: string) => string;
const readConfigFile: ReadConfigFile = (path) => readFileSync(path, 'utf8');

const postgresUrl = z.string().refine((value) => URL.canParse(value) && /^postgres(ql)?:$/.test(new URL(value).protocol));

/** An origin is scheme + host (+ port) only: no path, query, fragment or credentials. */
const origin = z.string().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value && url.username === '' && url.password === '';
});
const hostname = z.string().regex(/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/);
const proxyList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
  )
  .refine((items) => items.every((item) => /^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(item)));

const CURSOR_KEY_BYTES = 32;
/** 32 random bytes as 43 characters of base64url (no padding); the round trip rejects a value with stray trailing bits. */
const cursorKey = z.string().refine((value) => {
  const bytes = Buffer.from(value, 'base64url');
  return /^[A-Za-z0-9_-]{43}$/.test(value) && bytes.length === CURSOR_KEY_BYTES && bytes.toString('base64url') === value;
});
/** A key with few distinct bytes is a placeholder (all zeros, a repeated byte), never the output of a random generator. */
const MIN_DISTINCT_KEY_BYTES = 16;
const isPlaceholderKey = (value: string): boolean => new Set(Buffer.from(value, 'base64url')).size < MIN_DISTINCT_KEY_BYTES;

/** The key of the counters against guessing: base64url of at least 32 random bytes (EVM-026); the round trip rejects a value with stray trailing bits. */
const LOGIN_THROTTLE_KEY_MIN_BYTES = 32;
const loginThrottleKey = z
  .string()
  .optional()
  .refine((value) => {
    if (value === undefined || value === '') return true;
    const bytes = Buffer.from(value, 'base64url');
    return /^[A-Za-z0-9_-]+$/.test(value) && bytes.length >= LOGIN_THROTTLE_KEY_MIN_BYTES && bytes.toString('base64url') === value;
  });
const keyOfLoginThrottle = (value: string | undefined): Buffer | undefined =>
  value === undefined || value === '' ? undefined : Buffer.from(value, 'base64url');

/** `FIELD_ENCRYPTION_KEYS` is absent (or empty) or a well-formed list `id:base64url32,…`; production additionally needs it (see the schema). */
const fieldEncryptionKeys = z
  .string()
  .optional()
  .refine((value) => value === undefined || value === '' || parseFieldEncryptionKeys(value) !== undefined);
const keysOf = (value: string | undefined): readonly FieldKey[] =>
  value === undefined || value === '' ? [] : (parseFieldEncryptionKeys(value) ?? []);

/** An optional value of the release: absent or empty = null, otherwise exactly the pattern. */
const releaseValue = (pattern: RegExp) =>
  z
    .union([z.literal(''), z.string().regex(pattern)])
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value));

const hostOf = (value: string): string => (URL.canParse(value) ? new URL(value).hostname : '');
const isLocalHost = (host: string): boolean => host === 'localhost' || host.endsWith('.localhost');

/** The settings every entry point needs (the server, the worker, the CLI and the migrations): one definition, one set of rules. */
const commonShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: postgresUrl,
};
const verboseOnlyInDevelopment = (env: { NODE_ENV: string; LOG_LEVEL: LogLevel }): boolean =>
  env.NODE_ENV === 'development' || !VERBOSE_LEVELS.includes(env.LOG_LEVEL);

const schema = z
  .object({
    ...commonShape,
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    MIN_SUPPORTED_APP_VERSION_ANDROID: zSemver,
    MIN_SUPPORTED_APP_VERSION_IOS: zSemver,
    PANEL_ORIGIN: origin,
    WEBAUTHN_RP_ID: hostname,
    WEBAUTHN_RP_NAME: z.string().trim().min(1).max(64).default('EVia Manager'),
    TRUSTED_PROXIES: proxyList,
    CURSOR_KEY: cursorKey,
    FIELD_ENCRYPTION_KEYS: fieldEncryptionKeys,
    // Empty (an image built without the argument, the example file) is the same as absent.
    EVIA_RELEASE_COMMIT: releaseValue(/^[0-9a-f]{40}$/),
    EVIA_RELEASE_MANIFEST_SHA256: releaseValue(/^[0-9a-f]{64}$/),
    LOGIN_THROTTLE_KEY: loginThrottleKey,
    LOGIN_ALERT_PASSWORD_FAILURES: z.coerce.number().int().min(1).max(100_000).default(30),
    LOGIN_ALERT_SECOND_STEP_FAILURES: z.coerce.number().int().min(1).max(10).default(3),
  })
  .refine(verboseOnlyInDevelopment, { path: ['LOG_LEVEL'] })
  // The relying party id must be the host of the panel or a parent domain of it (WebAuthn); never the API's Host header.
  .refine(
    (env) => {
      const host = hostOf(env.PANEL_ORIGIN);
      return host === env.WEBAUTHN_RP_ID || host.endsWith(`.${env.WEBAUTHN_RP_ID}`);
    },
    { path: ['WEBAUTHN_RP_ID'] },
  )
  // Production: https only and no localhost — cookies are always Secure with the __Host- prefix, there is no switch.
  .refine((env) => env.NODE_ENV !== 'production' || (env.PANEL_ORIGIN.startsWith('https://') && !isLocalHost(hostOf(env.PANEL_ORIGIN))), {
    path: ['PANEL_ORIGIN'],
  })
  // Production never runs with a development or test key.
  .refine((env) => env.NODE_ENV !== 'production' || !isPlaceholderKey(env.CURSOR_KEY), { path: ['CURSOR_KEY'] })
  // The keys of the encrypted fields: required in production, never a placeholder, and never the key of the cursors (one key, one purpose).
  .refine((env) => env.NODE_ENV !== 'production' || keysOf(env.FIELD_ENCRYPTION_KEYS).length > 0, { path: ['FIELD_ENCRYPTION_KEYS'] })
  .refine(
    (env) =>
      keysOf(env.FIELD_ENCRYPTION_KEYS).every(
        ({ key }) =>
          !key.equals(Buffer.from(env.CURSOR_KEY, 'base64url')) &&
          (env.NODE_ENV !== 'production' || new Set(key).size >= MIN_DISTINCT_KEY_BYTES),
      ),
    { path: ['FIELD_ENCRYPTION_KEYS'] },
  )
  // The key of the counters against guessing: required in production, never a placeholder, and one key serves one purpose (EVM-026; SR-CRYPTO).
  .refine((env) => env.NODE_ENV !== 'production' || (env.LOGIN_THROTTLE_KEY !== undefined && env.LOGIN_THROTTLE_KEY !== ''), {
    path: ['LOGIN_THROTTLE_KEY'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || !isPlaceholderKey(env.LOGIN_THROTTLE_KEY ?? ''), { path: ['LOGIN_THROTTLE_KEY'] })
  .refine(
    (env) => {
      const key = keyOfLoginThrottle(env.LOGIN_THROTTLE_KEY);
      if (key === undefined) return true;
      return (
        !key.equals(Buffer.from(env.CURSOR_KEY, 'base64url')) && keysOf(env.FIELD_ENCRYPTION_KEYS).every((field) => !field.key.equals(key))
      );
    },
    { path: ['LOGIN_THROTTLE_KEY'] },
  );

export class ConfigError extends Error {
  readonly keys: readonly string[];

  constructor(keys: readonly string[]) {
    super(`Invalid environment configuration: ${keys.join(', ')}`);
    this.name = 'ConfigError';
    this.keys = keys;
  }
}

const migrationSchema = z.object(commonShape).refine(verboseOnlyInDevelopment, { path: ['LOG_LEVEL'] });

/** What `db:migrate` needs and nothing more (EVM-080 AC4): no HTTP, WebAuthn or cursor settings, so no `CURSOR_KEY`. */
export interface MigrationConfig {
  readonly nodeEnv: AppConfig['nodeEnv'];
  readonly logLevel: LogLevel;
  readonly databaseUrl: string;
}

type Env = Readonly<Record<string, string | undefined>>;

function parseEnv<S extends z.ZodType>(parser: S, env: Env): z.output<S> {
  const result = parser.safeParse(env, { reportInput: false });
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new ConfigError(keys);
  }
  return result.data;
}

/**
 * Replaces every `<KEY>_FILE` of FILE_KEYS by the content of its file (one trailing line break removed). Fail-fast, keys only in the error:
 * both `<KEY>` and `<KEY>_FILE` set (ambiguous), a relative path, an unreadable file or one over 64 KiB.
 */
export function resolveFileKeys(env: Env, read: ReadConfigFile = readConfigFile): Env {
  const resolved: Record<string, string | undefined> = { ...env };
  const keys: string[] = [];
  for (const key of FILE_KEYS) {
    const path = env[`${key}_FILE`];
    if (path === undefined || path === '') continue;
    resolved[`${key}_FILE`] = undefined;
    if (env[key] !== undefined && env[key] !== '') {
      keys.push(key);
      continue;
    }
    try {
      if (!isAbsolute(path)) throw new Error('relative path');
      const text = read(path);
      if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw new Error('too large');
      resolved[key] = text.replace(/\r?\n$/, '');
    } catch {
      keys.push(`${key}_FILE`);
    }
  }
  if (keys.length > 0) throw new ConfigError(keys.sort());
  return resolved;
}

export function loadMigrationConfig(env: Env, read: ReadConfigFile = readConfigFile): MigrationConfig {
  const value = parseEnv(migrationSchema, resolveFileKeys(env, read));
  return { nodeEnv: value.NODE_ENV, logLevel: value.LOG_LEVEL, databaseUrl: value.DATABASE_URL };
}

/** The full configuration of the server, the worker and the CLI. */
export function loadConfig(env: Env, read: ReadConfigFile = readConfigFile): AppConfig {
  const resolved = resolveFileKeys(env, read);
  const value = parseEnv(schema, resolved);
  const media = mediaOf(resolved);
  return {
    nodeEnv: value.NODE_ENV,
    port: value.API_PORT,
    logLevel: value.LOG_LEVEL,
    databaseUrl: value.DATABASE_URL,
    minSupportedAppVersion: { android: value.MIN_SUPPORTED_APP_VERSION_ANDROID, ios: value.MIN_SUPPORTED_APP_VERSION_IOS },
    panelOrigin: value.PANEL_ORIGIN,
    webauthn: { rpId: value.WEBAUTHN_RP_ID, rpName: value.WEBAUTHN_RP_NAME },
    trustedProxies: value.TRUSTED_PROXIES,
    cursorKey: Buffer.from(value.CURSOR_KEY, 'base64url'),
    fieldEncryptionKeys: keysOf(value.FIELD_ENCRYPTION_KEYS),
    release: { commit: value.EVIA_RELEASE_COMMIT, manifestSha256: value.EVIA_RELEASE_MANIFEST_SHA256 },
    loginThrottleKey: keyOfLoginThrottle(value.LOGIN_THROTTLE_KEY) ?? randomBytes(LOGIN_THROTTLE_KEY_MIN_BYTES),
    loginAlerts: { passwordFailures: value.LOGIN_ALERT_PASSWORD_FAILURES, secondStepFailures: value.LOGIN_ALERT_SECOND_STEP_FAILURES },
    ...(media === undefined ? {} : { media }),
  };
}

/** The media settings, all or nothing (EVM-044); an error names the keys only. */
function mediaOf(env: Env): MediaConfig | undefined {
  try {
    return loadMediaConfig(env);
  } catch (error) {
    if (error instanceof MediaConfigError) throw new ConfigError(error.keys);
    throw error;
  }
}

/** Where the transactional e-mail goes (EVM-024 AC6): the transport is an explicit, required setting — there is no default. */
export type EmailConfig =
  { readonly transport: 'none' } | { readonly transport: 'smtp'; readonly host: string; readonly port: number; readonly from: string };

/** The configuration of the worker process: everything the server has, plus the transport of e-mail (the API sends no mail and never reads `EMAIL_*`). */
export interface WorkerConfig extends AppConfig {
  readonly email: EmailConfig;
}

/**
 * The hosts the SMTP transport may name (SR-API-13, fail closed): Mailpit of the development environment and the loopback of the machine.
 * Mail can never leave through it — a real relay is the provider adapter of EVM-089, wrapped in the guard of recipients.
 */
export const SMTP_HOSTS = ['mailpit', 'localhost', '127.0.0.1', '::1'] as const;

const emailSchema = z
  .object({
    NODE_ENV: commonShape.NODE_ENV,
    EMAIL_TRANSPORT: z.enum(['smtp', 'none']),
    EMAIL_SMTP_HOST: z.enum(SMTP_HOSTS).optional(),
    EMAIL_SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
    EMAIL_FROM: z
      .string()
      .refine((value) => parseEmailAddress(value) === value)
      .optional(),
  })
  // `smtp` needs its host, port and sender — a transport that is half configured is an error at start, never a silent skip.
  .superRefine((env, context) => {
    if (env.EMAIL_TRANSPORT !== 'smtp') return;
    for (const key of ['EMAIL_SMTP_HOST', 'EMAIL_SMTP_PORT', 'EMAIL_FROM'] as const) {
      if (env[key] === undefined) context.addIssue({ code: 'custom', path: [key] });
    }
    // Staging and production (and a missing NODE_ENV, which means production) send through the provider of EVM-089, never through SMTP.
    if (env.NODE_ENV === 'production') context.addIssue({ code: 'custom', path: ['EMAIL_TRANSPORT'] });
  });

/** The full configuration of the worker: the settings of the server and the transport of e-mail; one error names the keys of both. */
export function loadWorkerConfig(env: Env, read: ReadConfigFile = readConfigFile): WorkerConfig {
  const keys = new Set<string>();
  const collect = (action: () => void): void => {
    try {
      action();
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      for (const key of error.keys) keys.add(key);
    }
  };
  let base: AppConfig | undefined;
  let email: z.output<typeof emailSchema> | undefined;
  collect(() => {
    base = loadConfig(env, read);
  });
  collect(() => {
    email = parseEnv(emailSchema, env);
  });
  if (base === undefined || email === undefined) throw new ConfigError([...keys].sort());
  const transport: EmailConfig =
    email.EMAIL_TRANSPORT === 'none'
      ? { transport: 'none' }
      : {
          transport: 'smtp',
          host: email.EMAIL_SMTP_HOST as string,
          port: email.EMAIL_SMTP_PORT as number,
          from: email.EMAIL_FROM as string,
        };
  return { ...base, email: transport };
}
