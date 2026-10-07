/**
 * Opaque pagination cursors (api-guidelines.md → Paginacja; EVM-017 AC3; SR-API-04, ASVS V11.3, CWE-327/330/321): the position
 * after the last item of a page, encrypted and authenticated with a key of the server (AES-256-GCM of `node:crypto`; no new
 * dependency). The client cannot read the sort key (a customer name, a number), change it, use it in another operation, with
 * other filters or as another user, and cannot use it after it expires.
 *
 * Token = base64url( version (1 byte) | nonce (12 random bytes) | ciphertext | tag (16 bytes) ).
 * Additional authenticated data = version byte + operation identifier, so a cursor of one operation does not open in another.
 * Plaintext = JSON `[position, scope, userId, expiresAtSeconds]`; `scope` is the hash of the normalised filters of the request.
 * Every failure — not base64url, too long, a bad tag, another version, expired, another user, other filters — is the same
 * `undefined`: the caller answers one `400 invalid_cursor` with no detail (SR-API-01). The key is never logged or returned.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Clock } from '../clock/clock.ts';

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
/** A cursor is valid for 30 minutes: long enough to page through a list, short enough that a leaked one is of little use. */
export const CURSOR_TTL_MS = 30 * 60_000;
/** The longest token the codec reads (the contract promises `maxLength` 512; the plaintext is far below this). */
export const MAX_CURSOR_LENGTH = 512;
const MAX_POSITION_PARTS = 4;
const MAX_PART_LENGTH = 128;

const plaintext = z.tuple([
  z.array(z.string().max(MAX_PART_LENGTH)).min(1).max(MAX_POSITION_PARTS),
  z.string().max(64),
  z.string().max(64),
  z.int().min(0),
]);

export interface CursorClaims {
  /** Where the next page starts: the values of the sort key of the last item (strings; the caller validates them again). */
  readonly position: readonly string[];
  /** {@link scopeOf} of the normalised filters of the request. */
  readonly scope: string;
  readonly userId: string;
}

/** @returns a short digest of the filter values; the order of `parts` matters, so the caller normalises them first */
export const scopeOf = (parts: readonly string[]): string =>
  createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('base64url').slice(0, 22);

const aad = (operationId: string): Buffer => Buffer.concat([Buffer.from([VERSION]), Buffer.from(operationId, 'utf8')]);

export class CursorCodec {
  readonly #key: Buffer;
  readonly #clock: Clock;

  constructor(key: Buffer, clock: Clock) {
    if (key.length !== KEY_BYTES) throw new RangeError('the cursor key must be 32 bytes');
    this.#key = Buffer.from(key);
    this.#clock = clock;
  }

  seal(operationId: string, claims: CursorClaims): string {
    const expiresAt = Math.floor((this.#clock.now().getTime() + CURSOR_TTL_MS) / 1000);
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(operationId));
    const body = Buffer.concat([
      cipher.update(JSON.stringify([claims.position, claims.scope, claims.userId, expiresAt]), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([Buffer.from([VERSION]), nonce, body, cipher.getAuthTag()]).toString('base64url');
  }

  /** @returns the position of a cursor this server issued for this operation, scope and user that has not expired; else undefined */
  open(operationId: string, token: string, expected: { readonly scope: string; readonly userId: string }): readonly string[] | undefined {
    if (token.length === 0 || token.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return undefined;
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 1 + NONCE_BYTES + TAG_BYTES + 1 || raw[0] !== VERSION) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.#key, raw.subarray(1, 1 + NONCE_BYTES), { authTagLength: TAG_BYTES });
      decipher.setAAD(aad(operationId));
      decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
      const text = Buffer.concat([decipher.update(raw.subarray(1 + NONCE_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString(
        'utf8',
      );
      const parsed = plaintext.safeParse(JSON.parse(text));
      if (!parsed.success) return undefined;
      const [position, scope, userId, expiresAt] = parsed.data;
      const nowSeconds = this.#clock.now().getTime() / 1000;
      const alive = expiresAt > nowSeconds && expiresAt - nowSeconds <= CURSOR_TTL_MS / 1000;
      return alive && scope === expected.scope && userId === expected.userId ? position : undefined;
    } catch {
      return undefined;
    }
  }
}
