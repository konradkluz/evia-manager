import type { Clock, Random } from './ports.ts';

const HEX = '0123456789abcdef';

function hex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    const byte = bytes[i] ?? 0;
    out += HEX[byte >> 4] ?? '0';
    out += HEX[byte & 15] ?? '0';
    if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
  }
  return out;
}

/**
 * UUIDv7 per RFC 9562: 48-bit millisecond timestamp, version 7, a 12-bit counter in `rand_a` (method 1: monotonic within a
 * millisecond; on overflow the timestamp is advanced), variant 10, 62 random bits. UUIDs are not secrets, but the bits
 * come from the injected CSPRNG (SR-CRYPTO-03).
 */
export function createUuidV7(clock: Clock, random: Random): () => string {
  let lastMs = -1;
  let counter = 0;
  const nextCounter = (): number => {
    const r = random.getRandomValues(new Uint8Array(2));
    return (((r[0] ?? 0) & 0x0f) << 8) | (r[1] ?? 0);
  };
  return () => {
    const now = Math.floor(clock.now());
    if (now > lastMs) {
      lastMs = now;
      counter = nextCounter();
    } else {
      counter += 1;
      if (counter > 0xfff) {
        lastMs += 1;
        counter = nextCounter();
      }
    }
    const bytes = random.getRandomValues(new Uint8Array(16));
    const high = Math.floor(lastMs / 0x1_0000_0000);
    const low = lastMs % 0x1_0000_0000;
    bytes[0] = (high >>> 8) & 0xff;
    bytes[1] = high & 0xff;
    bytes[2] = (low >>> 24) & 0xff;
    bytes[3] = (low >>> 16) & 0xff;
    bytes[4] = (low >>> 8) & 0xff;
    bytes[5] = low & 0xff;
    bytes[6] = 0x70 | (counter >> 8);
    bytes[7] = counter & 0xff;
    bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
    return hex(bytes);
  };
}
