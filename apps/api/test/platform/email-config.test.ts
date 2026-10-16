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
