import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, loadMigrationConfig } from '../../src/platform/config/config.ts';
import { TEST_FIELD_ENCRYPTION_KEY, TEST_FIELD_ENCRYPTION_KEYS, TEST_LOGIN_THROTTLE_KEY, validEnv } from '../support/app.ts';

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

describe('configuration of the synchronisation of the phones (EVM-096; ADR-0021 D6)', () => {
  it('EVM-096 AC3 without a ring the cursor key is ONE key derived from the cursor key of the panel - never equal to it; a ring given is kept in order', () => {
    const derived = loadConfig(validEnv()).sync.cursorKeys;
    expect(derived).toHaveLength(1);
    expect(derived[0]?.key).toHaveLength(32);
    expect(derived[0]?.key.equals(Buffer.alloc(32, 7))).toBe(false);
    const [first, second] = [randomKey(), randomKey()];
    expect(loadConfig(validEnv({ SYNC_CURSOR_KEYS: `k2:${first}, k1:${second}` })).sync.cursorKeys.map((key) => key.id)).toEqual([
      'k2',
      'k1',
    ]);
  });

  it('EVM-096 AC3 a ring with a malformed entry, a repeated id, the key of the panel cursors or an encryption key stops the start and names only the variable; production refuses a placeholder', () => {
    const key = randomKey();
    const panelKey = Buffer.alloc(32, 7).toString('base64url');
    for (const value of ['k1', 'k1:short', `k1:${key},k1:${randomKey()}`, `k1:${panelKey}`, `k1:${TEST_FIELD_ENCRYPTION_KEY}`]) {
      expect(errorOf(validEnv({ SYNC_CURSOR_KEYS: value })).keys, value).toEqual(['SYNC_CURSOR_KEYS']);
    }
    const placeholder = Buffer.alloc(32, 9).toString('base64url');
    expect(
      errorOf({ ...validEnv({ CURSOR_KEY: randomKey(), SYNC_CURSOR_KEYS: `k1:${placeholder}` }), NODE_ENV: 'production' }).keys,
    ).toEqual(['SYNC_CURSOR_KEYS']);
  });

  it('EVM-096 AC2 AC7 AC8 the scope, the periodic resync, the limit of full downloads and the budget of a page are settings of the server with bounds', () => {
    expect(
      loadConfig(
        validEnv({
          SYNC_CLOSED_ORDERS_IN_SCOPE_DAYS: '14',
          SYNC_PERIODIC_RESYNC_DAYS: '3',
          SYNC_SCOPE_RULE_VERSION: '4',
          SYNC_FULL_DOWNLOADS_PER_DAY: '5',
          SYNC_PAGE_MAX_BYTES: '500000',
        }),
      ).sync,
    ).toMatchObject({
      closedOrdersInScopeDays: 14,
      periodicResyncDays: 3,
      scopeRuleVersion: 4,
      fullDownloadsPerDay: 5,
      pageMaxBytes: 500_000,
    });
    for (const [name, value] of [
      ['SYNC_CLOSED_ORDERS_IN_SCOPE_DAYS', '0'],
      ['SYNC_PERIODIC_RESYNC_DAYS', '1000'],
      ['SYNC_FULL_DOWNLOADS_PER_DAY', 'many'],
      ['SYNC_PAGE_MAX_BYTES', '2000000'],
    ] as const) {
      expect(errorOf(validEnv({ [name]: value })).keys, name).toEqual([name]);
    }
  });
});

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
      fieldEncryptionKeys: [{ id: 'test', key: Buffer.from(TEST_FIELD_ENCRYPTION_KEY, 'base64url') }],
      release: { commit: null, manifestSha256: null },
      loginThrottleKey: Buffer.from(TEST_LOGIN_THROTTLE_KEY, 'base64url'),
      loginAlerts: { passwordFailures: 30, secondStepFailures: 3 },
      deletionRegister: { status: 'unconfigured' },
      sync: {
        cursorKeys: [{ id: 'derived', key: expect.any(Buffer) as Buffer }],
        closedOrdersInScopeDays: 30,
        periodicResyncDays: 7,
        scopeRuleVersion: 1,
        fullDownloadsPerDay: 3,
        pageMaxBytes: 900_000,
      },
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

  it('EVM-023 AC1 the keys of the encrypted fields are required in production only; elsewhere an absent or empty list means none (fail closed at use)', () => {
    for (const value of [undefined, '']) {
      expect(loadConfig({ ...validEnv({ FIELD_ENCRYPTION_KEYS: value }), NODE_ENV: 'development' }).fieldEncryptionKeys).toEqual([]);
      expect(loadConfig({ ...validEnv({ FIELD_ENCRYPTION_KEYS: value }), NODE_ENV: 'test' }).fieldEncryptionKeys).toEqual([]);
      expect(errorOf({ ...validEnv({ CURSOR_KEY: randomKey(), FIELD_ENCRYPTION_KEYS: value }), NODE_ENV: 'production' }).keys).toEqual([
        'FIELD_ENCRYPTION_KEYS',
      ]);
    }
  });

  it('EVM-023 AC1 a malformed list stops the start in every environment and the error names the key, never the value (SR-LOG-02)', () => {
    const good = randomKey();
    for (const nodeEnv of ['development', 'test', 'production'])
      for (const value of ['k1', `k1:${good.slice(1)}`, `K1:${good}`, `k1:${good},k1:${randomKey()}`, `k1:${good}=`]) {
        const error = errorOf({ ...validEnv({ CURSOR_KEY: randomKey(), FIELD_ENCRYPTION_KEYS: value }), NODE_ENV: nodeEnv });
        expect(error.keys, `${nodeEnv} ${value}`).toEqual(['FIELD_ENCRYPTION_KEYS']);
        expect(JSON.stringify({ message: error.message, keys: error.keys })).not.toContain(good);
      }
  });

  it('EVM-023 AC1 production refuses a placeholder key and the key of the cursors; several keys are kept in order (the first seals)', () => {
    const production = { ...validEnv({ CURSOR_KEY: randomKey() }), NODE_ENV: 'production' };
    for (const placeholder of [Buffer.alloc(32), Buffer.alloc(32, 7), Buffer.from('abcdefgh'.repeat(4))])
      expect(errorOf({ ...production, FIELD_ENCRYPTION_KEYS: `k1:${placeholder.toString('base64url')}` }).keys).toEqual([
        'FIELD_ENCRYPTION_KEYS',
      ]);
    const cursor = randomKey();
    expect(errorOf({ ...production, CURSOR_KEY: cursor, FIELD_ENCRYPTION_KEYS: `k1:${cursor}` }).keys).toEqual(['FIELD_ENCRYPTION_KEYS']);
    expect(errorOf({ ...production, CURSOR_KEY: cursor, FIELD_ENCRYPTION_KEYS: `k2:${randomKey()},k1:${cursor}` }).keys).toEqual([
      'FIELD_ENCRYPTION_KEYS',
    ]);
    const [first, second] = [randomKey(), randomKey()];
    const config = loadConfig({ ...production, FIELD_ENCRYPTION_KEYS: `k2:${first},k1:${second}` });
    expect(config.fieldEncryptionKeys.map((key) => key.id)).toEqual(['k2', 'k1']);
    expect(loadConfig({ ...production, FIELD_ENCRYPTION_KEYS: TEST_FIELD_ENCRYPTION_KEYS }).fieldEncryptionKeys).toHaveLength(1);
  });
});

describe('configuration of the protection against guessing passwords (EVM-026; SR-CRYPTO, ASVS V11)', () => {
  const production = () => ({ ...validEnv({ CURSOR_KEY: randomKey(), LOGIN_THROTTLE_KEY: randomKey() }), NODE_ENV: 'production' });

  it('EVM-026 AC1 the key of the counters is base64url of at least 32 bytes; the error names the key, never the value', () => {
    const key = randomBytes(40).toString('base64url');
    expect(loadConfig(validEnv({ LOGIN_THROTTLE_KEY: key })).loginThrottleKey.equals(Buffer.from(key, 'base64url'))).toBe(true);
    for (const value of ['short', randomBytes(31).toString('base64url'), `${randomKey()}=`, `${randomKey().slice(0, 42)}+`, '!!!']) {
      const error = errorOf(validEnv({ LOGIN_THROTTLE_KEY: value }));
      expect(error.keys, value).toEqual(['LOGIN_THROTTLE_KEY']);
      expect(JSON.stringify({ message: error.message, keys: error.keys })).not.toContain(value);
    }
  });

  it('EVM-026 AC1 outside production an absent key is a random key of the process; production requires it and refuses a placeholder', () => {
    for (const nodeEnv of ['development', 'test']) {
      for (const value of [undefined, '']) {
        const first = loadConfig({ ...validEnv({ LOGIN_THROTTLE_KEY: value }), NODE_ENV: nodeEnv }).loginThrottleKey;
        expect(first).toHaveLength(32);
        expect(first.equals(loadConfig({ ...validEnv({ LOGIN_THROTTLE_KEY: value }), NODE_ENV: nodeEnv }).loginThrottleKey)).toBe(false);
      }
    }
    for (const value of [undefined, ''])
      expect(errorOf({ ...production(), LOGIN_THROTTLE_KEY: value }).keys).toEqual(['LOGIN_THROTTLE_KEY']);
    for (const placeholder of [Buffer.alloc(32), Buffer.alloc(32, 7), Buffer.from('abcdefgh'.repeat(4))]) {
      expect(errorOf({ ...production(), LOGIN_THROTTLE_KEY: placeholder.toString('base64url') }).keys).toEqual(['LOGIN_THROTTLE_KEY']);
      expect(loadConfig({ ...production(), NODE_ENV: 'development', LOGIN_THROTTLE_KEY: placeholder.toString('base64url') }).nodeEnv).toBe(
        'development',
      );
    }
    expect(loadConfig(production()).nodeEnv).toBe('production');
  });

  it('EVM-026 AC1 the key differs from the key of the cursors and from every key of the encrypted fields (one key, one purpose)', () => {
    const shared = randomKey();
    for (const nodeEnv of ['development', 'production']) {
      const base = { ...production(), NODE_ENV: nodeEnv };
      expect(errorOf({ ...base, CURSOR_KEY: shared, LOGIN_THROTTLE_KEY: shared }).keys, nodeEnv).toEqual(['LOGIN_THROTTLE_KEY']);
      expect(
        errorOf({ ...base, FIELD_ENCRYPTION_KEYS: `k1:${randomKey()},k2:${shared}`, LOGIN_THROTTLE_KEY: shared }).keys,
        nodeEnv,
      ).toEqual(['LOGIN_THROTTLE_KEY']);
    }
  });

  it('EVM-026 AC6 the thresholds of the alerts default to more than 30 failed passwords and at least 3 failures of the second step', () => {
    expect(loadConfig(validEnv()).loginAlerts).toEqual({ passwordFailures: 30, secondStepFailures: 3 });
    expect(loadConfig(validEnv({ LOGIN_ALERT_PASSWORD_FAILURES: '50', LOGIN_ALERT_SECOND_STEP_FAILURES: '4' })).loginAlerts).toEqual({
      passwordFailures: 50,
      secondStepFailures: 4,
    });
    for (const [key, value] of [
      ['LOGIN_ALERT_PASSWORD_FAILURES', '0'],
      ['LOGIN_ALERT_PASSWORD_FAILURES', 'many'],
      ['LOGIN_ALERT_SECOND_STEP_FAILURES', '11'],
    ] as const) {
      expect(errorOf(validEnv({ [key]: value })).keys, `${key}=${value}`).toEqual([key]);
    }
  });
});

const migrationErrorOf = (env: Record<string, string | undefined>): ConfigError => {
  try {
    loadMigrationConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError');
};

describe('the key of the cursors is for the server, not for the migrations (EVM-080 AC4; SR-CRYPTO, CWE-532, CWE-798)', () => {
  it('EVM-080 AC4 the migrations need no CURSOR_KEY: missing, malformed and placeholder keys do not matter, and no other setting is read', () => {
    const migration = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@h:5432/db', LOG_LEVEL: 'warn' };
    expect(loadMigrationConfig(migration)).toEqual({ nodeEnv: 'production', logLevel: 'warn', databaseUrl: 'postgresql://u:p@h:5432/db' });
    for (const CURSOR_KEY of [undefined, '', 'short', Buffer.alloc(32).toString('base64url')])
      expect(loadMigrationConfig({ ...migration, CURSOR_KEY }).databaseUrl).toBe(migration.DATABASE_URL);
    expect(loadMigrationConfig({ DATABASE_URL: migration.DATABASE_URL })).toMatchObject({ nodeEnv: 'production', logLevel: 'info' });
  });

  it('EVM-080 AC4 the migrations keep the shared rules: the database URL is required and valid, the level is known, verbose only in development', () => {
    expect(migrationErrorOf({ NODE_ENV: 'test' }).keys).toEqual(['DATABASE_URL']);
    expect(migrationErrorOf({ DATABASE_URL: 'mysql://u:p@h/db' }).keys).toEqual(['DATABASE_URL']);
    expect(migrationErrorOf({ DATABASE_URL: validEnv().DATABASE_URL, NODE_ENV: 'staging', LOG_LEVEL: 'loud' }).keys).toEqual([
      'LOG_LEVEL',
      'NODE_ENV',
    ]);
    expect(migrationErrorOf({ DATABASE_URL: validEnv().DATABASE_URL, NODE_ENV: 'production', LOG_LEVEL: 'debug' }).keys).toEqual([
      'LOG_LEVEL',
    ]);
    expect(loadMigrationConfig({ DATABASE_URL: validEnv().DATABASE_URL, NODE_ENV: 'development', LOG_LEVEL: 'trace' }).logLevel).toBe(
      'trace',
    );
  });

  it('EVM-080 AC4 the server, the worker and the CLI keep the full configuration: a missing, malformed or placeholder key is a ConfigError naming only CURSOR_KEY, never the value', () => {
    const secrets = [Buffer.alloc(32, 9).toString('base64url'), `${randomKey()}x`, 'not-a-key-but-secret-looking'];
    const cases: [string | undefined, string][] = [
      [undefined, 'test'],
      [secrets[0], 'production'],
      [secrets[1], 'test'],
      [secrets[2], 'development'],
    ];
    for (const [value, nodeEnv] of cases) {
      const error = errorOf({ ...validEnv({ CURSOR_KEY: value }), NODE_ENV: nodeEnv });
      expect(error.keys).toEqual(['CURSOR_KEY']);
      if (value !== undefined) {
        for (const text of [error.message, error.stack ?? '', String(error), JSON.stringify(error)]) expect(text).not.toContain(value);
      }
    }
  });

  it('EVM-080 AC4 only the migration entry point reads the light configuration: a server, a worker or a CLI that did could start without a key', () => {
    const root = join(import.meta.dirname, '..', '..', 'src');
    const sources = (directory: string): string[] =>
      readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
      });
    const users = sources(root)
      .filter((path) => readFileSync(path, 'utf8').includes('loadMigrationConfig'))
      .map((path) => relative(root, path).split(sep).join('/'))
      .sort();
    expect(users).toEqual(['migrate.ts', 'platform/config/config.ts']);
  });
});

describe('the register of deletions in the configuration (EVM-040 AC3; SR-CRYPTO-04)', () => {
  const settings = {
    S3_ENDPOINT: 'https://s3.example.invalid',
    S3_REGION: 'pl-waw',
    DELETION_REGISTER_BUCKET: 'evia-test-deletion-register',
    DELETION_REGISTER_S3_ACCESS_KEY_ID: 'synthetic-access-key',
    DELETION_REGISTER_S3_SECRET_ACCESS_KEY: ['synthetic', 'secret', 'value'].join('-'),
  };

  it('EVM-040 AC3 the five settings make a configured register; the secret may come from its _FILE', () => {
    const { DELETION_REGISTER_S3_SECRET_ACCESS_KEY: secret, ...withoutSecret } = settings;
    expect(loadConfig({ ...validEnv(), ...settings }).deletionRegister).toMatchObject({
      status: 'configured',
      bucket: settings.DELETION_REGISTER_BUCKET,
    });
    const fromFile = loadConfig(
      { ...validEnv(), ...withoutSecret, DELETION_REGISTER_S3_SECRET_ACCESS_KEY_FILE: '/run/secrets/register-key' },
      () => `${secret}
`,
    );
    expect(fromFile.deletionRegister).toMatchObject({ status: 'configured', secretAccessKey: secret });
  });

  it('EVM-040 AC3 a partial or malformed set never stops the start: the register is "incomplete" and the service configures', () => {
    const partial = { ...settings, S3_REGION: undefined };
    expect(loadConfig({ ...validEnv(), ...partial }).deletionRegister).toMatchObject({ status: 'incomplete', missing: ['S3_REGION'] });
    expect(loadConfig({ ...validEnv(), ...settings, S3_ENDPOINT: 'http://s3.example.invalid' }).deletionRegister).toMatchObject({
      status: 'incomplete',
      invalid: ['S3_ENDPOINT'],
    });
  });
});
