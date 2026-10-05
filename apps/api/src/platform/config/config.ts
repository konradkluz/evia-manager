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
}

const postgresUrl = z.string().refine((value) => URL.canParse(value) && /^postgres(ql)?:$/.test(new URL(value).protocol));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    DATABASE_URL: postgresUrl,
    MIN_SUPPORTED_APP_VERSION_ANDROID: zSemver,
    MIN_SUPPORTED_APP_VERSION_IOS: zSemver,
  })
  .refine((env) => env.NODE_ENV === 'development' || !VERBOSE_LEVELS.includes(env.LOG_LEVEL), { path: ['LOG_LEVEL'] });

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
  };
}
