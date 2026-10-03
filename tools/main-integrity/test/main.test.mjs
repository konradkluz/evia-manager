// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMIT_TITLE, main } from '../lib/main.mjs';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const REPO = 'synthetic-owner/evia-manager';
const OWNER = 'owner-synthetic';
const BEFORE = 'b'.repeat(40);
const SHA = 'a'.repeat(40);
const SHA2 = 'c'.repeat(40);
const HEAD = 'd'.repeat(40);
const ZERO = '0'.repeat(40);
const TITLE = 'ci: add monorepo, quality gates and CI pipeline [EVM-006] (#2)';

/**
 * @param {{ sha?: string, message?: string, parents?: number }} [options]
 */
const commit = ({ sha = SHA, message = TITLE, parents = 1 } = {}) => ({
  sha,
  commit: { message: `${message}\n\nbody` },
  parents: Array.from({ length: parents }, (_, i) => ({ sha: String(i).repeat(40) })),
});

/** @param {Partial<Record<string, unknown>>} [overrides] */
const pull = (overrides = {}) => ({
  number: 2,
  state: 'closed',
  merged_at: '2026-10-04T10:00:00Z',
  merge_commit_sha: SHA,
  base: { ref: 'main' },
  head: { sha: HEAD, ref: 'feature/EVM-006-repo-i-ci' },
  merged_by: { login: OWNER },
  ...overrides,
});

/**
 * Fake GitHub REST API: path → JSON body (or a number = HTTP error status).
 * @param {Record<string, unknown>} overrides
 */
function api(overrides = {}) {
  /** @type {Record<string, unknown>} */
  const routes = {
    [`/repos/${REPO}/compare/${BEFORE}...${SHA}`]: { status: 'ahead', total_commits: 1, commits: [commit()] },
    [`/repos/${REPO}/commits/${SHA}/pulls`]: [pull()],
    [`/repos/${REPO}/pulls/2`]: pull(),
    [`/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${HEAD}&event=push&per_page=100`]: {
      workflow_runs: [
        { id: 7, path: '.github/workflows/ci.yml', head_sha: HEAD, event: 'push', created_at: '2026-10-04T09:00:00Z' },
        { id: 5, path: '.github/workflows/ci.yml', head_sha: HEAD, event: 'push', created_at: '2026-10-04T08:00:00Z' },
      ],
    },
    [`/repos/${REPO}/actions/runs/7/jobs?filter=latest&per_page=100`]: {
      jobs: [
        { name: 'quality', status: 'completed', conclusion: 'success' },
        { name: 'ci-gate', status: 'completed', conclusion: 'success' },
      ],
    },
    ...overrides,
  };
  /** @type {string[]} */
  const calls = [];
  /** @type {import('../lib/main.mjs').Fetch} */
  const fetch = (url, init) => {
    const path = url.replace('https://api.github.com', '');
    calls.push(path);
    assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
    const body = routes[path];
    if (body === 'network-error') return Promise.reject(new TypeError('fetch failed'));
    if (body === 'bad-json') {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection exercises the fail-closed branch
      const json = () => Promise.reject(/** @type {unknown} */ ('not json'));
      return Promise.resolve({ ok: true, status: 200, json });
    }
    if (body === undefined) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    if (typeof body === 'number') return Promise.resolve({ ok: false, status: body, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  return { fetch, calls };
}

/**
 * @param {Partial<Record<string, string>>} [env]
 * @param {Record<string, unknown>} [routes]
 */
async function run(env = {}, routes = {}) {
  /** @type {string[]} */
  const out = [];
  const { fetch, calls } = api(routes);
  const status = await main({
    env: { GITHUB_TOKEN: 'synthetic-token', GITHUB_REPOSITORY: REPO, BEFORE, AFTER: SHA, FORCED: 'false', MAIN_MERGER: OWNER, ...env },
    fetch,
    log: (line) => out.push(line),
  });
  return { status, out: out.join('\n'), calls };
}

describe('main integrity — K6 (EVM-006 AC4, A1, W5, W6)', () => {
  it('EVM-006 AC4: a squash merge of a PR merged by the owner with a green ci-gate and a Conventional Commit title passes', async () => {
    const { status, out } = await run();
    assert.equal(status, 0, out);
    assert.match(out, /OK/);
  });

  it('EVM-006 AC4: the title format accepts [EVM-###], [renovate] and [M#] with an optional (#N) suffix (W5)', () => {
    for (const title of [
      'ci: add monorepo, quality gates and CI pipeline [EVM-006]',
      'feat(work-orders): add template selection [EVM-123] (#14)',
      'chore(deps): update dependency vitest to v5.0.4 [renovate] (#31)',
      'docs(milestone): close M0 [M0] (#40)',
      'revert: restore pipeline without coverage gate [EVM-006] (#3)',
    ]) {
      assert.match(title, COMMIT_TITLE, title);
    }
    for (const title of [
      'Feature/evm 010 backlog m1 (#1)',
      'feat: no id',
      'Merge pull request #5 from x/y',
      'feat: x [evm-006]',
      'wip [EVM-006]',
    ]) {
      assert.doesNotMatch(title, COMMIT_TITLE, title);
    }
  });

  it('EVM-006 AC4: the lesson from PR #1 — a squash commit titled "Feature/evm 010 backlog m1 (#1)" is red', async () => {
    const message = 'Feature/evm 010 backlog m1 (#1)';
    const { status, out } = await run(
      {},
      { [`/repos/${REPO}/compare/${BEFORE}...${SHA}`]: { status: 'ahead', total_commits: 1, commits: [commit({ message })] } },
    );
    assert.equal(status, 1);
    assert.match(out, /Conventional Commit/);
  });

  it('EVM-006 AC4: a force push to main is red', async () => {
    const { status, out } = await run({ FORCED: 'true' });
    assert.equal(status, 1);
    assert.match(out, /force push/);
  });

  it('EVM-006 AC4: a history that is not a fast-forward of the previous main is red', async () => {
    const { status } = await run(
      {},
      { [`/repos/${REPO}/compare/${BEFORE}...${SHA}`]: { status: 'diverged', total_commits: 1, commits: [commit()] } },
    );
    assert.equal(status, 1);
  });

  it('EVM-006 AC4: a new or recreated main without a previous state is red (verify by hand)', async () => {
    const { status, out } = await run({ BEFORE: ZERO });
    assert.equal(status, 1);
    assert.match(out, /poprzedniego stanu/);
  });

  it('EVM-006 AC4: every commit of a multi-commit push is checked (a direct push hidden behind a merged PR is red)', async () => {
    const { status, out } = await run(
      {},
      {
        [`/repos/${REPO}/compare/${BEFORE}...${SHA}`]: {
          status: 'ahead',
          total_commits: 2,
          commits: [commit({ sha: SHA2, message: 'fix: sneak in [EVM-006]' }), commit()],
        },
        [`/repos/${REPO}/commits/${SHA2}/pulls`]: [],
      },
    );
    assert.equal(status, 1);
    assert.match(out, /cccccccccccc/);
  });

  it('EVM-006 AC4: more commits than the API returned is red (fail closed)', async () => {
    const { status } = await run(
      {},
      { [`/repos/${REPO}/compare/${BEFORE}...${SHA}`]: { status: 'ahead', total_commits: 300, commits: [commit()] } },
    );
    assert.equal(status, 1);
  });

  it('EVM-006 AC4: a merge commit (two parents) is red — only squash merges are allowed', async () => {
    const { status, out } = await run(
      {},
      { [`/repos/${REPO}/compare/${BEFORE}...${SHA}`]: { status: 'ahead', total_commits: 1, commits: [commit({ parents: 2 })] } },
    );
    assert.equal(status, 1);
    assert.match(out, /rodzic/);
  });

  it('EVM-006 AC4: an open PR that merely contains the commit does not count (direct push of a PR commit)', async () => {
    const { status, out } = await run(
      {},
      { [`/repos/${REPO}/commits/${SHA}/pulls`]: [pull({ state: 'open', merged_at: null, merge_commit_sha: 'e'.repeat(40) })] },
    );
    assert.equal(status, 1);
    assert.match(out, /scalonego PR/);
  });

  it('EVM-006 AC4: a PR merged into another branch or with another merge commit does not count', async () => {
    assert.equal((await run({}, { [`/repos/${REPO}/commits/${SHA}/pulls`]: [pull({ base: { ref: 'develop' } })] })).status, 1);
    assert.equal((await run({}, { [`/repos/${REPO}/commits/${SHA}/pulls`]: [pull({ merge_commit_sha: 'f'.repeat(40) })] })).status, 1);
  });

  it('EVM-006 AC4: a merge by anyone but the owner (e.g. a bot or GITHUB_TOKEN) is red', async () => {
    const { status, out } = await run({}, { [`/repos/${REPO}/pulls/2`]: pull({ merged_by: { login: 'renovate-bot-synthetic' } }) });
    assert.equal(status, 1);
    assert.match(out, /renovate-bot-synthetic/);
  });

  it('EVM-006 AC4: ci-gate failure, cancelled, in progress or missing on the PR head is red (W6)', async () => {
    const jobs = `/repos/${REPO}/actions/runs/7/jobs?filter=latest&per_page=100`;
    for (const job of [
      { name: 'ci-gate', status: 'completed', conclusion: 'failure' },
      { name: 'ci-gate', status: 'completed', conclusion: 'cancelled' },
      { name: 'ci-gate', status: 'in_progress', conclusion: null },
      { name: 'quality', status: 'completed', conclusion: 'success' },
    ]) {
      const { status, out } = await run({}, { [jobs]: { jobs: [job] } });
      assert.equal(status, 1, JSON.stringify(job));
      assert.match(out, /ci-gate/);
    }
  });

  it('EVM-006 AC4: only runs of ci.yml for the PR head on push count — a status or another workflow is not a green gate', async () => {
    const runs = `/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${HEAD}&event=push&per_page=100`;
    assert.equal((await run({}, { [runs]: { workflow_runs: [] } })).status, 1);
    const forged = { id: 7, path: '.github/workflows/other.yml', head_sha: HEAD, event: 'push', created_at: '2026-10-04T09:00:00Z' };
    assert.equal((await run({}, { [runs]: { workflow_runs: [forged] } })).status, 1);
    const otherHead = { id: 7, path: '.github/workflows/ci.yml', head_sha: SHA2, event: 'push', created_at: '2026-10-04T09:00:00Z' };
    assert.equal((await run({}, { [runs]: { workflow_runs: [otherHead] } })).status, 1);
  });

  it('EVM-006 AC4: an API error is red (fail closed) and the message has no request headers', async () => {
    const { status, out } = await run({}, { [`/repos/${REPO}/commits/${SHA}/pulls`]: 502 });
    assert.equal(status, 1);
    assert.match(out, /GitHub API 502/);
    assert.doesNotMatch(out, /synthetic-token|Bearer/);
  });

  it('EVM-006 AC4: a network error or a malformed answer is red (fail closed)', async () => {
    const compare = `/repos/${REPO}/compare/${BEFORE}...${SHA}`;
    const network = await run({}, { [compare]: 'network-error' });
    assert.equal(network.status, 1);
    assert.match(network.out, /niedostępne/);
    assert.equal((await run({}, { [compare]: 'bad-json' })).status, 1);
    assert.equal((await run({}, { [compare]: null })).status, 1);
    assert.equal((await run({}, { [`/repos/${REPO}/commits/${SHA}/pulls`]: { message: 'not a list' } })).status, 1);
  });

  it('EVM-006 AC4: a PR without merged_by or without a head commit is red', async () => {
    const unknown = await run({}, { [`/repos/${REPO}/pulls/2`]: pull({ merged_by: null }) });
    assert.equal(unknown.status, 1);
    assert.match(unknown.out, /nieznany/);
    assert.equal((await run({}, { [`/repos/${REPO}/pulls/2`]: pull({ head: {} }) })).status, 1);
  });

  it('EVM-006 AC4: untrusted titles are printed on one line (no injected ::workflow commands)', async () => {
    const message = 'feat: x [EVM-006]\u000d::error::injected';
    const { out } = await run(
      {},
      { [`/repos/${REPO}/compare/${BEFORE}...${SHA}`]: { status: 'ahead', total_commits: 1, commits: [commit({ message })] } },
    );
    for (const line of out.split('\n')) assert.doesNotMatch(line, /^::/);
  });

  it('EVM-006 AC4: missing configuration → exit 2', async () => {
    assert.equal((await run({ GITHUB_TOKEN: '' })).status, 2);
    assert.equal((await run({ MAIN_MERGER: '' })).status, 2);
    assert.equal((await run({ AFTER: 'not-a-sha' })).status, 2);
  });

  it('EVM-006 AC4: the CLI reads the environment and exits 2 without configuration', () => {
    const result = spawnSync(process.execPath, [CLI], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } });
    assert.equal(result.status, 2);
    assert.match(result.stdout + result.stderr, /GITHUB_TOKEN/);
  });
});
