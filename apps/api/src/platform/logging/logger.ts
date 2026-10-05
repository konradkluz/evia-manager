/**
 * Structured JSON logger (pino; ADR-0013, SR-LOG-02, SR-LOG-05). Redaction is applied to every logged object at any
 * depth by normalised key names (pino path-based redaction would miss deeper or differently cased keys). Errors are
 * serialised to type, message, code and stack only: driver errors (pg `detail`, `where`, query, parameters) carry row
 * values. No hostname or pid; request bodies and headers are never logged.
 */
import { pino, type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from '../config/config.ts';

export type { Logger } from 'pino';

export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;

/** Normalised fragments of keys whose values never reach the logs (ADR-0013: credentials, personal data, files, signed URLs). */
export const SENSITIVE_KEY_FRAGMENTS = Object.freeze([
  'authorization',
  'cookie',
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'mfa',
  'otp',
  'email',
  'phone',
  'firstname',
  'lastname',
  'surname',
  'fullname',
  'address',
  'pesel',
  'filename',
  'signedurl',
  'signature',
  'credential',
]);
/** Keys sensitive only as a whole word (as a fragment they would hide e.g. `operationName`). */
const SENSITIVE_KEYS = new Set(['name']);

export function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[_.-]/g, '');
  return SENSITIVE_KEYS.has(normalised) || SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalised.includes(fragment));
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/** @returns a copy with sensitive keys replaced by REDACTED, at any depth (arrays included). */
export function redactSensitive(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((item) => redactSensitive(item, depth + 1, seen))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, isSensitiveKey(key) ? REDACTED : redactSensitive(item, depth + 1, seen)]),
      );
  seen.delete(value);
  return result;
}

export interface SerializedError {
  readonly type: string;
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
}

export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) return { type: typeof error, message: 'non-error value thrown' };
  const code = (error as { code?: unknown }).code;
  return {
    type: error.name,
    message: error.message,
    ...(typeof code === 'string' ? { code } : {}),
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  };
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly destination?: DestinationStream;
  /** Extra fields of every entry (request context: traceId). */
  readonly mixin?: () => Record<string, unknown>;
}

export function createLogger({ level, destination, mixin }: LoggerOptions): Logger {
  return pino(
    {
      level,
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: { err: serializeError, error: serializeError },
      formatters: {
        level: (label) => ({ level: label }),
        log: (object) => redactSensitive(object) as Record<string, unknown>,
      },
      ...(mixin === undefined ? {} : { mixin }),
    },
    destination,
  );
}
