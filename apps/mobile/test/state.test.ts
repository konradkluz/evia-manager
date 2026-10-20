import { deriveStartupState } from '../src/startup/state';
import type { HealthResult } from '../src/api/health';

const ok = (android: string, ios = '1.0.0'): HealthResult => ({ kind: 'ok', minSupportedAppVersion: { android, ios } });
const android = { platform: 'android', appVersion: '0.1.0' } as const;

describe('startup state from the health answer (EVM-009 AC2, AC3)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('EVM-009 AC2: no answer at all means offline — the app keeps working locally', () => {
    expect(deriveStartupState({ kind: 'network' }, android)).toEqual({ kind: 'offline' });
  });

  it.each(['timeout', 'server', 'invalid'] as const)('EVM-009 AC2: the problem "%s" means the server is unavailable', (kind) => {
    expect(deriveStartupState({ kind }, android)).toEqual({ kind: 'serverUnavailable', problem: kind });
  });

  it('EVM-009 AC3: a minimum version above the app version requires an update', () => {
    expect(deriveStartupState(ok('0.2.0'), android)).toEqual({ kind: 'updateRequired', currentVersion: '0.1.0', requiredVersion: '0.2.0' });
  });

  it.each(['0.1.0', '0.0.9', '0.1.0-beta.1'])('EVM-009 AC3: the minimum version %s does not block version 0.1.0', (minimum) => {
    expect(deriveStartupState(ok(minimum), android)).toEqual({ kind: 'online' });
  });

  it('EVM-009 AC3: the platform decides which minimum applies', () => {
    expect(deriveStartupState(ok('0.1.0', '9.0.0'), { platform: 'android', appVersion: '0.1.0' })).toEqual({ kind: 'online' });
    expect(deriveStartupState(ok('0.1.0', '9.0.0'), { platform: 'ios', appVersion: '0.1.0' })).toMatchObject({ kind: 'updateRequired' });
  });

  it('EVM-009 AC3: an invalid minimum version from the server does not block and leaves only a fixed warning without the value', () => {
    expect(deriveStartupState(ok('latest'), android)).toEqual({ kind: 'online' });
    expect(warn).toHaveBeenCalledWith('[evia] min-version-invalid');
  });

  it('EVM-009 AC3: a missing minimum for the platform does not block', () => {
    expect(deriveStartupState({ kind: 'ok', minSupportedAppVersion: { ios: '1.0.0' } }, android)).toEqual({ kind: 'online' });
    expect(warn).toHaveBeenCalledWith('[evia] min-version-invalid');
  });

  it('EVM-009 AC3: an invalid version of the app does not block and leaves only a fixed warning without the value', () => {
    expect(deriveStartupState(ok('1.0.0'), { platform: 'android', appVersion: 'unknown' })).toEqual({ kind: 'online' });
    expect(warn).toHaveBeenCalledWith('[evia] app-version-invalid');
  });
});
