// @ts-check
/* eslint-disable @typescript-eslint/require-await -- stand-ins of async interfaces (fetch) */
/**
 * EVM-153 AC4b: the nightly alarm of a red publication on main, on synthetic answers of the GitHub API (no network).
 * Red on a failed publish / publish-infra of the latest executed run; green on success and on skipped; fail-closed on errors.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_RUNS, evaluate, jobConclusions, listRuns, run } from '../lib/watch.mjs';

const REPOSITORY = 'evia-test/manager';
const API = 'https://api.example.test';
const NOW = new Date('2026-11-26T02:30:00Z');
const sha = (/** @type {number} */ n) => String(n).padStart(40, '0');

/** @param {number} id @param {string} created */
const runItem = (id, created) => ({
  id,
  head_sha: sha(id),
  created_at: created,
  head_commit: { author: { name: 'Jan Kowalski', email: 'jan@example.test' }, message: 'secret message' },
});
/** @param {string} name @param {string} conclusion */
const job = (name, conclusion) => ({ name, conclusion, status: 'completed' });

/**
 * @param {{ runs?: unknown[], jobs?: Record<number, unknown[]>, status?: number, badJson?: boolean, throws?: boolean, runsPages?: unknown[][] }} spec
 * @returns {import('../lib/watch.mjs').Fetch & { calls: string[] }}
 */
function fakeFetch(spec) {
  /** @type {string[]} */
  const calls = [];
  const fn = async (/** @type {string} */ url) => {
    calls.push(url);
    if (spec.throws) throw new Error('network down');
    if (spec.status !== undefined && spec.status !== 200)
      return { ok: false, status: spec.status, json: async () => ({ message: 'secret body' }) };
    if (spec.badJson) {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('bad json');
        },
      };
    }
    const parsed = new URL(url);
    if (/\/actions\/workflows\/ci\.yml\/runs$/.test(parsed.pathname)) {
      const page = Number(parsed.searchParams.get('page'));
      const batch = spec.runsPages ? (spec.runsPages[page - 1] ?? []) : page === 1 ? (spec.runs ?? []) : [];
      return { ok: true, status: 200, json: async () => ({ workflow_runs: batch }) };
    }
    const jobsMatch = /\/actions\/runs\/(\d+)\/jobs$/.exec(parsed.pathname);
    if (jobsMatch) {
      const all = spec.jobs?.[Number(jobsMatch[1])] ?? [];
      const page = Number(parsed.searchParams.get('page'));
      const per = Number(parsed.searchParams.get('per_page'));
      return { ok: true, status: 200, json: async () => ({ jobs: all.slice((page - 1) * per, page * per) }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return Object.assign(fn, { calls });
}

/** @param {import('../lib/watch.mjs').Fetch} fetch @param {Record<string, string | undefined>} [extra] */
async function exec(fetch, extra = {}) {
  /** @type {string[]} */
  const lines = [];
  const code = await run({
    env: {
      GITHUB_TOKEN: 'token',
      GITHUB_API_URL: API,
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_SERVER_URL: 'https://github.example.test',
      ...extra,
    },
    fetch,
    now: NOW,
    log: (line) => lines.push(line),
  });
  return { code, text: lines.join('\n') };
}

const green = [job('publish', 'success'), job('publish-infra', 'success')];
const skipped = [job('publish', 'skipped'), job('publish-infra', 'skipped')];

describe('EVM-153 AC4b publish-watch', () => {
  it('EVM-153 AC4b: the latest executed run of each job green (a skipped job is judged by an older run) is green', async () => {
    const fetch = fakeFetch({
      runs: [runItem(3, '2026-11-25T10:00:00Z'), runItem(2, '2026-11-24T10:00:00Z')],
      jobs: { 3: [job('publish', 'skipped'), job('publish-infra', 'success')], 2: green },
    });
    const { code, text } = await exec(fetch);
    assert.equal(code, 0);
    assert.match(text, /green/);
  });

  it('EVM-153 AC4b: a red publish is not hidden by a later docs-only run (publish skipped, publish-infra success)', async () => {
    const fetch = fakeFetch({
      runs: [runItem(2, '2026-11-26T01:00:00Z'), runItem(1, '2026-11-23T01:00:00Z')],
      jobs: {
        2: [job('publish', 'skipped'), job('publish-infra', 'success')],
        1: [job('publish', 'failure'), job('publish-infra', 'success')],
      },
    });
    const { code, text } = await exec(fetch);
    assert.equal(code, 1);
    assert.match(text, /publish failure in run 1 /);
    assert.match(text, /failing for 3 day\(s\)/);
    assert.doesNotMatch(text, /publish-infra failure/);
  });

  it('EVM-153 AC4b: a job that executed in none of the runs is red (fail-closed)', async () => {
    const fetch = fakeFetch({
      runs: [runItem(1, '2026-11-25T10:00:00Z')],
      jobs: { 1: [job('publish', 'success'), job('publish-infra', 'skipped')] },
    });
    const { code, text } = await exec(fetch);
    assert.equal(code, 1);
    assert.match(text, /in which publish-infra executed/);
  });

  it('EVM-153 AC4b: a red publish is red with the job, run, URL, commit and age in days', async () => {
    const fetch = fakeFetch({
      runs: [runItem(3, '2026-11-25T10:00:00Z'), runItem(2, '2026-11-22T10:00:00Z'), runItem(1, '2026-11-19T10:00:00Z')],
      jobs: {
        3: [job('publish', 'failure'), job('publish-infra', 'success')],
        2: [job('publish', 'failure'), job('publish-infra', 'success')],
        1: green,
      },
    });
    const { code, text } = await exec(fetch);
    assert.equal(code, 1);
    assert.match(text, /publish failure in run 3 \(https:\/\/github\.example\.test\/evia-test\/manager\/actions\/runs\/3\)/);
    assert.ok(text.includes(`commit ${sha(3)}`));
    assert.match(text, /failing for 3 day\(s\)/);
    assert.doesNotMatch(text, /publish-infra failure/);
  });

  it('EVM-153 AC4b: a red publish-infra is red', async () => {
    const fetch = fakeFetch({
      runs: [runItem(5, '2026-11-26T01:00:00Z'), runItem(4, '2026-11-25T01:00:00Z')],
      jobs: { 5: [job('publish', 'skipped'), job('publish-infra', 'failure')], 4: green },
    });
    const { code, text } = await exec(fetch);
    assert.equal(code, 1);
    assert.match(text, /publish-infra failure in run 5/);
    assert.match(text, /0 day\(s\)/);
  });

  it('EVM-153 AC4b: cancelled and timed_out count as red; both red give two findings', async () => {
    const fetch = fakeFetch({
      runs: [runItem(5, '2026-11-26T01:00:00Z')],
      jobs: { 5: [job('publish', 'cancelled'), job('publish-infra', 'timed_out')] },
    });
    const { code, text } = await exec(fetch);
    assert.equal(code, 1);
    assert.equal(text.split('\n').filter((line) => line.startsWith('::error')).length, 2);
  });

  it('EVM-153 AC4b: runs with both jobs skipped are passed over; the older executed run decides', async () => {
    const runs = [runItem(9, '2026-11-26T01:00:00Z'), runItem(8, '2026-11-25T01:00:00Z')];
    assert.equal((await exec(fakeFetch({ runs, jobs: { 9: skipped, 8: green } }))).code, 0);
    assert.equal(
      (await exec(fakeFetch({ runs, jobs: { 9: skipped, 8: [job('publish', 'failure'), job('publish-infra', 'success')] } }))).code,
      1,
    );
  });

  it('EVM-153 AC4b: a skipped run inside the failing streak does not end it; the age counts from the oldest failure', async () => {
    const fetch = fakeFetch({
      runs: [
        runItem(4, '2026-11-26T01:00:00Z'),
        runItem(3, '2026-11-24T01:00:00Z'),
        runItem(2, '2026-11-20T01:00:00Z'),
        runItem(1, '2026-11-10T01:00:00Z'),
      ],
      jobs: {
        4: [job('publish', 'failure'), job('publish-infra', 'success')],
        3: [job('publish', 'skipped'), job('publish-infra', 'success')],
        2: [job('publish', 'failure'), job('publish-infra', 'success')],
        1: green,
      },
    });
    const { text } = await exec(fetch);
    assert.match(text, /failing for 6 day\(s\)/);
  });

  it('EVM-153 AC4b: fail-closed — no run, no executed run, a missing (renamed) job and a job without a conclusion are red', async () => {
    assert.equal((await exec(fakeFetch({ runs: [] }))).code, 1);
    const none = await exec(fakeFetch({ runs: [runItem(1, '2026-11-25T01:00:00Z')], jobs: { 1: skipped } }));
    assert.equal(none.code, 1);
    assert.match(none.text, /no completed run/);
    const renamed = await exec(
      fakeFetch({
        runs: [runItem(1, '2026-11-25T01:00:00Z')],
        jobs: { 1: [job('publish', 'success'), job('publish-infra-arm', 'success')] },
      }),
    );
    assert.equal(renamed.code, 1);
    assert.match(renamed.text, /no job publish-infra/);
    const prefix = await exec(
      fakeFetch({
        runs: [runItem(1, '2026-11-25T01:00:00Z')],
        jobs: { 1: [job('publish-extra', 'success'), job('publish-infra-x', 'success')] },
      }),
    );
    assert.equal(prefix.code, 1);
    const open = await exec(
      fakeFetch({
        runs: [runItem(1, '2026-11-25T01:00:00Z')],
        jobs: { 1: [{ name: 'publish', conclusion: null }, job('publish-infra', 'success')] },
      }),
    );
    assert.equal(open.code, 1);
  });

  it('EVM-153 AC4b: fail-closed — 403, 429, 500, an unreadable body and a network error are red, without echoing the body', async () => {
    for (const status of [403, 429, 500]) {
      const { code, text } = await exec(fakeFetch({ status }));
      assert.equal(code, 1);
      assert.match(text, new RegExp(`answered ${String(status)}`));
      assert.doesNotMatch(text, /secret body/);
    }
    assert.equal((await exec(fakeFetch({ badJson: true }))).code, 1);
    assert.equal((await exec(fakeFetch({ throws: true }))).code, 1);
  });

  it('EVM-153 AC4b: fail-closed — unreadable run entries and answers are red', async () => {
    assert.equal((await exec(fakeFetch({ runs: [{ id: 'x', head_sha: sha(1), created_at: '2026-11-25T01:00:00Z' }] }))).code, 1);
    assert.equal((await exec(fakeFetch({ runs: [{ id: 1, head_sha: 'abc', created_at: '2026-11-25T01:00:00Z' }] }))).code, 1);
    assert.equal((await exec(fakeFetch({ runs: [{ id: 1, head_sha: sha(1), created_at: 'yesterday' }] }))).code, 1);
    assert.equal((await exec(fakeFetch({ runs: ['text'] }))).code, 1);
    /** @type {import('../lib/watch.mjs').Fetch} */
    const noList = async () => ({ ok: true, status: 200, json: async () => ({ workflow_runs: 'x' }) });
    assert.equal((await exec(noList)).code, 1);
    /** @type {import('../lib/watch.mjs').Fetch} */
    const noJobs = async (url) => ({
      ok: true,
      status: 200,
      json: async () => (url.includes('/jobs') ? { jobs: 'x' } : { workflow_runs: [runItem(1, '2026-11-25T01:00:00Z')] }),
    });
    assert.equal((await exec(noJobs)).code, 1);
    /** @type {import('../lib/watch.mjs').Fetch} */
    const arrayBody = async () => ({ ok: true, status: 200, json: async () => [] });
    assert.equal((await exec(arrayBody)).code, 1);
  });

  it('EVM-153 AC4b: the configuration is validated (repository, API host, token, server) and nothing is called otherwise', async () => {
    const bad = [
      { GITHUB_REPOSITORY: 'no-slash' },
      { GITHUB_REPOSITORY: 'a/b/c' },
      { GITHUB_API_URL: 'http://api.example.test' },
      { GITHUB_API_URL: '' },
      { GITHUB_TOKEN: '' },
      { GITHUB_SERVER_URL: 'ftp://x' },
    ];
    for (const extra of bad) {
      const fetch = fakeFetch({ runs: [] });
      assert.equal((await exec(fetch, extra)).code, 1);
      assert.equal(fetch.calls.length, 0);
    }
    const fetch = fakeFetch({ runs: [runItem(3, '2026-11-25T10:00:00Z')], jobs: { 3: green } });
    assert.equal((await exec(fetch, { GITHUB_API_URL: `${API}/`, GITHUB_SERVER_URL: undefined })).code, 0);
    assert.ok(fetch.calls.every((url) => url.startsWith(`${API}/repos/${REPOSITORY}/`)));
  });

  it('EVM-153 AC4b: runs and jobs are read through filter=latest, push/main/completed and with full pagination', async () => {
    const many = Array.from({ length: 150 }, (_, index) => runItem(1000 - index, '2026-11-25T01:00:00Z'));
    const jobs = Object.fromEntries(many.map((item) => [item.id, skipped]));
    const fetch = fakeFetch({ runsPages: [many.slice(0, 100), many.slice(100)], jobs });
    const runs = await listRuns({ fetch, api: API, repository: REPOSITORY, token: 't' });
    assert.equal(runs.length, MAX_RUNS);
    assert.ok(fetch.calls[0]?.includes('branch=main&event=push&status=completed'));
    const filler = Array.from({ length: 130 }, (_, index) => job(`other-${String(index)}`, 'success'));
    const paged = fakeFetch({ jobs: { 7: [...filler, job('publish', 'success'), job('publish-infra', 'skipped')] } });
    assert.deepEqual(await jobConclusions({ fetch: paged, api: API, repository: REPOSITORY, token: 't' }, 7), {
      publish: 'success',
      'publish-infra': 'skipped',
    });
    assert.ok(paged.calls.every((url) => url.includes('filter=latest')));
    assert.equal(paged.calls.length, 2);
    const context = { fetch: fakeFetch({ runs: many.slice(0, 2), jobs }), api: API, repository: REPOSITORY, token: 't', now: NOW };
    await assert.rejects(() => evaluate(context), /no completed run/);
  });

  it('EVM-153 AC4b: the message never carries the author, the e-mail, the commit message or the token', async () => {
    const fetch = fakeFetch({
      runs: [runItem(3, '2026-11-25T10:00:00Z')],
      jobs: { 3: [job('publish', 'failure'), job('publish-infra', 'success')] },
    });
    const { text } = await exec(fetch);
    assert.doesNotMatch(text, /Kowalski|jan@example|secret message|token/);
  });

  it('EVM-153 AC4b: an unexpected error is red', async () => {
    /** @type {import('../lib/watch.mjs').Fetch} */
    const broken = () => {
      throw new TypeError('boom');
    };
    const { code, text } = await exec(broken);
    assert.equal(code, 1);
    assert.match(text, /fail-closed/);
    /** @type {import('../lib/watch.mjs').Fetch} */
    const failing = async () => ({ ok: true, status: 200, json: async () => ({ workflow_runs: [null] }) });
    assert.equal((await exec(failing)).code, 1);
  });

  it('EVM-153 AC4b: the CLI is red without configuration (no network)', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../cli.mjs', import.meta.url))], {
      env: { PATH: process.env['PATH'] ?? '' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /fail-closed/);
  });
});
