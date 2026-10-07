import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CURSOR_TTL_MS, CursorCodec, MAX_CURSOR_LENGTH, scopeOf } from '../../src/platform/crypto/opaque-cursor.ts';
import { FixedClock, MINUTE } from '../support/clock.ts';

const OPERATION = 'listWorkOrders';
const NOW = '2026-10-07T08:00:00.000Z';

function harness() {
  const clock = new FixedClock(NOW);
  const key = randomBytes(32); // generated per run: no key is committed
  const userId = randomUUID();
  const scope = scopeOf(['-number', 'all_open', 'new,quoting', '']);
  return { clock, key, userId, scope, codec: new CursorCodec(key, clock) };
}

describe('opaque cursor (EVM-017 AC3; SR-API-04, ASVS V11.3, CWE-327, CWE-330)', () => {
  it('EVM-017 AC3 a sealed cursor opens for the same operation, scope and user and returns the position', () => {
    const { codec, userId, scope } = harness();
    const token = codec.seal(OPERATION, { position: ['ZL-2026-0042'], scope, userId });
    expect(codec.open(OPERATION, token, { scope, userId })).toEqual(['ZL-2026-0042']);
  });

  it('EVM-017 AC3 the token is base64url within the length of the contract and does not show the sort key', () => {
    const { codec, userId, scope } = harness();
    const token = codec.seal(OPERATION, { position: ['ZL-2026-0042', '0198b0a0-0000-7000-8000-000000000001'], scope, userId });
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeLessThanOrEqual(MAX_CURSOR_LENGTH);
    const decoded = Buffer.from(token, 'base64url').toString('latin1');
    expect(decoded).not.toContain('ZL-2026');
    expect(decoded).not.toContain(userId);
  });

  it('EVM-017 AC3 two cursors for the same position differ (a random 96-bit nonce per cursor)', () => {
    const { codec, userId, scope } = harness();
    const claims = { position: ['ZL-2026-0042'], scope, userId };
    expect(codec.seal(OPERATION, claims)).not.toBe(codec.seal(OPERATION, claims));
  });

  it('EVM-017 AC3 a cursor of another operation, another user or other filters is refused', () => {
    const { codec, userId, scope } = harness();
    const token = codec.seal(OPERATION, { position: ['ZL-2026-0042'], scope, userId });
    expect(codec.open('searchWorkOrders', token, { scope, userId })).toBeUndefined();
    expect(codec.open(OPERATION, token, { scope, userId: randomUUID() })).toBeUndefined();
    expect(codec.open(OPERATION, token, { scope: scopeOf(['number', 'all_open', '', '']), userId })).toBeUndefined();
  });

  it('EVM-017 AC3 a cursor is valid for 30 minutes and not a second longer', () => {
    const { codec, clock, userId, scope } = harness();
    const token = codec.seal(OPERATION, { position: ['x'], scope, userId });
    clock.advance(CURSOR_TTL_MS - 1000);
    expect(codec.open(OPERATION, token, { scope, userId })).toEqual(['x']);
    clock.advance(1000);
    expect(codec.open(OPERATION, token, { scope, userId })).toBeUndefined();
    clock.advance(MINUTE);
    expect(codec.open(OPERATION, token, { scope, userId })).toBeUndefined();
  });

  it('EVM-017 AC3 a changed byte anywhere (version, nonce, ciphertext, tag) is refused', () => {
    const { codec, userId, scope } = harness();
    const raw = Buffer.from(codec.seal(OPERATION, { position: ['ZL-2026-0042'], scope, userId }), 'base64url');
    for (let index = 0; index < raw.length; index += 1) {
      const changed = Buffer.from(raw);
      changed[index] = (changed[index] ?? 0) ^ 0x01;
      expect(codec.open(OPERATION, changed.toString('base64url'), { scope, userId }), `byte ${index}`).toBeUndefined();
    }
  });

  it('EVM-017 AC3 a cursor sealed with another key is refused (key rotation invalidates cursors)', () => {
    const { codec, clock, userId, scope } = harness();
    const token = codec.seal(OPERATION, { position: ['x'], scope, userId });
    expect(new CursorCodec(randomBytes(32), clock).open(OPERATION, token, { scope, userId })).toBeUndefined();
    expect(codec.open(OPERATION, token, { scope, userId })).toEqual(['x']);
  });

  it('EVM-017 AC3 malformed input is refused without an exception: empty, not base64url, too long, too short, wrong version', () => {
    const { codec, userId, scope } = harness();
    const expected = { scope, userId };
    const valid = Buffer.from(codec.seal(OPERATION, { position: ['x'], scope, userId }), 'base64url');
    const otherVersion = Buffer.from(valid);
    otherVersion[0] = 2;
    for (const token of [
      '',
      '!!!',
      'a b',
      'A'.repeat(MAX_CURSOR_LENGTH + 1),
      'AAAA',
      otherVersion.toString('base64url'),
      `${valid.toString('base64url')}=`,
    ]) {
      expect(codec.open(OPERATION, token, expected), token.slice(0, 20)).toBeUndefined();
    }
  });

  it('EVM-017 AC3 a token that decrypts but is not what this API issues (plaintext of another shape) is refused', () => {
    const { codec, clock, key, userId, scope } = harness();
    // Same key and version: only a holder of the key could build it, yet the shape is still checked.
    const forged = new CursorCodec(key, clock);
    const claims = { position: [] as string[], scope, userId };
    expect(forged.open(OPERATION, forged.seal(OPERATION, claims), { scope, userId })).toBeUndefined();
    expect(codec.open(OPERATION, forged.seal(OPERATION, { ...claims, position: ['x'.repeat(129)] }), { scope, userId })).toBeUndefined();
  });

  it('EVM-017 AC3 a key that is not 32 bytes is refused at construction', () => {
    expect(() => new CursorCodec(randomBytes(31), new FixedClock(NOW))).toThrow(RangeError);
    expect(() => new CursorCodec(randomBytes(33), new FixedClock(NOW))).toThrow(RangeError);
  });

  it('EVM-017 AC3 the scope depends on every filter value and on their order', () => {
    expect(scopeOf(['a', 'b'])).toBe(scopeOf(['a', 'b']));
    expect(scopeOf(['a', 'b'])).not.toBe(scopeOf(['b', 'a']));
    expect(scopeOf(['a', ''])).not.toBe(scopeOf(['a']));
  });
});
