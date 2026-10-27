// @ts-check
/**
 * init-secrets.sh in a Linux container (EVM-007 AC7; ADR-0018 "Gdzie żyją sekrety"; SR-INFRA-05; SR-LOG-02). Run:
 * docker compose -f compose.yaml run --rm deploy-sh-tests (local gate and CI). The values are random, so the tests
 * check shapes (the formats of apps/api/src/platform/config/config.ts) and that no value reaches stdout or stderr.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../init-secrets.sh', import.meta.url).pathname;
const MANIFEST = new URL('../secrets.manifest.json', import.meta.url).pathname;
const UID = process.getuid?.() ?? 0;
const GENERATED = [
  'postgres-password',
  'evia-migrator-password',
  'evia-api-password',
  'database-url-migrator',
  'database-url-app',
  'cursor-key',
  'field-encryption-keys',
  'login-throttle-key',
];
// EVM-084: provided by hand in the IaC session; the script neither generates nor reads them
const EXTERNAL = [
  'media-s3-secret-access-key',
  'deletion-register-s3-secret-access-key',
  'backup-s3-secret-access-key',
  'pgbackrest-cipher-pass',
  'restore-reader-s3-secret-access-key',
  'restore-orchestrator-s3-secret-access-key',
  'media-backup-reader-s3-secret-access-key',
  'restore-hcloud-token',
  'rclone-crypt-password',
  'rclone-crypt-password2',
];
const RANDOM_KEYS = ['cursor-key', 'login-throttle-key', 'postgres-password', 'evia-migrator-password', 'evia-api-password'];
const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;

/** @type {string} */
let root;
const dir = () => join(root, 'etc/evia/secrets');
const read = (/** @type {string} */ name) => readFileSync(join(dir(), name), 'utf8');
const names = () => readdirSync(dir()).sort();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'init-secrets-'));
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  chmodSync(dir(), 0o700);
  mkdirSync(join(root, 'etc/evia/deploy-agent'), { recursive: true });
  writeFileSync(join(root, 'etc/evia/deploy-agent/secrets.manifest.json'), readFileSync(MANIFEST));
});

function run(/** @type {string[]} */ args = [], /** @type {Record<string, string>} */ env = {}) {
  const result = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', EVIA_ROOT: root, EVIA_EXPECTED_UID: String(UID), ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const snapshot = () => JSON.stringify(names().map((name) => [name, read(name), statSync(join(dir(), name)).mtimeMs]));

describe('EVM-084 AC2: the S3 keys, the pgBackRest password and the restore secrets are provided by hand', () => {
  it('EVM-084 AC2: init-secrets creates none of them, succeeds with a note and --check reports each as MISSING (exit 1)', () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    for (const name of EXTERNAL) assert.ok(!names().includes(name), name);
    assert.match(result.stderr, /provide media-s3-secret-access-key by hand/);
    const checked = run(['--check']);
    assert.equal(checked.status, 1);
    for (const name of EXTERNAL) assert.match(checked.stdout, new RegExp(`^${name} MISSING$`, 'm'));
  });

  it('EVM-084 AC2: a value provided by hand is never printed, changed or read; a file with another mode is refused', () => {
    run();
    writeFileSync(join(dir(), 'media-s3-secret-access-key'), 'SYNTHETIC-MEDIA-SECRET-VALUE-0123456789', { mode: 0o600 });
    const before = read('media-s3-secret-access-key');
    const again = run();
    const checked = run(['--check']);
    assert.equal(read('media-s3-secret-access-key'), before);
    assert.doesNotMatch(`${again.stdout}${again.stderr}${checked.stdout}${checked.stderr}`, /SYNTHETIC-MEDIA-SECRET/);
    assert.match(checked.stdout, /^media-s3-secret-access-key size=\d+ mode=600 owner=\d+$/m);
    chmodSync(join(dir(), 'media-s3-secret-access-key'), 0o644);
    assert.equal(run().status, 1);
  });

  it('EVM-084 AC2 (SR-INFRA-03, security-engineer P7): every key reaches only the services listed, and the restore secrets no container', () => {
    const services = JSON.parse(readFileSync(MANIFEST, 'utf8')).services;
    const holders = (/** @type {string} */ file) => Object.keys(services).filter((name) => services[name].files.includes(file));
    assert.deepEqual(holders('media-s3-secret-access-key'), ['api']);
    assert.deepEqual(holders('deletion-register-s3-secret-access-key'), ['worker']);
    assert.deepEqual(holders('pgbackrest-cipher-pass'), ['postgres']);
    assert.deepEqual(holders('backup-s3-secret-access-key'), ['postgres']);
    for (const file of EXTERNAL.filter((name) => /^(restore|rclone|media-backup)/.test(name))) assert.deepEqual(holders(file), [], file);
  });
});

describe('EVM-007 AC7: init-secrets.sh creates the secrets of the services', () => {
  it('EVM-007 AC7: an empty directory gets every file, 0600, and every file of the manifest exists', () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(names(), [...GENERATED].sort());
    for (const name of GENERATED) assert.equal(statSync(join(dir(), name)).mode & 0o777, 0o600, name);
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    for (const service of Object.values(manifest.services))
      for (const file of /** @type {{ files: string[] }} */ (service).files)
        assert.ok(existsSync(join(dir(), file)) !== EXTERNAL.includes(file), file);
  });

  it('EVM-007 AC7: formats — keys base64url 32 bytes, URLs with the roles, host, port and database of the runtime, field keys id:key', () => {
    run();
    for (const name of RANDOM_KEYS) assert.match(read(name), B64URL_32, name);
    for (const name of ['cursor-key', 'login-throttle-key'])
      assert.equal(Buffer.from(read(name), 'base64url').toString('base64url'), read(name));
    const [id, key, ...rest] = read('field-encryption-keys').split(/[:,]/);
    assert.match(id ?? '', /^[a-z0-9][a-z0-9-]{0,15}$/);
    assert.match(key ?? '', B64URL_32);
    assert.deepEqual(rest, []);
    for (const [file, role, passwordFile] of [
      ['database-url-migrator', 'evia_migrator', 'evia-migrator-password'],
      ['database-url-app', 'evia_api', 'evia-api-password'],
    ]) {
      const url = new URL(read(file ?? ''));
      assert.equal(url.protocol, 'postgresql:');
      assert.equal(url.username, role);
      assert.equal(url.password, read(passwordFile ?? ''));
      assert.equal(`${url.hostname}:${url.port}${url.pathname}`, 'postgres:5432/evia');
      assert.equal(url.search, '?sslmode=disable');
    }
    assert.equal(new Set(RANDOM_KEYS.map(read)).size, RANDOM_KEYS.length, 'every secret is separate');
    assert.notEqual(read('field-encryption-keys').slice(3), read('cursor-key'));
  });

  it('EVM-007 AC7: no value reaches stdout or stderr (create and --check); only file names', () => {
    const created = run();
    const checked = run(['--check']);
    const output = `${created.stdout}${created.stderr}${checked.stdout}${checked.stderr}`;
    for (const name of GENERATED) {
      for (const part of read(name).split(/[:@/?]/)) if (part.length >= 16) assert.ok(!output.includes(part), `${name} leaked`);
      assert.ok(output.includes(name));
    }
  });

  it('EVM-007 AC7: the second run changes nothing (contents, modes, times)', () => {
    run();
    const before = snapshot();
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(snapshot(), before);
    assert.doesNotMatch(second.stdout, /created/);
  });

  it('EVM-007 AC7: only MISSING files are created; an existing one (even with a foreign value) and other files stay as they are', () => {
    writeFileSync(join(dir(), 'cursor-key'), 'existing-cursor', { mode: 0o600 });
    writeFileSync(join(dir(), 'luks-pgdata.key'), 'luks-bytes', { mode: 0o600 });
    writeFileSync(join(dir(), 'github-pat'), 'pat', { mode: 0o600 });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(read('cursor-key'), 'existing-cursor');
    assert.equal(read('luks-pgdata.key'), 'luks-bytes');
    assert.equal(read('github-pat'), 'pat');
    assert.doesNotMatch(result.stdout, /cursor-key|luks|github-pat/);
    assert.deepEqual(names(), [...GENERATED, 'github-pat', 'luks-pgdata.key'].sort());
  });

  it('EVM-007 AC7: a missing URL is derived from the existing password; a missing password is taken from the existing URL', () => {
    const password = 'A'.repeat(43);
    writeFileSync(join(dir(), 'evia-api-password'), password, { mode: 0o600 });
    const url = `postgresql://evia_migrator:${'B'.repeat(43)}@postgres:5432/evia?sslmode=disable`;
    writeFileSync(join(dir(), 'database-url-migrator'), url, { mode: 0o600 });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(read('database-url-app'), `postgresql://evia_api:${password}@postgres:5432/evia?sslmode=disable`);
    assert.equal(read('database-url-migrator'), url);
    assert.equal(read('evia-migrator-password'), 'B'.repeat(43));
  });

  it('EVM-007 AC7: an existing URL without a usable password is refused and its password file is not invented', () => {
    writeFileSync(join(dir(), 'database-url-app'), 'postgresql://evia_api@postgres:5432/evia', { mode: 0o600 });
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /REFUSED/);
    assert.ok(!names().includes('evia-api-password'));
  });

  it('EVM-007 AC7: --check prints name, size, mode and owner only; exit 1 while a file is missing, 0 when complete', () => {
    writeFileSync(join(dir(), 'cursor-key'), 'x'.repeat(43), { mode: 0o600 });
    const incomplete = run(['--check']);
    assert.equal(incomplete.status, 1);
    assert.match(incomplete.stdout, /^cursor-key size=43 mode=600 owner=\d+$/m);
    assert.match(incomplete.stdout, /^postgres-password MISSING$/m);
    assert.deepEqual(names(), ['cursor-key'], '--check writes nothing');
    run();
    const generatedOnly = run(['--check']);
    assert.equal(generatedOnly.status, 1, 'the keys provided by hand are still missing');
    for (const name of EXTERNAL) writeFileSync(join(dir(), name), 'synthetic', { mode: 0o600 });
    const complete = run(['--check']);
    assert.equal(complete.status, 0);
    assert.equal(complete.stdout.trim().split('\n').length, GENERATED.length + EXTERNAL.length);
  });

  it('EVM-007 AC7: a directory of another owner or mode is refused, nothing is written', () => {
    chmodSync(dir(), 0o755);
    const mode = run();
    assert.equal(mode.status, 1);
    assert.match(mode.stderr, /0700 root/);
    chmodSync(dir(), 0o700);
    const owner = run([], { EVIA_EXPECTED_UID: String(UID + 1) });
    assert.equal(owner.status, 1);
    assert.deepEqual(names(), []);
  });

  it('EVM-007 AC7: an existing file with another mode, or a symbolic link, is refused before anything is created', () => {
    writeFileSync(join(dir(), 'cursor-key'), 'x');
    chmodSync(join(dir(), 'cursor-key'), 0o644);
    assert.equal(run().status, 1);
    assert.deepEqual(names(), ['cursor-key']);
    chmodSync(join(dir(), 'cursor-key'), 0o600);
    symlinkSync('/etc/hostname', join(dir(), 'login-throttle-key'));
    assert.equal(run().status, 1);
    assert.deepEqual(names(), ['cursor-key', 'login-throttle-key']);
  });

  it('EVM-007 AC7: a manifest asking for a file the script does not know fails (every manifest file must exist)', () => {
    writeFileSync(
      join(root, 'etc/evia/deploy-agent/secrets.manifest.json'),
      JSON.stringify({ services: { api: { uid: 10001, files: ['cursor-key', 'unknown-secret'] } } }),
    );
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown-secret/);
  });

  it('EVM-007 AC7: without a manifest (installed later in the session) the run succeeds with a note; the directory is created 0700', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'init-secrets-fresh-'));
    const result = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', EVIA_ROOT: fresh, EVIA_EXPECTED_UID: String(UID) },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /no secrets manifest yet/);
    assert.equal(statSync(join(fresh, 'etc/evia/secrets')).mode & 0o777, 0o700);
  });

  it('EVM-007 AC7: usage errors are refused', () => {
    assert.equal(run(['--bogus']).status, 1);
    assert.equal(run(['--check', 'x']).status, 1);
  });
});
