import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/platform/config/config.ts';
import { validEnv } from '../support/app.ts';

/** A key that looks random (production refuses the placeholders of development and tests). Generated per run, never committed. */
const randomKey = (): string => randomBytes(32).toString('base64url');

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
      cursorKey: Buffer.alloc(32, 7),
    });
    expect(
      loadConfig({ ...validEnv({ CURSOR_KEY: randomKey() }), NODE_ENV: undefined, API_PORT: '8080', LOG_LEVEL: 'warn' }),
    ).toMatchObject({
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
      expect(errorOf({ ...validEnv({ CURSOR_KEY: randomKey() }), NODE_ENV: 'production', LOG_LEVEL: level }).keys, level).toEqual([
        'LOG_LEVEL',
      ]);
      expect(errorOf({ ...validEnv(), NODE_ENV: 'test', LOG_LEVEL: level }).keys, level).toEqual(['LOG_LEVEL']);
      expect(loadConfig({ ...validEnv(), NODE_ENV: 'development', LOG_LEVEL: level }).logLevel).toBe(level);
    }
  });

  it('EVM-016 AC4 the panel origin is a bare origin: https or http, no path, query, fragment or credentials', () => {
    for (const value of [
      undefined,
      '',
      'panel.evia.test',
      'ftp://panel.evia.test',
      'https://panel.evia.test/',
      'https://panel.evia.test/x',
      'https://u:p@panel.evia.test',
      'https://panel.evia.test?x=1',
    ]) {
      expect(errorOf({ ...validEnv(), PANEL_ORIGIN: value }).keys, String(value)).toContain('PANEL_ORIGIN');
    }
    expect(loadConfig({ ...validEnv(), PANEL_ORIGIN: 'https://panel.evia.test:8443' }).panelOrigin).toBe('https://panel.evia.test:8443');
  });

  it('EVM-016 AC4 the relying party id is a domain that is the host of the panel or a parent of it, never taken from a request', () => {
    expect(loadConfig({ ...validEnv(), WEBAUTHN_RP_ID: 'evia.test' }).webauthn.rpId).toBe('evia.test');
    for (const value of [undefined, '', 'other.test', 'anel.evia.test', 'https://panel.evia.test', 'Panel.Evia.Test', 'a_b.test']) {
      expect(errorOf({ ...validEnv(), WEBAUTHN_RP_ID: value }).keys, String(value)).toEqual(['WEBAUTHN_RP_ID']);
    }
    expect(loadConfig({ ...validEnv(), WEBAUTHN_RP_NAME: ' Panel EVia ' }).webauthn.rpName).toBe('Panel EVia');
    expect(errorOf({ ...validEnv(), WEBAUTHN_RP_NAME: 'x'.repeat(65) }).keys).toEqual(['WEBAUTHN_RP_NAME']);
  });

  it('EVM-016 AC6 production accepts only an https panel that is not localhost: there is no switch for Secure or __Host-', () => {
    const production = { ...validEnv({ CURSOR_KEY: randomKey() }), NODE_ENV: 'production' };
    expect(loadConfig(production).nodeEnv).toBe('production');
    expect(errorOf({ ...production, PANEL_ORIGIN: 'http://panel.evia.test' }).keys).toEqual(['PANEL_ORIGIN']);
    expect(errorOf({ ...production, PANEL_ORIGIN: 'https://localhost:5173', WEBAUTHN_RP_ID: 'localhost' }).keys).toEqual(['PANEL_ORIGIN']);
    expect(errorOf({ ...production, PANEL_ORIGIN: 'https://panel.localhost', WEBAUTHN_RP_ID: 'panel.localhost' }).keys).toEqual([
      'PANEL_ORIGIN',
    ]);
    const development = { ...validEnv(), NODE_ENV: 'development', PANEL_ORIGIN: 'http://localhost:5173', WEBAUTHN_RP_ID: 'localhost' };
    expect(loadConfig(development).panelOrigin).toBe('http://localhost:5173');
  });

  it('EVM-016 AC5 trusted proxies default to none and accept addresses and CIDR ranges only (SR-API-02, CWE-348)', () => {
    expect(loadConfig(validEnv()).trustedProxies).toEqual([]);
    expect(loadConfig({ ...validEnv(), TRUSTED_PROXIES: ' 10.0.0.0/8 , 172.16.0.5,fd00::/8 ' }).trustedProxies).toEqual([
      '10.0.0.0/8',
      '172.16.0.5',
      'fd00::/8',
    ]);
    for (const value of ['loopback', 'proxy.evia.test', '10.0.0.1;rm', '*']) {
      expect(errorOf({ ...validEnv(), TRUSTED_PROXIES: value }).keys, value).toEqual(['TRUSTED_PROXIES']);
    }
  });

  it('EVM-017 AC3 the cursor key is exactly 32 bytes of base64url (43 characters); the error names the key, never the value (SR-LOG-02)', () => {
    const key = randomKey();
    expect(loadConfig(validEnv({ CURSOR_KEY: key })).cursorKey.equals(Buffer.from(key, 'base64url'))).toBe(true);
    const invalid = [
      undefined,
      '',
      'short',
      randomBytes(31).toString('base64url'),
      randomBytes(33).toString('base64url'),
      `${key}=`,
      `${key.slice(0, 42)}+`,
    ];
    for (const value of invalid) {
      const error = errorOf(validEnv({ CURSOR_KEY: value }));
      expect(error.keys, String(value)).toEqual(['CURSOR_KEY']);
      if (value !== undefined && value !== '') expect(JSON.stringify({ message: error.message, keys: error.keys })).not.toContain(value);
    }
  });

  it('EVM-017 AC3 the key is required in every environment, and production refuses a placeholder (all zeros, a repeated byte) but takes a random key', () => {
    for (const nodeEnv of ['development', 'test', 'production'])
      expect(errorOf({ ...validEnv(), NODE_ENV: nodeEnv, CURSOR_KEY: undefined }).keys, nodeEnv).toEqual(['CURSOR_KEY']);
    for (const placeholder of [Buffer.alloc(32), Buffer.alloc(32, 7), Buffer.from('abcdefgh'.repeat(4))]) {
      const env = validEnv({ CURSOR_KEY: placeholder.toString('base64url') });
      expect(errorOf({ ...env, NODE_ENV: 'production' }).keys).toEqual(['CURSOR_KEY']);
      expect(loadConfig({ ...env, NODE_ENV: 'development' }).nodeEnv).toBe('development');
    }
    expect(loadConfig({ ...validEnv({ CURSOR_KEY: randomKey() }), NODE_ENV: 'production' }).nodeEnv).toBe('production');
  });
});
