import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, SMTP_HOSTS, loadConfig, loadWorkerConfig } from '../../src/platform/config/config.ts';
import { validEnv } from '../support/app.ts';

const smtpEnv = (overrides: Record<string, string | undefined> = {}) =>
  validEnv({
    EMAIL_TRANSPORT: 'smtp',
    EMAIL_SMTP_HOST: 'mailpit',
    EMAIL_SMTP_PORT: '1025',
    EMAIL_FROM: 'noreply@evia.localhost',
    ...overrides,
  });

const keysOf = (env: Record<string, string | undefined>): readonly string[] => {
  try {
    loadWorkerConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.keys;
    throw error;
  }
  throw new Error('expected a ConfigError');
};

describe('the transport of e-mail in the configuration of the worker (EVM-024 AC6; SR-API-13, fail closed)', () => {
  it('EVM-024 AC6 the transport is an explicit setting without a default: its absence is an error that names the key', () => {
    expect(keysOf(validEnv())).toEqual(['EMAIL_TRANSPORT']);
    expect(keysOf(validEnv({ EMAIL_TRANSPORT: '' }))).toEqual(['EMAIL_TRANSPORT']);
    expect(keysOf(validEnv({ EMAIL_TRANSPORT: 'mailpit' }))).toEqual(['EMAIL_TRANSPORT']);
    expect(keysOf(validEnv({ EMAIL_TRANSPORT: 'inmemory' }))).toEqual(['EMAIL_TRANSPORT']);
  });

  it('EVM-024 AC6 smtp needs its host, port and sender; none needs nothing and is allowed in every environment', () => {
    const config = loadWorkerConfig(smtpEnv());
    expect(config.email).toEqual({ transport: 'smtp', host: 'mailpit', port: 1025, from: 'noreply@evia.localhost' });
    expect(config.databaseUrl).toBe(validEnv()['DATABASE_URL']);
    expect(keysOf(smtpEnv({ EMAIL_SMTP_HOST: undefined }))).toEqual(['EMAIL_SMTP_HOST']);
    expect(keysOf(smtpEnv({ EMAIL_SMTP_PORT: undefined }))).toEqual(['EMAIL_SMTP_PORT']);
    expect(keysOf(smtpEnv({ EMAIL_FROM: undefined }))).toEqual(['EMAIL_FROM']);
    expect(keysOf(smtpEnv({ EMAIL_SMTP_PORT: '0' }))).toEqual(['EMAIL_SMTP_PORT']);
    expect(keysOf(smtpEnv({ EMAIL_SMTP_PORT: 'smtp' }))).toEqual(['EMAIL_SMTP_PORT']);
    expect(keysOf(smtpEnv({ EMAIL_FROM: 'Evia <noreply@evia.localhost>' }))).toEqual(['EMAIL_FROM']);
    expect(keysOf(smtpEnv({ EMAIL_FROM: 'a@b.test\r\nBcc: x@y.test' }))).toEqual(['EMAIL_FROM']);
    for (const NODE_ENV of ['test', 'development', 'production']) {
      expect(
        loadWorkerConfig(validEnv({ NODE_ENV, EMAIL_TRANSPORT: 'none', CURSOR_KEY: randomBytes(32).toString('base64url') })).email,
      ).toEqual({
        transport: 'none',
      });
    }
  });

  it('EVM-024 AC6 W6 only Mailpit and the loopback are accepted as the SMTP host: any other host is a ConfigError with the name of the key alone', () => {
    for (const host of SMTP_HOSTS) expect(loadWorkerConfig(smtpEnv({ EMAIL_SMTP_HOST: host })).email).toMatchObject({ host });
    for (const host of ['smtp.gmail.com', 'smtp.tem.scw.cloud', '10.0.0.5', 'mailpit.evil.test', 'localhost.evil.test', 'MAILPIT', '']) {
      const error = (() => {
        try {
          loadWorkerConfig(smtpEnv({ EMAIL_SMTP_HOST: host }));
        } catch (caught) {
          return caught as ConfigError;
        }
        throw new Error('expected a ConfigError');
      })();
      expect(error.keys, host).toEqual(['EMAIL_SMTP_HOST']);
      expect(error.message).not.toContain(host === '' ? 'never' : host);
    }
  });

  it('EVM-024 AC6 smtp is refused in production — also when NODE_ENV is missing, which means production (staging and production)', () => {
    const production = {
      CURSOR_KEY: randomBytes(32).toString('base64url'),
      PANEL_ORIGIN: 'https://panel.evia.pl',
      WEBAUTHN_RP_ID: 'panel.evia.pl',
    };
    expect(keysOf(smtpEnv({ NODE_ENV: 'production', ...production }))).toEqual(['EMAIL_TRANSPORT']);
    expect(keysOf(smtpEnv({ NODE_ENV: undefined, ...production }))).toEqual(['EMAIL_TRANSPORT']);
    expect(loadWorkerConfig(smtpEnv({ NODE_ENV: 'development' })).email.transport).toBe('smtp');
  });

  it('EVM-024 AC6 W7 the panel origin of the links is the one of the configuration with the rule of production (https, not localhost)', () => {
    expect(
      keysOf(
        smtpEnv({ NODE_ENV: 'production', PANEL_ORIGIN: 'http://panel.evia.pl', WEBAUTHN_RP_ID: 'panel.evia.pl', EMAIL_TRANSPORT: 'none' }),
      ),
    ).toEqual(['CURSOR_KEY', 'PANEL_ORIGIN']);
  });

  it('EVM-024 AC6 one error names the keys of the server and of the e-mail together, never a value', () => {
    const error = (() => {
      try {
        loadWorkerConfig({ ...validEnv({ EMAIL_SMTP_HOST: 'secret-relay.example', EMAIL_TRANSPORT: 'smtp' }), DATABASE_URL: undefined });
      } catch (caught) {
        return caught as ConfigError;
      }
      throw new Error('expected a ConfigError');
    })();
    expect(error.keys).toEqual(['DATABASE_URL', 'EMAIL_SMTP_HOST']);
    expect(JSON.stringify({ message: error.message, stack: error.stack })).not.toContain('secret-relay');
  });

  it('EVM-024 AC6 a failure that is not a ConfigError (a defect of the environment object) is not swallowed into one', () => {
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new TypeError('synthetic defect');
        },
      },
    );
    expect(() => loadWorkerConfig(hostile)).toThrow(TypeError);
  });

  it('EVM-024 AC6 the server (and the CLI) read no EMAIL_* key: the API sends no mail, so its start needs none — only the worker loads the transport', () => {
    expect(loadConfig(validEnv())).not.toHaveProperty('email');
    expect(
      loadConfig(smtpEnv({ EMAIL_SMTP_HOST: 'smtp.gmail.com', NODE_ENV: 'production', CURSOR_KEY: randomBytes(32).toString('base64url') })),
    ).toBeDefined();
    const root = join(import.meta.dirname, '..', '..', 'src');
    const sources = (directory: string): string[] =>
      readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
      });
    const users = sources(root)
      .filter((path) => readFileSync(path, 'utf8').includes('loadWorkerConfig'))
      .map((path) => relative(root, path).split(sep).join('/'))
      .sort();
    expect(users).toEqual(['platform/config/config.ts', 'worker/worker-process.ts']);
  });
});

describe('the transport tem of the worker (EVM-089 AC1, AC2; SR-INFRA-05, SR-API-13)', () => {
  const KEY = '00000000-0000-4000-8000-000000000001';
  const PROJECT = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const production = (overrides: Record<string, string | undefined> = {}) =>
    validEnv({
      NODE_ENV: 'production',
      CURSOR_KEY: randomBytes(32).toString('base64url'),
      PANEL_ORIGIN: 'https://panel.eviacharge.pl',
      WEBAUTHN_RP_ID: 'panel.eviacharge.pl',
      EMAIL_TRANSPORT: 'tem',
      EMAIL_FROM: 'powiadomienia@panel.eviacharge.pl',
      EMAIL_TEM_API_KEY_FILE: '/run/secrets/tem-api-key',
      EMAIL_TEM_PROJECT_ID_FILE: '/run/secrets/tem-project-id',
      EMAIL_RECIPIENT_MODE_FILE: '/run/secrets/email-recipient-mode',
      EMAIL_ALLOWED_RECIPIENTS_FILE: '/run/secrets/email-allowed-recipients',
      ...overrides,
    });
  const files = (content: Record<string, string | undefined> = {}) => {
    const all: Record<string, string | undefined> = {
      '/run/secrets/tem-api-key': `${KEY}\n`,
      '/run/secrets/tem-project-id': PROJECT,
      '/run/secrets/email-recipient-mode': 'otwarty\n',
      '/run/secrets/email-allowed-recipients': '# biuro\nAnna.Testowa@Biuro.pl\n\njan@biuro.pl # szef\n',
      ...content,
    };
    return (path: string): string => {
      const value = all[path];
      if (value === undefined) throw new Error('ENOENT');
      return value;
    };
  };
  const keys = (env: Record<string, string | undefined>, read = files()): readonly string[] => {
    try {
      loadWorkerConfig(env, read);
    } catch (error) {
      if (error instanceof ConfigError) return error.keys;
      throw error;
    }
    throw new Error('expected a ConfigError');
  };

  it('EVM-089 AC1 tem is allowed in production; the key and the project come from files, the mode and the normalised list too', () => {
    const { email } = loadWorkerConfig(production(), files());
    expect(email).toMatchObject({
      transport: 'tem',
      from: 'powiadomienia@panel.eviacharge.pl',
      projectId: PROJECT,
      mode: 'otwarty',
      allowed: ['anna.testowa@biuro.pl', 'jan@biuro.pl'],
      pendingMaxAgeHours: 24,
    });
    expect((email as { apiKey?: string }).apiKey).toBe(KEY);
  });

  it('EVM-089 AC1 B the key is not enumerable: a log of the configuration, JSON and a spread never show it', () => {
    const { email } = loadWorkerConfig(production(), files());
    expect(JSON.stringify(email)).not.toContain(KEY);
    expect(JSON.stringify({ ...email })).not.toContain(KEY);
    expect(Object.keys(email)).not.toContain('apiKey');
  });

  it('EVM-089 AC2 fail closed: a missing, empty or unknown mode is lista; a missing list is an empty one', () => {
    for (const mode of [undefined, '', '\n', 'lista', 'OPEN', 'otwarty lista']) {
      const read = files({ '/run/secrets/email-recipient-mode': mode });
      expect(loadWorkerConfig(production(), read).email, String(mode)).toMatchObject({ mode: 'lista' });
    }
    const noFiles = production({ EMAIL_RECIPIENT_MODE_FILE: undefined, EMAIL_ALLOWED_RECIPIENTS_FILE: undefined });
    expect(loadWorkerConfig(noFiles, files()).email).toMatchObject({ mode: 'lista', allowed: [] });
    expect(loadWorkerConfig(production(), files({ '/run/secrets/email-allowed-recipients': undefined })).email).toMatchObject({
      allowed: [],
    });
  });

  it('EVM-089 AC2 a malformed entry of the list stops the start (never skipped silently) and names the key only', () => {
    const read = files({ '/run/secrets/email-allowed-recipients': 'anna@biuro.pl\nnot an address zażółć\n' });
    expect(keys(production(), read)).toEqual(['EMAIL_ALLOWED_RECIPIENTS_FILE']);
    try {
      loadWorkerConfig(production(), read);
    } catch (error) {
      expect((error as Error).message).not.toMatch(/zażółć|anna/);
    }
  });

  it('EVM-089 B a missing, malformed or too large key or project file is a ConfigError naming the key, never the value', () => {
    expect(keys(production(), files({ '/run/secrets/tem-api-key': undefined }))).toEqual(['EMAIL_TEM_API_KEY_FILE']);
    expect(keys(production(), files({ '/run/secrets/tem-api-key': 'SECRET-not-a-uuid' }))).toEqual(['EMAIL_TEM_API_KEY_FILE']);
    expect(keys(production(), files({ '/run/secrets/tem-api-key': '' }))).toEqual(['EMAIL_TEM_API_KEY_FILE']);
    expect(keys(production(), files({ '/run/secrets/tem-api-key': KEY + 'x'.repeat(70_000) }))).toEqual(['EMAIL_TEM_API_KEY_FILE']);
    expect(keys(production(), files({ '/run/secrets/tem-project-id': 'nope' }))).toEqual(['EMAIL_TEM_PROJECT_ID_FILE']);
    expect(keys(production({ EMAIL_TEM_API_KEY_FILE: undefined }))).toEqual(['EMAIL_TEM_API_KEY_FILE']);
    expect(keys(production({ EMAIL_TEM_PROJECT_ID_FILE: undefined }))).toEqual(['EMAIL_TEM_PROJECT_ID_FILE']);
    expect(keys(production({ EMAIL_TEM_API_KEY_FILE: 'relative/tem-api-key' }))).toEqual(['EMAIL_TEM_API_KEY_FILE']);
    const error = (() => {
      try {
        loadWorkerConfig(production(), files({ '/run/secrets/tem-api-key': 'SECRET-not-a-uuid' }));
      } catch (caught) {
        return caught as ConfigError;
      }
      throw new Error('expected a ConfigError');
    })();
    expect(JSON.stringify({ message: error.message, stack: error.stack })).not.toContain('SECRET-not-a-uuid');
  });

  it('EVM-089 C the sender is on EXACTLY the verified domain (a label boundary): a sibling, a parent, a suffix trick and a missing sender are refused', () => {
    for (const from of [
      'powiadomienia@staging.eviacharge.pl',
      'powiadomienia@eviacharge.pl',
      'powiadomienia@evil-panel.eviacharge.pl',
      'powiadomienia@panel.eviacharge.pl.evil.test',
      'powiadomienia@xpanel.eviacharge.pl',
      'powiadomienia@sub.panel.eviacharge.pl',
      'Evia <powiadomienia@panel.eviacharge.pl>',
    ]) {
      expect(keys(production({ EMAIL_FROM: from })), from).toEqual(['EMAIL_FROM']);
    }
    expect(keys(production({ EMAIL_FROM: undefined }))).toEqual(['EMAIL_FROM']);
    expect(loadWorkerConfig(production({ EMAIL_FROM: 'powiadomienia@panel.eviacharge.pl' }), files()).email).toMatchObject({
      from: 'powiadomienia@panel.eviacharge.pl',
    });
  });

  it('EVM-089 D the limit of the age of a pending row is a whole number of hours from 1 to 720 (default 24)', () => {
    expect(loadWorkerConfig(production({ EMAIL_PENDING_MAX_AGE_HOURS: '6' }), files()).email).toMatchObject({ pendingMaxAgeHours: 6 });
    for (const value of ['0', '721', '1.5', 'day']) {
      expect(keys(production({ EMAIL_PENDING_MAX_AGE_HOURS: value }))).toEqual(['EMAIL_PENDING_MAX_AGE_HOURS']);
    }
  });

  it('EVM-089 B the value of the key may not come from the environment: only the file is read (a plain EMAIL_TEM_API_KEY is ignored)', () => {
    const read = files({ '/run/secrets/tem-api-key': undefined });
    expect(keys({ ...production(), EMAIL_TEM_API_KEY: KEY }, read)).toEqual(['EMAIL_TEM_API_KEY_FILE']);
  });
});
