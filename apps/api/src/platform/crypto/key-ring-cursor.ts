/**
 * Opaque cursor with a RING of keys (ADR-0021 D6; EVM-096 AC3; SR-SYNC-07, ASVS V11.3, CWE-345/639): the same primitive as the cursors of the panel
 * (`opaque-cursor.ts`: AES-256-GCM of `node:crypto`, a random 96-bit nonce per token, no new dependency), but long lived (90 days) and with the identifier of the
 * key in the token, so a key can be rotated without every phone losing its place. The FIRST key seals, ALL keys open.
 *
 * Token = base64url( version (1 byte) | length of the key id (1 byte) | key id | nonce (12 bytes) | ciphertext | tag (16 bytes) ).
 * Additional authenticated data = version byte + key id + operation identifier, so a cursor of another operation, or one with a swapped key id, does not open.
 * Plaintext = JSON `{ x: expiresAtSeconds, c: claims }`; the claims are chosen by the caller (identifiers and positions, never personal data).
 *
 * The answer to `open` tells the caller WHY it failed in a closed set, never anything else (SR-API-01): the caller maps `tampered` (a known key, a bad tag)
 * to a `400` and the rest to a resync, because a removed key and a damaged token look alike only when the key id is unknown.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Clock } from '../clock/clock.ts';
import type { FieldKey } from './field-encryption.ts';

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_KEY_ID_BYTES = 16;
/** A cursor of the phone is valid for 90 days (the retention of the change log). */
export const SYNC_CURSOR_TTL_MS = 90 * 24 * 3_600_000;
/** The longest token the codec reads (the contract promises `maxLength` 1024). */
export const MAX_KEY_RING_CURSOR_LENGTH = 1024;
const MAX_CLAIMS_BYTES = 512;

export type KeyRingOpenResult =
  | { readonly kind: 'ok'; readonly claims: unknown }
  /** Not a token of this codec: wrong format, version or length. */
  | { readonly kind: 'malformed' }
  /** The key id is not in the ring (a rotated-out or removed key). */
  | { readonly kind: 'unknown_key' }
  /** The key is known but the tag does not match: the token was changed, or belongs to another operation. */
  | { readonly kind: 'tampered' }
  | { readonly kind: 'expired' };

const aad = (kid: Buffer, operationId: string): Buffer => Buffer.concat([Buffer.from([VERSION]), kid, Buffer.from(operationId, 'utf8')]);

export class KeyRingCursorCodec {
  readonly #ring: readonly FieldKey[];
  readonly #clock: Clock;

  constructor(ring: readonly FieldKey[], clock: Clock) {
    if (ring.length === 0) throw new RangeError('the cursor key ring must not be empty');
    this.#ring = ring;
    this.#clock = clock;
  }

  seal(operationId: string, claims: object): string {
    const [current] = this.#ring;
    if (current === undefined) throw new RangeError('the cursor key ring must not be empty');
    const kid = Buffer.from(current.id, 'utf8');
    const expiresAt = Math.floor((this.#clock.now().getTime() + SYNC_CURSOR_TTL_MS) / 1000);
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', current.key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(kid, operationId));
    const body = Buffer.concat([cipher.update(JSON.stringify({ x: expiresAt, c: claims }), 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION, kid.length]), kid, nonce, body, cipher.getAuthTag()]).toString('base64url');
  }

  open(operationId: string, token: string): KeyRingOpenResult {
    if (token.length === 0 || token.length > MAX_KEY_RING_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return { kind: 'malformed' };
    const raw = Buffer.from(token, 'base64url');
    const kidLength = raw[1] ?? 0;
    if (raw[0] !== VERSION || kidLength < 1 || kidLength > MAX_KEY_ID_BYTES) return { kind: 'malformed' };
    const nonceStart = 2 + kidLength;
    if (raw.length < nonceStart + NONCE_BYTES + TAG_BYTES + 1) return { kind: 'malformed' };
    const kid = raw.subarray(2, nonceStart);
    const key = this.#ring.find((candidate) => Buffer.from(candidate.id, 'utf8').equals(kid));
    if (key === undefined) return { kind: 'unknown_key' };
    let text: string;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key.key, raw.subarray(nonceStart, nonceStart + NONCE_BYTES), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(aad(kid, operationId));
      decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
      text = Buffer.concat([decipher.update(raw.subarray(nonceStart + NONCE_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      return { kind: 'tampered' };
    }
    if (text.length > MAX_CLAIMS_BYTES) return { kind: 'malformed' };
    const parsed = parseEnvelope(text);
    if (parsed === undefined) return { kind: 'malformed' };
    const nowSeconds = this.#clock.now().getTime() / 1000;
    if (parsed.x <= nowSeconds) return { kind: 'expired' };
    if (parsed.x - nowSeconds > SYNC_CURSOR_TTL_MS / 1000 + 60) return { kind: 'malformed' };
    return { kind: 'ok', claims: parsed.c };
  }
}

function parseEnvelope(text: string): { readonly x: number; readonly c: unknown } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || !('x' in value) || !('c' in value)) return undefined;
    return typeof value.x === 'number' && Number.isFinite(value.x) ? { x: value.x, c: value.c } : undefined;
  } catch {
    return undefined;
  }
}
