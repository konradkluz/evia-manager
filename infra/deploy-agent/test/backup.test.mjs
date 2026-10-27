// @ts-check
/**
 * The backup of the database, the copy of the media and the verification of the buckets (EVM-084 AC1, AC2; ADR-0009, ADR-0011;
 * SR-INFRA-02; security-engineer P8). pgBackRest and rclone are stand-ins on PATH; the S3 API is a stand-in on the loopback that
 * behaves like the policies of modules/object-storage (and, in the negative tests, like a wrongly configured bucket). The real
 * backup, copy and verification run in the IaC session (status stays in-progress). Run: docker compose -f compose.yaml run --rm deploy-sh-tests
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = new URL('../restore/', import.meta.url).pathname;
const SECRET_VALUES = {
  'media-s3-secret-access-key': 'SYNTHETIC-MEDIA-SECRET-MARKER',
  'deletion-register-s3-secret-access-key': 'SYNTHETIC-REGISTER-SECRET-MARKER',
  'backup-s3-secret-access-key': 'SYNTHETIC-BACKUP-SECRET-MARKER',
  'media-backup-reader-s3-secret-access-key': 'SYNTHETIC-READER-SECRET-MARKER',
  'media-copy-storagebox-password': 'SYNTHETIC-BOX-PASSWORD-MARKER',
  'rclone-crypt-password': 'SYNTHETIC-CRYPT-ONE-MARKER',
  'rclone-crypt-password2': 'SYNTHETIC-CRYPT-TWO-MARKER',
};
/** @type {string} */
let root;
/** @type {{ port: number, close: () => Promise<void>, seen: string[] } | undefined} */
let s3;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'backup-'));
  mkdirSync(join(root, 'secrets'), { mode: 0o700 });
  mkdirSync(join(root, 'bin'));
  for (const [name, value] of Object.entries(SECRET_VALUES)) writeFileSync(join(root, 'secrets', name), value, { mode: 0o600 });
});
afterEach(async () => {
  await s3?.close();
  s3 = undefined;
});

function exec(/** @type {string} */ script, /** @type {string[]} */ args = [], /** @type {Record<string, string>} */ extra = {}) {
  return new Promise((resolve) => {
    const child = spawn('bash', [join(DIR, script), ...args], {
      env: {
        PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
        EVIA_RESTORE_TEST_MODE: '1',
        EVIA_RESTORE_NOW: '2026-10-27T12:00:00Z',
        EVIA_RESTORE_STATE: join(root, 'state'),
        EVIA_METRICS_DIR: join(root, 'metrics'),
        EVIA_SECRETS_DIR: join(root, 'secrets'),
        ...extra,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  }).then((value) => /** @type {{ status: number | null, stdout: string, stderr: string }} */ (value));
}
const read = (/** @type {string} */ path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const events = () =>
  read(join(root, 'state/events.jsonl'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const metrics = () => read(join(root, 'metrics/evia_restore.prom'));
function noSecret(/** @type {string} */ output) {
  for (const value of Object.values(SECRET_VALUES)) assert.ok(!output.includes(value), 'a secret leaked');
}

describe('EVM-084 AC1: the scheduled backup of the database', () => {
  const pgbackrest = (/** @type {number} */ failOn) => {
    // failOn: 0 none, 1 backup fails, 2 check fails
    writeFileSync(
      join(root, 'bin/fake-pgbackrest'),
      `#!/bin/bash\necho "$*" >> "${join(root, 'pgbackrest.log')}"\ncase "$1" in backup) [ "${failOn}" = 1 ] && exit 1 ;; check) [ "${failOn}" = 2 ] && exit 1 ;; esac\nexit 0\n`,
      { mode: 0o755 },
    );
    return { EVIA_PGBACKREST_BIN: join(root, 'bin/fake-pgbackrest') };
  };

  it('EVM-084 AC1: a backup and a check of the archive; success is a metric and an event', async () => {
    const run = await exec('backup.sh', ['diff'], pgbackrest(0));
    assert.equal(run.status, 0, run.stderr);
    assert.equal(read(join(root, 'pgbackrest.log')), 'backup --type=diff\ncheck\n');
    assert.match(metrics(), /^evia_backup_last_success_timestamp_seconds 1793102400$/m);
    assert.match(metrics(), /^evia_backup_last_failed 0$/m);
    assert.ok(events().some((item) => item.event === 'backup-succeeded' && item.type === 'diff'));
  });

  it('EVM-084 AC1: a failed backup or a failed archive check is a local event and a metric, exit code 1', async () => {
    for (const failOn of [1, 2]) {
      const run = await exec('backup.sh', ['full'], pgbackrest(failOn));
      assert.equal(run.status, 1);
      assert.match(metrics(), /^evia_backup_last_failed 1$/m);
      assert.match(metrics(), /^evia_backup_last_failure_timestamp_seconds 1793102400$/m);
      assert.ok(events().some((item) => item.event === 'backup-failed' && item.type === 'full'));
    }
  });

  it('EVM-084 AC1: only full, diff and incr are accepted', async () => {
    for (const args of [[], ['weird'], ['full', 'x'], ['--type=full']])
      assert.equal((await exec('backup.sh', args, pgbackrest(0))).status, 1, args.join(' '));
  });
});

describe('EVM-084 AC2: the copy of the media to the Storage Box', () => {
  const env = () => ({
    EVIA_RCLONE_BIN: join(root, 'bin/fake-rclone'),
    S3_ENDPOINT: 'https://s3.pl-waw.scw.cloud',
    S3_REGION: 'pl-waw',
    MEDIA_BUCKET: 'evia-staging-media',
    MEDIA_BACKUP_READER_ACCESS_KEY_ID: 'SCWREADER0001',
    STORAGEBOX_HOST: 'u0001.your-storagebox.de',
    STORAGEBOX_COPY_USER: 'sub-copy',
  });
  const rclone = (/** @type {boolean} */ fails) =>
    writeFileSync(
      join(root, 'bin/fake-rclone'),
      `#!/bin/bash\nif [ "$1" = obscure ]; then echo "obscured-$(cat | wc -c)"; exit 0; fi\necho "$*" >> "${join(root, 'rclone-args.log')}"\nenv | grep '^RCLONE_CONFIG_' | sed 's/=.*//' | sort >> "${join(root, 'rclone-env-names.log')}"\nenv | grep '^RCLONE_CONFIG_' >> "${join(root, 'rclone-env.log')}"\n${fails ? 'exit 1' : 'exit 0'}\n`,
      { mode: 0o755 },
    );

  it('EVM-084 AC2: `rclone copy` (never sync) from the bucket with the READ key to the crypt remote; secrets only in the environment of rclone', async () => {
    rclone(false);
    const run = await exec('media-copy.sh', [], env());
    assert.equal(run.status, 0, run.stderr);
    const args = read(join(root, 'rclone-args.log'));
    assert.match(args, /^--config \/dev\/null copy --checksum src:evia-staging-media media:$/m);
    assert.doesNotMatch(args, /\b(sync|move|purge|delete)\b/);
    const names = read(join(root, 'rclone-env-names.log'));
    assert.match(names, /RCLONE_CONFIG_MEDIA_FILENAME_ENCRYPTION/);
    assert.match(read(join(root, 'rclone-env.log')), /RCLONE_CONFIG_MEDIA_FILENAME_ENCRYPTION=standard/);
    assert.match(read(join(root, 'rclone-env.log')), /RCLONE_CONFIG_SRC_ACCESS_KEY_ID=SCWREADER0001/);
    assert.match(read(join(root, 'rclone-env.log')), /RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY=SYNTHETIC-READER-SECRET-MARKER/);
    assert.ok(!args.includes('SYNTHETIC'), 'no secret in argv');
    noSecret(run.stdout + run.stderr + read(join(root, 'state/events.jsonl')));
    assert.match(metrics(), /^evia_media_copy_last_success_timestamp_seconds 1793102400$/m);
  });

  it('EVM-084 AC2: a failed copy is an event and a metric, exit code 1; odd configuration is refused', async () => {
    rclone(true);
    const failed = await exec('media-copy.sh', [], env());
    assert.equal(failed.status, 1);
    assert.match(metrics(), /^evia_media_copy_last_failed 1$/m);
    assert.ok(events().some((item) => item.event === 'media-copy-failed'));
    assert.equal((await exec('media-copy.sh', [], { ...env(), MEDIA_BUCKET: 'Bad Bucket' })).status, 1);
    assert.equal((await exec('media-copy.sh', [], { ...env(), STORAGEBOX_HOST: 'host;rm' })).status, 1);
  });
});

/** Stand-in for the buckets: answers like the policies of the module, or wrongly when `broken` names a defect. */
async function startS3(/** @type {string} */ broken = '') {
  /** @type {Set<string>} */
  const existing = new Set();
  /** @type {string[]} */
  const seen = [];
  const keyIds = { SCWMEDIA0001: 'media', SCWREGISTER01: 'register', SCWBACKUP0001: 'backup' };
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const method = request.method ?? 'GET';
      const credential = /Credential=([A-Za-z0-9]+)\//.exec(String(request.headers.authorization ?? ''))?.[1] ?? '';
      const who = /** @type {Record<string, string>} */ (keyIds)[credential] ?? 'anonymous';
      seen.push(`${method} ${url.pathname}${url.search} ${who}`);
      const admin =
        ['policy', 'versioning', 'lifecycle', 'retention'].some((name) => url.searchParams.has(name)) || url.searchParams.has('versionId');
      const reply = (/** @type {number} */ code, /** @type {Record<string, string>} */ headers = {}) => {
        response.writeHead(code, headers);
        response.end();
      };
      if (who === 'anonymous') return reply(broken === 'anonymous-open' ? 200 : 403);
      if (admin) return reply(broken === 'admin-allowed' && who === 'media' ? 200 : 403);
      const object = url.pathname;
      if (who === 'register') {
        if (method === 'GET') return reply(broken === 'register-get' ? 200 : 403);
        if (method === 'DELETE') return reply(403);
        if (method === 'PUT') {
          const conditional = request.headers['if-none-match'] === '*';
          if (!conditional) return reply(broken === 'overwrite' ? 200 : 403);
          if (existing.has(object)) return reply(412);
          existing.add(object);
          return reply(200);
        }
      }
      if (who === 'media' && method === 'PUT') return reply(200);
      if (who === 'media' && method === 'HEAD') return reply(200, broken === 'no-sse' ? {} : { 'x-amz-server-side-encryption': 'AES256' });
      return reply(403);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  return { port, seen, close: () => new Promise((resolve) => server.close(() => resolve(undefined))) };
}

describe('EVM-084 AC2: bucket-verify.sh', () => {
  const env = () => ({
    S3_ENDPOINT: `http://127.0.0.1:${s3?.port}`,
    S3_REGION: 'pl-waw',
    MEDIA_BUCKET: 'evia-staging-media',
    DELETION_REGISTER_BUCKET: 'evia-staging-deletion-register',
    DB_BACKUP_BUCKET: 'evia-staging-db-backup',
    MEDIA_S3_ACCESS_KEY_ID: 'SCWMEDIA0001',
    DELETION_REGISTER_S3_ACCESS_KEY_ID: 'SCWREGISTER01',
    BACKUP_WRITER_ACCESS_KEY_ID: 'SCWBACKUP0001',
  });

  it('EVM-084 AC2: a correctly configured storage passes: anonymous 403, the register adds once and nothing else, no administrative action', async () => {
    s3 = await startS3();
    const run = await exec('bucket-verify.sh', [], env());
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.doesNotMatch(run.stdout, /FAIL/);
    for (const line of [
      'anonymous list of evia-staging-media',
      'register: the second PUT with If-None-Match is refused',
      'register: an overwrite (PUT without If-None-Match) is AccessDenied',
      'register: DELETE is AccessDenied',
      'backup key: DeleteObjectVersion is AccessDenied',
      'the media object is encrypted (SSE-ONE)',
    ])
      assert.ok(run.stdout.includes(line), line);
    noSecret(run.stdout + run.stderr);
    assert.ok(s3.seen.every((entry) => !/SYNTHETIC/.test(entry)));
  });

  it('EVM-084 AC2: every defect is a FAIL line and exit code 1 (public bucket, overwrite or read by the register key, administrative action, no SSE)', async () => {
    for (const [defect, expected] of [
      ['anonymous-open', 'anonymous'],
      ['overwrite', 'overwrite'],
      ['register-get', 'GET is AccessDenied'],
      ['admin-allowed', 'PutBucketPolicy'],
      ['no-sse', 'x-amz-server-side-encryption'],
    ]) {
      await s3?.close();
      s3 = await startS3(defect);
      const run = await exec('bucket-verify.sh', [], env());
      assert.equal(run.status, 1, defect);
      assert.match(run.stdout, new RegExp(`FAIL: .*${expected}`), defect);
    }
  });

  it('EVM-084 AC2: only https (http on the loopback in test mode) is accepted as the endpoint', async () => {
    s3 = await startS3();
    assert.equal((await exec('bucket-verify.sh', [], { ...env(), S3_ENDPOINT: 'http://example.com' })).status, 1);
    assert.equal((await exec('bucket-verify.sh', [], { ...env(), EVIA_RESTORE_TEST_MODE: '' })).status, 1);
  });
});
