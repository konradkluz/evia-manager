import { readRuntimeConfig } from '../src/config';

const mockApplication = { nativeApplicationVersion: '0.3.0' as string | null };
const mockConstants: { expoConfig: { version?: string; extra?: Record<string, unknown> } | null } = {
  expoConfig: { version: '0.1.0', extra: {} },
};
const mockPlatform = { OS: 'android' };

jest.mock('expo-application', () => ({
  get nativeApplicationVersion() {
    return mockApplication.nativeApplicationVersion;
  },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockConstants.expoConfig;
    },
  },
}));
jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatform.OS;
    },
  },
}));

describe('runtime configuration (EVM-009 AC2, AC3, AC6)', () => {
  beforeEach(() => {
    mockApplication.nativeApplicationVersion = '0.3.0';
    mockConstants.expoConfig = { version: '0.1.0', extra: {} };
    mockPlatform.OS = 'android';
  });

  it('EVM-009 AC3: the installed native version is the version of the app', () => {
    expect(readRuntimeConfig('https://api.example.test')).toEqual({
      apiBaseUrl: 'https://api.example.test',
      platform: 'android',
      appVersion: '0.3.0',
      buildVariant: 'release',
    });
  });

  it('EVM-009 AC3: without a native version the version of app.config.ts is used, and without both the check cannot block', () => {
    mockApplication.nativeApplicationVersion = null;
    expect(readRuntimeConfig('https://api.example.test')?.appVersion).toBe('0.1.0');
    mockConstants.expoConfig = null;
    expect(readRuntimeConfig('https://api.example.test')?.appVersion).toBe('unknown');
  });

  it('EVM-009 AC3: the platform comes from the system (ios or android)', () => {
    mockPlatform.OS = 'ios';
    expect(readRuntimeConfig('https://api.example.test')?.platform).toBe('ios');
  });

  it('EVM-009 AC6: a plain HTTP address is rejected in a release build and accepted for the emulator in the e2e variant', () => {
    expect(readRuntimeConfig('http://10.0.2.2:3000')).toBeNull();
    mockConstants.expoConfig = { extra: { buildVariant: 'e2e' } };
    expect(readRuntimeConfig('http://10.0.2.2:3000')?.apiBaseUrl).toBe('http://10.0.2.2:3000');
    expect(readRuntimeConfig('http://api.example.test')).toBeNull();
  });

  it('EVM-009 AC6: a missing address gives no configuration (the app reports the server as unavailable)', () => {
    expect(readRuntimeConfig(undefined)).toBeNull();
  });
});
