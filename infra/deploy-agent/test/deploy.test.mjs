// @ts-check
/**
 * deploy.sh in a Linux container with stand-ins for docker and curl on PATH (EVM-007 AC4, AC7; ADR-0018 V6; architect 16;
 * security-engineer B "Granica zaufania"). Run: docker compose -f compose.yaml run --rm deploy-sh-tests (local gate and
 * CI). Not run natively on Windows: the shell script needs bash, GNU coreutils and jq — the container has them.
 * The shell is not counted by coverage; every decision of the verifier is TypeScript (services/deploy-agent).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../deploy.sh', import.meta.url).pathname;
const SECRETS_SCRIPT = new URL('../secrets.sh', import.meta.url).pathname;
const sha256 = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');
const sha = (/** @type {string} */ label) => createHash('sha1').update(label).digest('hex');
const API_REPO = 'ghcr.io/evia-test/evia-api';
const WEB_REPO = 'ghcr.io/evia-test/evia-web';
const NETWORK = 'evia-runtime';
const BASELINE = sha('baseline');

const FAKE_DOCKER = `#!/bin/bash
printf 'docker %s | COMPOSE_FILE=%s\\n' "$*" "\${COMPOSE_FILE-unset}" >> "$FAKE_LOG"
case "$*" in
  *" run --rm --no-deps migrate"*) exit "\${FAKE_MIGRATE_EXIT:-0}" ;;
  "pull "*) exit "\${FAKE_PULL_EXIT:-0}" ;;
  *" exec -T caddy caddy reload"*) exit "\${FAKE_RELOAD_EXIT:-0}" ;;
  "inspect "*) echo 10.0.0.5 ;;
  "image inspect --format {{.Os}}/{{.Architecture}} -- "*web*) echo "\${FAKE_WEB_PLATFORM:-linux/arm64}" ;;
  "image inspect --format {{.Os}}/{{.Architecture}} -- "*) echo "\${FAKE_API_PLATFORM:-linux/arm64}" ;;
  "version --format {{.Server.Os}}/{{.Server.Arch}}") echo "\${FAKE_HOST_PLATFORM:-linux/arm64}" ;;
  "image ls "*) cat "$FAKE_IMAGES" 2> /dev/null || true ;;
esac
exit 0
`;
const FAKE_CURL = `#!/bin/bash
printf 'curl %s\\n' "$*" >> "$FAKE_LOG"
url="\${*: -1}"
case "$url" in
  */api/health) exit "\${FAKE_HEALTH_EXIT:-0}" ;;
  http://*/api/version) printf '%s' "$FAKE_VERSION" ;;
  https://*/version) printf '%s' "\${FAKE_EDGE:-$FAKE_VERSION}" ;;
esac
exit 0
`;

/** The canonical compose document as the verifier writes it (minimal, within the allow-list of deploy.sh). */
function compose(/** @type {string} */ api, /** @type {string} */ web, /** @type {Record<string, unknown>} */ extra = {}) {
  const service = (/** @type {string} */ name, /** @type {string} */ image, /** @type {string} */ user) => ({
    image,
    pull_policy: 'never',
    user,
    read_only: true,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    networks: [NETWORK],
    ...(name === 'web' ? {} : { volumes: [`/run/evia/secrets/${name}:/run/secrets:ro`] }),
  });
  return JSON.stringify({
    services: {
      api: { ...service('api', api, '10001:10001'), ...extra },
      migrate: service('migrate', api, '10003:10003'),
      web: service('web', web, '10004:10004'),
      worker: service('worker', api, '10002:10002'),
    },
    networks: { [NETWORK]: { external: true, name: NETWORK } },
  });
}

/** A result of the verifier for a commit (overrides change single fields). */
function result(
  /** @type {string} */ label,
  /** @type {Record<string, unknown>} */ overrides = {},
  /** @type {Record<string, unknown>} */ composeExtra = {},
) {
  const commit = sha(label);
  const api = `${API_REPO}@sha256:${sha256(`api-${label}`)}`;
  const web = `${WEB_REPO}@sha256:${sha256(`web-${label}`)}`;
  const manifest = JSON.stringify({ schemaVersion: 1, commit, images: { api, web }, compose: 'infra/runtime/compose.staging.yaml' });
  const document = compose(api, web, composeExtra);
  return {
    schemaVersion: 1,
    checkedAt: '2026-10-21T10:00:00.000Z',
    decision: 'deploy',
    commit,
    manifestSha256: sha256(manifest),
    manifest,
    images: { api, web },
    compose: document,
    composeSha256: sha256(document),
    activityEventId: 101,
    head: commit,
    reasons: ['test'],
    ...overrides,
  };
}

/** @type {string} */ let root;
/** @type {string} */ let log;

function setup() {
  root = mkdtempSync(join(tmpdir(), 'deploy-sh-'));
  const bin = join(root, 'bin');
  for (const dir of ['bin', 'etc/evia/deploy-agent', 'etc/evia/caddy', 'etc/evia/runtime', 'var/lib/evia/agent/out', 'run/evia/secrets'])
    mkdirSync(join(root, dir), { recursive: true });
  mkdirSync(join(root, 'etc/evia/secrets'), { mode: 0o700 });
  chmodSync(join(root, 'etc/evia/secrets'), 0o700);
  writeFileSync(join(bin, 'docker'), FAKE_DOCKER, { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), FAKE_CURL, { mode: 0o755 });
  writeFileSync(
    join(root, 'etc/evia/deploy-agent/config.json'),
    JSON.stringify({
      imageRepositories: { api: API_REPO, web: WEB_REPO },
      runtimeNetwork: NETWORK,
      baseline: { commit: BASELINE, activityEventId: 100 },
    }),
  );
  writeFileSync(
    join(root, 'etc/evia/deploy-agent/secrets.manifest.json'),
    readFileSync(new URL('../secrets.manifest.json', import.meta.url)),
  );
  for (const file of [
    'database-url-migrator',
    'database-url-app',
    'cursor-key',
    'field-encryption-keys',
    'login-throttle-key',
    'postgres-password',
    // EVM-084: provided by hand on the VM, listed in the manifest
    'media-s3-secret-access-key',
    'media-worker-s3-secret-access-key',
    'deletion-register-s3-secret-access-key',
    'pgbackrest-cipher-pass',
    'backup-s3-secret-access-key',
    // EVM-085: the write token of the collector (alloy)
    'grafana-write-token',
  ])
    writeFileSync(join(root, 'etc/evia/secrets', file), `synthetic-${file}`, { mode: 0o600 });
  // deploy.sh and the boot unit share one materialisation of the secrets (/usr/local/sbin/evia-secrets on the VM).
  mkdirSync(join(root, 'usr/local/sbin'), { recursive: true });
  writeFileSync(join(root, 'usr/local/sbin/evia-secrets'), readFileSync(SECRETS_SCRIPT), { mode: 0o755 });
  log = join(root, 'calls.log');
  writeFileSync(log, '');
}

/** The boot unit's call: evia-secrets without arguments (the manifest hash comes from the registry). */
function restoreSecrets(/** @type {string[]} */ args = []) {
  const run = spawnSync('bash', [SECRETS_SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', EVIA_ROOT: root, EVIA_EXPECTED_UID: String(process.getuid?.() ?? 0) },
  });
  return { status: run.status, stderr: run.stderr };
}

function deploy(/** @type {Record<string, unknown>} */ value, /** @type {Record<string, string>} */ env = {}) {
  writeFileSync(join(root, 'var/lib/evia/agent/out/result.json'), JSON.stringify(value));
  const version = JSON.stringify({ commit: value['commit'], manifestSha256: value['manifestSha256'] });
  writeFileSync(log, '');
  const run = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
      EVIA_ROOT: root,
      EVIA_EXPECTED_UID: String(process.getuid?.() ?? 0),
      EVIA_HEALTH_WAIT: '0',
      FAKE_LOG: log,
      FAKE_IMAGES: join(root, 'images.txt'),
      FAKE_VERSION: version,
      ...env,
    },
  });
  return { status: run.status, stderr: run.stderr, calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
}

const registry = () => JSON.parse(readFileSync(join(root, 'var/lib/evia/registry/registry.json'), 'utf8')).entries;
const active = () =>
  existsSync(join(root, 'var/lib/evia/deploy/active-color'))
    ? readFileSync(join(root, 'var/lib/evia/deploy/active-color'), 'utf8').trim()
    : 'none';
const index = (/** @type {string[]} */ calls, /** @type {string} */ part) => calls.findIndex((line) => line.includes(part));

describe('EVM-007 AC4: deploy.sh — order of the deployment', () => {
  beforeEach(setup);

  it('EVM-007 AC4: pull by digest -> migrate -> start -> health and version -> switch of Caddy -> edge check -> registry', () => {
    const value = result('c1');
    const run = deploy(value);
    assert.equal(run.status, 0, run.stderr);
    const order = [
      'docker pull --quiet -- ghcr.io/evia-test/evia-api@',
      'docker pull --quiet -- ghcr.io/evia-test/evia-web@',
      'run --rm --no-deps migrate',
      ' up -d --no-build --pull never --no-deps api worker web',
      '/api/health',
      'http://10.0.0.5:3000/api/version',
      'caddy reload',
      'https://staging.eviacharge.pl/version',
    ];
    const positions = order.map((part) => index(run.calls, part));
    assert.ok(
      positions.every((position) => position >= 0),
      JSON.stringify(run.calls),
    );
    assert.deepEqual(
      [...positions].sort((a, b) => a - b),
      positions,
    );
    assert.ok(run.calls.every((line) => !line.startsWith('docker compose') || line.includes('--env-file /dev/null')));
    assert.ok(run.calls.some((line) => line.includes('--project-name evia-blue')));
    assert.equal(active(), 'blue');
    const entries = registry();
    assert.equal(entries.length, 1);
    assert.deepEqual(
      {
        commit: entries[0].commit,
        manifestSha256: entries[0].manifestSha256,
        composeSha256: entries[0].composeSha256,
        activityEventId: entries[0].activityEventId,
        baseline: entries[0].baseline,
      },
      {
        commit: value.commit,
        manifestSha256: value.manifestSha256,
        composeSha256: value.composeSha256,
        activityEventId: 101,
        baseline: BASELINE,
      },
    );
    assert.equal(sha256(entries[0].manifest), value.manifestSha256);
    assert.equal((statSync(join(root, 'var/lib/evia/registry/registry.json')).mode & 0o777).toString(8), '644');
    const snippet = readFileSync(join(root, 'etc/evia/caddy/upstream.caddy'), 'utf8');
    assert.match(snippet, /reverse_proxy evia-blue-api-1:3000/);
    assert.doesNotMatch(snippet, /ghcr|sha256|green/);
  });

  it('EVM-007 AC4: the next deployment uses the other colour and stops the previous one after the switch', () => {
    assert.equal(deploy(result('c1')).status, 0);
    const run = deploy(result('c2'));
    assert.equal(run.status, 0, run.stderr);
    assert.equal(active(), 'green');
    const down = index(run.calls, '--project-name evia-blue');
    assert.ok(down > index(run.calls, 'caddy reload'));
    assert.ok(run.calls[down]?.includes(' down --remove-orphans'));
    assert.equal(registry().length, 2);
  });

  it('EVM-007 AC1, AC4 (Arm64 VM): the pulled images are checked against the platform of the host before the migration', () => {
    const run = deploy(result('c1'));
    assert.equal(run.status, 0, run.stderr);
    const check = index(run.calls, 'docker version --format {{.Server.Os}}/{{.Server.Arch}}');
    const api = index(run.calls, 'docker image inspect --format {{.Os}}/{{.Architecture}} -- ghcr.io/evia-test/evia-api@');
    const web = index(run.calls, 'docker image inspect --format {{.Os}}/{{.Architecture}} -- ghcr.io/evia-test/evia-web@');
    assert.ok(check >= 0 && api > index(run.calls, 'docker pull --quiet -- ghcr.io/evia-test/evia-web@'), JSON.stringify(run.calls));
    assert.ok(web > api && web < index(run.calls, 'run --rm --no-deps migrate'), JSON.stringify(run.calls));
  });

  it('EVM-007 AC1, AC4 (Arm64 VM): an image of another platform than the host migrates nothing, starts nothing and leaves the previous version', () => {
    assert.equal(deploy(result('c1')).status, 0);
    for (const env of [{ FAKE_API_PLATFORM: 'linux/amd64' }, { FAKE_WEB_PLATFORM: 'linux/amd64' }, { FAKE_HOST_PLATFORM: 'linux/amd64' }]) {
      const run = deploy(result('c2'), env);
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /platform/);
      assert.equal(index(run.calls, 'run --rm --no-deps migrate'), -1);
      assert.equal(index(run.calls, ' up -d'), -1);
      assert.equal(active(), 'blue');
      assert.equal(registry().length, 1);
    }
  });

  it('EVM-007 AC4: a failed migration starts nothing new and leaves the previous version and the registry', () => {
    assert.equal(deploy(result('c1')).status, 0);
    const run = deploy(result('c2'), { FAKE_MIGRATE_EXIT: '1' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /migration failed/);
    assert.equal(index(run.calls, ' up -d'), -1);
    assert.equal(index(run.calls, 'caddy reload'), -1);
    assert.equal(active(), 'blue');
    assert.equal(registry().length, 1);
  });

  it('EVM-007 AC4: a failed health or version check stops the new colour and never switches', () => {
    assert.equal(deploy(result('c1')).status, 0);
    for (const env of [{ FAKE_HEALTH_EXIT: '22' }, { FAKE_VERSION: JSON.stringify({ commit: sha('other'), manifestSha256: 'x' }) }]) {
      const run = deploy(result('c2'), env);
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /health or version check/);
      assert.equal(index(run.calls, 'caddy reload'), -1);
      assert.ok(run.calls.some((line) => line.includes('--project-name evia-green') && line.includes(' down')));
      assert.equal(active(), 'blue');
      assert.equal(registry().length, 1);
    }
  });

  it('EVM-007 AC4: the edge not serving the new commit restores the previous snippet and keeps the previous version', () => {
    assert.equal(deploy(result('c1')).status, 0);
    const before = readFileSync(join(root, 'etc/evia/caddy/upstream.caddy'), 'utf8');
    const run = deploy(result('c2'), { FAKE_EDGE: '{}' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /switched back/);
    assert.equal(readFileSync(join(root, 'etc/evia/caddy/upstream.caddy'), 'utf8'), before);
    assert.equal(active(), 'blue');
    assert.equal(registry().length, 1);
  });

  it('EVM-007 AC4: decision none does nothing; COMPOSE_* variables of root never reach compose', () => {
    const none = deploy({ schemaVersion: 1, decision: 'none', head: null, reasons: [] });
    assert.equal(none.status, 0);
    assert.deepEqual(none.calls, []);
    const run = deploy(result('c1'), { COMPOSE_FILE: '/tmp/evil.yaml', COMPOSE_PROJECT_NAME: 'x' });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.calls.filter((line) => line.startsWith('docker ')).every((line) => line.endsWith('COMPOSE_FILE=unset')));
  });
});

describe('EVM-007 AC4 (security-engineer B): deploy.sh treats the result of the verifier as untrusted', () => {
  beforeEach(setup);
  const refused = (/** @type {Record<string, unknown>} */ value, /** @type {RegExp} */ reason) => {
    const run = deploy(value);
    assert.notEqual(run.status, 0, `accepted: ${JSON.stringify(value).slice(0, 80)}`);
    assert.match(run.stderr, reason);
    assert.deepEqual(run.calls, [], 'no docker or curl call before the checks pass');
    assert.equal(existsSync(join(root, 'var/lib/evia/registry/registry.json')) ? registry().length : 0, 0);
  };

  it('EVM-007 AC4: an unknown decision, a short commit, a bad hash or event ID are refused', () => {
    refused({ ...result('c1'), decision: 'deploy-now' }, /decision/);
    refused({ ...result('c1'), commit: 'abc' }, /commit/);
    refused({ ...result('c1'), commit: 'main' }, /commit/);
    refused({ ...result('c1'), manifestSha256: 'x' }, /manifest hash/);
    refused({ ...result('c1'), composeSha256: 'x' }, /compose hash/);
    refused({ ...result('c1'), activityEventId: 'x' }, /activity event/);
    refused({ schemaVersion: 2 }, /not a result/);
  });

  it('EVM-007 AC4: an image of another repository or without a digest is refused', () => {
    const good = result('c1');
    refused({ ...good, images: { api: `ghcr.io/attacker/evia-api@sha256:${'a'.repeat(64)}`, web: good.images.web } }, /allowed repository/);
    refused({ ...good, images: { api: `${API_REPO}:latest`, web: good.images.web } }, /allowed repository|digest/);
    refused({ ...good, images: { api: `${API_REPO}@sha256:${'a'.repeat(63)}`, web: good.images.web } }, /digest/);
  });

  it('EVM-007 AC4: a manifest that does not match its hash, its commit or the images is refused', () => {
    const good = result('c1');
    refused({ ...good, manifest: `${good.manifest} ` }, /manifest does not match/);
    const other = result('c2');
    refused({ ...good, manifest: other.manifest, manifestSha256: other.manifestSha256 }, /another commit/);
  });

  it('EVM-007 AC4: a compose document that differs from its hash or leaves the allow-list is refused', () => {
    const good = result('c1');
    refused({ ...good, compose: `${good.compose} ` }, /compose does not match/);
    for (const extra of [
      { privileged: true },
      { network_mode: 'host' },
      { volumes: ['/var/run/docker.sock:/var/run/docker.sock'] },
      { user: '0:0' },
      { image: `${WEB_REPO}@sha256:${'c'.repeat(64)}` },
      { networks: ['host'] },
    ]) {
      const value = result('c1', {}, extra);
      refused(value, /outside the allow-list/);
    }
  });

  it('EVM-007 AC4: a rollback is allowed only to a commit of the registry, and the administrator command is consumed', () => {
    refused({ ...result('c1'), decision: 'rollback' }, /outside the registry/);
    assert.equal(deploy(result('c1')).status, 0);
    assert.equal(deploy(result('c2')).status, 0);
    writeFileSync(join(root, 'etc/evia/deploy-agent/rollback'), sha('c1'));
    const run = deploy({ ...result('c1'), decision: 'rollback' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(registry().length, 3);
    assert.equal(registry()[2].commit, sha('c1'));
    assert.equal(existsSync(join(root, 'etc/evia/deploy-agent/rollback')), false);
  });

  it('EVM-007 AC4 (review round 1): the registry records the kind of every entry; a rollback must repeat a deploy entry exactly', () => {
    assert.equal(deploy(result('c1', { activityEventId: 101 })).status, 0);
    assert.equal(deploy(result('c2', { activityEventId: 102 })).status, 0);
    const foreign = deploy({ ...result('c1', { activityEventId: 102 }), decision: 'rollback' });
    assert.notEqual(foreign.status, 0);
    assert.match(foreign.stderr, /outside the registry/);
    assert.equal(registry().length, 2);
    const run = deploy({ ...result('c1', { activityEventId: 101 }), decision: 'rollback' });
    assert.equal(run.status, 0, run.stderr);
    const entries = registry();
    assert.deepEqual(
      entries.map((/** @type {{ kind: string }} */ item) => item.kind),
      ['deploy', 'deploy', 'rollback'],
    );
    const [first, , last] = entries;
    // The verifier's registry schema (services/deploy-agent/src/registry.ts): the same keys, the rollback repeats its deployment.
    assert.deepEqual(Object.keys(last).sort(), [
      'activityEventId',
      'baseline',
      'commit',
      'composeSha256',
      'deployedAt',
      'kind',
      'manifest',
      'manifestSha256',
    ]);
    for (const key of ['commit', 'manifestSha256', 'manifest', 'composeSha256', 'activityEventId', 'baseline'])
      assert.equal(last[key], first[key], key);
  });

  it('EVM-007 AC4 (security-engineer, rollback i migracje): a rollback never runs migrate — N−1 runs on schema N', () => {
    assert.equal(deploy(result('c1')).status, 0);
    assert.equal(deploy(result('c2')).status, 0);
    writeFileSync(join(root, 'etc/evia/deploy-agent/rollback'), sha('c1'));
    // The old migrator would refuse a database with migrations it does not know; a rollback must not depend on it.
    const run = deploy({ ...result('c1'), decision: 'rollback' }, { FAKE_MIGRATE_EXIT: '1' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(index(run.calls, 'run --rm --no-deps migrate'), -1, JSON.stringify(run.calls));
    assert.ok(index(run.calls, ' up -d --no-build --pull never --no-deps api worker web') >= 0);
    assert.match(run.stderr, /migrations skipped/);
    assert.equal(active(), 'blue');
  });
});

describe('EVM-007 AC7: secrets of the services', () => {
  beforeEach(setup);

  it('EVM-007 AC7: every service gets only its files, 0400, the migrator password only in migrate, the manifest hash for the API', () => {
    const value = result('c1');
    assert.equal(deploy(value).status, 0);
    const run = (/** @type {string} */ path) => join(root, 'run/evia/secrets', path);
    assert.equal(readFileSync(run('migrate/database-url-migrator'), 'utf8'), 'synthetic-database-url-migrator');
    for (const service of ['api', 'worker']) {
      assert.equal(existsSync(run(`${service}/database-url-migrator`)), false);
      assert.equal((statSync(run(`${service}/database-url-app`)).mode & 0o777).toString(8), '400');
    }
    assert.equal(existsSync(run('migrate/database-url-app')), false);
    assert.equal(readFileSync(run('api/release-manifest-sha256'), 'utf8'), value.manifestSha256);
    assert.equal((statSync(run('api')).mode & 0o777).toString(8), '500');
  });

  it('EVM-007 AC7: a secret with another mode, a missing secret or an open secrets directory refuses the start', () => {
    chmodSync(join(root, 'etc/evia/secrets/cursor-key'), 0o644);
    let run = deploy(result('c1'));
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /cursor-key must be 0600/);
    assert.equal(index(run.calls, 'docker pull'), -1);
    setup();
    writeFileSync(join(root, 'etc/evia/secrets/cursor-key'), '', { flag: 'w' });
    spawnSync('rm', ['-f', join(root, 'etc/evia/secrets/cursor-key')]);
    run = deploy(result('c1'));
    assert.match(run.stderr, /cursor-key is missing/);
    setup();
    chmodSync(join(root, 'etc/evia/secrets'), 0o755);
    run = deploy(result('c1'));
    assert.match(run.stderr, /must be 0700/);
  });

  it('EVM-007 AC7 (security-engineer, SR-INFRA-05): PostgreSQL gets only its password, the channel services never get it', () => {
    assert.equal(deploy(result('c1')).status, 0);
    const run = (/** @type {string} */ path) => join(root, 'run/evia/secrets', path);
    assert.equal(readFileSync(run('postgres/postgres-password'), 'utf8'), 'synthetic-postgres-password');
    assert.equal((statSync(run('postgres/postgres-password')).mode & 0o777).toString(8), '400');
    assert.equal(existsSync(run('postgres/database-url-app')), false);
    for (const service of ['api', 'worker', 'migrate']) assert.equal(existsSync(run(`${service}/postgres-password`)), false);
  });

  it('EVM-007 AC7 (security-engineer): after a reboot (empty /run) the boot unit restores every service and the API manifest hash of the registry', () => {
    const first = result('c1');
    const second = result('c2');
    assert.equal(deploy(first).status, 0);
    assert.equal(deploy(second).status, 0);
    spawnSync('chmod', ['-R', 'u+w', join(root, 'run')]);
    spawnSync('rm', ['-rf', join(root, 'run')]);
    const restored = restoreSecrets();
    assert.equal(restored.status, 0, restored.stderr);
    const run = (/** @type {string} */ path) => join(root, 'run/evia/secrets', path);
    for (const [service, file] of [
      ['postgres', 'postgres-password'],
      ['migrate', 'database-url-migrator'],
      ['api', 'database-url-app'],
      ['worker', 'cursor-key'],
    ])
      assert.equal(readFileSync(run(`${service}/${file}`), 'utf8'), `synthetic-${file}`);
    assert.equal(readFileSync(run('api/release-manifest-sha256'), 'utf8'), second.manifestSha256);
    assert.equal((statSync(run('api')).mode & 0o777).toString(8), '500');
  });

  it('EVM-007 AC7: before the first deployment the boot unit restores the secrets without a manifest hash; a bad registry or manifest refuses', () => {
    const restored = restoreSecrets();
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(existsSync(join(root, 'run/evia/secrets/postgres/postgres-password')), true);
    assert.equal(existsSync(join(root, 'run/evia/secrets/api/release-manifest-sha256')), false);
    mkdirSync(join(root, 'var/lib/evia/registry'), { recursive: true });
    writeFileSync(
      join(root, 'var/lib/evia/registry/registry.json'),
      JSON.stringify({ schemaVersion: 1, entries: [{ manifestSha256: '../../etc/x' }] }),
    );
    assert.match(restoreSecrets().stderr, /manifest hash/);
    assert.match(restoreSecrets(['a', 'b']).stderr, /usage/);
    const manifest = join(root, 'etc/evia/deploy-agent/secrets.manifest.json');
    const original = readFileSync(manifest, 'utf8');
    for (const services of [
      { postgres: { uid: 0, files: ['postgres-password'] } },
      { postgres: { uid: 10001, files: ['postgres-password'] } },
      { api: { uid: 999, files: ['cursor-key'] } },
      { shell: { uid: 10001, files: ['cursor-key'] } },
      { api: { uid: 10001, files: ['../secrets'] } },
    ]) {
      writeFileSync(manifest, JSON.stringify({ services }));
      assert.notEqual(restoreSecrets([sha256('m')]).status, 0, JSON.stringify(services));
    }
    writeFileSync(manifest, original);
  });

  it('EVM-007 AC7 (architect): a deployment that fails before the switch leaves the manifest hash of the serving release', () => {
    const hash = () => join(root, 'run/evia/secrets/api/release-manifest-sha256');
    // Before the first deployment there is no release: a failed first deployment leaves no hash behind.
    const first = deploy(result('c1'), { FAKE_MIGRATE_EXIT: '1' });
    assert.notEqual(first.status, 0);
    assert.equal(existsSync(hash()), false);
    assert.equal(deploy(result('c1')).status, 0);
    for (const env of [{ FAKE_PULL_EXIT: '1' }, { FAKE_MIGRATE_EXIT: '1' }, { FAKE_HEALTH_EXIT: '22' }, { FAKE_EDGE: '{}' }]) {
      const run = deploy(result('c2'), env);
      assert.notEqual(run.status, 0, JSON.stringify(env));
      assert.equal(readFileSync(hash(), 'utf8'), result('c1').manifestSha256, JSON.stringify(env));
      assert.equal(registry().length, 1);
    }
    assert.equal(deploy(result('c2')).status, 0);
    assert.equal(readFileSync(hash(), 'utf8'), result('c2').manifestSha256);
  });

  it('EVM-007 AC7: a repeated materialisation keeps the directory of a running container and removes files no longer in the manifest', () => {
    assert.equal(deploy(result('c1')).status, 0);
    const directory = join(root, 'run/evia/secrets/api');
    const inode = statSync(directory).ino;
    chmodSync(directory, 0o700);
    writeFileSync(join(directory, 'stale-secret'), 'old');
    assert.equal(deploy(result('c2')).status, 0);
    assert.equal(statSync(directory).ino, inode, 'the bind mount of the serving colour keeps its files');
    assert.equal(existsSync(join(directory, 'stale-secret')), false);
    assert.equal(readFileSync(join(directory, 'release-manifest-sha256'), 'utf8'), result('c2').manifestSha256);
  });
});

describe('EVM-007 AC4: images of the last 3 deployments stay', () => {
  beforeEach(setup);

  it('EVM-007 AC4: older evia images are removed, those of the last 3 registry entries and foreign images are kept', () => {
    const values = ['c1', 'c2', 'c3', 'c4'].map((label) => result(label));
    for (const value of values.slice(0, 3)) assert.equal(deploy(value).status, 0);
    writeFileSync(
      join(root, 'images.txt'),
      [...values.flatMap((value) => [value.images.api, value.images.web]), `docker.io/library/postgres@sha256:${'d'.repeat(64)}`].join(
        '\n',
      ),
    );
    const run = deploy(values[3] ?? {});
    assert.equal(run.status, 0, run.stderr);
    const removed = run.calls.filter((line) => line.startsWith('docker image rm')).map((line) => line.split(' ')[4]);
    assert.deepEqual(removed.sort(), [values[0]?.images.api, values[0]?.images.web].sort());
  });
});

describe('EVM-007 AC4 (security-engineer B): ShellCheck on the shell scripts of the VM and the IaC container', () => {
  const scripts = [
    '/src/infra/deploy-agent/deploy.sh',
    '/src/infra/deploy-agent/cycle.sh',
    '/src/infra/deploy-agent/secrets.sh',
    '/src/infra/deploy-agent/init-secrets.sh',
    '/src/infra/deploy-agent/restore/lib.sh',
    '/src/infra/deploy-agent/restore/run.sh',
    '/src/infra/deploy-agent/restore/sweep.sh',
    '/src/infra/deploy-agent/restore/scenario.sh',
    '/src/infra/deploy-agent/restore/s3-presign.sh',
    '/src/infra/deploy-agent/restore/vm-restore.sh',
    '/src/infra/deploy-agent/restore/backup.sh',
    '/src/infra/deploy-agent/restore/media-copy.sh',
    '/src/infra/deploy-agent/restore/bucket-verify.sh',
    '/src/infra/docker/iac/check.sh',
    '/src/infra/docker/iac/iac.sh',
  ];

  it('EVM-007 AC4: every script passes ShellCheck without exceptions', () => {
    const run = spawnSync('shellcheck', ['-x', '--source-path=SCRIPTDIR', '--severity=style', ...scripts], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    for (const script of scripts) assert.doesNotMatch(readFileSync(script, 'utf8'), /shellcheck disable/);
  });

  it('EVM-007 AC4: ShellCheck reports an unquoted variable (it really runs)', () => {
    const bad = join(mkdtempSync(join(tmpdir(), 'shellcheck-')), 'bad.sh');
    writeFileSync(bad, '#!/bin/bash\nrm -rf $1/*\n');
    const run = spawnSync('shellcheck', [bad], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /SC2086/);
  });
});
