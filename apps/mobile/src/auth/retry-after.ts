/**
 * `Retry-After` of a `429` (EVM-100 AC2; security W8): delta seconds or an HTTP-date. A missing, malformed, negative or past value
 * gives a safe default, and the wait is capped so that a wrong header can never lock the sign-in screen for good.
 */
export const DEFAULT_RETRY_AFTER_MS = 60_000;
export const MAX_RETRY_AFTER_MS = 3_600_000;

export function parseRetryAfter(value: string | null, now: number): number {
  const text = value?.trim() ?? '';
  let ms: number;
  if (/^\d{1,10}$/.test(text)) {
    ms = Number(text) * 1000;
  } else if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) {
    const at = Date.parse(text);
    ms = Number.isFinite(at) && at > now ? at - now : DEFAULT_RETRY_AFTER_MS;
  } else {
    ms = DEFAULT_RETRY_AFTER_MS;
  }
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}
