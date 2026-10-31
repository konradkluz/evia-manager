import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CursorCodec } from '../../src/platform/crypto/opaque-cursor.ts';
import { KeyRingCursorCodec, SYNC_CURSOR_TTL_MS } from '../../src/platform/crypto/key-ring-cursor.ts';
import { FixedClock } from '../support/clock.ts';

const OPERATION = 'getSyncChanges';
const NOW = '2026-10-29T08:00:00.000Z';
const ring = (...ids: string[]) => ids.map((id) => ({ id, key: randomBytes(32) })); // generated per run: no key is committed

describe('cursor with a ring of keys (EVM-096 AC3; ADR-0021 D6)', () => {
  it('EVM-096 AC3 a sealed cursor opens and returns the claims; the token is base64url and shows nothing of them', () => {
    const codec = new KeyRingCursorCodec(ring('k1'), new FixedClock(NOW));
    const token = codec.seal(OPERATION, { userId: 'u-1', deviceId: 'd-1' });
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url').toString('latin1')).not.toContain('u-1');
    expect(codec.open(OPERATION, token)).toEqual({ kind: 'ok', claims: { userId: 'u-1', deviceId: 'd-1' } });
  });

  it('EVM-096 AC3 the first key seals, every key opens: a cursor of the old key survives the rotation, a removed key is unknown', () => {
    const clock = new FixedClock(NOW);
    const [old, fresh] = ring('k1', 'k2') as [{ id: string; key: Buffer }, { id: string; key: Buffer }];
    const before = new KeyRingCursorCodec([old], clock).seal(OPERATION, { a: 1 });
    expect(new KeyRingCursorCodec([fresh, old], clock).open(OPERATION, before)).toEqual({ kind: 'ok', claims: { a: 1 } });
    expect(new KeyRingCursorCodec([fresh], clock).open(OPERATION, before)).toEqual({ kind: 'unknown_key' });
  });

  it('EVM-096 AC3 a changed token, another operation and a swapped key id are tampered (a known key, a bad tag), never a silent success', () => {
    const clock = new FixedClock(NOW);
    const codec = new KeyRingCursorCodec(ring('k1', 'k2'), clock);
    const token = codec.seal(OPERATION, { a: 1 });
    const raw = Buffer.from(token, 'base64url');
    raw[raw.length - 20] = (raw[raw.length - 20] ?? 0) ^ 1;
    expect(codec.open(OPERATION, raw.toString('base64url'))).toEqual({ kind: 'tampered' });
    expect(codec.open('listWorkOrders', token)).toEqual({ kind: 'tampered' });
    const swapped = Buffer.from(token, 'base64url');
    swapped[3] = '2'.charCodeAt(0); // k1 -> k2
    expect(codec.open(OPERATION, swapped.toString('base64url'))).toEqual({ kind: 'tampered' });
  });

  it('EVM-096 AC3 a cursor of the panel does not open here and a cursor of the sync does not open in the panel', () => {
    const clock = new FixedClock(NOW);
    const keys = ring('k1');
    const panelKey = keys[0]?.key ?? randomBytes(32);
    const panel = new CursorCodec(panelKey, clock);
    const sync = new KeyRingCursorCodec(keys, clock);
    const panelToken = panel.seal(OPERATION, { position: ['x'], scope: 's', userId: 'u' });
    expect(['malformed', 'tampered', 'unknown_key']).toContain(sync.open(OPERATION, panelToken).kind);
    expect(panel.open(OPERATION, sync.seal(OPERATION, { a: 1 }), { scope: 's', userId: 'u' })).toBeUndefined();
  });

  it('EVM-096 AC3 a cursor expires after 90 days; garbage, a too long and an empty token are malformed', () => {
    const clock = new FixedClock(NOW);
    const codec = new KeyRingCursorCodec(ring('k1'), clock);
    const token = codec.seal(OPERATION, { a: 1 });
    clock.advance(SYNC_CURSOR_TTL_MS - 60_000);
    expect(codec.open(OPERATION, token).kind).toBe('ok');
    clock.advance(120_000);
    expect(codec.open(OPERATION, token)).toEqual({ kind: 'expired' });
    for (const garbage of ['', 'a'.repeat(2000), '!!not-base64url!!', 'AAAA', Buffer.alloc(64).toString('base64url')]) {
      expect(codec.open(OPERATION, garbage).kind, garbage.slice(0, 8)).toBe('malformed');
    }
  });

  it('EVM-096 AC3 an empty ring is refused at construction', () => {
    expect(() => new KeyRingCursorCodec([], new FixedClock(NOW))).toThrow(RangeError);
  });
});
