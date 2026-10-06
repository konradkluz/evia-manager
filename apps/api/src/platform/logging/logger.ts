/**
 * Structured JSON logger (pino; ADR-0013, SR-LOG-02, SR-LOG-05). Redaction is applied to every logged object at any
 * depth by normalised key names (pino path-based redaction would miss deeper or differently cased keys). Errors are
 * serialised to type, scrubbed message, code and stack frames only: driver errors (pg message, `detail`, `where`, query,
 * parameters) carry row values, so they keep only SQLSTATE and object names. No hostname or pid; request bodies and
 * headers are never logged.
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
  // EVM-016: WebAuthn ceremony data and the CSRF token (the latter also matches `token`; listed for the record).
  'challenge',
  'clientdata',
  'attestation',
  'assertion',
  'csrf',
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
  /** Names of the database objects of a driver error (schema metadata, never row values). */
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
  /** Stack frames only — the first line of a stack repeats the message. */
  readonly stack?: string;
}

/** The local part is bounded (RFC 5321: 64, with margin): an unbounded `+` before `@` costs O(n²) on text without `@` (CWE-1333). */
const EMAIL = /[\p{L}\p{N}._%+-]{1,254}@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
/** A URL fragment that looks like a one-time token (`#` + 20 or more base64url characters; the activation link, SR-LOG-02). */
const FRAGMENT_TOKEN = /#[A-Za-z0-9_-]{20,}/g;
/** Messages may contain attacker-controlled text (e.g. an origin from WebAuthn clientDataJSON): bound the work before scrubbing. */
export const MAX_SCRUBBED_LENGTH = 2048;
/** Phone numbers, PESEL, account numbers: 9+ digits, optionally grouped; not inside identifiers (UUID, hashes). */
const LONG_NUMBER = /(?<![\p{L}\p{N}_-])(?:\+\d{1,3}[ -]?)?\d(?:[ -]?\d){8,}(?![\p{L}\p{N}_-])/gu;
const QUOTED = /(["'„«])[^"'”»\n]*(["'”»])/gu;

/**
 * Replaces values that may come from users in free text (error messages): e-mail addresses, long numbers (phone,
 * PESEL) and quoted text. Key-based redaction cannot see them (SR-LOG-02, CWE-532).
 */
export function scrubValues(text: string, maxLength: number = MAX_SCRUBBED_LENGTH): string {
  const bounded = text.length > maxLength ? `${text.slice(0, maxLength)}…[truncated]` : text;
  return bounded
    .replace(FRAGMENT_TOKEN, `#${REDACTED}`)
    .replace(EMAIL, REDACTED)
    .replace(LONG_NUMBER, REDACTED)
    .replace(QUOTED, (_match, open: string, close: string) => `${open}${REDACTED}${close}`);
}

const MAX_SCRUBBED_STACK_LENGTH = 8192;

const stackFrames = (stack: string | undefined): string | undefined => {
  const frames = stack
    ?.split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');
  return frames === undefined || frames === '' ? undefined : scrubValues(frames, MAX_SCRUBBED_STACK_LENGTH);
};

const stringField = (error: Error, key: string): Record<string, string> => {
  const value = (error as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? { [key]: value } : {};
};

/** Errors of the PostgreSQL driver (pg DatabaseError): their message quotes input values (e.g. 22P02). */
const isDatabaseError = (error: Error): boolean =>
  typeof (error as { severity?: unknown }).severity === 'string' && typeof (error as { code?: unknown }).code === 'string';

export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) return { type: typeof error, message: 'non-error value thrown' };
  const stack = stackFrames(error.stack);
  if (isDatabaseError(error)) {
    return {
      type: 'DatabaseError',
      message: 'database error',
      ...stringField(error, 'code'),
      ...stringField(error, 'constraint'),
      ...stringField(error, 'table'),
      ...stringField(error, 'column'),
      ...(stack === undefined ? {} : { stack }),
    };
  }
  return {
    type: error.name,
    message: scrubValues(error.message),
    ...stringField(error, 'code'),
    ...(stack === undefined ? {} : { stack }),
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
