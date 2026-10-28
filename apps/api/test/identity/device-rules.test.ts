import { describe, expect, it, vi } from 'vitest';
import { atLeast, readClientVersion } from '../../src/modules/identity/domain/client-version.ts';
import { PREVIOUS_SECRET_VALID_MS } from '../../src/modules/identity/domain/constants.ts';
import { equalHashes, issueSecret, matchSecret, type SecretState } from '../../src/modules/identity/domain/device-rules.ts';
import { isRefreshToken, newAccessToken, newRefreshToken, parseBearer } from '../../src/modules/identity/domain/mobile-tokens.ts';
import { hashToken } from '../../src/modules/identity/domain/tokens.ts';
import { clientConfig } from '../../src/modules/identity/domain/client-config.ts';

const now = new Date('2026-10-28T08:00:00Z');
const hash = (value: string): Buffer => hashToken(value);

const state = (overrides: Partial<SecretState> = {}): SecretState => ({
  current: hash('current'),
  proven: true,
  previous: null,
  previousValidUntil: null,
  ...overrides,
});

describe('the installation secret: two comparisons in constant time, whatever the device (EVM-094 AC2; CWE-208)', () => {
  it('EVM-094 AC2 the newest secret matches as current, the previous one as previous while it is valid, and nothing else matches', () => {
    const device = state({ proven: false, previous: hash('previous'), previousValidUntil: new Date(now.getTime() + 1000) });
    expect(matchSecret(device, hash('current'), now)).toBe('current');
    expect(matchSecret(device, hash('previous'), now)).toBe('previous');
    expect(matchSecret(device, hash('other'), now)).toBeUndefined();
  });

  it('EVM-094 AC2 the previous secret stops at its time (7 days at the longest) and never matches when there is none', () => {
    const expired = state({ previous: hash('previous'), previousValidUntil: now });
    expect(matchSecret(expired, hash('previous'), now)).toBeUndefined();
    expect(matchSecret(state(), hash('previous'), now)).toBeUndefined();
  });

  it('EVM-094 AC2 an UNKNOWN device runs the same two comparisons against decoys, as a known one does (no branch tells the identifier exists)', () => {
    const compare = vi.fn(() => false);
    expect(matchSecret(undefined, hash('anything'), now, compare)).toBeUndefined();
    expect(compare).toHaveBeenCalledTimes(2);
    compare.mockClear();
    expect(matchSecret(state(), hash('anything'), now, compare)).toBeUndefined();
    expect(compare).toHaveBeenCalledTimes(2);
    for (const [, right] of compare.mock.calls as unknown as Array<[Buffer, Buffer]>) expect(right).toHaveLength(32);
  });

  it('EVM-094 AC2 the comparator is the constant-time one over equal-length hashes', () => {
    expect(equalHashes(hash('a'), hash('a'))).toBe(true);
    expect(equalHashes(hash('a'), hash('b'))).toBe(false);
    expect(equalHashes(Buffer.alloc(3), Buffer.alloc(4))).toBe(false);
  });
});

describe('the two-phase rotation of the secret (EVM-094 AC2)', () => {
  const issued = hash('issued');

  it('EVM-094 AC2 a new device has one unproven secret and no previous one', () => {
    expect(issueSecret(undefined, undefined, issued, now)).toEqual({
      current: issued,
      proven: false,
      previous: null,
      previousValidUntil: null,
    });
  });

  it('EVM-094 AC2 presenting the newest secret proves it: it becomes the previous one for 7 days at the longest', () => {
    const next = issueSecret(state(), 'current', issued, now);
    expect(next).toEqual({
      current: issued,
      proven: false,
      previous: hash('current'),
      previousValidUntil: new Date(now.getTime() + PREVIOUS_SECRET_VALID_MS),
    });
    expect(PREVIOUS_SECRET_VALID_MS).toBe(7 * 24 * 3_600_000);
  });

  it('EVM-094 AC2 presenting the previous secret (the answer was lost) keeps it unextended and drops the unproven newest: never more than two valid', () => {
    const until = new Date(now.getTime() + 1000);
    const lost = state({ current: hash('lost'), proven: false, previous: hash('previous'), previousValidUntil: until });
    const next = issueSecret(lost, 'previous', issued, now);
    expect(next).toEqual({ current: issued, proven: false, previous: hash('previous'), previousValidUntil: until });
    expect([next.current, next.previous].filter((value) => value !== null)).toHaveLength(2);
  });
});

describe('the version of the app (EVM-094 AC6; SR-API-08)', () => {
  it('EVM-094 AC6 the platform must be android or ios and the version MAJOR.MINOR.PATCH; anything else is not a version', () => {
    expect(readClientVersion('android', '1.2.0')).toEqual({ platform: 'android', version: '1.2.0' });
    expect(readClientVersion('ios', '10.0.1')).toEqual({ platform: 'ios', version: '10.0.1' });
    for (const [platform, version] of [
      [undefined, '1.2.0'],
      ['android', undefined],
      ['windows', '1.2.0'],
      ['android', '1.2'],
      ['android', 'v1.2.0'],
      ['android', '1.2.0-beta'],
      ['android', '01.2.0'],
    ] as const) {
      expect(readClientVersion(platform, version), `${platform} ${version}`).toBeUndefined();
    }
  });

  it('EVM-094 AC6 versions are compared by number, not by text', () => {
    expect(atLeast('1.2.0', '1.2.0')).toBe(true);
    expect(atLeast('1.10.0', '1.9.9')).toBe(true);
    expect(atLeast('2.0.0', '1.99.99')).toBe(true);
    expect(atLeast('1.1.9', '1.2.0')).toBe(false);
    expect(atLeast('0.9.0', '1.0.0')).toBe(false);
    expect(atLeast('garbage', '1.0.0')).toBe(false);
  });
});

describe('the opaque tokens of the phone (EVM-094 AC4; SR-CRYPTO-01, ASVS V7.2.1)', () => {
  it('EVM-094 AC4 a token is a prefix and 256 bits of base64url, different every time', () => {
    const [access, refresh] = [newAccessToken(), newRefreshToken()];
    expect(access).toMatch(/^evia_at_[A-Za-z0-9_-]{43}$/);
    expect(refresh).toMatch(/^evia_rt_[A-Za-z0-9_-]{43}$/);
    expect(newAccessToken()).not.toBe(access);
    expect(isRefreshToken(refresh)).toBe(true);
    expect(isRefreshToken(access)).toBe(false);
  });

  it('EVM-094 AC4 the header is parsed strictly: one space, the scheme exactly Bearer, the whole shape of a token — anything else is refused before the database', () => {
    const token = newAccessToken();
    expect(parseBearer(`Bearer ${token}`)).toBe(token);
    for (const header of [
      undefined,
      '',
      token,
      `bearer ${token}`,
      `Bearer  ${token}`,
      `Bearer ${token} `,
      `Bearer ${token}x`,
      `Bearer ${newRefreshToken()}`,
      `Basic ${token}`,
      `Bearer ${token}, Bearer ${token}`,
    ]) {
      expect(parseBearer(header), String(header)).toBeUndefined();
    }
  });
});

describe('the configuration of the client (EVM-094)', () => {
  it('EVM-094 AC6 carries the minimum version of the API settings and no personal data', () => {
    const config = clientConfig({ android: '1.2.0', ios: '1.1.0' });
    expect(config).toMatchObject({ minSupportedVersion: { android: '1.2.0', ios: '1.1.0' }, scopeRuleVersion: 1 });
    expect(JSON.stringify(config)).not.toMatch(/@|token|secret/i);
  });
});
