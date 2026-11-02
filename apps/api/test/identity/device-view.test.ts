import { describe, expect, it } from 'vitest';
import { modelConfirmed, patchLevel, viewState } from '../../src/modules/identity/domain/device-view.ts';
import { devicePositionParts, parseDevicePosition, resolveDeviceListQuery } from '../../src/modules/identity/domain/device-list-query.ts';

const NOW = new Date('2026-11-02T08:00:00.000Z');
const DAY = 86_400_000;

describe('the state of a device as the panel shows it (EVM-095 AC1, AC2)', () => {
  it('EVM-095 AC2 an active device with a valid session is Active, without one Signed out; the other states are shown as they are', () => {
    expect(viewState('active', true)).toBe('active');
    expect(viewState('active', false)).toBe('signed_out');
    expect(viewState('wipe_required', true)).toBe('wipe_required');
    expect(viewState('wipe_required', false)).toBe('wipe_required');
    expect(viewState('wiped', false)).toBe('wiped');
  });
});

describe('the level of the security patches (EVM-095 AC2)', () => {
  const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
  it('EVM-095 AC2 up to 183 days is current, up to a year older_6m, beyond older_12m', () => {
    expect(patchLevel(ago(0), NOW)).toBe('current');
    expect(patchLevel(ago(183), NOW)).toBe('current');
    expect(patchLevel(ago(184), NOW)).toBe('older_6m');
    expect(patchLevel(ago(365), NOW)).toBe('older_6m');
    expect(patchLevel(ago(366), NOW)).toBe('older_12m');
  });

  it('EVM-095 AC2 a placeholder, an invalid or a future date is unknown', () => {
    expect(patchLevel(new Date(0), NOW)).toBe('unknown');
    expect(patchLevel(new Date('invalid'), NOW)).toBe('unknown');
    expect(patchLevel(new Date(NOW.getTime() + 3 * DAY), NOW)).toBe('unknown');
  });
});

describe('the confirmation of the model (EVM-095 AC4)', () => {
  it('EVM-095 AC4 trim and NFC are forgiven; the case and any other difference are not', () => {
    expect(modelConfirmed('Pixel 8', 'Pixel 8')).toBe(true);
    expect(modelConfirmed('  Pixel 8\n', 'Pixel 8')).toBe(true);
    expect(modelConfirmed('Zażółć'.normalize('NFD'), 'Zażółć'.normalize('NFC'))).toBe(true);
    expect(modelConfirmed('pixel 8', 'Pixel 8')).toBe(false);
    expect(modelConfirmed('Pixel  8', 'Pixel 8')).toBe(false);
    expect(modelConfirmed('', 'Pixel 8')).toBe(false);
  });
});

describe('the query of the list of devices (EVM-095 AC2; SR-API-02)', () => {
  it('EVM-095 AC2 the defaults, the limit 1..100, the closed list of states and strict keys', () => {
    expect(resolveDeviceListQuery.parse({})).toEqual({ userId: undefined, state: undefined, limit: 50, cursor: undefined });
    expect(resolveDeviceListQuery.parse({ limit: '100', state: 'wiped' })).toMatchObject({ limit: 100, state: 'wiped' });
    for (const bad of [
      { limit: '0' },
      { limit: '101' },
      { limit: '1.5' },
      { state: 'lost' },
      { userId: 'x' },
      { cursor: '***' },
      { extra: '1' },
    ]) {
      expect(resolveDeviceListQuery.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('EVM-095 AC2 the position of a cursor survives the round trip; anything else is refused', () => {
    const position = { lastContactAt: NOW, id: '0193a000-0000-7000-8000-0000000000d1' };
    expect(parseDevicePosition(devicePositionParts(position))).toEqual(position);
    expect(parseDevicePosition(['not a date', position.id])).toBeUndefined();
    expect(parseDevicePosition([NOW.toISOString(), 'x'])).toBeUndefined();
    expect(parseDevicePosition([NOW.toISOString()])).toBeUndefined();
  });
});
