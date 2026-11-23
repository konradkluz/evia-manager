const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CHUNK = 3 * 4096;

const char = (n: number): string => ALPHABET.charAt(n & 63);

/** Base64 of a byte array (the engine of the app has no `btoa` guaranteed; no dependency for 30 lines). */
export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    let out = '';
    let i = start;
    for (; i + 2 < end; i += 3) {
      const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
      out += char(n >> 18) + char(n >> 12) + char(n >> 6) + char(n);
    }
    const left = end - i;
    if (left === 1) {
      const n = (bytes[i] ?? 0) << 16;
      out += `${char(n >> 18)}${char(n >> 12)}==`;
    } else if (left === 2) {
      const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
      out += `${char(n >> 18)}${char(n >> 12)}${char(n >> 6)}=`;
    }
    parts.push(out);
  }
  return parts.join('');
}
