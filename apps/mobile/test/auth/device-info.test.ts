import { systemClock } from '../../src/auth/clock';
import { FALLBACK_DEVICE, normalizeDeviceInfo, readDeviceInfo } from '../../src/device/device-info';
import { zMobileDeviceInfo } from '@evia/contracts/zod';

describe('description of the phone (EVM-100 AC1; contract MobileDeviceInfo)', () => {
  it('EVM-100 AC1: the values of Android are passed as they are when they fit the contract', async () => {
    const native = { deviceInfo: () => ({ model: 'Pixel 8', osVersion: '15', securityPatch: '2026-09-05' }) };
    expect(await readDeviceInfo(native)).toEqual({ model: 'Pixel 8', osVersion: '15', securityPatch: '2026-09-05' });
  });

  it('EVM-100 AC1 (architect 8): unusual vendor values are normalised to the patterns of the contract, never rejected', () => {
    const cases: unknown[] = [
      { model: 'SM-S918B™ «Ultra»', osVersion: '14 QPR2', securityPatch: '2026-9-5' },
      { model: '', osVersion: '', securityPatch: '' },
      { model: 'x'.repeat(300), osVersion: '8.1.0', securityPatch: '2025-12-01' },
      { model: 42 },
      null,
      'text',
    ];
    for (const raw of cases) {
      const info = normalizeDeviceInfo(raw);
      expect(zMobileDeviceInfo.safeParse(info).success).toBe(true);
    }
    expect(normalizeDeviceInfo(cases[0])).toEqual({
      model: 'SM-S918B Ultra',
      osVersion: '14',
      securityPatch: FALLBACK_DEVICE.securityPatch,
    });
    expect(normalizeDeviceInfo(cases[1])).toEqual(FALLBACK_DEVICE);
    expect(normalizeDeviceInfo(cases[2]).osVersion).toBe('8.1.0');
  });

  it('EVM-100 AC1: without the native module (or when it throws) the fallback is sent', async () => {
    expect(await readDeviceInfo(null)).toEqual(FALLBACK_DEVICE);
    expect(
      await readDeviceInfo({
        deviceInfo: () => {
          throw new Error('synthetic');
        },
      }),
    ).toEqual(FALLBACK_DEVICE);
    expect(zMobileDeviceInfo.safeParse(await readDeviceInfo()).success).toBe(true);
  });

  it('EVM-100 AC5: the system clock gives the wall time, a monotonic reading and a stable id of the process', () => {
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(1000);
    expect(systemClock.monotonicNow()).toBeGreaterThanOrEqual(0);
    expect(systemClock.bootId()).toBe(systemClock.bootId());
  });
});
