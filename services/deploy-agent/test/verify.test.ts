/**
 * The verification cycle on the stub of the GitHub API (EVM-007 AC3, AC4; ADR-0018 V0–V4, rollback, n5): the healthy
 * path and every rejection of AC3 — each ends with `reject` (or a rollback for an event in the deployed period), a
 * reason and no change. Synthetic data only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Deployment } from '../src/verify.ts';
import {
  OTHER_ID,
  OWNER_ID,
  WORKFLOW_ID,
  buildScenario,
  fakeSha,
  manifestText,
  startStub,
  wireArtifacts,
  type Built,
  type Stub,
} from './support/github-stub.ts';
import { COMPOSE, entry, reasons, run } from './support/fixtures.ts';
import { makeZip } from './support/zip.ts';

let stub: Stub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

async function start(built: Built): Promise<Stub> {
  stub = await startStub(built.scenario);
  wireArtifacts(stub);
  return stub;
}

const event = (built: Built, index: number): Record<string, unknown> => {
  const found = built.scenario.events.find((item) => item['id'] === 100 + index);
  if (found === undefined) throw new Error('no such event');
  return found;
};

describe('EVM-007 AC3: deployment after V0–V4', () => {
  it('EVM-007 AC3: three merges by Konrad, each with a green PR run and publish — HEAD is deployed with the digests of its manifest', async () => {
    const built = buildScenario(3, COMPOSE);
    const api = await start(built);
    const decision = (await run(api, built.baseline)) as Deployment;
    expect(decision.decision, reasons(decision)).toBe('deploy');
    expect(decision.commit).toBe(built.commits[2]);
    expect(decision.head).toBe(built.commits[2]);
    expect(decision.activityEventId).toBe(103);
    expect(decision.manifest).toBe(built.manifests.get(built.commits[2] ?? ''));
    const compose = JSON.parse(decision.compose) as {
      services: Record<string, { image: string; networks: string[]; pull_policy: string }>;
    };
    expect(compose.services['api']?.image).toBe(decision.images.api);
    expect(compose.services['web']?.image).toBe(decision.images.web);
    expect(compose.services['migrate']?.networks).toEqual(['evia-runtime']);
    expect(compose.services['api']?.pull_policy).toBe('never');
    // A3: the blob storage never receives the token
    expect(api.blobHeaders.length).toBe(1);
    expect(api.blobHeaders[0]?.authorization).toBeUndefined();
  });

  it('EVM-007 AC3 (P7): the newest commit without a release (documentation only) — the newest published commit is deployed, V2 still checks the whole range', async () => {
    const built = buildScenario(3, COMPOSE, { unpublished: [3] });
    const api = await start(built);
    const decision = (await run(api, built.baseline)) as Deployment;
    expect(decision.decision, reasons(decision)).toBe('deploy');
    expect(decision.commit).toBe(built.commits[1]);
    expect(decision.head).toBe(built.commits[2]);
    expect(api.requests.some((path) => path.endsWith('/pulls/3'))).toBe(true);
  });

  it('EVM-007 AC3: nothing to do when HEAD is deployed, and no release yet when no commit of the range is published', async () => {
    const built = buildScenario(2, COMPOSE, { unpublished: [1, 2] });
    const api = await start(built);
    expect((await run(api, built.baseline)).reasons).toEqual(['no published release in the range yet']);
    const deployed = [entry(built.commits[1] ?? '', 102, built.baseline, manifestText(built.commits[1] ?? ''))];
    const decision = await run(api, built.baseline, deployed);
    expect(decision.decision, reasons(decision)).toBe('none');
    expect(decision.reasons).toEqual(['up to date']);
  });

  it('EVM-007 AC3: a second deployment checks only the commits after the deployed one and anchors V0 on the previous deployment', async () => {
    const built = buildScenario(4, COMPOSE);
    const api = await start(built);
    const registry = [
      entry(built.commits[0] ?? '', 101, built.baseline, manifestText(built.commits[0] ?? '')),
      entry(built.commits[1] ?? '', 102, built.baseline, manifestText(built.commits[1] ?? '')),
    ];
    const decision = (await run(api, built.baseline, registry)) as Deployment;
    expect(decision.decision, reasons(decision)).toBe('deploy');
    expect(decision.commit).toBe(built.commits[3]);
    expect(api.requests.some((path) => path.endsWith('/pulls/2'))).toBe(false);
    expect(api.requests.some((path) => path.includes(`/compare/${built.commits[1] ?? ''}...`))).toBe(true);
  });

  it('EVM-007 AC3: Activity and compare are read across pages', async () => {
    const built = buildScenario(5, COMPOSE);
    built.scenario.activityPageSize = 2;
    built.scenario.comparePageSize = 2;
    const api = await start(built);
    const decision = await run(api, built.baseline);
    expect(decision.decision, reasons(decision)).toBe('deploy');
    expect(api.requests.filter((path) => path.includes('/activity')).length).toBe(3);
    expect(api.requests.filter((path) => path.includes('/compare/')).length).toBe(3);
  });
});

describe('EVM-007 AC3: V0 — Activity of main', () => {
  for (const type of ['push', 'force_push', 'branch_deletion', 'branch_creation', 'merge_queue_merge', 'unknown_future_type']) {
    it(`EVM-007 AC3: an event ${type} on main after the last deployment blocks the deployment`, async () => {
      const built = buildScenario(2, COMPOSE);
      event(built, 2)['activity_type'] = type;
      const decision = await run(await start(built), built.baseline);
      expect(decision.decision).toBe('reject');
      expect(reasons(decision)).toContain('v0-blocked');
      expect(reasons(decision)).toContain(type);
    });
  }

  it('EVM-007 AC3: a merge by another account (another numeric ID, the same login) blocks the deployment', async () => {
    const built = buildScenario(2, COMPOSE);
    event(built, 1)['actor'] = { id: OTHER_ID, login: 'konrad-test' };
    const decision = await run(await start(built), built.baseline);
    expect(reasons(decision)).toContain('v0-actor');
  });

  it('EVM-007 AC3: an event without an actor, of another ref or breaking the chain blocks the deployment', async () => {
    for (const change of [
      (built: Built) => delete event(built, 1)['actor'],
      (built: Built) => (event(built, 1)['ref'] = 'refs/heads/other'),
      (built: Built) => (event(built, 2)['before'] = fakeSha('elsewhere')),
    ]) {
      const built = buildScenario(2, COMPOSE);
      change(built);
      const decision = await run(await start(built), built.baseline);
      expect(decision.decision).toBe('reject');
      expect(reasons(decision)).toMatch(/v0-(actor|ref|chain)/);
      await stub?.close();
      stub = undefined;
    }
  });

  it('EVM-007 AC3: the anchor event missing from Activity (retention, window of the API) rejects the cycle', async () => {
    const built = buildScenario(2, COMPOSE);
    built.scenario.events = built.scenario.events.filter((item) => item['id'] !== 100);
    const decision = await run(await start(built), built.baseline);
    expect(reasons(decision)).toContain('v0-anchor-not-found');
  });

  it('EVM-007 AC3: an anchor event that leads to another commit rejects the cycle', async () => {
    const built = buildScenario(1, COMPOSE);
    event(built, 0)['after'] = fakeSha('not-the-baseline');
    expect(reasons(await run(await start(built), built.baseline))).toContain('v0-anchor');
  });

  it('EVM-007 AC3: Activity that has not reached HEAD yet (lag) rejects the cycle', async () => {
    const built = buildScenario(2, COMPOSE);
    built.scenario.events.shift();
    expect(reasons(await run(await start(built), built.baseline))).toContain('v0-activity-lag');
  });

  it('EVM-007 AC3 (n5): an event inside the period already deployed rolls back to the previous deployment from the registry', async () => {
    const built = buildScenario(2, COMPOSE);
    event(built, 2)['activity_type'] = 'force_push';
    const registry = [
      entry(built.commits[0] ?? '', 101, built.baseline, manifestText(built.commits[0] ?? '')),
      entry(built.commits[1] ?? '', 102, built.baseline, manifestText(built.commits[1] ?? '')),
    ];
    const decision = (await run(await start(built), built.baseline, registry)) as Deployment;
    expect(decision.decision, reasons(decision)).toBe('rollback');
    expect(decision.commit).toBe(built.commits[0]);
    expect(reasons(decision)).toContain('force_push');
  });

  it('EVM-007 AC3 (n5): an event inside the deployed period with no earlier deployment blocks without a rollback', async () => {
    const built = buildScenario(1, COMPOSE);
    event(built, 1)['activity_type'] = 'push';
    const registry = [entry(built.commits[0] ?? '', 101, built.baseline, manifestText(built.commits[0] ?? ''))];
    const decision = await run(await start(built), built.baseline, registry);
    expect(decision.decision).toBe('reject');
    expect(reasons(decision)).toContain('no earlier deployment');
  });

  it('EVM-007 AC3: a registry entry that is not in the Activity chain rejects the cycle', async () => {
    const built = buildScenario(2, COMPOSE);
    const registry = [entry(built.commits[1] ?? '', 555, built.baseline, manifestText(built.commits[1] ?? ''))];
    expect(reasons(await run(await start(built), built.baseline, registry))).toContain('v0-registry');
  });

  it('EVM-007 AC3: entries of an older baseline are ignored (a new chain after an incident)', async () => {
    const built = buildScenario(1, COMPOSE);
    const old = [entry(built.commits[0] ?? '', 999, fakeSha('old-baseline'), manifestText(built.commits[0] ?? ''))];
    expect((await run(await start(built), built.baseline, old)).decision).toBe('deploy');
  });
});

describe('EVM-007 AC3: V1 — history of main', () => {
  it('EVM-007 AC3: a history that is not a fast-forward from the deployed commit rejects the cycle', async () => {
    const built = buildScenario(2, COMPOSE);
    built.scenario.overrides.push({
      prefix: '/repos/evia-test/manager/compare/',
      status: 200,
      body: JSON.stringify({ status: 'diverged', ahead_by: 2, behind_by: 1, total_commits: 2, commits: [] }),
    });
    expect(reasons(await run(await start(built), built.baseline))).toContain('v1-not-fast-forward');
  });

  it('EVM-007 AC3: an incomplete compare (fewer commits than total_commits) rejects the cycle', async () => {
    const built = buildScenario(2, COMPOSE);
    built.scenario.overrides.push({
      prefix: '/repos/evia-test/manager/compare/',
      status: 200,
      body: JSON.stringify({ status: 'ahead', ahead_by: 3, behind_by: 0, total_commits: 3, commits: [] }),
    });
    expect(reasons(await run(await start(built), built.baseline))).toContain('v1-incomplete');
  });

  it('EVM-007 AC3: a range over the limit, or a chain of commits that does not end at HEAD, rejects the cycle', async () => {
    const built = buildScenario(3, COMPOSE);
    expect(reasons(await run(await start(built), built.baseline, [], null, { maxRangeCommits: 2 }))).toContain('v1-range');
    await stub?.close();
    const broken = buildScenario(2, COMPOSE);
    const last = broken.scenario.history[2];
    if (last !== undefined) last.parents = [fakeSha('elsewhere')];
    expect(reasons(await run(await start(broken), broken.baseline))).toContain('v1-chain');
  });

  it('EVM-007 AC3: HEAD must be refs/heads/main pointing to a commit', async () => {
    const built = buildScenario(1, COMPOSE);
    built.scenario.overrides.push({
      prefix: '/repos/evia-test/manager/git/ref/heads/main',
      status: 200,
      body: JSON.stringify({ ref: 'refs/tags/main', object: { type: 'commit', sha: built.scenario.head } }),
    });
    expect(reasons(await run(await start(built), built.baseline))).toContain('v1-ref');
  });
});

describe('EVM-007 AC3: V2 — squash merges of Konrad with a green full run', () => {
  const cases: Array<[string, (built: Built) => void, string]> = [
    ['a commit without a pull request', (built) => built.scenario.pulls.delete(built.commits[0] ?? ''), 'v2-no-pull-request'],
    ['a pull request that is not merged', (built) => (pull(built, 1)['merged'] = false), 'v2-not-merged'],
    [
      'a pull request merged by another numeric ID',
      (built) => (pull(built, 1)['merged_by'] = { id: OTHER_ID, login: 'konrad-test' }),
      'v2-merged-by',
    ],
    ['a pull request to another base branch', (built) => (pull(built, 1)['base'] = { ref: 'develop' }), 'v2-base'],
    ['a pull request whose merge commit differs', (built) => (pull(built, 1)['merge_commit_sha'] = fakeSha('other')), 'v2-no-pull-request'],
    [
      'a merge commit with two parents',
      (built) => {
        (built.scenario.history[1]?.parents ?? []).push(fakeSha('second-parent'));
      },
      'v2-not-squash',
    ],
    [
      'only a check named ci-gate from a branch workflow (no run of ci.yml)',
      (built) => {
        const original = prRun(built, 1);
        built.scenario.runs = built.scenario.runs.filter((item) => item.id !== 1001);
        built.scenario.runs.push({ ...original, id: 4001, workflow_id: WORKFLOW_ID + 1 });
        built.scenario.jobs.set('4001/1', [{ name: 'ci-gate', status: 'completed', conclusion: 'success' }]);
      },
      'v2-ci-gate',
    ],
    [
      'only a fast push run of the branch (EVM-083), no pull_request run',
      (built) => {
        const run = prRun(built, 1);
        run.event = 'push';
      },
      'v2-ci-gate',
    ],
    [
      'a pull_request run with a red ci-gate job',
      (built) => built.scenario.jobs.set('1001/1', [{ name: 'ci-gate', status: 'completed', conclusion: 'failure' }]),
      'v2-ci-gate',
    ],
    [
      'a pull_request run of an older head of the pull request',
      (built) => (pull(built, 1)['head'] = { sha: fakeSha('newer-head') }),
      'v2-ci-gate',
    ],
    ['a failed pull_request run', (built) => (prRun(built, 1).conclusion = 'failure'), 'v2-ci-gate'],
  ];
  function pull(built: Built, index: number): Record<string, unknown> {
    const found = built.scenario.pulls.get(built.commits[index - 1] ?? '');
    if (found === undefined) throw new Error('no pull');
    return found;
  }
  function prRun(built: Built, index: number): Built['scenario']['runs'][number] {
    const found = built.scenario.runs.find((item) => item.id === 1000 + index);
    if (found === undefined) throw new Error('no run');
    return found;
  }
  for (const [name, change, code] of cases) {
    it(`EVM-007 AC3: ${name} rejects the deployment`, async () => {
      const built = buildScenario(2, COMPOSE);
      change(built);
      const decision = await run(await start(built), built.baseline);
      expect(decision.decision).toBe('reject');
      expect(reasons(decision)).toContain(code);
    });
  }

  it(`EVM-007 AC3: Konrad's numeric ID decides, not the login`, async () => {
    const built = buildScenario(1, COMPOSE);
    const pullRequest = built.scenario.pulls.get(built.commits[0] ?? '');
    if (pullRequest !== undefined) pullRequest['merged_by'] = { id: OWNER_ID, login: 'renamed-login' };
    expect((await run(await start(built), built.baseline)).decision).toBe('deploy');
  });
});

describe('EVM-007 AC3: V3 — the release run and its manifest', () => {
  const pushRun = (built: Built, index: number): Built['scenario']['runs'][number] => {
    const found = built.scenario.runs.find((item) => item.id === 2000 + index);
    if (found === undefined) throw new Error('no run');
    return found;
  };

  it('EVM-007 AC3: a push run of a tag named main (publish skipped) is not a release', async () => {
    const built = buildScenario(1, COMPOSE);
    built.scenario.jobs.set('2001/1', [
      { name: 'ci-gate', status: 'completed', conclusion: 'success' },
      { name: 'publish', status: 'completed', conclusion: 'skipped' },
    ]);
    const decision = await run(await start(built), built.baseline);
    expect(decision.decision).toBe('none');
  });

  it('EVM-007 AC3: the oldest push run is chosen and its newest successful attempt', async () => {
    const built = buildScenario(1, COMPOSE);
    const run1 = pushRun(built, 1);
    run1.run_attempt = 2;
    built.scenario.attempts.set('2001/2', { status: 'completed', conclusion: 'failure' });
    built.scenario.attempts.set('2001/1', { status: 'completed', conclusion: 'success' });
    built.scenario.runs.push({ ...run1, id: 2500, run_attempt: 1, conclusion: 'failure' });
    const api = await start(built);
    const decision = await run(api, built.baseline);
    expect(decision.decision, reasons(decision)).toBe('deploy');
    expect(api.requests.some((path) => path.includes('/actions/runs/2001/attempts/1/jobs'))).toBe(true);
    expect(api.requests.some((path) => path.includes('/actions/runs/2500/'))).toBe(false);
  });

  it('EVM-007 AC3: a run still in progress or without a successful attempt is not a release yet', async () => {
    const built = buildScenario(1, COMPOSE);
    pushRun(built, 1).status = 'in_progress';
    expect((await run(await start(built), built.baseline)).decision).toBe('none');
    await stub?.close();
    const failed = buildScenario(1, COMPOSE);
    pushRun(failed, 1).conclusion = 'failure';
    expect((await run(await start(failed), failed.baseline)).decision).toBe('none');
  });

  it('EVM-007 AC3: a successful publish without its release-manifest (missing, expired, of another run or another commit, another name) is rejected', async () => {
    const mutations: Array<(artifact: Record<string, unknown>) => void> = [
      (artifact) => (artifact['expired'] = true),
      (artifact) =>
        (artifact['workflow_run'] = {
          id: 9,
          head_sha: artifact['workflow_run'] && (artifact['workflow_run'] as Record<string, unknown>)['head_sha'],
        }),
      (artifact) => (artifact['workflow_run'] = { id: 2001, head_sha: fakeSha('other') }),
      (artifact) => (artifact['name'] = 'release-manifest-x'),
    ];
    for (const mutate of mutations) {
      const built = buildScenario(1, COMPOSE);
      for (const artifact of built.scenario.artifacts.get(2001) ?? []) mutate(artifact);
      expect(reasons(await run(await start(built), built.baseline))).toContain('v3-artifact-missing');
      await stub?.close();
      stub = undefined;
    }
  });

  const forged: Array<[string, (commit: string) => string, string]> = [
    ['of another commit', () => manifestText(fakeSha('other')), 'v3-manifest-commit'],
    [
      'with an image of another repository',
      (commit) =>
        manifestText(commit, {
          images: { api: `ghcr.io/attacker/evia-api@sha256:${'a'.repeat(64)}`, web: `ghcr.io/evia-test/evia-web@sha256:${'b'.repeat(64)}` },
        }),
      'v3-manifest-image',
    ],
    [
      'with an image by tag',
      (commit) =>
        manifestText(commit, {
          images: { api: 'ghcr.io/evia-test/evia-api:latest', web: `ghcr.io/evia-test/evia-web@sha256:${'b'.repeat(64)}` },
        }),
      'v3-manifest-image',
    ],
    [
      'with a digest of 63 characters',
      (commit) =>
        manifestText(commit, {
          images: {
            api: `ghcr.io/evia-test/evia-api@sha256:${'a'.repeat(63)}`,
            web: `ghcr.io/evia-test/evia-web@sha256:${'b'.repeat(64)}`,
          },
        }),
      'v3-manifest-image',
    ],
    ['choosing its own compose path', (commit) => manifestText(commit, { compose: 'infra/runtime/evil.yaml' }), 'v3-manifest-compose'],
    ['with an extra key', (commit) => manifestText(commit, { command: 'x' }), 'v3-manifest-schema'],
    ['of another schema version', (commit) => manifestText(commit, { schemaVersion: 2 }), 'v3-manifest-schema'],
    ['that is not JSON', () => 'not json', 'v3-manifest-schema'],
    ['with a byte-order mark', (commit) => `\uFEFF${manifestText(commit)}`, 'v3-manifest-schema'],
  ];
  for (const [name, text, code] of forged) {
    it(`EVM-007 AC3: a forged manifest ${name} is rejected`, async () => {
      const built = buildScenario(1, COMPOSE);
      built.scenario.zips.set(3001, makeZip([{ name: 'release-manifest.json', data: Buffer.from(text(built.commits[0] ?? ''), 'utf8') }]));
      const decision = await run(await start(built), built.baseline);
      expect(decision.decision).toBe('reject');
      expect(reasons(decision)).toContain(code);
    });
  }

  it('EVM-007 AC3 (A3): a redirect to a host outside the allow-list, a non-redirect answer and a foreign archive URL are rejected', async () => {
    const built = buildScenario(1, COMPOSE);
    built.scenario.redirect = '{blob}/blob/{id}'.replace('{blob}', 'http://localhost:1');
    expect(reasons(await run(await start(built), built.baseline))).toContain('v3-artifact-host');
    await stub?.close();
    const plain = buildScenario(1, COMPOSE);
    plain.scenario.overrides.push({ prefix: '/repos/evia-test/manager/actions/artifacts/', status: 200, body: '{}' });
    expect(reasons(await run(await start(plain), plain.baseline))).toContain('v3-artifact-redirect');
    await stub?.close();
    const foreign = buildScenario(1, COMPOSE);
    const api = await start(foreign);
    for (const artifact of foreign.scenario.artifacts.get(2001) ?? [])
      artifact['archive_download_url'] = 'https://evil.example/repos/evia-test/manager/actions/artifacts/3001/zip';
    expect(reasons(await run(api, foreign.baseline))).toContain('v3-artifact-url');
  });

  it('EVM-007 AC3: a ZIP over the limit (download, declared or inflated) is rejected', async () => {
    const bomb = buildScenario(1, COMPOSE);
    bomb.scenario.zips.set(3001, makeZip([{ name: 'release-manifest.json', data: Buffer.alloc(2 * 1024 * 1024, 32), declaredSize: 100 }]));
    expect(reasons(await run(await start(bomb), bomb.baseline))).toContain('zip-too-large');
    await stub?.close();
    const big = buildScenario(1, COMPOSE);
    big.scenario.zips.set(3001, makeZip([{ name: 'release-manifest.json', data: Buffer.alloc(1100 * 1024, 7), method: 0 }]));
    expect(reasons(await run(await start(big), big.baseline))).toContain('api-size');
  });
});

describe('EVM-007 AC3: V4 — the compose file of commit X', () => {
  it('EVM-007 AC3: a malicious compose file of commit X (privileged) is rejected', async () => {
    const built = buildScenario(1, COMPOSE);
    built.scenario.contents.set(
      `infra/runtime/compose.staging.yaml@${built.commits[0] ?? ''}`,
      COMPOSE.replace('    read_only: true\n', '    privileged: true\n    read_only: true\n'),
    );
    const decision = await run(await start(built), built.baseline);
    expect(decision.decision).toBe('reject');
    expect(reasons(decision)).toContain('v4-key');
  });

  it('EVM-007 AC3: a missing or oversized compose file is rejected', async () => {
    const built = buildScenario(1, COMPOSE);
    built.scenario.contents.delete(`infra/runtime/compose.staging.yaml@${built.commits[0] ?? ''}`);
    expect(reasons(await run(await start(built), built.baseline))).toContain('api-status');
    await stub?.close();
    const big = buildScenario(1, COMPOSE);
    big.scenario.contents.set(`infra/runtime/compose.staging.yaml@${big.commits[0] ?? ''}`, `${COMPOSE}\n#${'x'.repeat(70 * 1024)}`);
    expect(reasons(await run(await start(big), big.baseline))).toContain('v4-size');
  });
});

describe('EVM-007 AC3: limits of the API (fail-closed, n3)', () => {
  const cases: Array<[string, { status: number; headers?: Record<string, string>; body?: string }, string]> = [
    ['an exhausted rate limit (403, remaining 0)', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }, 'api-rate-limit'],
    ['a secondary rate limit (429 with retry-after)', { status: 429, headers: { 'retry-after': '60' } }, 'api-rate-limit'],
    ['a server error (5xx)', { status: 502 }, 'api-unavailable'],
    ['a forbidden answer without rate-limit headers', { status: 403 }, 'api-status'],
    ['a body that is not JSON', { status: 200, body: '<html>' }, 'api-parse'],
  ];
  for (const [name, answer, code] of cases) {
    it(`EVM-007 AC3: ${name} rejects the cycle — no check is skipped`, async () => {
      const built = buildScenario(2, COMPOSE);
      built.scenario.overrides.push({ prefix: '/repos/evia-test/manager/activity', ...answer });
      const decision = await run(await start(built), built.baseline);
      expect(decision.decision).toBe('reject');
      expect(reasons(decision)).toContain(code);
    });
  }

  it('EVM-007 AC3: the request budget of a cycle ends the cycle with reject', async () => {
    const built = buildScenario(6, COMPOSE);
    expect(reasons(await run(await start(built), built.baseline, [], null, { requestBudget: 10 }))).toContain('api-budget');
  });
});

describe('EVM-007 AC4: rollback on the administrator command (registry only)', () => {
  const registry = (built: Built) => [
    entry(built.commits[0] ?? '', 101, built.baseline, manifestText(built.commits[0] ?? '')),
    entry(built.commits[1] ?? '', 102, built.baseline, manifestText(built.commits[1] ?? '')),
    entry(built.commits[2] ?? '', 103, built.baseline, manifestText(built.commits[2] ?? '')),
  ];

  it('EVM-007 AC4: a rollback to a commit of the registry uses its stored manifest and the compose of that commit', async () => {
    const built = buildScenario(3, COMPOSE);
    const decision = (await run(await start(built), built.baseline, registry(built), built.commits[0] ?? '')) as Deployment;
    expect(decision.decision, reasons(decision)).toBe('rollback');
    expect(decision.commit).toBe(built.commits[0]);
    expect(decision.manifest).toBe(manifestText(built.commits[0] ?? ''));
  });

  it('EVM-007 AC4: a rollback to a commit outside the registry or to the deployed commit is rejected', async () => {
    const built = buildScenario(3, COMPOSE);
    const api = await start(built);
    expect(reasons(await run(api, built.baseline, registry(built), fakeSha('never-deployed')))).toContain('rollback-not-in-registry');
    expect(reasons(await run(api, built.baseline, registry(built), built.commits[2] ?? ''))).toContain('rollback-current');
  });

  it('EVM-007 AC4: a rollback to an entry before a V0 violation of the deployed period is allowed (the way out of the incident)', async () => {
    const built = buildScenario(3, COMPOSE);
    event(built, 3)['activity_type'] = 'push';
    const decision = await run(await start(built), built.baseline, registry(built), built.commits[0] ?? '');
    expect(decision.decision, reasons(decision)).toBe('rollback');
  });

  it('EVM-007 AC4: a rollback whose compose changed since the deployment is rejected', async () => {
    const built = buildScenario(3, COMPOSE);
    built.scenario.contents.set(
      `infra/runtime/compose.staging.yaml@${built.commits[0] ?? ''}`,
      COMPOSE.replace('mem_limit: 128m', 'mem_limit: 256m'),
    );
    expect(reasons(await run(await start(built), built.baseline, registry(built), built.commits[0] ?? ''))).toContain('rollback-compose');
  });
});
