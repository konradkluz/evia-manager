/**
 * Configuration from environment variables, validated once at startup (12-factor; ADR-0002). Fail-fast: an invalid
 * value stops the process. Errors name the keys only, never the values — DATABASE_URL holds a password (SR-LOG-02).
 * The minimum supported app version uses the Semver schema generated from the contract (one source of the pattern);
 * EVM-009 (meta/client-config, 426) reads the same `minSupportedAppVersion` object.
 */
import { zSemver } from '@evia/contracts/zod';
import { z } from 'zod';

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
}

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

const hostOf = (value: string): string => (URL.canParse(value) ? new URL(value).hostname : '');
const isLocalHost = (host: string): boolean => host === 'localhost' || host.endsWith('.localhost');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    DATABASE_URL: postgresUrl,
    MIN_SUPPORTED_APP_VERSION_ANDROID: zSemver,
    MIN_SUPPORTED_APP_VERSION_IOS: zSemver,
    PANEL_ORIGIN: origin,
    WEBAUTHN_RP_ID: hostname,
    WEBAUTHN_RP_NAME: z.string().trim().min(1).max(64).default('EVia Manager'),
    TRUSTED_PROXIES: proxyList,
    CURSOR_KEY: cursorKey,
  })
  .refine((env) => env.NODE_ENV === 'development' || !VERBOSE_LEVELS.includes(env.LOG_LEVEL), { path: ['LOG_LEVEL'] })
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
  .refine((env) => env.NODE_ENV !== 'production' || !isPlaceholderKey(env.CURSOR_KEY), { path: ['CURSOR_KEY'] });

export class ConfigError extends Error {
  readonly keys: readonly string[];

  constructor(keys: readonly string[]) {
    super(`Invalid environment configuration: ${keys.join(', ')}`);
    this.name = 'ConfigError';
    this.keys = keys;
  }
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const result = schema.safeParse(env, { reportInput: false });
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new ConfigError(keys);
  }
  const value = result.data;
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
  };
}
