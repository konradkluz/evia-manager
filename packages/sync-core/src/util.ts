import type { Random } from './ports.ts';

/** Number of bytes of the UTF-8 encoding of a string (no TextEncoder/Buffer: portable). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** A number in [0, 1) from the injected random source. */
export function unitRandom(random: Random): number {
  const r = random.getRandomValues(new Uint8Array(4));
  const value = ((r[0] ?? 0) * 0x100_0000 + (r[1] ?? 0) * 0x1_0000 + (r[2] ?? 0) * 0x100 + (r[3] ?? 0)) / 0x1_0000_0000;
  return value;
}

export const MIN_RETRY_AFTER_MS = 1000;

/**
 * `Retry-After` as delta-seconds or an HTTP-date, in milliseconds clamped to [1 s, maxMs]; anything unreadable (negative, NaN,
 * absurd) is ignored or clamped so a hostile or broken header cannot freeze the queue (SR-ERR-02).
 */
export function parseRetryAfter(value: string | number | undefined, nowMs: number, maxMs: number): number | undefined {
  let ms: number;
  if (typeof value === 'number') {
    ms = value * 1000;
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (/^\d{1,12}$/.test(text)) ms = Number(text) * 1000;
    else if (text.length > 0 && text.length <= 64 && /[A-Za-z]{3}/.test(text)) ms = Date.parse(text) - nowMs;
    else return undefined;
  } else return undefined;
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(maxMs, Math.max(MIN_RETRY_AFTER_MS, Math.floor(ms)));
}

/** Exponential backoff with a cap and full jitter: a random delay in [floor, min(cap, base * 2^(attempt-1))]. */
export function backoffDelay(attempt: number, random: Random, baseMs: number, capMs: number): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 30);
  const ceiling = Math.min(capMs, baseMs * 2 ** exponent);
  return Math.max(MIN_RETRY_AFTER_MS, Math.floor(unitRandom(random) * ceiling));
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** A `date-time` string of the contract as epoch milliseconds, or undefined (shape checked first, then `Date.parse`). */
export function parseServerTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length > 40 || !TIMESTAMP.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}
