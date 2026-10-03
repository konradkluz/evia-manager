// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMIT_TITLE, main, SENSITIVE_PATHS, WINDOW } from '../lib/main.mjs';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const REPO = 'synthetic-owner/evia-manager';
const OWNER = 'owner-synthetic';
const BEFORE = 'b'.repeat(40);
const BASELINE = 'e'.repeat(40);
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

const COMPARE = `/repos/${REPO}/compare/${BEFORE}...${SHA}`;
const HISTORY = `/repos/${REPO}/commits?sha=${SHA}&per_page=${String(WINDOW)}`;
/** @param {string} sha */
const files = (sha) => `/repos/${REPO}/commits/${sha}`;
/** @param {string[]} names */
const changed = (names) => ({ files: names.map((filename) => ({ filename })) });

/**
 * Fake GitHub REST API: path → JSON body (or a number = HTTP error status). Default: main = BASELINE ← BEFORE ← SHA,
 * the push BEFORE..SHA adds SHA (a squash merge of PR #2 by the owner with a green ci-gate on the PR head).
 * @param {Record<string, unknown>} overrides
 */
function api(overrides = {}) {
  /** @type {Record<string, unknown>} */
  const routes = {
    [COMPARE]: { status: 'ahead', total_commits: 1, commits: [commit()] },
    [HISTORY]: [commit(), commit({ sha: BEFORE, message: 'docs: x [EVM-006] (#1)' }), commit({ sha: BASELINE, message: 'legacy' })],
    [files(SHA)]: changed(['docs/ops/github-i-ci.md']),
    [files(BEFORE)]: changed(['README.md']),
    [`/repos/${REPO}/commits/${SHA}/pulls`]: [pull()],
    [`/repos/${REPO}/commits/${BEFORE}/pulls`]: [pull({ number: 1, merge_commit_sha: BEFORE })],
    [`/repos/${REPO}/pulls/2`]: pull(),
    [`/repos/${REPO}/pulls/1`]: pull({ number: 1, merge_commit_sha: BEFORE }),
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
    env: {
      GITHUB_TOKEN: 'synthetic-token',
      GITHUB_REPOSITORY: REPO,
      EVENT: 'push',
      BEFORE,
      AFTER: SHA,
      FORCED: 'false',
      MAIN_MERGER: OWNER,
      BASELINE,
      ...env,
    },
    fetch,
    log: (line) => out.push(line),
  });
  return { status, out: out.join('\n'), calls };
}

/** A history of `count` squash merges below SHA, without the baseline (a long main). */
function longHistory(/** @type {number} */ count) {
  const shas = Array.from({ length: count }, (_, i) => (i === 0 ? SHA : (i + 0x100).toString(16).padStart(40, '1')));
  /** @type {Record<string, unknown>} */
  const routes = { [HISTORY]: shas.map((sha) => commit({ sha })) };
  for (const sha of shas) {
    routes[files(sha)] = changed(['docs/a.md']);
    routes[`/repos/${REPO}/commits/${sha}/pulls`] = [pull({ merge_commit_sha: sha })];
  }
  return { shas, routes };
}

describe('main integrity — K6 (EVM-006 AC4, A1, W5, W6)', () => {
  it('EVM-006 AC4: a squash merge of a PR merged by the owner with a green ci-gate and a Conventional Commit title passes', async () => {
    const { status, out } = await run();
    assert.equal(status, 0, out);
    assert.match(out, /OK — 2 commit/);
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
    const { status, out } = await run({}, { [HISTORY]: [commit({ message }), commit({ sha: BASELINE })] });
    assert.equal(status, 1);
    assert.match(out, /Conventional Commit/);
  });

  it('EVM-006 AC4: a force push to main is red', async () => {
    const { status, out } = await run({ FORCED: 'true' });
    assert.equal(status, 1);
    assert.match(out, /force push/);
  });

  it('EVM-006 AC4: a history that is not a fast-forward of the previous main is red', async () => {
    const { status } = await run({}, { [COMPARE]: { status: 'diverged', total_commits: 1, commits: [commit()] } });
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
        [COMPARE]: { status: 'ahead', total_commits: 2, commits: [commit({ sha: SHA2 }), commit()] },
        [HISTORY]: [commit(), commit({ sha: SHA2, message: 'fix: sneak in [EVM-006]' }), commit({ sha: BASELINE })],
        [files(SHA2)]: changed(['src/x.ts']),
        [`/repos/${REPO}/commits/${SHA2}/pulls`]: [],
      },
    );
    assert.equal(status, 1);
    assert.match(out, /cccccccccccc .*bezpośredni push/);
  });

  it('EVM-006 AC4 (security review): a commit outside the push range — e.g. pushed with GITHUB_TOKEN, which starts no workflow — is red on the next push', async () => {
    const { status, out } = await run(
      {},
      {
        [HISTORY]: [commit(), commit({ sha: BEFORE, message: 'chore: bot [EVM-006]' }), commit({ sha: BASELINE })],
        [`/repos/${REPO}/commits/${BEFORE}/pulls`]: [],
      },
    );
    assert.equal(status, 1);
    assert.match(out, /bbbbbbbbbbbb .*bezpośredni push/);
  });

  it('EVM-006 AC4 (security review): the nightly run checks the window without a push and is red for a direct push', async () => {
    const green = await run({ EVENT: 'schedule', BEFORE: '', FORCED: '' });
    assert.equal(green.status, 0, green.out);
    assert.ok(!green.calls.some((path) => path.includes('/compare/')));
    const red = await run({ EVENT: 'schedule', BEFORE: '', FORCED: '' }, { [`/repos/${REPO}/commits/${BEFORE}/pulls`]: [] });
    assert.equal(red.status, 1);
    assert.match(red.out, /bbbbbbbbbbbb/);
  });

  it('EVM-006 AC4: the window stops at the baseline — the history of main before K6 is not checked', async () => {
    const { status, out, calls } = await run({}, { [HISTORY]: [commit(), commit({ sha: BASELINE }), commit({ sha: SHA2, message: 'x' })] });
    assert.equal(status, 0, out);
    assert.match(out, /OK — 1 commit/);
    assert.ok(!calls.some((path) => path.includes(BASELINE) || path.includes(SHA2)));
  });

  it(`EVM-006 AC4: a long main is checked in a window of the newest ${String(WINDOW)} commits`, async () => {
    const { shas, routes } = longHistory(WINDOW);
    const { status, out, calls } = await run({}, routes);
    assert.equal(status, 0, out);
    assert.match(out, new RegExp(`OK — ${String(WINDOW)} commit`));
    assert.equal(calls.filter((path) => path.endsWith('/pulls')).length, shas.length);
  });

  it('EVM-006 AC4: a short history without the baseline is red (rewritten history or a wrong BASELINE)', async () => {
    const { status, out } = await run({}, { [HISTORY]: [commit(), commit({ sha: BEFORE, message: 'docs: x [EVM-006] (#1)' })] });
    assert.equal(status, 1);
    assert.match(out, /BASELINE/);
  });

  it('EVM-006 AC4: a push with more commits than the window, or more than the API returned, is red (fail closed)', async () => {
    assert.equal((await run({}, { [COMPARE]: { status: 'ahead', total_commits: WINDOW + 1, commits: [commit()] } })).status, 1);
    assert.equal((await run({}, { [COMPARE]: { status: 'ahead', total_commits: 2, commits: [commit()] } })).status, 1);
  });

  it('EVM-006 AC4: a commit list that is not a list or does not start at AFTER is red (fail closed)', async () => {
    assert.equal((await run({}, { [HISTORY]: { message: 'not a list' } })).status, 1);
    const shifted = await run({}, { [HISTORY]: [commit({ sha: BEFORE }), commit({ sha: BASELINE })] });
    assert.equal(shifted.status, 1);
    assert.match(shifted.out, /AFTER/);
  });

  it('EVM-006 AC4 (security review): commits changing .github/, tools/main-integrity/ or tools/scan/ are listed for the Activity check', async () => {
    assert.deepEqual(SENSITIVE_PATHS, ['.github/', 'tools/main-integrity/', 'tools/scan/']);
    const { status, out } = await run(
      {},
      {
        [files(SHA)]: changed(['.github/workflows/ci.yml', 'docs/x.md', 'tools/main-integrity/lib/main.mjs', 'tools/scan/lib/steps.mjs']),
        [files(BEFORE)]: { files: Array.from({ length: 300 }, (_, i) => ({ filename: `docs/f${String(i)}.md` })) },
      },
    );
    assert.equal(status, 0, out);
    assert.match(out, /aaaaaaaaaaaa: \.github\/workflows\/ci\.yml, tools\/main-integrity\/lib\/main\.mjs, tools\/scan\/lib\/steps\.mjs/);
    assert.match(out, /bbbbbbbbbbbb: lista plików obcięta/);
    assert.match(out, /Activity/);
    const quiet = await run();
    assert.doesNotMatch(quiet.out, /Activity/);
  });

  it('EVM-006 AC4: a commit file list that is not a list is red (fail closed)', async () => {
    assert.equal((await run({}, { [files(SHA)]: { message: 'no files' } })).status, 1);
  });

  it('EVM-006 AC4: a merge commit (two parents) is red — only squash merges are allowed', async () => {
    const { status, out } = await run({}, { [HISTORY]: [commit({ parents: 2 }), commit({ sha: BASELINE })] });
    assert.equal(status, 1);
    assert.match(out, /rodzic/);
  });

  it('EVM-006 AC4: an open PR that merely contains the commit does not count (direct push of a PR commit)', async () => {
    const { status, out } = await run(
      {},
      { [`/repos/${REPO}/commits/${SHA}/pulls`]: [pull({ state: 'open', merged_at: null, merge_commit_sha: 'f'.repeat(40) })] },
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
    const network = await run({}, { [COMPARE]: 'network-error' });
    assert.equal(network.status, 1);
    assert.match(network.out, /niedostępne/);
    assert.equal((await run({}, { [COMPARE]: 'bad-json' })).status, 1);
    assert.equal((await run({}, { [COMPARE]: null })).status, 1);
    assert.equal((await run({}, { [`/repos/${REPO}/commits/${SHA}/pulls`]: { message: 'not a list' } })).status, 1);
  });

  it('EVM-006 AC4: a PR without merged_by or without a head commit is red', async () => {
    const unknown = await run({}, { [`/repos/${REPO}/pulls/2`]: pull({ merged_by: null }) });
    assert.equal(unknown.status, 1);
    assert.match(unknown.out, /nieznany/);
    assert.equal((await run({}, { [`/repos/${REPO}/pulls/2`]: pull({ head: {} }) })).status, 1);
  });

  it('EVM-006 AC4: untrusted titles and file names are printed on one line (no injected ::workflow commands)', async () => {
    const message = 'feat: x [EVM-006]\u000d::error::injected';
    const { out } = await run(
      {},
      {
        [HISTORY]: [commit({ message }), commit({ sha: BASELINE })],
        [files(SHA)]: changed(['.github/x\n::error::injected']),
      },
    );
    for (const line of out.split('\n')) assert.doesNotMatch(line, /^::/);
  });

  it('EVM-006 AC4: missing configuration → exit 2', async () => {
    assert.equal((await run({ GITHUB_TOKEN: '' })).status, 2);
    assert.equal((await run({ MAIN_MERGER: '' })).status, 2);
    assert.equal((await run({ AFTER: 'not-a-sha' })).status, 2);
    assert.equal((await run({ BASELINE: '' })).status, 2);
    assert.equal((await run({ BEFORE: '' })).status, 2);
    assert.equal((await run({ EVENT: '' })).status, 2);
  });

  it('EVM-006 AC4: the CLI reads the environment and exits 2 without configuration', () => {
    const result = spawnSync(process.execPath, [CLI], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } });
    assert.equal(result.status, 2);
    assert.match(result.stdout + result.stderr, /GITHUB_TOKEN/);
  });
});
