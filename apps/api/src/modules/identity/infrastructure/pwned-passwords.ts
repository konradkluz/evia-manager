/**
 * Pwned Passwords range API (SR-AUTH-02, SR-API-13; ASVS V6.2.4, V6.2.12): only the first five hex characters of the
 * password's SHA-1 are sent (k-anonymity), with `Add-Padding: true`; the response is compared locally. The host is a
 * constant (allow-list for outbound traffic), redirects are refused, the request has a 2 s timeout and the response a
 * size limit. Entries with a count of 0 are padding, not hits. Any failure is `unavailable`: the caller continues with
 * the local checks and logs a warning without the prefix or the hash (the activation must stay possible).
 */
import { createHash } from 'node:crypto';
import type { BreachedPasswordCheck, BreachResult } from './ports.ts';

export const PWNED_PASSWORDS_ORIGIN = 'https://api.pwnedpasswords.com';
export const PWNED_TIMEOUT_MS = 2000;
export const PWNED_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Reads the body up to a byte limit; null when the limit is exceeded. */
async function readLimited(response: Response, limit: number): Promise<string | null> {
  if (response.body === null) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = (await reader.read()) as { done: boolean; value: Uint8Array };
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export class PwnedPasswordsCheck implements BreachedPasswordCheck {
  readonly #fetch: FetchLike;

  constructor(fetchImplementation: FetchLike = fetch) {
    this.#fetch = fetchImplementation;
  }

  async check(password: string): Promise<BreachResult> {
    // nosemgrep: SHA-1 is the fixed identifier of the Pwned Passwords range API (k-anonymity), not a security control (ASVS V11.4.1).
    const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    try {
      const response = await this.#fetch(`${PWNED_PASSWORDS_ORIGIN}/range/${prefix}`, {
        method: 'GET',
        headers: { 'Add-Padding': 'true' },
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(PWNED_TIMEOUT_MS),
      });
      if (!response.ok) return 'unavailable';
      const body = await readLimited(response, PWNED_MAX_RESPONSE_BYTES);
      if (body === null) return 'unavailable';
      const hit = body.split(/\r?\n/).some((line) => {
        const [candidate, count] = line.trim().split(':');
        return candidate === suffix && Number(count) > 0;
      });
      return hit ? 'breached' : 'clean';
    } catch {
      return 'unavailable';
    }
  }
}
