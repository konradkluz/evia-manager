/**
 * UUID version 7 (RFC 9562) made in the browser: the client names a new customer and every attempt to save it (AC4: the same
 * `id` and `Idempotency-Key` on a retry). 48 bits of the time in milliseconds, version 7, variant `10`, the rest random from
 * the platform's cryptographic generator. The format is what the contract demands (`pattern` of `id` and of the key).
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let time = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(time & 0xffn);
    time >>= 8n;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
