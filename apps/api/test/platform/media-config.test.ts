import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, resolveFileKeys } from '../../src/platform/config/config.ts';
import { parseClamdAddress } from '../../src/platform/config/media-config.ts';
import { validEnv } from '../support/app.ts';

const MEDIA = {
  S3_ENDPOINT: 'https://s3.fr-par.scw.cloud',
  S3_REGION: 'fr-par',
  MEDIA_BUCKET: 'evia-staging-media',
  MEDIA_S3_ACCESS_KEY_ID: 'SCWSYNTHETIC0000',
  MEDIA_S3_SECRET_ACCESS_KEY: 'synthetic-secret-value',
};

const without = (env: Record<string, string>, ...keys: string[]): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter(([key]) => !keys.includes(key)));

const keysOf = (env: Record<string, string | undefined>): readonly string[] => {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.keys;
    throw error;
  }
  return [];
};

describe('EVM-044 AC3 media configuration is all or nothing (P5, fail closed)', () => {
  it('EVM-044 AC3 no media variable means the feature is off and the service starts', () => {
    expect(loadConfig(validEnv()).media).toBeUndefined();
    expect(loadConfig(validEnv({ S3_ENDPOINT: '' })).media).toBeUndefined();
  });

  it('EVM-044 AC3 a partial setting stops the start and names the missing keys only', () => {
    const partial = without(MEDIA, 'MEDIA_BUCKET', 'MEDIA_S3_SECRET_ACCESS_KEY');
    expect(keysOf(validEnv(partial))).toEqual(['MEDIA_BUCKET', 'MEDIA_S3_SECRET_ACCESS_KEY']);
    expect(keysOf(validEnv({ CLAMD_SOCKET: 'tcp://clamd:3310' }))).toEqual(expect.arrayContaining(['MEDIA_BUCKET']));
  });

  it('EVM-044 AC3 a full setting is read; clamd, path style and the CSP origin are optional', () => {
    const media = loadConfig(validEnv(MEDIA)).media;
    expect(media?.s3).toMatchObject({ bucket: 'evia-staging-media', forcePathStyle: false });
    expect(media?.clamd).toBeUndefined();
    expect(media?.bucketOrigin).toBeUndefined();
    const full = loadConfig(
      validEnv({
        ...MEDIA,
        CLAMD_SOCKET: 'tcp://clamd:3310',
        S3_FORCE_PATH_STYLE: 'true',
        MEDIA_BUCKET_ORIGIN: 'https://evia-staging-media.s3.fr-par.scw.cloud',
      }),
    ).media;
    expect(full?.clamd).toEqual({ kind: 'tcp', host: 'clamd', port: 3310 });
    expect(full?.s3.forcePathStyle).toBe(true);
    expect(full?.bucketOrigin).toBe('https://evia-staging-media.s3.fr-par.scw.cloud');
  });

  it('EVM-044 AC3 invalid values are refused without echoing them (wildcard origin, bad clamd address, bad flag)', () => {
    expect(keysOf(validEnv({ ...MEDIA, MEDIA_BUCKET_ORIGIN: 'https://*.scw.cloud' }))).toEqual(['MEDIA_BUCKET_ORIGIN']);
    expect(keysOf(validEnv({ ...MEDIA, MEDIA_BUCKET_ORIGIN: 'https://bucket.example/path' }))).toEqual(['MEDIA_BUCKET_ORIGIN']);
    expect(keysOf(validEnv({ ...MEDIA, MEDIA_BUCKET_ORIGIN: 'http://bucket.example' }))).toEqual(['MEDIA_BUCKET_ORIGIN']);
    expect(keysOf(validEnv({ ...MEDIA, CLAMD_SOCKET: 'clamd:3310' }))).toEqual(['CLAMD_SOCKET']);
    expect(keysOf(validEnv({ ...MEDIA, S3_FORCE_PATH_STYLE: 'yes' }))).toEqual(['S3_FORCE_PATH_STYLE']);
    expect(
      keysOf(
        validEnv({
          ...MEDIA,
          S3_ENDPOINT: 'ftp://x',
          S3_REGION: 'Fr Par',
          MEDIA_BUCKET: 'B',
          MEDIA_S3_ACCESS_KEY_ID: '!',
          MEDIA_S3_SECRET_ACCESS_KEY: 'x',
        }),
      ),
    ).toEqual(['MEDIA_BUCKET', 'MEDIA_S3_ACCESS_KEY_ID', 'MEDIA_S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT', 'S3_REGION']);
  });

  it('EVM-044 AC3 a plain http endpoint needs a loopback host or the path-style flag of the test server', () => {
    expect(keysOf(validEnv({ ...MEDIA, S3_ENDPOINT: 'http://s3.example.test' }))).toEqual(['S3_ENDPOINT']);
    expect(keysOf(validEnv({ ...MEDIA, S3_ENDPOINT: 'http://s3.example.test', S3_FORCE_PATH_STYLE: 'false' }))).toEqual(['S3_ENDPOINT']);
    expect(keysOf(validEnv({ ...MEDIA, S3_ENDPOINT: 'http://s3.example.test', S3_FORCE_PATH_STYLE: 'true' }))).toEqual([]);
    for (const host of ['localhost:9000', '127.0.0.1:9000', '[::1]:9000']) {
      expect(keysOf(validEnv({ ...MEDIA, S3_ENDPOINT: `http://${host}` }))).toEqual([]);
    }
  });

  it('EVM-044 AC3 the secret key is read from its file', () => {
    const rest = without(MEDIA, 'MEDIA_S3_SECRET_ACCESS_KEY');
    const env = { ...validEnv(rest), MEDIA_S3_SECRET_ACCESS_KEY_FILE: '/run/secrets/media-s3-secret' };
    const resolved = resolveFileKeys(env, () => 'file-secret-value\n');
    expect(resolved['MEDIA_S3_SECRET_ACCESS_KEY']).toBe('file-secret-value');
    expect(loadConfig(env, () => 'file-secret-value\n').media?.s3.secretAccessKey).toBe('file-secret-value');
  });

  it('EVM-044 AC3 clamd addresses: tcp host:port and absolute unix paths only', () => {
    expect(parseClamdAddress('tcp://clamd:3310')).toEqual({ kind: 'tcp', host: 'clamd', port: 3310 });
    expect(parseClamdAddress('unix:///run/clamav/clamd.sock')).toEqual({ kind: 'unix', path: '/run/clamav/clamd.sock' });
    for (const bad of ['tcp://clamd', 'tcp://clamd:0', 'tcp://clamd:70000', 'unix://relative.sock', 'unix:///a/../b', 'http://x:1', '']) {
      expect(parseClamdAddress(bad)).toBeUndefined();
    }
  });
});

describe('EVM-068 AC5 the settings of the image processor come as a pair of absolute paths', () => {
  const PROCESSOR = { MEDIA_PROCESSOR_SOCKET: '/run/evia/media-work/processor.sock', MEDIA_PROCESSOR_WORKDIR: '/run/evia/media-work' };

  it('EVM-068 AC5 without them the processor is off (the photos stay clean); with both it is read', () => {
    expect(loadConfig(validEnv(MEDIA)).media?.processor).toBeUndefined();
    expect(loadConfig(validEnv({ ...MEDIA, ...PROCESSOR })).media?.processor).toEqual({
      socketPath: '/run/evia/media-work/processor.sock',
      workDir: '/run/evia/media-work',
    });
  });

  it('EVM-068 AC5 one of them without the other, a relative path, a path with `..` and a NUL are refused by name, never echoed', () => {
    expect(keysOf(validEnv({ ...MEDIA, MEDIA_PROCESSOR_SOCKET: PROCESSOR.MEDIA_PROCESSOR_SOCKET }))).toEqual(['MEDIA_PROCESSOR_WORKDIR']);
    expect(keysOf(validEnv({ ...MEDIA, MEDIA_PROCESSOR_WORKDIR: PROCESSOR.MEDIA_PROCESSOR_WORKDIR }))).toEqual(['MEDIA_PROCESSOR_SOCKET']);
    expect(keysOf(validEnv({ ...MEDIA, ...PROCESSOR, MEDIA_PROCESSOR_SOCKET: 'p.sock' }))).toEqual(['MEDIA_PROCESSOR_SOCKET']);
    expect(keysOf(validEnv({ ...MEDIA, ...PROCESSOR, MEDIA_PROCESSOR_WORKDIR: '/run/../etc' }))).toEqual(['MEDIA_PROCESSOR_WORKDIR']);
    expect(keysOf(validEnv({ ...MEDIA, ...PROCESSOR, MEDIA_PROCESSOR_WORKDIR: '/run/evia\0' }))).toEqual(['MEDIA_PROCESSOR_WORKDIR']);
  });

  it('EVM-068 AC5 the processor settings alone are media settings: without the storage the start stops and names the missing keys', () => {
    expect(keysOf(validEnv(PROCESSOR))).toEqual(expect.arrayContaining(['MEDIA_BUCKET']));
  });
});
