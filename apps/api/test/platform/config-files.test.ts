import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  ConfigError,
  FILE_KEYS,
  loadConfig,
  loadMigrationConfig,
  loadWorkerConfig,
  resolveFileKeys,
  type ReadConfigFile,
} from '../../src/platform/config/config.ts';
import { TEST_CURSOR_KEY, validEnv } from '../support/app.ts';

type Env = Record<string, string | undefined>;

const keysOf = (action: () => unknown): readonly string[] => {
  try {
    action();
  } catch (error) {
    if (error instanceof ConfigError) return error.keys;
    throw error;
  }
  return [];
};

/** A reader over synthetic files; any other path fails like a missing file. */
const filesOf =
  (files: Record<string, string>): ReadConfigFile =>
  (path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  };

describe('settings from files — <KEY>_FILE (EVM-007 AC7; ADR-0018 "Gdzie żyją sekrety", SR-LOG-02)', () => {
  it('EVM-007 AC7 a secret is read from its file, one trailing line break removed, and the _FILE key is dropped', () => {
    const env = { ...validEnv({ CURSOR_KEY: undefined }), CURSOR_KEY_FILE: '/run/secrets/cursor-key' };
    const resolved = resolveFileKeys(env, filesOf({ '/run/secrets/cursor-key': `${TEST_CURSOR_KEY}\n` }));
    expect(resolved['CURSOR_KEY']).toBe(TEST_CURSOR_KEY);
    expect(resolved['CURSOR_KEY_FILE']).toBeUndefined();
    expect(loadConfig(env, filesOf({ '/run/secrets/cursor-key': `${TEST_CURSOR_KEY}\r\n` })).cursorKey).toEqual(Buffer.alloc(32, 7));
  });

  it('EVM-007 AC7 only the listed keys are read from files; an empty _FILE is ignored', () => {
    expect(FILE_KEYS).toEqual([
      'DATABASE_URL',
      'CURSOR_KEY',
      'FIELD_ENCRYPTION_KEYS',
      'SYNC_CURSOR_KEYS',
      'LOGIN_THROTTLE_KEY',
      'EVIA_RELEASE_MANIFEST_SHA256',
      'MEDIA_S3_SECRET_ACCESS_KEY',
      'DELETION_REGISTER_S3_SECRET_ACCESS_KEY',
    ]);
    const read = filesOf({});
    expect(resolveFileKeys({ PANEL_ORIGIN_FILE: '/etc/passwd', NODE_ENV_FILE: '/x' }, read)).toEqual({
      PANEL_ORIGIN_FILE: '/etc/passwd',
      NODE_ENV_FILE: '/x',
    });
    expect(resolveFileKeys({ CURSOR_KEY_FILE: '' }, read)).toEqual({ CURSOR_KEY_FILE: '' });
  });

  it('EVM-007 AC7 an ambiguous setting, a relative path, a missing or oversized file stop the start — the error names the keys only', () => {
    const secret = 'postgres://evia_api:synthetic-SECRET@postgres:5432/evia';
    const read = filesOf({ '/run/secrets/database-url-app': secret, '/run/secrets/big': 'x'.repeat(64 * 1024 + 1) });
    const cases: Array<[Env, string[]]> = [
      [{ DATABASE_URL: secret, DATABASE_URL_FILE: '/run/secrets/database-url-app' }, ['DATABASE_URL']],
      [{ DATABASE_URL_FILE: 'run/secrets/database-url-app' }, ['DATABASE_URL_FILE']],
      [{ CURSOR_KEY_FILE: '/run/secrets/cursor-key' }, ['CURSOR_KEY_FILE']],
      [{ FIELD_ENCRYPTION_KEYS_FILE: '/run/secrets/big', CURSOR_KEY_FILE: '/nope' }, ['CURSOR_KEY_FILE', 'FIELD_ENCRYPTION_KEYS_FILE']],
    ];
    for (const [env, keys] of cases) {
      let error: unknown;
      try {
        resolveFileKeys(env, read);
      } catch (caught) {
        error = caught;
      }
      expect(error, JSON.stringify(env)).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).keys).toEqual(keys);
      expect((error as ConfigError).message).not.toContain('SECRET');
    }
    expect(keysOf(() => loadMigrationConfig({ NODE_ENV: 'test', DATABASE_URL_FILE: '/missing' }, read))).toEqual(['DATABASE_URL_FILE']);
    expect(keysOf(() => loadWorkerConfig({ ...validEnv(), EMAIL_TRANSPORT: 'none', CURSOR_KEY_FILE: '/missing' }, read))).toEqual([
      'CURSOR_KEY',
    ]);
  });

  it('EVM-007 AC4 the release: the commit of the image and the manifest hash from its file; a malformed value stops the start', () => {
    const commit = 'a1'.repeat(20);
    const manifest = 'b2'.repeat(32);
    const read = filesOf({ '/run/secrets/release-manifest-sha256': manifest });
    const env = validEnv({ EVIA_RELEASE_COMMIT: commit, EVIA_RELEASE_MANIFEST_SHA256_FILE: '/run/secrets/release-manifest-sha256' });
    expect(loadConfig(env, read).release).toEqual({ commit, manifestSha256: manifest });
    expect(keysOf(() => loadConfig(validEnv({ EVIA_RELEASE_COMMIT: 'main' })))).toEqual(['EVIA_RELEASE_COMMIT']);
    expect(keysOf(() => loadConfig(validEnv({ EVIA_RELEASE_MANIFEST_SHA256: 'B2'.repeat(32) })))).toEqual(['EVIA_RELEASE_MANIFEST_SHA256']);
  });
});

/**
 * The contract between the compose file of the deployment channel and the configuration (EVM-007 AC4, AC7; architect, review round 1): every
 * application service of infra/runtime/compose.staging.yaml starts with exactly its environment, its *_FILE paths served by the secrets of
 * infra/deploy-agent/secrets.manifest.json (synthetic contents here). A missing or misspelt key would fail the health check of the first deployment.
 */
describe('EVM-007 AC4: compose.staging.yaml satisfies the configuration of the API, the worker and the migrations', () => {
  const compose = parse(readFileSync(new URL('../../../../infra/runtime/compose.staging.yaml', import.meta.url), 'utf8')) as {
    services: Record<string, { environment?: Record<string, string> }>;
  };
  const secrets = JSON.parse(readFileSync(new URL('../../../../infra/deploy-agent/secrets.manifest.json', import.meta.url), 'utf8')) as {
    services: Record<string, { files: string[] }>;
  };
  const randomKey = (): string => randomBytes(32).toString('base64url');
  /** Synthetic secret files by name — never real values; keys random because production refuses placeholders. */
  const contents: Record<string, string> = {
    'database-url-migrator': 'postgres://evia_migrator:synthetic@postgres:5432/evia\n',
    'database-url-app': 'postgres://evia_api:synthetic@postgres:5432/evia\n',
    'cursor-key': `${randomKey()}\n`,
    'field-encryption-keys': `k1:${randomKey()}\n`,
    'login-throttle-key': `${randomKey()}\n`,
    // Written by evia-secrets for the API only (the hash of the release manifest, not a secret).
    'release-manifest-sha256': `${'c3'.repeat(32)}\n`,
  };

  /** The environment of a service and a reader that serves only the files the secrets manifest gives that service. */
  function service(name: string): { env: Env; read: ReadConfigFile } {
    const env = compose.services[name]?.environment ?? {};
    const files = [...(secrets.services[name]?.files ?? []), ...(name === 'api' ? ['release-manifest-sha256'] : [])];
    const served = Object.fromEntries(files.map((file) => [`/run/secrets/${file}`, contents[file] ?? '']));
    return { env, read: filesOf(served) };
  }

  it('EVM-007 AC4 the API starts on port 3000 in production with its secrets from files and reports its release', () => {
    const { env, read } = service('api');
    const config = loadConfig(env, read);
    expect(config).toMatchObject({ nodeEnv: 'production', port: 3000, panelOrigin: 'https://staging.eviacharge.pl' });
    expect(config.fieldEncryptionKeys.length).toBe(1);
    // EVM-026: production refuses to start without the key of the counters against guessing — on staging it comes from a file.
    expect(config.loginThrottleKey.length).toBe(32);
    expect(config.trustedProxies.length).toBeGreaterThan(0);
    expect(config.release.manifestSha256).toBe('c3'.repeat(32));
  });

  it('EVM-007 AC4 the worker starts with its secrets from files and without e-mail until EVM-089', () => {
    const { env, read } = service('worker');
    expect(loadWorkerConfig(env, read)).toMatchObject({ nodeEnv: 'production', email: { transport: 'none' } });
  });

  it('EVM-007 AC4 the migrations start with the migrator role only', () => {
    const { env, read } = service('migrate');
    expect(loadMigrationConfig(env, read).databaseUrl).toContain('evia_migrator');
    expect(Object.keys(env).sort()).toEqual(['DATABASE_URL_FILE', 'LOG_LEVEL', 'NODE_ENV']);
  });

  it('EVM-007 AC7 no service of the channel names a secret file it does not receive', () => {
    for (const name of ['api', 'worker', 'migrate']) {
      const { env, read } = service(name);
      for (const [key, path] of Object.entries(env).filter(([key]) => key.endsWith('_FILE')))
        expect(() => read(path ?? ''), `${name}: ${key}`).not.toThrow();
    }
  });
});
