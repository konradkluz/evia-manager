// @ts-check
/* eslint-disable @typescript-eslint/require-await -- stand-ins of async interfaces (api, fetch) */
/**
 * GHCR retention on a stand-in of the API (EVM-007 AC2; ADR-0018 n2; security-engineer A5): protected digests of the
 * last 30 push runs, the 20 newest versions, only evia-api and evia-web, dry-run by default, fail-closed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { KEEP_NEWEST, digestsOf, githubApi, manifestFromZip, retention, runFromEnv, versionsToDelete } from '../lib/retention.mjs';

const OWNER = 'evia-test';
const REPOSITORY = `${OWNER}/manager`;
const digest = (/** @type {string} */ label) => `sha256:${createHash('sha256').update(label).digest('hex')}`;

/** A single-entry ZIP (store or deflate). @param {string} name @param {string} text @param {number} method */
function zip(name, text, method = 8) {
  const data = Buffer.from(text);
  const payload = method === 8 ? deflateRawSync(data) : data;
  const file = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(payload.byteLength, 18);
  local.writeUInt32LE(data.byteLength, 22);
  local.writeUInt16LE(file.byteLength, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(payload.byteLength, 20);
  central.writeUInt32LE(data.byteLength, 24);
  central.writeUInt16LE(file.byteLength, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + file.byteLength, 12);
  end.writeUInt32LE(30 + file.byteLength + payload.byteLength, 16);
  return new Uint8Array(Buffer.concat([local, file, payload, central, file, end]));
}

const manifest = (/** @type {string} */ label) =>
  JSON.stringify({
    schemaVersion: 1,
    commit: 'a'.repeat(40),
    images: { api: `ghcr.io/${OWNER}/evia-api@${digest(`api-${label}`)}`, web: `ghcr.io/${OWNER}/evia-web@${digest(`web-${label}`)}` },
    compose: 'infra/runtime/compose.staging.yaml',
  });

/** A stand-in of the API: 3 push runs with manifests, `count` versions per package (newest first by label). */
function stub({ count = 25, protectedLabels = ['r1', 'r2', 'r3'], broken = '' } = {}) {
  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const requested = [];
  const versions = (/** @type {string} */ name) =>
    Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      name: digest(`${name === 'evia-api' ? 'api' : 'web'}-v${String(index)}`),
      created_at: new Date(Date.UTC(2026, 9, 21) - index * 3_600_000).toISOString(),
    }));
  /** @type {import('../lib/retention.mjs').Api} */
  const api = {
    get: async (path) => {
      requested.push(path);
      if (broken === 'runs' && path.includes('/runs?')) return {};
      if (path.includes('/workflows/ci.yml/runs?'))
        return {
          workflow_runs: protectedLabels
            .map((_label, index) => ({ id: index + 1, event: 'push', head_branch: 'main' }))
            .concat([{ id: 99, event: 'pull_request', head_branch: 'x' }]),
        };
      const run = /\/actions\/runs\/(\d+)\/artifacts/.exec(path);
      if (run !== null) {
        if (broken === 'expired' && run[1] === '2') return { artifacts: [{ name: 'release-manifest', expired: true }] };
        return {
          artifacts: [
            { name: 'release-manifest', expired: false, archive_download_url: `zip:${protectedLabels[Number(run[1]) - 1] ?? ''}` },
          ],
        };
      }
      if (broken === 'versions' && path.includes('/versions')) throw new Error('500');
      const pkg = /\/packages\/container\/(evia-api|evia-web)\/versions/.exec(path);
      if (pkg !== null) return versions(pkg[1] ?? '');
      throw new Error(`unexpected ${path}`);
    },
    artifact: async (url) => {
      if (broken === 'zip') return new Uint8Array(10);
      return zip('release-manifest.json', manifest(url.slice(4)));
    },
    remove: async (path) => {
      removed.push(path);
    },
  };
  return { api, removed, requested };
}

describe('EVM-007 AC2: GHCR retention', () => {
  it('EVM-007 AC2: dry-run (the default) deletes nothing and reports the candidates', async () => {
    const { api, removed } = stub();
    const lines = /** @type {string[]} */ ([]);
    const result = await retention({ api, repository: REPOSITORY, mode: 'dry-run', log: (line) => lines.push(line) });
    assert.deepEqual(removed, []);
    assert.equal(result.aborted, false);
    assert.equal(result.candidates, 10);
    assert.match(lines.at(-1) ?? '', /dry-run/);
    assert.ok(lines.every((line) => !line.includes('ghs_')));
  });

  it('EVM-007 AC2: delete keeps the 20 newest and every digest of the manifests of the last push runs, in evia-api and evia-web only', async () => {
    const { api, removed, requested } = stub({ count: 25, protectedLabels: ['v22', 'v24'] });
    const result = await retention({ api, repository: REPOSITORY, mode: 'delete', log: () => undefined });
    // 5 beyond the newest 20 per package, minus the protected v22 and v24 of each
    assert.equal(result.deleted, 6);
    assert.ok(removed.every((path) => /\/users\/evia-test\/packages\/container\/evia-(api|web)\/versions\/\d+$/.test(path)));
    assert.ok(!removed.some((path) => path.endsWith('/versions/23') || path.endsWith('/versions/25')));
    assert.ok(requested.every((path) => !path.includes('deploy-agent')));
  });

  for (const broken of ['runs', 'expired', 'zip'])
    it(`EVM-007 AC2: fail-closed — an unreadable manifest source (${broken}) deletes nothing`, async () => {
      const { api, removed } = stub({ broken });
      const result = await retention({ api, repository: REPOSITORY, mode: 'delete', log: () => undefined });
      assert.equal(result.aborted, true);
      assert.deepEqual(removed, []);
    });

  it('EVM-007 AC2: fail-closed — an error listing the versions deletes nothing', async () => {
    const { api, removed } = stub({ broken: 'versions' });
    const result = await retention({ api, repository: REPOSITORY, mode: 'delete', log: () => undefined });
    assert.equal(result.aborted, true);
    assert.deepEqual(removed, []);
  });

  it('EVM-007 AC2: the selection ignores versions that are not digests and keeps KEEP_NEWEST', () => {
    const versions = Array.from({ length: KEEP_NEWEST + 2 }, (_, index) => ({
      id: index,
      name: index === 0 ? 'latest' : digest(String(index)),
      created_at: new Date(Date.UTC(2026, 0, 1) + index).toISOString(),
    }));
    const selected = versionsToDelete(versions, new Set());
    assert.equal(selected.length, 1);
    assert.equal(selected[0]?.id, 1);
  });

  it('EVM-007 AC2: the manifest digests come only from the allowed repositories; the ZIP must hold exactly release-manifest.json', () => {
    assert.deepEqual(digestsOf(Buffer.from(manifest('x')), OWNER), [digest('api-x'), digest('web-x')]);
    assert.throws(() => digestsOf(Buffer.from(manifest('x').replace(`ghcr.io/${OWNER}/evia-api`, 'ghcr.io/other/evia-api')), OWNER));
    assert.throws(() => digestsOf(Buffer.from('{'), OWNER));
    assert.throws(() => digestsOf(Buffer.from('{}'), OWNER));
    assert.equal(new TextDecoder().decode(manifestFromZip(zip('release-manifest.json', '{"a":1}', 0))), '{"a":1}');
    assert.throws(() => manifestFromZip(zip('other.json', '{}')));
    assert.throws(() => manifestFromZip(new Uint8Array(30)));
    const broken = zip('release-manifest.json', '{}');
    broken[broken.byteLength - 6] = 0xff;
    assert.throws(() => manifestFromZip(broken));
    const badLocal = zip('release-manifest.json', '{}');
    badLocal[0] = 0;
    assert.throws(() => manifestFromZip(badLocal));
    const badData = zip('release-manifest.json', '{}');
    new DataView(badData.buffer).setUint32(badData.byteLength - 22 - 46 - 21 + 20, 0xffff, true);
    assert.throws(() => manifestFromZip(badData));
    const badInflate = zip('release-manifest.json', '{}');
    badInflate[30 + 21] = 0xff;
    badInflate[30 + 22] = 0xff;
    assert.throws(() => manifestFromZip(badInflate));
  });

  it('EVM-007 AC2 (A3): the API client sends the job token, never follows a redirect with it and limits the download', async () => {
    /** @type {Array<{ url: string, auth: string | null }>} */
    const calls = [];
    /** @type {typeof fetch} */
    const fake = async (input, init) => {
      const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
      const headers = new Headers(init?.headers);
      calls.push({ url, auth: headers.get('authorization') });
      if (url.endsWith('/zip')) return new Response(null, { status: 302, headers: { location: 'https://blob.example/x' } });
      if (url.endsWith('/nozip')) return new Response(null, { status: 200 });
      if (url === 'https://blob.example/x') return new Response(new Uint8Array(4));
      if (url.includes('/fail')) return new Response('{}', { status: 500 });
      return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response('{"ok":true}');
    };
    const api = githubApi('ghs_synthetic', fake, 'https://api.example');
    assert.deepEqual(await api.get('/x'), { ok: true });
    await api.remove('/x');
    assert.equal((await api.artifact('https://api.example/zip')).byteLength, 4);
    assert.equal(calls.find((call) => call.url === 'https://blob.example/x')?.auth, null);
    assert.equal(calls[0]?.auth, 'Bearer ghs_synthetic');
    await assert.rejects(api.get('/fail'));
    await assert.rejects(api.artifact('https://api.example/nozip'));
    const big = githubApi('t', async (input) =>
      (input instanceof URL ? input.href : typeof input === 'string' ? input : input.url).endsWith('/zip')
        ? new Response(null, { status: 302, headers: { location: 'https://blob.example/big' } })
        : new Response(new Uint8Array(2 * 1024 * 1024)),
    );
    await assert.rejects(big.artifact('https://api.example/zip'));
    const missing = githubApi('t', async (input) =>
      (input instanceof URL ? input.href : typeof input === 'string' ? input : input.url).endsWith('/zip')
        ? new Response(null, { status: 302, headers: { location: 'https://blob.example/404' } })
        : new Response(null, { status: 404 }),
    );
    await assert.rejects(missing.artifact('https://api.example/zip'));
  });

  it('EVM-007 AC2: the step reads the repository and the mode from the environment; anything but delete is a dry run', async () => {
    const { api, removed } = stub();
    const lines = /** @type {string[]} */ ([]);
    const dry = await runFromEnv(
      { GITHUB_REPOSITORY: REPOSITORY, GHCR_RETENTION_MODE: 'yes' },
      () => api,
      (line) => lines.push(line),
    );
    assert.equal(dry?.deleted, 0);
    assert.deepEqual(removed, []);
    const real = await runFromEnv(
      { GITHUB_REPOSITORY: REPOSITORY, GITHUB_TOKEN: 'ghs_x', GHCR_RETENTION_MODE: 'delete' },
      () => api,
      () => undefined,
    );
    assert.equal(real?.deleted, 10);
    assert.equal(
      await runFromEnv(
        { GITHUB_REPOSITORY: 'not a repository' },
        () => api,
        () => undefined,
      ),
      null,
    );
  });

  it('EVM-007 AC2: the CLI without a repository does nothing (no request)', () => {
    const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [cli], {
      encoding: 'utf8',
      cwd: mkdtempSync(join(tmpdir(), 'retention-')),
      env: { PATH: process.env['PATH'] ?? '' },
    });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /nic nie usunięto/);
  });
});
