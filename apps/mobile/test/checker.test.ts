import { readRuntimeConfig } from '../src/config';
import { createStartupChecker } from '../src/startup';

jest.mock('../src/config', () => ({ readRuntimeConfig: jest.fn() }));

const config = { apiBaseUrl: 'https://api.example.test', platform: 'android', appVersion: '0.1.0', buildVariant: 'release' } as const;
const health = (android: string) =>
  new Response(JSON.stringify({ status: 'ok', minSupportedAppVersion: { android, ios: '1.0.0' } }), {
    headers: { 'Content-Type': 'application/json' },
  });

describe('the real startup check (EVM-009 AC2, AC3)', () => {
  let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.mocked(readRuntimeConfig).mockReturnValue(config);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    warn.mockRestore();
  });

  it('EVM-009 AC2: a healthy API with a supported version gives the online state, and the headers carry platform and version', async () => {
    fetchSpy.mockResolvedValue(health('0.1.0'));
    expect(await createStartupChecker()()).toEqual({ kind: 'online' });
    const request = fetchSpy.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('https://api.example.test/api/health');
    expect(request.headers.get('X-Client-Platform')).toBe('android');
    expect(request.headers.get('X-Client-Version')).toBe('0.1.0');
  });

  it('EVM-009 AC3: a minimum version above the app version gives the update state', async () => {
    fetchSpy.mockResolvedValue(health('0.2.0'));
    expect(await createStartupChecker()()).toEqual({ kind: 'updateRequired', currentVersion: '0.1.0', requiredVersion: '0.2.0' });
  });

  it('EVM-009 AC2: a failing network gives the offline state', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Network request failed'));
    expect(await createStartupChecker()()).toEqual({ kind: 'offline' });
  });

  it('EVM-009 AC6: a missing or forbidden API address gives "server unavailable" without calling the network', async () => {
    jest.mocked(readRuntimeConfig).mockReturnValue(null);
    expect(await createStartupChecker()()).toEqual({ kind: 'serverUnavailable', problem: 'invalid' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[evia] api-config-invalid');
  });
});
