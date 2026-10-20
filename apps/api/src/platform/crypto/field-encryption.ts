/**
 * Envelope encryption of sensitive database fields (EVM-023 AC1; SR-CRYPTO-02, SR-CRYPTO-03, P12; ASVS V11.2.2, V11.3.3; CWE-311, CWE-327, CWE-312):
 * a TOTP secret (and any other value that must be read back, so a hash is no option) is never stored in the clear. No new dependency —
 * AES-256-GCM of `node:crypto`.
 *
 * Every value gets its own random 256-bit data key (DEK) from the CSPRNG. The value is encrypted with the DEK, the DEK is wrapped with a master key
 * (KEK) named by an identifier, both with AES-256-GCM and a fresh random 96-bit nonce:
 *
 *   sealed = header | wrapNonce(12) | wrappedDek(32) | wrapTag(16) | dataNonce(12) | ciphertext | dataTag(16)
 *   header = version(1) | algorithm(1) | keyIdLength(1) | keyId
 *
 * The header (version, algorithm, key id) is part of the additional authenticated data of BOTH operations, together with a label of the operation
 * and the context of the caller (`totp:<userId>`): a sealed value does not open for another account or another purpose, and a changed header or
 * key id is an authentication failure, not a silent fallback. Every failure is the same `FieldEncryptionError` — no detail that tells why.
 *
 * Keys come from `FIELD_ENCRYPTION_KEYS` (`id:base64url32,…`): the first one seals, every one opens (rotation: a new key goes first, the old stay
 * until no row names them). Keys are never logged and never put in an error message.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;
const ALGORITHM_AES_256_GCM = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const MAX_KEY_ID_BYTES = 16;
const KEY_ID = /^[a-z0-9][a-z0-9-]{0,15}$/;

export interface FieldKey {
  readonly id: string;
  /** 32 random bytes. */
  readonly key: Buffer;
}

export interface FieldEncryption {
  /** @param context what the value belongs to (`totp:<userId>`): it must be the same at `decrypt` */
  encrypt(plaintext: Buffer, context: string): Buffer;
  /** @throws FieldEncryptionError for a wrong key, a wrong context and any change of the sealed bytes */
  decrypt(sealed: Buffer, context: string): Buffer;
}

/** The sealed value does not open (or cannot be made). Carries no detail. */
export class FieldEncryptionError extends Error {
  constructor() {
    super('field encryption failed');
    this.name = 'FieldEncryptionError';
  }
}

/** No key is configured (development and tests without `FIELD_ENCRYPTION_KEYS`): everything that needs the keys is refused (fail closed). */
export class FieldEncryptionUnavailableError extends Error {
  constructor() {
    super('field encryption is not configured');
    this.name = 'FieldEncryptionUnavailableError';
  }
}

/**
 * Parses `id:base64url32[,id:base64url32…]`.
 * @returns the keys in the given order, or undefined for anything malformed: an empty list, a bad id, a key that is not exactly 32 bytes in canonical
 *   base64url, a repeated id
 */
export function parseFieldEncryptionKeys(raw: string): FieldKey[] | undefined {
  const entries = raw.split(',').map((entry) => entry.trim());
  const keys: FieldKey[] = [];
  for (const entry of entries) {
    const separator = entry.indexOf(':');
    if (separator < 0) return undefined;
    const id = entry.slice(0, separator);
    const encoded = entry.slice(separator + 1);
    const key = Buffer.from(encoded, 'base64url');
    if (!KEY_ID.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(encoded) || key.length !== KEY_BYTES || key.toString('base64url') !== encoded)
      return undefined;
    if (keys.some((known) => known.id === id)) return undefined;
    keys.push({ id, key });
  }
  return keys;
}

const aad = (header: Buffer, label: string, context: string): Buffer =>
  Buffer.concat([header, Buffer.from(`${label}\0${context}`, 'utf8')]);

function seal(key: Buffer, plaintext: Buffer, additional: Buffer): { nonce: Buffer; ciphertext: Buffer; tag: Buffer } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(additional);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, ciphertext, tag: cipher.getAuthTag() };
}

function open(key: Buffer, nonce: Buffer, ciphertext: Buffer, tag: Buffer, additional: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(additional);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export class KeyringFieldEncryption implements FieldEncryption {
  readonly #keys: ReadonlyMap<string, Buffer>;
  readonly #activeId: string;

  /** @param keys the first one seals; at least one, every id once, every key 32 bytes */
  constructor(keys: readonly FieldKey[]) {
    const [active] = keys;
    if (active === undefined) throw new RangeError('at least one field encryption key is required');
    const map = new Map<string, Buffer>();
    for (const { id, key } of keys) {
      if (!KEY_ID.test(id) || key.length !== KEY_BYTES || map.has(id)) throw new RangeError('invalid field encryption keys');
      map.set(id, Buffer.from(key));
    }
    this.#keys = map;
    this.#activeId = active.id;
  }

  encrypt(plaintext: Buffer, context: string): Buffer {
    const kek = this.#keys.get(this.#activeId) as Buffer;
    const id = Buffer.from(this.#activeId, 'ascii');
    const header = Buffer.concat([Buffer.from([VERSION, ALGORITHM_AES_256_GCM, id.length]), id]);
    const dek = randomBytes(KEY_BYTES);
    const wrapped = seal(kek, dek, aad(header, 'dek', context));
    const data = seal(dek, plaintext, aad(header, 'data', context));
    dek.fill(0);
    return Buffer.concat([header, wrapped.nonce, wrapped.ciphertext, wrapped.tag, data.nonce, data.ciphertext, data.tag]);
  }

  decrypt(sealed: Buffer, context: string): Buffer {
    try {
      return this.#decrypt(sealed, context);
    } catch {
      throw new FieldEncryptionError();
    }
  }

  #decrypt(sealed: Buffer, context: string): Buffer {
    const idLength = sealed[2] ?? 0;
    const headerLength = 3 + idLength;
    if (sealed[0] !== VERSION || sealed[1] !== ALGORITHM_AES_256_GCM || idLength < 1 || idLength > MAX_KEY_ID_BYTES)
      throw new FieldEncryptionError();
    const header = sealed.subarray(0, headerLength);
    const kek = this.#keys.get(header.subarray(3).toString('ascii'));
    const fixed = headerLength + NONCE_BYTES + KEY_BYTES + TAG_BYTES + NONCE_BYTES + TAG_BYTES;
    if (kek === undefined || sealed.length < fixed) throw new FieldEncryptionError();

    let offset = headerLength;
    const take = (length: number): Buffer => {
      const part = sealed.subarray(offset, offset + length);
      offset += length;
      return part;
    };
    const wrapNonce = take(NONCE_BYTES);
    const wrappedDek = take(KEY_BYTES);
    const wrapTag = take(TAG_BYTES);
    const dataNonce = take(NONCE_BYTES);
    const ciphertext = take(sealed.length - offset - TAG_BYTES);
    const dataTag = take(TAG_BYTES);

    const dek = open(kek, wrapNonce, wrappedDek, wrapTag, aad(header, 'dek', context));
    try {
      return open(dek, dataNonce, ciphertext, dataTag, aad(header, 'data', context));
    } finally {
      dek.fill(0);
    }
  }
}

/** What the platform provides when no key is configured: the first use is refused, nothing is ever stored unencrypted. */
export class UnavailableFieldEncryption implements FieldEncryption {
  encrypt(): Buffer {
    throw new FieldEncryptionUnavailableError();
  }

  decrypt(): Buffer {
    throw new FieldEncryptionUnavailableError();
  }
}

export const fieldEncryptionFor = (keys: readonly FieldKey[]): FieldEncryption =>
  keys.length === 0 ? new UnavailableFieldEncryption() : new KeyringFieldEncryption(keys);
