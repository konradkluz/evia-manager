// UUIDv7 (RFC 9562): time-ordered identifier generated on the device before the file enters the queue.
// Randomness is injectable; default is the Web Crypto CSPRNG (Node and, via the expo-crypto polyfill, React Native).
export function uuidv7(now: number = Date.now(), random?: Uint8Array): string {
  const rnd = random ?? globalThis.crypto.getRandomValues(new Uint8Array(10));
  const b = new Uint8Array(16);
  const ts = BigInt(now);
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  b.set(rnd.subarray(0, 10), 6);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
