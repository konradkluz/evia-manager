import { readFileSync, readdirSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QUARANTINE_RETENTION_DAYS,
  quarantineOf,
  quarantineReasonOf,
  signatureAlertsDue,
  type QuarantineFacts,
} from '../../src/modules/media/domain/quarantine.ts';
import type { ReasonCode } from '../../src/modules/media/domain/scan-outcome.ts';
import { loadMediaConfig } from '../../src/platform/config/media-config.ts';
import { ClamdScanner, parseClamdVersion } from '../../src/platform/malware-scan/clamd-scanner.ts';
import { FakeMalwareScanner } from '../../src/platform/malware-scan/fake-malware-scanner.ts';
import { MalwareScanError } from '../../src/platform/malware-scan/malware-scanner.ts';
import { InMemoryObjectStorage } from '../../src/platform/object-storage/in-memory-object-storage.ts';
import { ObjectStorageError } from '../../src/platform/object-storage/object-storage.ts';

const at = (iso: string): Date => new Date(iso);
const file = (over: Partial<QuarantineFacts & { state_reason_code: ReasonCode | null }> = {}) => ({
  state: 'quarantined' as const,
  quarantined_at: at('2026-09-01T10:00:00Z'),
  purged_at: null,
  state_reason_code: 'malware_detected' as const,
  ...over,
});

describe('EVM-049 AC1 AC5 the state and the reason of a quarantine (pure rules)', () => {
  const expires = at('2026-09-30T22:00:00Z');

  it('EVM-049 AC5 the retention is 30 days, a domain constant', () => {
    expect(QUARANTINE_RETENTION_DAYS).toBe(30);
  });

  it('EVM-049 AC6 a file is held when it is quarantined or in a new scan, purged when its object was removed, otherwise it is not in quarantine', () => {
    expect(quarantineOf(file(), expires)).toEqual({ state: 'held', expiresAt: expires, purgedAt: null });
    expect(quarantineOf(file({ state: 'scanning' }), expires)).toMatchObject({ state: 'held' });
    const purgedAt = at('2026-10-01T00:05:00Z');
    expect(quarantineOf(file({ purged_at: purgedAt }), expires)).toEqual({ state: 'purged', expiresAt: expires, purgedAt });
    // a clean result of a new scan releases the file; a file that never was in quarantine has no state
    expect(quarantineOf(file({ state: 'clean' }), expires)).toBeNull();
    expect(quarantineOf(file({ quarantined_at: null, state: 'uploaded' }), null)).toBeNull();
    expect(quarantineOf(file(), null)).toBeNull();
  });

  it('EVM-049 AC1 the reason exists only for a file that is stopped now, with a reason of the scan', () => {
    expect(quarantineReasonOf(file())).toBe('malware_detected');
    expect(quarantineReasonOf(file({ state_reason_code: 'type_mismatch' }))).toBe('type_mismatch');
    expect(quarantineReasonOf(file({ state: 'scanning', state_reason_code: null }))).toBeUndefined();
    expect(quarantineReasonOf(file({ purged_at: at('2026-10-01T00:05:00Z') }))).toBeUndefined();
    expect(quarantineReasonOf(file({ state_reason_code: 'checksum_mismatch' }))).toBeUndefined();
  });
});

describe('EVM-049 AC7 the alerts of the signatures (24 h once per episode, 72 h daily)', () => {
  const built = at('2026-10-20T07:00:00Z');
  const base = { since: built, lastStaleAlert: null, last72hAlert: null };

  it('EVM-049 AC7 up to 24 hours there is no alert', () => {
    expect(signatureAlertsDue({ ...base, now: at('2026-10-21T07:00:00Z') })).toEqual([]);
  });

  it('EVM-049 AC7 past 24 hours one signature_stale per episode: not again while the newest alert is from this episode', () => {
    const now = at('2026-10-21T07:00:01Z');
    expect(signatureAlertsDue({ ...base, now })).toEqual(['signature_stale']);
    expect(signatureAlertsDue({ ...base, now, lastStaleAlert: at('2026-10-21T07:15:00Z') })).toEqual([]);
    // an alert of an earlier episode (before this build + 24 h) does not hide the new one
    expect(signatureAlertsDue({ ...base, now, lastStaleAlert: at('2026-10-19T09:00:00Z') })).toEqual(['signature_stale']);
  });

  it('EVM-049 AC7 past 72 hours signature_stale_72h at most once in 24 hours', () => {
    const now = at('2026-10-23T07:00:01Z');
    expect(signatureAlertsDue({ ...base, now, lastStaleAlert: at('2026-10-21T07:15:00Z') })).toEqual(['signature_stale_72h']);
    expect(
      signatureAlertsDue({ ...base, now, lastStaleAlert: at('2026-10-21T07:15:00Z'), last72hAlert: at('2026-10-23T00:00:00Z') }),
    ).toEqual([]);
    const daily = { ...base, lastStaleAlert: at('2026-10-21T07:15:00Z'), last72hAlert: at('2026-10-23T07:00:01Z') };
    expect(signatureAlertsDue({ ...daily, now: at('2026-10-24T07:00:00Z') })).toEqual([]);
    expect(signatureAlertsDue({ ...daily, now: at('2026-10-24T07:00:01Z') })).toEqual(['signature_stale_72h']);
    // both at once when nothing was raised yet
    expect(signatureAlertsDue({ ...base, now })).toEqual(['signature_stale', 'signature_stale_72h']);
  });
});

describe('EVM-049 AC7 the reply of clamd to VERSION is untrusted (strict shape, UTC)', () => {
  it('EVM-049 AC7 a good reply is read as UTC, with a one-digit day padded by a space', () => {
    expect(parseClamdVersion('ClamAV 1.5.4/27800/Wed Oct 28 07:03:12 2026\0')).toEqual(at('2026-10-28T07:03:12Z'));
    expect(parseClamdVersion('ClamAV 1.5.4/27800/Thu Oct  1 00:00:00 2026\n')).toEqual(at('2026-10-01T00:00:00Z'));
  });

  it.each([
    '',
    '\0',
    'ClamAV 1.5.4\0',
    'ClamAV 1.5.4/27800/Wed Oct 28 07:03:12 2026 extra\0',
    'ClamAV 1.5.4/27800/Wed Foo 28 07:03:12 2026\0',
    'ClamAV 1.5.4/27800/Wed Feb 31 07:03:12 2026\0',
    'ClamAV 1.5.4/27800/Wed Oct 28 25:03:12 2026\0',
    `ClamAV ${'9'.repeat(300)}/1/Wed Oct 28 07:03:12 2026\0`,
    'UNKNOWN COMMAND\0',
  ])('EVM-049 AC7 %j is not a date of the signatures', (reply) => {
    expect(() => parseClamdVersion(reply)).toThrow(MalwareScanError);
  });
});

describe('EVM-049 AC7 the client of clamd sends only the fixed command VERSION', () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function startClamd(reply: Buffer | undefined, options: { silent?: boolean } = {}): Promise<{ port: number; received: Buffer[] }> {
    const received: Buffer[] = [];
    const server = createServer((socket: Socket) => {
      socket.on('error', () => undefined);
      socket.on('data', (data: Buffer) => {
        received.push(data);
        if (options.silent === true) return;
        if (reply === undefined) socket.destroy();
        else socket.end(reply);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return { port: typeof address === 'object' && address !== null ? address.port : 0, received };
  }

  it('EVM-049 AC7 asks zVERSION and nothing else, and returns the date', async () => {
    const clamd = await startClamd(Buffer.from('ClamAV 1.5.4/27800/Wed Oct 28 07:03:12 2026\0', 'latin1'));
    const scanner = new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: clamd.port });
    await expect(scanner.signatureDate()).resolves.toEqual(at('2026-10-28T07:03:12Z'));
    expect(Buffer.concat(clamd.received).toString('latin1')).toBe('zVERSION\0');
  });

  it('EVM-049 AC7 garbage, a reply that is too long, silence, a dropped connection and an unreachable clamd are all MalwareScanError', async () => {
    const garbage = await startClamd(Buffer.from('hello\0'));
    await expect(new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: garbage.port }).signatureDate()).rejects.toBeInstanceOf(
      MalwareScanError,
    );
    const long = await startClamd(Buffer.alloc(600, 65));
    await expect(new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: long.port }).signatureDate()).rejects.toBeInstanceOf(
      MalwareScanError,
    );
    const silent = await startClamd(undefined, { silent: true });
    await expect(
      new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: silent.port }, { idleTimeoutMs: 100 }).signatureDate(),
    ).rejects.toBeInstanceOf(MalwareScanError);
    const dropped = await startClamd(undefined);
    await expect(new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: dropped.port }).signatureDate()).rejects.toBeInstanceOf(
      MalwareScanError,
    );
    const gone = await startClamd(Buffer.from('x'));
    const port = gone.port;
    servers.pop()?.close();
    await expect(new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port }).signatureDate()).rejects.toBeInstanceOf(MalwareScanError);
  });

  it('EVM-049 AC7 the fake scanner reports a date, or fails like a scanner that does not answer', async () => {
    const fake = new FakeMalwareScanner();
    fake.signatures = at('2026-10-20T07:00:00Z');
    await expect(fake.signatureDate()).resolves.toEqual(at('2026-10-20T07:00:00Z'));
    fake.signatures = 'unknown';
    await expect(fake.signatureDate()).rejects.toBeInstanceOf(MalwareScanError);
    fake.signatures = new Date();
    fake.mode = 'unavailable';
    await expect(fake.signatureDate()).rejects.toBeInstanceOf(MalwareScanError);
  });
});

describe('EVM-049 AC4 nothing leaves the system and nothing releases a quarantined file', () => {
  it('EVM-049 AC4 the only operation that changes a medium after its creation is the new scan (rescanMediaAsset)', () => {
    const changing = Object.entries(AUTHZ_MANIFEST)
      .filter(([, operation]) => operation.path.includes('/media-assets') && operation.method !== 'get')
      .map(([id]) => id)
      .sort();
    expect(changing).toEqual(
      ['abortUploadSession', 'completeUploadSession', 'createMediaAssets', 'createUploadSession', 'rescanMediaAsset'].sort(),
    );
    expect(Object.keys(AUTHZ_MANIFEST).filter((id) => /release|override|unquarantine|whitelist|approveMedia/i.test(id))).toEqual([]);
    const rescan = AUTHZ_MANIFEST['rescanMediaAsset']?.authz;
    expect(rescan).toMatchObject({ roles: ['administrator'], channels: ['web'], stepUp: true });
  });

  it('EVM-049 AC4 P5 the scanner and the storage have no HTTP client to a host outside the configuration (no fetch, no node:http, no third-party SDK)', () => {
    const dir = join(import.meta.dirname, '..', '..', 'src', 'platform', 'malware-scan');
    for (const name of readdirSync(dir)) {
      const source = readFileSync(join(dir, name), 'utf8');
      expect(source, name).not.toMatch(/\bfetch\(|node:https?|from 'axios'|from 'undici'|virustotal|metadefender/i);
    }
  });
});

describe('EVM-049 D9 the limits of unfinished media come from the environment and fail closed', () => {
  const MEDIA = {
    S3_ENDPOINT: 'https://s3.fr-par.scw.cloud',
    S3_REGION: 'fr-par',
    MEDIA_BUCKET: 'evia-staging-media',
    MEDIA_S3_ACCESS_KEY_ID: 'SCWSYNTHETIC0000',
    MEDIA_S3_SECRET_ACCESS_KEY: 'synthetic-secret-value',
  };

  it('EVM-049 D9 the defaults are 200 per user, 500 per order and 7 days', () => {
    expect(loadMediaConfig(MEDIA)).toMatchObject({
      ok: true,
      media: { limits: { maxPendingPerUser: 200, maxPendingPerOrder: 500, abandonAfterDays: 7 } },
    });
  });

  it('EVM-049 D9 a valid value is taken; zero, a sign, a fraction, text and a huge number are a start error naming the key only', () => {
    expect(
      loadMediaConfig({ ...MEDIA, MEDIA_MAX_PENDING_PER_USER: '10', MEDIA_MAX_PENDING_PER_ORDER: '20', MEDIA_ABANDON_AFTER_DAYS: '3' }),
    ).toMatchObject({ ok: true, media: { limits: { maxPendingPerUser: 10, maxPendingPerOrder: 20, abandonAfterDays: 3 } } });
    for (const bad of ['0', '-1', '1.5', 'many', '99999999', ' 5']) {
      expect(loadMediaConfig({ ...MEDIA, MEDIA_MAX_PENDING_PER_USER: bad }), bad).toEqual({
        ok: false,
        keys: ['MEDIA_MAX_PENDING_PER_USER'],
      });
    }
    expect(loadMediaConfig({ ...MEDIA, MEDIA_ABANDON_AFTER_DAYS: '400' })).toEqual({ ok: false, keys: ['MEDIA_ABANDON_AFTER_DAYS'] });
  });
});

describe('EVM-049 AC5 the storage removes an object the way a versioned bucket does (a delete marker)', () => {
  it('EVM-049 AC5 after deleteObject a plain read finds nothing, a pinned version stays, a missing key is not an error, a new version revives it', async () => {
    const storage = new InMemoryObjectStorage();
    const { versionId } = storage.putObject('media/2026/09/x/original', Buffer.from('synthetic'));
    await storage.deleteObject('media/2026/09/x/original');
    expect(storage.isDeleted('media/2026/09/x/original')).toBe(true);
    await expect(storage.head('media/2026/09/x/original')).resolves.toBeUndefined();
    await expect(storage.getObjectStream('media/2026/09/x/original', {})).rejects.toBeInstanceOf(ObjectStorageError);
    await expect(storage.getObjectStream('media/2026/09/x/original', { versionId })).resolves.toBeDefined();
    await expect(storage.deleteObject('media/2026/09/never/original')).resolves.toBeUndefined();
    storage.putObject('media/2026/09/x/original', Buffer.from('again'));
    expect(storage.isDeleted('media/2026/09/x/original')).toBe(false);
    storage.unavailable = true;
    await expect(storage.deleteObject('media/2026/09/x/original')).rejects.toBeInstanceOf(ObjectStorageError);
  });
});
