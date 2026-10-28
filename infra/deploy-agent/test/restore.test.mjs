// @ts-check
/**
 * The restore test orchestrator, the sweeper, the presigned URL and the scenario "backup deleted from a taken-over VM"
 * (EVM-084 AC3, AC4, AC5; ADR-0018 "Test odtworzenia"; security-engineer P5-P10; architect 6, 9, 10). The scripts run in the
 * deploy-sh-tests container against a stand-in for the API of Hetzner and for the S3 result object: a local HTTP server on the
 * loopback with an ephemeral port (the scripts accept it only in test mode). Secrets here are synthetic markers; no value of them
 * may reach stdout or stderr. The real run on the project evia-restore-staging is the IaC session (status stays in-progress).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = new URL('../restore/', import.meta.url).pathname;
const NOW = '2026-10-27T12:00:00Z';
const NOW_MS = Date.parse(NOW);
const TOKEN = 'SYNTHETIC-HCLOUD-TOKEN-4f9a0c';
const ROOT_PASSWORD = 'SYNTHETIC-ROOT-PASSWORD-MARKER';
const SECRETS = {
  'restore-hcloud-token': TOKEN,
  'restore-reader-s3-secret-access-key': 'SYNTHETIC-READER-SECRET-MARKER',
  'restore-orchestrator-s3-secret-access-key': 'SYNTHETIC-ORCH-SECRET-MARKER',
  'pgbackrest-cipher-pass': 'SYNTHETIC-CIPHER-PASS-MARKER',
  'rclone-crypt-password': 'SYNTHETIC-CRYPT-ONE-MARKER',
  'rclone-crypt-password2': 'SYNTHETIC-CRYPT-TWO-MARKER',
  'restore-storagebox-password': 'SYNTHETIC-BOX-PASSWORD-MARKER',
  'backup-s3-secret-access-key': 'SYNTHETIC-WRITER-SECRET-MARKER',
};
const ago = (/** @type {number} */ seconds) => new Date(NOW_MS - seconds * 1000).toISOString().replace('.000Z', 'Z');
const HOUR = 3600;

/** @typedef {{ method: string, path: string, query: URLSearchParams, auth: string | undefined, body: string }} Recorded */

/** Stand-in for the API of Hetzner and the S3 result object. */
async function startMock(/** @type {Record<string, any>} */ options = {}) {
  /** @type {Record<string, any[]>} */
  const store = { servers: [], volumes: [], images: [], primary_ips: [], firewalls: [] };
  /** @type {Recorded[]} */
  const requests = [];
  /** @type {Map<string, string>} */
  const objects = new Map();
  /** @type {Map<string, { polls: number, putPath: string, run: Record<string, string> }>} */
  const vms = new Map();
  let nextId = 1000;
  const sink = { authorization: /** @type {string[]} */ ([]) };
  const server = createServer((request, response) => {
    const chunks = /** @type {Buffer[]} */ ([]);
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const body = Buffer.concat(chunks).toString('utf8');
      const method = request.method ?? 'GET';
      requests.push({ method, path: url.pathname, query: url.searchParams, auth: request.headers.authorization, body });
      const send = (/** @type {number} */ code, /** @type {unknown} */ payload, /** @type {Record<string, string>} */ headers = {}) => {
        response.writeHead(code, { 'content-type': 'application/json', ...headers });
        response.end(payload === undefined ? '' : typeof payload === 'string' ? payload : JSON.stringify(payload));
      };
      // the S3 object of the result (the signed URL is not verified here: the signature is tested separately)
      if (url.pathname.startsWith('/evia-test-db-backup/restore-results/')) {
        if (method === 'GET') return objects.has(url.pathname) ? send(200, objects.get(url.pathname)) : send(404, '{}');
        if (method === 'PUT') return objects.has(url.pathname) ? send(412, '{}') : (objects.set(url.pathname, body), send(200, {}));
      }
      if (url.pathname === '/sink') {
        sink.authorization.push(String(request.headers.authorization));
        return send(200, {});
      }
      if (options.redirect) return send(302, '', { location: `http://127.0.0.1:${options.sinkPort}/sink` });
      const match = /^\/v1\/(\w+)(?:\/(\d+))?$/.exec(url.pathname);
      if (!match) return send(404, {});
      const [, kind = '', id] = match;
      const list = store[kind];
      if (!list) return send(404, {});
      if (options.failList === kind && method === 'GET' && !id) return send(500, { error: 'boom' });
      if (method === 'GET' && !id) {
        let items = list;
        const selector = url.searchParams.get('label_selector');
        if (selector) {
          const [key, value] = selector.split('=');
          items = items.filter((item) => item.labels?.[key ?? ''] === value);
        }
        const type = url.searchParams.get('type');
        if (kind === 'images' && type) items = items.filter((item) => item.type === type);
        const perPage = Number(url.searchParams.get('per_page') ?? 25);
        const page = Number(url.searchParams.get('page') ?? 1);
        const slice = items.slice((page - 1) * perPage, page * perPage);
        const last = Math.max(1, Math.ceil(items.length / perPage));
        return send(200, {
          [kind]: slice,
          meta: { pagination: { page, per_page: perPage, next_page: page < last ? page + 1 : null, last_page: last } },
        });
      }
      if (method === 'GET' && id) {
        const found = list.find((item) => String(item.id) === id);
        if (!found) return send(404, {});
        const vm = vms.get(id);
        if (vm) {
          vm.polls += 1;
          if (vm.polls > (options.offAfter ?? 1) && !options.neverOff) {
            found.status = 'off';
            if (!objects.has(vm.putPath)) {
              const result = options.result ? options.result(vm.run) : validResult(vm.run);
              if (result !== null) objects.set(vm.putPath, typeof result === 'string' ? result : JSON.stringify(result));
            }
          }
        }
        return send(200, { server: found });
      }
      if (method === 'DELETE' && id) {
        if (kind === 'firewalls' && (options.firewallBusy ?? 0) > 0) {
          options.firewallBusy -= 1;
          return send(422, { error: 'resource in use' });
        }
        const index = list.findIndex((item) => String(item.id) === id);
        if (index < 0) return send(404, {});
        list.splice(index, 1);
        return send(200, { action: {} });
      }
      if (method === 'POST') {
        const payload = JSON.parse(body);
        const created = { id: nextId++, created: NOW, ...payload };
        if (kind === 'servers') {
          created.status = 'starting';
          const decoded = Buffer.from(/content: (\S+)/.exec(payload.user_data)?.[1] ?? '', 'base64').toString('utf8');
          const put = /RESULT_PUT_URL='https?:\/\/[^/]+(\/[^?']+)\?/.exec(decoded)?.[1] ?? '';
          const run = Object.fromEntries([...decoded.matchAll(/^(\w+)='([^']*)'$/gm)].map((entry) => [entry[1], entry[2]]));
          vms.set(String(created.id), { polls: 0, putPath: put, run });
        }
        list.push(created);
        if (kind === 'servers' && options.createFails) return send(500, { error: 'lost answer' });
        return send(201, { [kind.slice(0, -1)]: created, ...(kind === 'servers' ? { root_password: ROOT_PASSWORD } : {}) });
      }
      return send(405, {});
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  return { port, store, requests, objects, sink, close: () => new Promise((resolve) => server.close(() => resolve(undefined))) };
}

function validResult(/** @type {Record<string, string>} */ run) {
  return {
    runId: run['RUN_ID'],
    status: 'ok',
    stage: 'done',
    startedAt: NOW,
    finishedAt: NOW,
    targetTime: run['TARGET_TIME'],
    restoredTo: run['TARGET_TIME'],
    rpoSeconds: 120,
    dbTables: 42,
    dbRows: 1234,
    mediaFiles: 7,
    mediaSampleVerified: 3,
    deletionRegisterEntries: 2,
  };
}

/** @type {string} */
let root;
/** @type {Awaited<ReturnType<typeof startMock>> | undefined} */
let mock;

/** The stand-in for evia-pgbackrest: logs the call; `info --output=json` lists two backups that stopped long ago. */
function pgbackrestFake(/** @type {boolean} */ backupFails = false) {
  mkdirSync(join(root, 'bin'), { recursive: true });
  writeFileSync(
    join(root, 'bin/fake-pgbackrest'),
    `#!/bin/bash
echo "pgbackrest $*" >> "${join(root, 'pgbackrest.log')}"
[ "$1" = backup ] && ${backupFails ? 'exit 1' : 'exit 0'}
if [ "$1" = info ] && [[ "$*" == *--output=json* ]]; then
  echo '[{"name":"evia","backup":[{"label":"20261027-010000F","timestamp":{"start":1,"stop":2}},{"label":"20261027-010000F_20261028-010000D","timestamp":{"start":3,"stop":4}},{"label":"20261027-010000F_99991231-010000I","timestamp":{"start":4102444800,"stop":4102444900}}]}]'
fi
exit 0
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, 'bin/fake-psql'),
    `#!/bin/bash
echo "psql $*" >> "${join(root, 'psql.log')}"
exit 0
`,
    { mode: 0o755 },
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'restore-'));
  mkdirSync(join(root, 'secrets'), { mode: 0o700 });
  pgbackrestFake();
  for (const [name, value] of Object.entries(SECRETS)) writeFileSync(join(root, 'secrets', name), value, { mode: 0o600 });
  writeFileSync(join(root, 'known_hosts'), '[storagebox.example]:23 ssh-ed25519 AAAA-SYNTHETIC\n');
});
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

function env(/** @type {Record<string, string>} */ extra = {}) {
  return {
    PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
    EVIA_RESTORE_TEST_MODE: '1',
    EVIA_RESTORE_NOW: NOW,
    EVIA_RESTORE_STATE: join(root, 'state'),
    EVIA_METRICS_DIR: join(root, 'metrics'),
    EVIA_SECRETS_DIR: join(root, 'secrets'),
    HCLOUD_TOKEN_FILE: join(root, 'secrets/restore-hcloud-token'),
    HCLOUD_API: `http://127.0.0.1:${mock?.port}/v1`,
    EVIA_RESTORE_POLL_SECONDS: '0',
    RESTORE_IMAGE: '4242',
    RESTORE_SERVER_TYPE: 'cax11',
    RESTORE_LOCATION: 'fsn1',
    S3_ENDPOINT: `http://127.0.0.1:${mock?.port}`,
    S3_REGION: 'pl-waw',
    DB_BACKUP_BUCKET: 'evia-test-db-backup',
    DELETION_REGISTER_BUCKET: 'evia-test-deletion-register',
    RESTORE_READER_ACCESS_KEY_ID: 'SCWREADER0001',
    RESTORE_ORCH_ACCESS_KEY_ID: 'SCWORCH00002',
    STORAGEBOX_HOST: 'storagebox.example',
    STORAGEBOX_RESTORE_USER: 'sub-restore',
    STORAGEBOX_KNOWN_HOSTS: join(root, 'known_hosts'),
    EVIA_PSQL_BIN: join(root, 'bin/fake-psql'),
    EVIA_PGBACKREST_BIN: join(root, 'bin/fake-pgbackrest'),
    ...extra,
  };
}

function exec(/** @type {string} */ script, /** @type {string[]} */ args = [], /** @type {Record<string, string>} */ extra = {}) {
  return new Promise((resolve) => {
    const child = spawn('bash', [join(DIR, script), ...args], { env: env(extra) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  }).then((value) => /** @type {{ status: number | null, stdout: string, stderr: string }} */ (value));
}

const events = () => {
  const path = join(root, 'state/events.jsonl');
  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
};
const metrics = () => {
  const path = join(root, 'metrics/evia_restore.prom');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};
const RESTORE_LABELS = { 'evia-restore': 'staging' };
const server = (/** @type {Record<string, unknown>} */ fields) => ({
  id: 1,
  created: ago(HOUR),
  status: 'running',
  labels: RESTORE_LABELS,
  ...fields,
});
/** The sentinel of the project of the restore test: a firewall created in the IaC session, older than 24 hours and never swept. */
const addSentinel = (/** @type {Awaited<ReturnType<typeof startMock>>} */ stand) =>
  stand.store['firewalls'].push({ id: 99, created: ago(900 * HOUR), labels: { 'evia-project': 'evia-restore-staging' } });
const SECRET_MARKERS = [...Object.values(SECRETS), ROOT_PASSWORD];
function assertNoSecret(/** @type {string} */ output, /** @type {string[]} */ extra = []) {
  for (const marker of [...SECRET_MARKERS, ...extra]) assert.ok(!output.includes(marker), `${marker.slice(0, 22)} leaked`);
  assert.doesNotMatch(output, /X-Amz-Signature|user_data|#cloud-config/);
}

describe('EVM-084 AC4: the sweeper deletes what is older than 24 hours', () => {
  it('EVM-084 AC4: an artificially old resource of every kind is deleted and reported; younger ones stay; the border is strict', async () => {
    mock = await startMock();
    mock.store['servers'].push(
      server({ id: 1, created: ago(25 * HOUR) }),
      server({ id: 2, created: ago(23 * HOUR) }),
      server({ id: 3, created: ago(24 * HOUR) }),
    );
    mock.store['servers'].push(server({ id: 4, created: ago(24 * HOUR + 1) }), server({ id: 5, created: ago(24 * HOUR - 1) }));
    addSentinel(mock);
    mock.store['volumes'].push({ id: 11, created: ago(30 * HOUR), labels: RESTORE_LABELS });
    mock.store['images'].push({ id: 21, type: 'snapshot', created: ago(30 * HOUR) }, { id: 22, type: 'backup', created: ago(30 * HOUR) });
    mock.store['images'].push({ id: 23, type: 'system', created: ago(300 * HOUR) }, { id: 24, type: 'app', created: ago(300 * HOUR) });
    mock.store['primary_ips'].push({ id: 31, created: ago(48 * HOUR) });
    mock.store['firewalls'].push(
      { id: 41, created: ago(48 * HOUR), labels: { 'evia-restore': 'staging' } },
      { id: 42, created: ago(48 * HOUR), labels: {} },
    );
    const run = await exec('sweep.sh');
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(
      mock.store['servers'].map((item) => item.id),
      [2, 3, 5],
    );
    assert.deepEqual(mock.store['volumes'], []);
    assert.deepEqual(
      mock.store['images'].map((item) => item.id),
      [23, 24],
    );
    assert.deepEqual(mock.store['primary_ips'], []);
    assert.deepEqual(
      mock.store['firewalls'].map((item) => item.id),
      [99, 42],
      'a firewall without the label of the test is not ours; the sentinel stays',
    );
    const deleted = events().filter((item) => item.event === 'restore-sweep-deleted');
    assert.deepEqual(deleted.map((item) => `${item.kind}:${item.id}`).sort(), [
      'firewalls:41',
      'images:21',
      'images:22',
      'primary_ips:31',
      'servers:1',
      'servers:4',
      'volumes:11',
    ]);
    assert.match(metrics(), /^evia_restore_sweeper_last_run_failed 0$/m);
    assert.match(metrics(), /^evia_restore_sweeper_last_deleted 7$/m);
    assertNoSecret(run.stdout + run.stderr);
  });

  it('EVM-084 AC4 (P10): the second page of the listing is swept too (next_page), the age comes from `created` in UTC', async () => {
    mock = await startMock();
    addSentinel(mock);
    for (let id = 1; id <= 120; id += 1) mock.store['servers'].push(server({ id, created: id === 120 ? ago(40 * HOUR) : ago(HOUR) }));
    mock.store['servers'].push(server({ id: 121, created: '2026-10-25T09:00:00+02:00' }));
    const run = await exec('sweep.sh');
    assert.equal(run.status, 0, run.stderr);
    assert.equal(mock.store['servers'].length, 119);
    assert.ok(!mock.store['servers'].some((item) => item.id === 120 || item.id === 121));
    assert.ok(mock.requests.some((item) => item.path === '/v1/servers' && item.query.get('page') === '3'));
  });

  it('EVM-084 AC4 (P10): an unreadable date or an API error is an event and exit code 1 (fail-closed), the other kinds are still swept', async () => {
    mock = await startMock({ failList: 'images' });
    addSentinel(mock);
    mock.store['servers'].push(server({ id: 1, created: 'yesterday' }), server({ id: 2, created: ago(30 * HOUR) }));
    mock.store['volumes'].push({ id: 11, created: ago(30 * HOUR), labels: RESTORE_LABELS });
    mock.store['primary_ips'].push({ id: 31, created: ago(48 * HOUR) });
    const run = await exec('sweep.sh');
    assert.equal(run.status, 1);
    assert.deepEqual(
      mock.store['servers'].map((item) => item.id),
      [1],
      'the readable old server is deleted, the unreadable one stays',
    );
    assert.deepEqual(mock.store['primary_ips'], []);
    const failed = events().filter((item) => item.event === 'restore-sweep-failed');
    assert.deepEqual(failed.map((item) => `${item.kind}:${item.reason}`).sort(), [
      'images:list',
      'images:list',
      'servers:unreadable-resource',
    ]);
    assert.match(metrics(), /^evia_restore_sweeper_last_run_failed 1$/m);
  });

  it('EVM-084 AC4 (P10): a token of another project deletes nothing — no sentinel, or a server or a volume without the label of the test, is a refusal (exit 1, nothing deleted)', async () => {
    const old = ago(48 * HOUR);
    const cases = /** @type {Array<[string, (stand: Awaited<ReturnType<typeof startMock>>) => void, string, string]>} */ ([
      [
        'no sentinel: the staging project',
        (stand) => {
          stand.store['servers'].push({ id: 5, created: old, labels: { 'evia-restore': 'staging' } });
        },
        'no-sentinel',
        '',
      ],
      [
        'a foreign server',
        (stand) => {
          addSentinel(stand);
          stand.store['servers'].push({ id: 5, created: old, labels: {} }, { id: 6, created: old, labels: RESTORE_LABELS });
        },
        'foreign-resource',
        'servers',
      ],
      [
        'a foreign volume with the LUKS data',
        (stand) => {
          addSentinel(stand);
          stand.store['volumes'].push({ id: 7, created: old });
          stand.store['servers'].push({ id: 6, created: old, labels: RESTORE_LABELS });
        },
        'foreign-resource',
        'volumes',
      ],
      [
        'a server with the label of another value',
        (stand) => {
          addSentinel(stand);
          stand.store['servers'].push({ id: 5, created: old, labels: { 'evia-restore': 'production' } });
        },
        'foreign-resource',
        'servers',
      ],
    ]);
    for (const [name, arrange, reason, kind] of cases) {
      mock = await startMock();
      arrange(mock);
      mock.store['images'].push({ id: 21, type: 'snapshot', created: old });
      mock.store['primary_ips'].push({ id: 31, created: old });
      const before = JSON.stringify(mock.store);
      const run = await exec('sweep.sh');
      assert.equal(run.status, 1, name);
      assert.equal(JSON.stringify(mock.store), before, `${name}: nothing deleted`);
      assert.ok(!mock.requests.some((item) => item.method === 'DELETE'), `${name}: no DELETE request`);
      const refused = events().filter((item) => item.event === 'restore-sweep-refused');
      assert.equal(refused.length, 1, name);
      assert.equal(refused[0].reason, reason, name);
      if (kind) assert.equal(refused[0].kind, kind, name);
      assert.match(metrics(), /^evia_restore_sweeper_last_run_failed 1$/m, name);
      assert.match(metrics(), /^evia_restore_sweeper_last_deleted 0$/m, name);
      await mock.close();
      mock = undefined;
      rmSync(join(root, 'state/events.jsonl'), { force: true });
    }
  });

  it('EVM-084 AC4 (P10): the guard fails closed — a failed listing of the sentinel, the servers or the volumes is a refusal, nothing is deleted', async () => {
    for (const failList of ['firewalls', 'servers', 'volumes']) {
      mock = await startMock({ failList });
      addSentinel(mock);
      mock.store['servers'].push(server({ id: 5, created: ago(48 * HOUR) }));
      const run = await exec('sweep.sh');
      assert.equal(run.status, 1, failList);
      assert.equal(mock.store['servers'].length, 1, `${failList}: nothing deleted`);
      assert.ok(
        events().some((item) => item.event === 'restore-sweep-refused' && item.reason === 'list'),
        failList,
      );
      await mock.close();
      mock = undefined;
      rmSync(join(root, 'state/events.jsonl'), { force: true });
    }
  });

  it('EVM-084 AC4: a failed deletion is an event and exit code 1', async () => {
    mock = await startMock({ firewallBusy: 1 });
    addSentinel(mock);
    mock.store['firewalls'].push({ id: 41, created: ago(48 * HOUR), labels: { 'evia-restore': 'staging' } });
    const run = await exec('sweep.sh');
    assert.equal(run.status, 1);
    assert.ok(events().some((item) => item.event === 'restore-sweep-failed' && item.reason === 'delete'));
  });
});

describe('EVM-084 AC3 (P6): the address of the API and the token', () => {
  it('EVM-084 AC3 (P6): the address can be replaced only by http://127.0.0.1:<port>/v1 in test mode; every other value is refused before a request', async () => {
    mock = await startMock();
    for (const [api, testMode] of [
      [`http://127.0.0.1:${mock.port}/v1`, ''],
      ['https://api.hetzner.cloud.evil.example/v1', '1'],
      ['http://localhost:1/v1', '1'],
      [`http://127.0.0.1:${mock.port}/v1/../x`, '1'],
      ['https://api.hetzner.cloud/v1/', '1'],
    ]) {
      const run = await exec('sweep.sh', [], { HCLOUD_API: api ?? '', EVIA_RESTORE_TEST_MODE: testMode ?? '' });
      assert.equal(run.status, 1, String(api));
      assert.match(run.stderr, /HCLOUD_API is not allowed/);
    }
    assert.equal(mock.requests.length, 0);
  });

  it('EVM-084 AC3 (P6): a redirect is not followed — the token never reaches another address', async () => {
    const sink = await startMock();
    mock = await startMock({ redirect: true, sinkPort: sink.port });
    const run = await exec('sweep.sh');
    assert.equal(run.status, 1);
    assert.deepEqual(sink.sink.authorization, []);
    assert.equal(sink.requests.length, 0);
    assertNoSecret(run.stdout + run.stderr);
    await sink.close();
  });

  it('EVM-084 AC3 (P6): the token travels in the Authorization header from a file and never in argv (curl config on stdin, no -L)', async () => {
    mock = await startMock();
    await exec('sweep.sh');
    assert.ok(mock.requests.length > 0);
    assert.ok(mock.requests.every((item) => item.auth === `Bearer ${TOKEN}`));
    const lib = readFileSync(join(DIR, 'lib.sh'), 'utf8').replace(/^\s*#.*$/gm, '');
    assert.match(lib, /--config -/);
    assert.doesNotMatch(lib, /(^|\s)-L(\s|$)|--location|-H\s+"?Authorization|set -x/m);
    assert.match(lib, /--proto "=\$API_PROTO"/);
    for (const script of ['run.sh', 'sweep.sh', 'scenario.sh', 'vm-restore.sh', 's3-presign.sh'])
      assert.doesNotMatch(readFileSync(join(DIR, script), 'utf8').replace(/^\s*#.*$/gm, ''), /set -x|bash -x|Bearer/, script);
  });
});

describe('EVM-084 AC3: the orchestrator of the restore test', () => {
  /** @type {Awaited<ReturnType<typeof exec>>} */
  let run;
  const decodedUserData = () => {
    const created = mock?.requests.find((item) => item.method === 'POST' && item.path === '/v1/servers');
    return created ? String(JSON.parse(created.body).user_data) : '';
  };
  const entry = (/** @type {string} */ userData, /** @type {string} */ path) =>
    Buffer.from(
      new RegExp(`path: ${path.replaceAll('/', '\\/')}\\n.*\\n.*\\n\\s+content: (\\S+)`).exec(userData)?.[1] ?? '',
      'base64',
    ).toString('utf8');

  it('EVM-084 AC3: a VM without inbound ports, in the EU, with the firewall attached in the create request; user-data holds read keys and the signed PUT only', async () => {
    mock = await startMock();
    run = await exec('run.sh');
    assert.equal(run.status, 0, run.stderr);
    const firewallCreate = mock.requests.find((item) => item.method === 'POST' && item.path === '/v1/firewalls');
    const serverCreate = mock.requests.find((item) => item.method === 'POST' && item.path === '/v1/servers');
    assert.ok(firewallCreate && serverCreate);
    const firewall = JSON.parse(firewallCreate.body);
    assert.deepEqual(
      firewall.rules.filter((rule) => rule.direction !== 'out'),
      [],
      'no inbound rule',
    );
    assert.deepEqual(firewall.rules.map((rule) => `${rule.protocol}/${rule.port}`).sort(), [
      'tcp/23',
      'tcp/443',
      'tcp/53',
      'udp/123',
      'udp/53',
    ]);
    assert.equal(firewall.labels['evia-restore'], 'staging');
    const created = JSON.parse(serverCreate.body);
    assert.equal(created.firewalls.length, 1);
    assert.equal(typeof created.firewalls[0].firewall, 'number');
    assert.ok(['fsn1', 'nbg1', 'hel1'].includes(created.location));
    assert.equal(created.image, 4242);
    assert.equal(created.server_type, 'cax11');
    assert.equal(created.labels['evia-restore'], 'staging');
    assert.equal(created.start_after_create, true);
    const userData = String(created.user_data);
    assert.match(userData, /ssh_pwauth: false/);
    assert.match(userData, /disable_root: true/);
    assert.match(userData, /\[shutdown, -h, "\+300"\]/);
    assert.match(userData, /systemctl, disable, --now, ssh\.service, ssh\.socket/);
    assert.match(userData, /passwd, -l, root/);
    for (const name of [
      'restore-reader-s3-secret-access-key',
      'pgbackrest-cipher-pass',
      'rclone-crypt-password',
      'rclone-crypt-password2',
      'restore-storagebox-password',
    ])
      assert.equal(entry(userData, `/etc/evia-restore/secrets/${name}`), SECRETS[/** @type {keyof typeof SECRETS} */ (name)], name);
    const decoded =
      userData + Buffer.from([...userData.matchAll(/content: (\S+)/g)].map((item) => item[1]).join(''), 'base64').toString('latin1');
    for (const forbidden of [TOKEN, SECRETS['backup-s3-secret-access-key'], SECRETS['restore-orchestrator-s3-secret-access-key']])
      assert.ok(!decoded.includes(forbidden) && !userData.includes(Buffer.from(forbidden).toString('base64')), 'no token, no write key');
    const env = entry(userData, '/etc/evia-restore/env');
    assert.match(
      env,
      /^RESULT_PUT_URL='http:\/\/127\.0\.0\.1:\d+\/evia-test-db-backup\/restore-results\/[0-9a-z-]+\.json\?X-Amz-Algorithm=AWS4-HMAC-SHA256&.*X-Amz-Expires=7200&X-Amz-SignedHeaders=host%3Bif-none-match&X-Amz-Signature=[0-9a-f]{64}'$/m,
    );
    assert.ok(!env.includes('SECRET'), 'the env file carries no secret');
  });

  it('EVM-084 AC3, AC5: a named restore point is written to the WAL of staging and archived BEFORE the VM exists; the VM gets the point, the backup that stopped before it and the archive delay', async () => {
    mock = await startMock();
    run = await exec('run.sh');
    assert.equal(run.status, 0, run.stderr);
    const env = decodedEnv();
    const runId = /^RUN_ID='([0-9a-z-]+)'$/m.exec(env)?.[1] ?? 'none';
    assert.match(env, new RegExp(`^RESTORE_POINT='${runId}'$`, 'm'));
    assert.match(env, /^BACKUP_SET='20261027-010000F_20261028-010000D'$/m);
    assert.match(env, /^ARCHIVED_AT='\d{4}-\d{2}-\d{2}T[0-9:]{8}Z'$/m);
    assert.match(env, /^PG_SUPERUSER='evia_owner'$/m);
    const target = /^TARGET_TIME='(.*)'$/m.exec(env)?.[1] ?? '';
    const archived = /^ARCHIVED_AT='(.*)'$/m.exec(env)?.[1] ?? '';
    assert.ok(Date.parse(archived) >= Date.parse(target), 'the archive confirmation is not older than the point');
    assert.equal(readFileSync(join(root, 'psql.log'), 'utf8').trim(), `psql -Atq -c select pg_create_restore_point('${runId}')`);
    const calls = readFileSync(join(root, 'pgbackrest.log'), 'utf8').trim().split('\n');
    assert.deepEqual(
      calls,
      ['pgbackrest check', 'pgbackrest info --output=json'],
      'the segment is archived (check), then the backups are read',
    );
    assert.ok(events().some((item) => item.event === 'restore-test-point-created'));
    assert.ok(
      events().findIndex((item) => item.event === 'restore-test-point-created') <
        events().findIndex((item) => item.event === 'restore-test-vm-created'),
    );
  });

  it('EVM-084 AC3 (P10): when the point cannot be written, archived or restored from, no firewall and no VM are created', async () => {
    mock = await startMock();
    writeFileSync(join(root, 'bin/fake-psql'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });
    run = await exec('run.sh');
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /cannot create the restore point/);
    pgbackrestFake();
    writeFileSync(join(root, 'bin/fake-pgbackrest'), '#!/bin/bash\n[ "$1" = check ] && exit 1\nexit 0\n', { mode: 0o755 });
    run = await exec('run.sh');
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /archive check after the restore point failed/);
    // no backup older than the point: the only backup stopped in the future
    writeFileSync(
      join(root, 'bin/fake-pgbackrest'),
      `#!/bin/bash\nif [ "$1" = info ]; then echo '[{"backup":[{"label":"20261027-010000F","timestamp":{"start":4102444800,"stop":4102444900}}]}]'; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    run = await exec('run.sh');
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /no backup older than the restore point/);
    assert.ok(!mock.requests.some((item) => item.method === 'POST'), 'nothing was created');
  });

  it('EVM-084 AC3: an odd database superuser name is refused before any request', async () => {
    mock = await startMock();
    run = await exec('run.sh', [], { PG_SUPERUSER: "evia'; drop" });
    assert.notEqual(run.status, 0);
    assert.equal(mock.requests.length, 0);
  });

  it('EVM-084 AC3: the result is stored locally after validation, the VM and the firewall are deleted, nothing secret reaches the log', async () => {
    mock = await startMock();
    run = await exec('run.sh');
    assert.equal(run.status, 0, run.stderr);
    const last = JSON.parse(readFileSync(join(root, 'state/last.json'), 'utf8'));
    assert.equal(last.status, 'ok');
    assert.equal(last.dbTables, 42);
    assert.equal(last.scenario, 'none');
    assert.deepEqual(mock.store['servers'], []);
    assert.deepEqual(mock.store['firewalls'], []);
    assert.deepEqual(
      readdirSyncSafe(join(root, 'state')).filter((name) => name.startsWith('work.')),
      [],
    );
    assert.match(metrics(), /^evia_restore_test_last_success_timestamp_seconds \d+$/m);
    assert.match(metrics(), /^evia_restore_test_last_rpo_seconds 120$/m);
    assert.ok(events().some((item) => item.event === 'restore-test-finished'));
    const created = mock.requests.findIndex((item) => item.method === 'POST' && item.path === '/v1/servers');
    const removed = mock.requests.findIndex((item) => item.method === 'DELETE' && item.path.startsWith('/v1/servers/'));
    assert.ok(created >= 0 && removed > created);
    assertNoSecret(run.stdout + run.stderr + readFileSync(join(root, 'state/events.jsonl'), 'utf8'), [userDataSignature()]);
  });

  const userDataSignature = () => /X-Amz-Signature=([0-9a-f]{64})/.exec(decodedEnv())?.[1] ?? 'no-signature';
  const decodedEnv = () => entry(decodedUserData(), '/etc/evia-restore/env');

  it('EVM-084 AC3 (P10): a second VM is refused when the project has ANY server (label or not); nothing is created', async () => {
    mock = await startMock();
    mock.store['servers'].push(server({ id: 7, labels: {} }));
    run = await exec('run.sh');
    assert.notEqual(run.status, 0);
    assert.ok(!mock.requests.some((item) => item.method === 'POST'));
    assert.deepEqual(
      mock.store['servers'].map((item) => item.id),
      [7],
      'a server of somebody else is not deleted by the cleanup',
    );
    assert.ok(events().some((item) => item.event === 'restore-test-refused' && item.reason === 'server-exists'));
  });

  it('EVM-084 AC3 (P10): a run holding the lock refuses a second one (exit 75)', async () => {
    mock = await startMock();
    mkdirSync(join(root, 'state'), { recursive: true, mode: 0o700 });
    const holder = spawn('flock', [join(root, 'state/run.lock'), 'sleep', '5']);
    await new Promise((resolve) => setTimeout(resolve, 400));
    run = await exec('run.sh');
    holder.kill();
    assert.equal(run.status, 75);
    assert.ok(!mock.requests.some((item) => item.method === 'POST'));
  });

  it('EVM-084 AC3: a location outside the EU list or a missing image id is refused before any request', async () => {
    mock = await startMock();
    for (const extra of [
      { RESTORE_LOCATION: 'ash' },
      { RESTORE_IMAGE: 'debian-13' },
      { RESTORE_SERVER_TYPE: 'cx22 ' },
      { S3_ENDPOINT: 'http://example.com' },
    ]) {
      run = await exec('run.sh', [], extra);
      assert.notEqual(run.status, 0, JSON.stringify(extra));
    }
    assert.equal(mock.requests.length, 0);
  });

  it('EVM-084 AC3: the VM is deleted after an error — a result that breaks the schema, a failed restore, a VM that never powers off', async () => {
    const cases = /** @type {Array<[string, Record<string, any>, Record<string, string>]>} */ ([
      ['unknown field', { result: (/** @type {any} */ run) => ({ ...validResult(run), extra: 'x' }) }, {}],
      ['wrong run id', { result: (/** @type {any} */ run) => ({ ...validResult(run), runId: 'other' }) }, {}],
      ['string instead of a number', { result: (/** @type {any} */ run) => ({ ...validResult(run), dbRows: '12' }) }, {}],
      ['negative number', { result: (/** @type {any} */ run) => ({ ...validResult(run), mediaFiles: -1 }) }, {}],
      ['oversized', { result: (/** @type {any} */ run) => JSON.stringify({ ...validResult(run), stage: 'x'.repeat(20000) }) }, {}],
      ['not json', { result: () => 'not json' }, {}],
      ['no result', { result: () => null }, {}],
      ['restore failed', { result: (/** @type {any} */ run) => ({ ...validResult(run), status: 'failed', stage: 'database' }) }, {}],
      ['never powers off', { neverOff: true }, { EVIA_RESTORE_MAX_WAIT_SECONDS: '2', EVIA_RESTORE_POLL_SECONDS: '1' }],
    ]);
    for (const [name, options, extra] of cases) {
      mock = await startMock(options);
      run = await exec('run.sh', [], extra);
      assert.notEqual(run.status, 0, name);
      assert.deepEqual(mock.store['servers'], [], `${name}: server deleted`);
      assert.deepEqual(mock.store['firewalls'], [], `${name}: firewall deleted`);
      assertNoSecret(run.stdout + run.stderr);
      // a result that failed the schema or never came is not stored; a reported failure is (it is the record of the run)
      assert.equal(existsSync(join(root, 'state/last.json')), name === 'restore failed', `${name}: last.json`);
      assert.match(metrics(), /^evia_restore_test_last_run_failed 1$/m, name);
      await mock.close();
      mock = undefined;
      rmSync(join(root, 'state/last.json'), { force: true });
      writeFileSync(join(root, 'state/events.jsonl'), '');
    }
  });

  it('EVM-084 AC3: a server whose create answer was lost is found by the label of the run and deleted; the firewall waits until the server is gone', async () => {
    mock = await startMock({ createFails: true, firewallBusy: 2 });
    run = await exec('run.sh');
    assert.notEqual(run.status, 0);
    assert.deepEqual(mock.store['servers'], []);
    assert.deepEqual(mock.store['firewalls'], []);
    assert.ok(
      mock.requests.filter((item) => item.method === 'DELETE' && item.path.startsWith('/v1/firewalls/')).length >= 3,
      'the deletion was retried',
    );
  });

  it('EVM-084 AC3: SIGTERM during the wait still deletes the VM and the firewall', async () => {
    mock = await startMock({ neverOff: true });
    const child = spawn('bash', [join(DIR, 'run.sh')], {
      env: env({ EVIA_RESTORE_POLL_SECONDS: '1', EVIA_RESTORE_MAX_WAIT_SECONDS: '60' }),
    });
    const closed = new Promise((resolve) => child.on('close', (code) => resolve(code)));
    for (
      let tries = 0;
      tries < 50 && !mock.requests.some((item) => item.path.startsWith('/v1/servers/') && item.method === 'GET');
      tries += 1
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    child.kill('SIGTERM');
    assert.notEqual(await closed, 0);
    assert.deepEqual(mock.store['servers'], []);
    assert.deepEqual(mock.store['firewalls'], []);
  });
});

function readdirSyncSafe(/** @type {string} */ path) {
  const listing = spawnSync('ls', ['-A', path], { encoding: 'utf8' });
  return listing.stdout.split('\n').filter(Boolean);
}

describe('EVM-084 AC3 (P5): the presigned URL of the result', () => {
  const presign = (/** @type {string[]} */ args, /** @type {Record<string, string>} */ extra = {}) =>
    spawnSync('bash', [join(DIR, 's3-presign.sh'), ...args], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', S3_SECRET_FILE: join(root, 'aws-secret'), EVIA_RESTORE_TEST_MODE: '1', ...extra },
    });

  it('EVM-084 AC3: the known answer of the AWS documentation (SigV4, query string) is reproduced', () => {
    writeFileSync(join(root, 'aws-secret'), 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', { mode: 0o600 });
    const run = presign(['GET', 'examplebucket.s3.amazonaws.com', '/test.txt', '86400', 'AKIAIOSFODNN7EXAMPLE', 'us-east-1'], {
      EVIA_PRESIGN_DATE: '20130524T000000Z',
      S3_PRESIGN_MAX_EXPIRES: '86400',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      run.stdout.trim(),
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('EVM-084 AC3: the lifetime is at most 2 hours, and the conditional PUT signs If-None-Match (a second PUT is refused by the bucket)', () => {
    writeFileSync(join(root, 'aws-secret'), 'SYNTHETIC-SECRET', { mode: 0o600 });
    const base = ['PUT', 's3.pl-waw.scw.cloud', '/b/restore-results/x.json'];
    assert.equal(presign([...base, '7200', 'SCWKEY1', 'pl-waw']).status, 0);
    assert.equal(presign([...base, '7201', 'SCWKEY1', 'pl-waw']).status, 1);
    assert.equal(presign([...base, '0', 'SCWKEY1', 'pl-waw']).status, 1);
    const once = presign([...base, '600', 'SCWKEY1', 'pl-waw', 'if-none-match']);
    assert.match(once.stdout, /X-Amz-SignedHeaders=host%3Bif-none-match/);
    assert.notEqual(
      /X-Amz-Signature=(\w+)/.exec(once.stdout)?.[1],
      /X-Amz-Signature=(\w+)/.exec(presign([...base, '600', 'SCWKEY1', 'pl-waw']).stdout)?.[1],
    );
    assert.ok(!(once.stdout + once.stderr).includes('SYNTHETIC-SECRET'));
  });

  it('EVM-084 AC3: odd input is refused (method, host, path with a query or traversal, key id, missing secret file)', () => {
    writeFileSync(join(root, 'aws-secret'), 'SYNTHETIC-SECRET', { mode: 0o600 });
    const ok = ['PUT', 's3.pl-waw.scw.cloud', '/b/k.json', '600', 'SCWKEY1', 'pl-waw'];
    const variants = [
      ['DELETE', ...ok.slice(1)],
      [ok[0], 'EVIL HOST', ...ok.slice(2)],
      [...ok.slice(0, 2), '/b/k.json?x=1', ...ok.slice(3)],
      [...ok.slice(0, 2), 'b/k.json', ...ok.slice(3)],
      [...ok.slice(0, 4), 'KEY;rm', ok[5]],
      [...ok.slice(0, 5), 'PL WAW'],
      [...ok, 'bogus'],
    ];
    for (const variant of variants) assert.equal(presign(/** @type {string[]} */ (variant)).status, 1, variant.join(' '));
    assert.equal(presign(ok, { S3_SECRET_FILE: join(root, 'missing') }).status, 1);
    assert.equal(presign(ok.slice(0, 5)).status, 1);
  });
});

describe('EVM-084 AC5: the scenario "backup deleted from a taken-over VM"', () => {
  /** A versioned store on disk: `live/` are the current objects, `trash/` the objects hidden by a delete marker. */
  function fakes(/** @type {{ backupFails?: boolean, healBroken?: boolean }} */ { backupFails = false, healBroken = false } = {}) {
    const store = join(root, 'fake-s3');
    mkdirSync(join(store, 'live'), { recursive: true });
    mkdirSync(join(store, 'trash'), { recursive: true });
    for (const file of [
      'backup/evia/backup.info',
      'backup/evia/20261027-010000F/pg_data/base.gz',
      'archive/evia/18-1/0000000100000001.gz',
    ]) {
      mkdirSync(join(store, 'live', file, '..'), { recursive: true });
      writeFileSync(join(store, 'live', file), 'synthetic');
    }
    mkdirSync(join(root, 'bin'), { recursive: true });
    const secretsSeen = join(root, 'rclone-env.log');
    writeFileSync(
      join(root, 'bin/fake-rclone'),
      `#!/bin/bash
store="${store}"
printf '%s\\n' "\${RCLONE_CONFIG_BK_ACCESS_KEY_ID:-}" >> "${secretsSeen}"
args=("$@")
case "\${args[2]:-}" in
  lsf) (cd "$store/live" && find . -type f | sed 's#^\\./##') ;;
esac
for index in "\${!args[@]}"; do
  case "\${args[$index]}" in
    delete) mkdir -p "$store/trash" && cp -R "$store/live/." "$store/trash/" && rm -rf "$store/live" && mkdir -p "$store/live" ;;
    copy) ${healBroken ? ':' : 'cp -R "$store/trash/." "$store/live/"'} ;;
  esac
done
exit 0
`,
      { mode: 0o755 },
    );
    pgbackrestFake(backupFails);
    return { store, secretsSeen };
  }
  const scenarioEnv = () => ({
    EVIA_RCLONE_BIN: join(root, 'bin/fake-rclone'),
    EVIA_PGBACKREST_BIN: join(root, 'bin/fake-pgbackrest'),
    BACKUP_WRITER_ACCESS_KEY_ID: 'SCWWRITER0003',
  });
  const liveFiles = (/** @type {string} */ store) => readdirSyncSafe(join(store, 'live'));

  it('EVM-084 AC5: after a fresh backup the objects are deleted with the key of the VM, the time is recorded, and `heal` restores the repository to the state before', async () => {
    mock = await startMock();
    const { store } = fakes();
    const state = join(root, 'scenario.state');
    const deleted = await exec('scenario.sh', ['delete', state], scenarioEnv());
    assert.equal(deleted.status, 0, deleted.stderr);
    assert.deepEqual(liveFiles(store), [], 'the repository looks empty to the key of the VM');
    assert.match(readFileSync(state, 'utf8'), /^\d{4}-\d{2}-\d{2}T[0-9:]+Z\n$/);
    assert.match(readFileSync(join(root, 'pgbackrest.log'), 'utf8'), /^pgbackrest backup --type=incr$/m);
    const healed = await exec('scenario.sh', ['heal', state], scenarioEnv());
    assert.equal(healed.status, 0, healed.stderr);
    assert.deepEqual(liveFiles(store).sort(), ['archive', 'backup']);
    const log = readFileSync(join(root, 'pgbackrest.log'), 'utf8');
    assert.match(log, /^pgbackrest check$/m);
    assert.match(log, /^pgbackrest info$/m);
    assert.match(metrics(), /^evia_restore_repo_heal_failed 0$/m);
    assert.ok(events().some((item) => item.event === 'restore-repo-healed'));
    assert.ok(!existsSync(state), 'the state is consumed');
    assertNoSecret(deleted.stdout + deleted.stderr + healed.stdout + healed.stderr);
  });

  it('EVM-084 AC5: a failed fresh backup deletes nothing', async () => {
    mock = await startMock();
    const { store } = fakes({ backupFails: true });
    const run = await exec('scenario.sh', ['delete', join(root, 'scenario.state')], scenarioEnv());
    assert.equal(run.status, 1);
    assert.deepEqual(liveFiles(store).sort(), ['archive', 'backup']);
    assert.ok(events().some((item) => item.event === 'restore-scenario-aborted'));
  });

  it('EVM-084 AC5: a repository that is not whole after the healing is an event and a metric, exit code 1', async () => {
    mock = await startMock();
    const { store } = fakes({ healBroken: true });
    const state = join(root, 'scenario.state');
    assert.equal((await exec('scenario.sh', ['delete', state], scenarioEnv())).status, 0);
    const healed = await exec('scenario.sh', ['heal', state], scenarioEnv());
    assert.equal(healed.status, 1);
    assert.deepEqual(liveFiles(store), []);
    assert.match(metrics(), /^evia_restore_repo_heal_failed 1$/m);
    assert.ok(events().some((item) => item.event === 'restore-repo-heal-failed'));
  });

  it('EVM-084 AC5: the orchestrator runs the scenario, hands the VM the repository time before the deletion, and heals the repository also when the test fails', async () => {
    for (const failing of [false, true]) {
      await mock?.close();
      mock = await startMock(failing ? { result: () => null } : {});
      const { store } = fakes();
      const run = await exec('run.sh', [], { ...scenarioEnv(), EVIA_RESTORE_SCENARIO: 'delete' });
      assert.equal(run.status === 0, !failing, run.stderr);
      const created = mock.requests.find((item) => item.method === 'POST' && item.path === '/v1/servers');
      const userData = String(JSON.parse(created?.body ?? '{}').user_data);
      const env = Buffer.from(/path: \/etc\/evia-restore\/env\n.*\n.*\n\s+content: (\S+)/.exec(userData)?.[1] ?? '', 'base64').toString(
        'utf8',
      );
      assert.match(env, /^REPO_TARGET_TIME='\d{4}-\d{2}-\d{2}T[0-9:]+Z'$/m);
      assert.deepEqual(liveFiles(store).sort(), ['archive', 'backup'], 'the repository is whole again');
      if (!failing) assert.equal(JSON.parse(readFileSync(join(root, 'state/last.json'), 'utf8')).scenario, 'delete');
      assertNoSecret(run.stdout + run.stderr);
    }
  });
});

describe('EVM-084 AC3, AC5, AC6: vm-restore.sh and the contract of its result', () => {
  const script = readFileSync(join(DIR, 'vm-restore.sh'), 'utf8');
  const SCHEMA = join(DIR, 'result.schema.jq');

  /** Runs `publish` of the real script (sourced) with a stand-in curl and returns the object it wrote. */
  function publishResult(/** @type {string} */ assignments) {
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(join(root, 'bin/curl'), `#!/bin/bash\necho "$*" >> "${join(root, 'curl.log')}"\nexit 0\n`, { mode: 0o755 });
    const resultPath = join(root, 'vm-result.json');
    const run = spawnSync(
      'bash',
      [
        '-c',
        `. "${join(DIR, 'vm-restore.sh')}"; RUN_ID=run-1; TARGET_TIME=2026-10-27T12:00:00Z; RESULT_PUT_URL=https://example.invalid/put; ${assignments}; publish`,
      ],
      { env: { PATH: `${join(root, 'bin')}:/usr/bin:/bin`, EVIA_RESTORE_TEST_MODE: '1', EVIA_VM_RESULT: resultPath }, encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(readFileSync(resultPath, 'utf8'));
  }
  const valid = (/** @type {object} */ result) =>
    spawnSync('jq', ['-e', '--arg', 'run', 'run-1', '--arg', 'iso', '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$', '-f', SCHEMA], {
      input: JSON.stringify(result),
      encoding: 'utf8',
    }).status === 0;

  it('EVM-084 AC3: the result the VM writes — a failure at the very start as well as a success — passes the schema of the orchestrator (no negative rpoSeconds)', () => {
    const early = publishResult('true');
    assert.equal(early.status, 'failed');
    assert.equal(early.stage, 'start');
    assert.equal(early.rpoSeconds, 0);
    assert.ok(valid(early), JSON.stringify(early));
    const ok = publishResult(
      'status=ok; stage=done; restored_to=2026-10-27T12:00:00Z; rpo=3; tables=12; rows=340; media_files=5; media_sample=3; register_entries=2',
    );
    assert.ok(valid(ok), JSON.stringify(ok));
    assert.equal(ok.dbRows, 340);
    // the schema itself still refuses what the VM must not send
    assert.ok(!valid({ ...ok, rpoSeconds: -1 }));
    assert.ok(!valid({ ...ok, extra: 1 }));
    assert.ok(!valid({ ...ok, stage: 'Not Allowed' }));
    assert.match(readFileSync(join(root, 'curl.log'), 'utf8'), /-X PUT -H If-None-Match: \* .*--data-binary @.*vm-result\.json/);
  });

  it('EVM-084 AC3: the schema file is the one the orchestrator uses, and nothing else validates the result', () => {
    const orchestrator = readFileSync(join(DIR, 'run.sh'), 'utf8');
    assert.match(orchestrator, /-f "\$SELF_DIR\/result\.schema\.jq"/);
    assert.doesNotMatch(orchestrator, /def count/);
  });

  it('EVM-084 AC3, AC5: the script restores to the named point from a chosen backup with the secrets in a file the recovering server can read; it publishes one conditional PUT and powers off, also after a failure', () => {
    assert.match(script, /^if \[\[ "\$\{BASH_SOURCE\[0\]\}" == "\$0" \]\]; then main; fi$/m);
    assert.match(script, /^ {2}restore_steps\n {2}publish\n {2}shutdown -h now$/m);
    assert.match(script, /--type=name --target="\$\{RESTORE_POINT:\?\}" --target-action=promote --set="\$\{BACKUP_SET:\?\}"/);
    assert.match(script, /--repo-target-time=/);
    assert.doesNotMatch(script, /--type=time/);
    assert.match(script, /conf\.d\/secrets\.conf/);
    assert.match(script, /repo1-cipher-pass=/);
    assert.match(script, /repo1-s3-key-secret=/);
    assert.doesNotMatch(
      script,
      /PGBACKREST_REPO1_(CIPHER_PASS|S3_KEY_SECRET)=/,
      'the secrets are not only in the environment of one process',
    );
    assert.match(script, /-U "\$superuser"/);
    assert.match(script, /recovery stopping at restore point/);
    assert.match(script, /greatest\(reltuples, 0\)/);
    assert.match(script, /-H 'If-None-Match: \*'/);
    assert.match(script, /repo1-cipher-type=aes-256-cbc/);
    assert.doesNotMatch(script, /verify-tls|backup-s3-secret|restore-hcloud-token|restore-orchestrator/);
    assert.doesNotMatch(script, /--password|--secret/);
  });

  it('EVM-084 AC3: test mode is not reachable without EVIA_RESTORE_TEST_MODE=1 (the paths of the VM are kept)', () => {
    const run = spawnSync(
      'bash',
      [
        '-c',
        `EVIA_VM_PGDATA=/tmp/evil EVIA_VM_REPO_PATH=/tmp/evil . "${join(DIR, 'vm-restore.sh')}"; printf '%s|%s|%s' "$PGDATA_DIR" "\${AS_POSTGRES[*]}" "$TEST_MODE"`,
      ],
      { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' },
    );
    assert.equal(run.stdout, '/var/lib/evia-restore/pgdata|runuser -u postgres --|0');
  });
});
