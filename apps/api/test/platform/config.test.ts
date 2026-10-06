import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/platform/config/config.ts';
import { validEnv } from '../support/app.ts';

const errorOf = (env: Record<string, string | undefined>): ConfigError => {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError');
};

describe('configuration from the environment (EVM-008 AC1; ADR-0002, SR-LOG-02)', () => {
  it('EVM-008 AC1 config reads the minimum supported app versions, the database URL and defaults', () => {
    expect(loadConfig(validEnv())).toEqual({
      nodeEnv: 'test',
      port: 3000,
      logLevel: 'info',
      databaseUrl: validEnv()['DATABASE_URL'],
      minSupportedAppVersion: { android: '1.2.0', ios: '1.1.0' },
      panelOrigin: 'https://panel.evia.test',
      webauthn: { rpId: 'panel.evia.test', rpName: 'EVia Manager' },
      trustedProxies: [],
    });
    expect(loadConfig({ ...validEnv(), NODE_ENV: undefined, API_PORT: '8080', LOG_LEVEL: 'warn' })).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      logLevel: 'warn',
    });
  });

  it('EVM-008 AC1 config rejects missing or invalid minimum app versions (contract Semver)', () => {
    for (const value of [undefined, '', '1.2', 'v1.2.3', '1.2.3-beta', '1.2.3\n']) {
      expect(errorOf({ ...validEnv(), MIN_SUPPORTED_APP_VERSION_IOS: value }).keys, String(value)).toEqual([
        'MIN_SUPPORTED_APP_VERSION_IOS',
      ]);
    }
    expect(errorOf({ ...validEnv(), MIN_SUPPORTED_APP_VERSION_ANDROID: undefined }).keys).toEqual(['MIN_SUPPORTED_APP_VERSION_ANDROID']);
  });

  it('EVM-008 AC1 config error names the keys only, never the values (the database URL holds a password)', () => {
    const invalidPort = 'postgres://evia:synthetic-SECRET-pass@db.invalid:port/evia';
    const error = errorOf({ ...validEnv(), DATABASE_URL: invalidPort, API_PORT: 'eighty', LOG_LEVEL: 'loud' });
    expect(error.keys).toEqual(['API_PORT', 'DATABASE_URL', 'LOG_LEVEL']);
    expect(error.message).toBe('Invalid environment configuration: API_PORT, DATABASE_URL, LOG_LEVEL');
    expect(JSON.stringify({ message: error.message, stack: error.stack, keys: error.keys })).not.toMatch(/SECRET|eighty|loud/);
  });

  it('EVM-008 AC1 database URL must be a postgres URL', () => {
    for (const value of [undefined, 'not a url', 'mysql://u:p@h/db', 'http://h/db'])
      expect(errorOf({ ...validEnv(), DATABASE_URL: value }).keys, String(value)).toEqual(['DATABASE_URL']);
    expect(loadConfig({ ...validEnv(), DATABASE_URL: 'postgresql://u:p@h:5432/db' }).databaseUrl).toBe('postgresql://u:p@h:5432/db');
  });

  it('EVM-008 AC1 port is a TCP port number and NODE_ENV one of the known environments', () => {
    for (const value of ['0', '65536', '3.5', '-1']) expect(errorOf({ ...validEnv(), API_PORT: value }).keys, value).toEqual(['API_PORT']);
    expect(errorOf({ ...validEnv(), NODE_ENV: 'staging' }).keys).toEqual(['NODE_ENV']);
  });

  it('EVM-008 AC1 debug and trace log levels are rejected outside development (SR-LOG-02)', () => {
    for (const level of ['debug', 'trace']) {
      expect(errorOf({ ...validEnv(), NODE_ENV: 'production', LOG_LEVEL: level }).keys, level).toEqual(['LOG_LEVEL']);
      expect(errorOf({ ...validEnv(), NODE_ENV: 'test', LOG_LEVEL: level }).keys, level).toEqual(['LOG_LEVEL']);
      expect(loadConfig({ ...validEnv(), NODE_ENV: 'development', LOG_LEVEL: level }).logLevel).toBe(level);
    }
  });
});
