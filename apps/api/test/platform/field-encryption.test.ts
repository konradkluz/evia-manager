import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FieldEncryptionError,
  FieldEncryptionUnavailableError,
  KeyringFieldEncryption,
  fieldEncryptionFor,
  parseFieldEncryptionKeys,
  type FieldKey,
} from '../../src/platform/crypto/field-encryption.ts';

// Keys are generated per run: no key is committed.
const keyOf = (id: string): FieldKey => ({ id, key: randomBytes(32) });
const SECRET = Buffer.from('synthetic totp secret 20');

describe('field encryption (EVM-023 AC1; SR-CRYPTO-02, ASVS V11.2.2, V11.3.3, CWE-311)', () => {
  it('EVM-023 AC1 a sealed value opens with the same context and the plaintext is not in the sealed bytes', () => {
    const encryption = new KeyringFieldEncryption([keyOf('k1')]);
    const context = `totp:${randomUUID()}`;
    const sealed = encryption.encrypt(SECRET, context);
    expect(encryption.decrypt(sealed, context).equals(SECRET)).toBe(true);
    expect(sealed.includes(SECRET)).toBe(false);
  });

  it('EVM-023 AC1 every sealing uses a new data key and nonces: two sealings of one value differ', () => {
    const encryption = new KeyringFieldEncryption([keyOf('k1')]);
    expect(encryption.encrypt(SECRET, 'totp:a').equals(encryption.encrypt(SECRET, 'totp:a'))).toBe(false);
  });

  it('EVM-023 AC1 a sealed value does not open for another account (context is authenticated data)', () => {
    const encryption = new KeyringFieldEncryption([keyOf('k1')]);
    const sealed = encryption.encrypt(SECRET, `totp:${randomUUID()}`);
    expect(() => encryption.decrypt(sealed, `totp:${randomUUID()}`)).toThrow(FieldEncryptionError);
  });

  it('EVM-023 AC1 any changed byte — header, wrapped key, nonce, ciphertext, tag — is an authentication failure', () => {
    const encryption = new KeyringFieldEncryption([keyOf('k1')]);
    const sealed = encryption.encrypt(SECRET, 'totp:a');
    for (let index = 0; index < sealed.length; index += 1) {
      const changed = Buffer.from(sealed);
      changed[index] = (changed[index] ?? 0) ^ 0x01;
      expect(() => encryption.decrypt(changed, 'totp:a'), `byte ${index}`).toThrow(FieldEncryptionError);
    }
    expect(() => encryption.decrypt(sealed.subarray(0, sealed.length - 1), 'totp:a')).toThrow(FieldEncryptionError);
    expect(() => encryption.decrypt(Buffer.alloc(0), 'totp:a')).toThrow(FieldEncryptionError);
  });

  it('EVM-023 AC1 swapping the key id in the header fails: the id is part of the authenticated data of both operations', () => {
    const first = keyOf('k1');
    const encryption = new KeyringFieldEncryption([first, { id: 'k2', key: first.key }]);
    const sealed = encryption.encrypt(SECRET, 'totp:a');
    const swapped = Buffer.from(sealed);
    swapped.write('k2', 3, 'ascii');
    // Same key bytes under another id: the header differs from the one that was authenticated, so the unwrap fails.
    expect(() => encryption.decrypt(swapped, 'totp:a')).toThrow(FieldEncryptionError);
  });

  it('EVM-023 AC1 rotation: the first key seals, the older keys still open earlier values, a removed key does not', () => {
    const old = keyOf('k1');
    const current = keyOf('k2');
    const before = new KeyringFieldEncryption([old]).encrypt(SECRET, 'totp:a');
    const rotated = new KeyringFieldEncryption([current, old]);
    expect(rotated.decrypt(before, 'totp:a').equals(SECRET)).toBe(true);
    const after = rotated.encrypt(SECRET, 'totp:a');
    expect(after.subarray(3, 5).toString('ascii')).toBe('k2');
    expect(() => new KeyringFieldEncryption([current]).decrypt(before, 'totp:a')).toThrow(FieldEncryptionError);
  });

  it('EVM-023 AC1 a wrong key does not open the value', () => {
    const sealed = new KeyringFieldEncryption([keyOf('k1')]).encrypt(SECRET, 'totp:a');
    expect(() => new KeyringFieldEncryption([keyOf('k1')]).decrypt(sealed, 'totp:a')).toThrow(FieldEncryptionError);
  });

  it('EVM-023 AC1 the keyring refuses no keys, a key that is not 32 bytes, a bad id and a repeated id', () => {
    expect(() => new KeyringFieldEncryption([])).toThrow(RangeError);
    expect(() => new KeyringFieldEncryption([{ id: 'k1', key: randomBytes(31) }])).toThrow(RangeError);
    expect(() => new KeyringFieldEncryption([{ id: 'K 1', key: randomBytes(32) }])).toThrow(RangeError);
    expect(() => new KeyringFieldEncryption([keyOf('k1'), keyOf('k1')])).toThrow(RangeError);
  });

  it('EVM-023 AC1 without a key everything is refused (fail closed) — nothing is ever sealed in the clear', () => {
    const none = fieldEncryptionFor([]);
    expect(() => none.encrypt(SECRET, 'totp:a')).toThrow(FieldEncryptionUnavailableError);
    expect(() => none.decrypt(SECRET, 'totp:a')).toThrow(FieldEncryptionUnavailableError);
    expect(fieldEncryptionFor([keyOf('k1')])).toBeInstanceOf(KeyringFieldEncryption);
  });

  it('EVM-023 AC1 the errors carry no detail and no key material', () => {
    const key = keyOf('k1');
    const encryption = new KeyringFieldEncryption([key]);
    const sealed = encryption.encrypt(SECRET, 'totp:a');
    try {
      encryption.decrypt(sealed, 'totp:b');
      expect.unreachable();
    } catch (error) {
      expect(`${(error as Error).message}${(error as Error).stack ?? ''}`).not.toContain(key.key.toString('base64url'));
      expect((error as Error).message).toBe('field encryption failed');
    }
  });
});

describe('FIELD_ENCRYPTION_KEYS syntax (EVM-023 AC1; SR-CRYPTO-04)', () => {
  const encoded = (): string => randomBytes(32).toString('base64url');

  it('EVM-023 AC1 parses id:key lists in order', () => {
    const [a, b] = [encoded(), encoded()];
    const keys = parseFieldEncryptionKeys(`k2:${a}, k1:${b}`);
    expect(keys?.map((key) => key.id)).toEqual(['k2', 'k1']);
    expect(keys?.[0]?.key.toString('base64url')).toBe(a);
  });

  it('EVM-023 AC1 refuses anything malformed: empty, no id, bad id, wrong length, padding, a repeated id', () => {
    const good = encoded();
    for (const value of [
      '',
      good,
      `:${good}`,
      `K1:${good}`,
      `k1:${good.slice(1)}`,
      `k1:${good}=`,
      `k1:${good},k1:${encoded()}`,
      `k1:${good},`,
      `${'a'.repeat(17)}:${good}`,
    ])
      expect(parseFieldEncryptionKeys(value), value).toBeUndefined();
  });
});
