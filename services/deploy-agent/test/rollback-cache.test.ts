/**
 * The cycle after a rollback and the memory of results that cannot change (EVM-007 AC3, AC4; ADR-0018 "Rollback", n3,
 * n5; review round 1 — security-engineer and solution-architect): the channel holds after a rollback instead of
 * rejecting or redeploying, deploys only a newer release, stays blocked after the automatic rollback of n5, and a second
 * cycle at the same HEAD does not ask V2/V3 again. Synthetic data only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { VerificationCache } from '../src/cache.ts';
import type { RegistryEntry } from '../src/registry.ts';
import type { Deployment } from '../src/verify.ts';
import { buildScenario, fakeSha, manifestText, startStub, wireArtifacts, type Built, type Stub } from './support/github-stub.ts';
import { COMPOSE, entry, reasons, rolledBack, run } from './support/fixtures.ts';

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

function event(built: Built, index: number): Record<string, unknown> {
  const found = built.scenario.events.find((item) => item['id'] === 100 + index);
  if (found === undefined) throw new Error('no such event');
  return found;
}

/** Deploy entries of the first `count` merges, as deploy.sh records them. */
const deployed = (built: Built, count: number): RegistryEntry[] =>
  built.commits.slice(0, count).map((commit, index) => entry(commit, 101 + index, built.baseline, manifestText(commit)));

function at(entries: readonly RegistryEntry[], index: number): RegistryEntry {
  const found = entries[index];
  if (found === undefined) throw new Error('no such entry');
  return found;
}

const commit = (built: Built, index: number): string => built.commits[index] ?? '';

describe('EVM-007 AC4: the cycle after a rollback (frontier, hold, no redeployment)', () => {
  it('EVM-007 AC4: after a rollback on the command and without a new merge the channel holds — none, neither reject nor a redeployment of the commit it rolled back from', async () => {
    for (const target of [0, 1]) {
      const built = buildScenario(3, COMPOSE);
      const registry = deployed(built, 3);
      const api = await start(built);
      const decision = await run(api, built.baseline, [...registry, rolledBack(at(registry, target))]);
      expect(decision.decision, reasons(decision)).toBe('none');
      expect(decision.reasons).toEqual([
        `held after the rollback to ${commit(built, target)}: waits for a release newer than ${commit(built, 2)}`,
      ]);
      expect(api.requests.some((path) => path.includes('/pulls'))).toBe(false);
      await stub?.close();
      stub = undefined;
    }
  });

  it('EVM-007 AC4: after a rollback a new merge D is deployed — V0 anchored on the deployment before the frontier C, V1 from C', async () => {
    const built = buildScenario(4, COMPOSE);
    const registry = deployed(built, 3);
    const api = await start(built);
    const decision = (await run(api, built.baseline, [...registry, rolledBack(at(registry, 0))])) as Deployment;
    expect(decision.decision, reasons(decision)).toBe('deploy');
    expect(decision.commit).toBe(commit(built, 3));
    expect(decision.activityEventId).toBe(104);
    expect(api.requests.some((path) => path.includes(`/compare/${commit(built, 2)}...${commit(built, 3)}`))).toBe(true);
    expect(api.requests.some((path) => path.endsWith('/pulls/3'))).toBe(false);
  });

  it('EVM-007 AC4: after a rollback a new merge without a release (documentation only) keeps the hold', async () => {
    const built = buildScenario(4, COMPOSE, { skippedPublish: [4] });
    const registry = deployed(built, 3);
    const decision = await run(await start(built), built.baseline, [...registry, rolledBack(at(registry, 1))]);
    expect(decision.decision, reasons(decision)).toBe('none');
    expect(decision.reasons).toEqual([
      'no published release in the range yet',
      `held after the rollback to ${commit(built, 1)}: waits for a release newer than ${commit(built, 2)}`,
    ]);
  });

  it('EVM-007 AC4: the administrator may return to the frontier; afterwards the channel is up to date', async () => {
    const built = buildScenario(3, COMPOSE);
    const registry = deployed(built, 3);
    registry.push(rolledBack(at(registry, 0)));
    const api = await start(built);
    const back = (await run(api, built.baseline, registry, commit(built, 2))) as Deployment;
    expect(back.decision, reasons(back)).toBe('rollback');
    expect(back.activityEventId).toBe(103);
    expect(reasons(await run(api, built.baseline, registry, commit(built, 0)))).toContain('rollback-current');
    registry.push(rolledBack(at(registry, 2)));
    expect((await run(api, built.baseline, registry)).reasons).toEqual(['up to date']);
  });

  it('EVM-007 AC4 (n5): after the automatic rollback every cycle is v0-blocked until the baseline moves — no rollback loop, no return to the frontier', async () => {
    const built = buildScenario(2, COMPOSE);
    event(built, 2)['activity_type'] = 'force_push';
    const registry = deployed(built, 2);
    const api = await start(built);
    const first = (await run(api, built.baseline, registry)) as Deployment;
    expect(first.decision, reasons(first)).toBe('rollback');
    expect(first.commit).toBe(commit(built, 0));
    const after = [...registry, rolledBack(at(registry, 0))];
    const next = await run(api, built.baseline, after);
    expect(next.decision).toBe('reject');
    expect(reasons(next)).toContain('v0-blocked');
    expect(reasons(next)).toContain('until the baseline moves');
    const toFrontier = await run(api, built.baseline, after, commit(built, 1));
    expect(reasons(toFrontier)).toContain('v0-blocked');
    expect(reasons(toFrontier)).toContain('inside the violated period');
  });

  it('EVM-007 AC4: a violation after the frontier while a rollback serves blocks without another rollback', async () => {
    const built = buildScenario(4, COMPOSE);
    event(built, 4)['activity_type'] = 'push';
    const registry = deployed(built, 3);
    const decision = await run(await start(built), built.baseline, [...registry, rolledBack(at(registry, 0))]);
    expect(decision.decision).toBe('reject');
    expect(reasons(decision)).toContain('v0-blocked');
    expect(reasons(decision)).toContain('push');
  });
});

describe('EVM-007 AC3 (n3): results that cannot change are not asked again', () => {
  it('EVM-007 AC3: a second cycle at the same HEAD with documentation-only commits asks the API at most 3 times (HEAD, Activity, compare)', async () => {
    const built = buildScenario(4, COMPOSE, { skippedPublish: [2, 3, 4] });
    const registry = deployed(built, 1);
    const api = await start(built);
    const cache = new VerificationCache(built.baseline);
    const first = await run(api, built.baseline, registry, null, {}, cache);
    expect(first.reasons).toEqual(['no published release in the range yet']);
    const before = api.requests.length;
    const second = await run(api, built.baseline, registry, null, {}, cache);
    expect(second.reasons).toEqual(['no published release in the range yet']);
    const asked = api.requests.slice(before);
    expect(asked.length).toBeLessThanOrEqual(3);
    // V0 and V1 still run every cycle.
    expect(asked.some((path) => path.includes('/activity'))).toBe(true);
    expect(asked.some((path) => path.includes('/compare/'))).toBe(true);
  });

  it('EVM-007 AC3: a release that is not usable yet (no push run) is asked again, a passed V2 is not', async () => {
    const built = buildScenario(2, COMPOSE, { unpublished: [2] });
    const api = await start(built);
    const cache = new VerificationCache(built.baseline);
    const registry = deployed(built, 1);
    await run(api, built.baseline, registry, null, {}, cache);
    const before = api.requests.length;
    await run(api, built.baseline, registry, null, {}, cache);
    const asked = api.requests.slice(before);
    expect(asked.some((path) => path.includes('event=push'))).toBe(true);
    expect(asked.some((path) => path.includes('event=pull_request'))).toBe(false);
  });

  it('EVM-007 AC3: the squash rule is checked every cycle, also for a cached commit', async () => {
    const built = buildScenario(2, COMPOSE, { skippedPublish: [2] });
    const registry = deployed(built, 1);
    const api = await start(built);
    const cache = new VerificationCache(built.baseline);
    await run(api, built.baseline, registry, null, {}, cache);
    built.scenario.history[2]?.parents.push(fakeSha('second-parent'));
    expect(reasons(await run(api, built.baseline, registry, null, {}, cache))).toContain('v2-not-squash');
  });

  it('EVM-007 AC3: a failed or ambiguous publish is not a final skip', async () => {
    const built = buildScenario(2, COMPOSE, { skippedPublish: [2] });
    built.scenario.jobs.set('2002/1', [
      { name: 'ci-gate', status: 'completed', conclusion: 'success' },
      { name: 'publish', status: 'completed', conclusion: 'skipped' },
      { name: 'publish', status: 'completed', conclusion: 'failure' },
    ]);
    const api = await start(built);
    const cache = new VerificationCache(built.baseline);
    await run(api, built.baseline, deployed(built, 1), null, {}, cache);
    expect(cache.isSkipped(commit(built, 1))).toBe(false);
  });

  it('EVM-007 AC3: the cache keeps only the commits of the current range and of its baseline; a malformed file is an empty cache', () => {
    const baseline = fakeSha('baseline');
    const evidence = { commit: fakeSha('a'), pullRequest: 1, headSha: fakeSha('h'), runId: 7 };
    const cache = new VerificationCache(baseline, [evidence, { ...evidence, commit: fakeSha('c') }], [fakeSha('a'), fakeSha('b')]);
    cache.prune([fakeSha('a')]);
    const text = cache.serialize();
    const read = VerificationCache.parse(text, baseline);
    expect(read.pull(fakeSha('a'))).toEqual(evidence);
    expect(read.pull(fakeSha('c'))).toBeUndefined();
    expect(read.isSkipped(fakeSha('a'))).toBe(true);
    expect(read.isSkipped(fakeSha('b'))).toBe(false);
    const document = JSON.parse(text) as Record<string, unknown>;
    for (const bad of [
      null,
      '{',
      '[]',
      JSON.stringify({ ...document, schemaVersion: 2 }),
      JSON.stringify({ ...document, baseline: fakeSha('other') }),
      JSON.stringify({ ...document, pulls: {} }),
      JSON.stringify({ ...document, skipped: ['main'] }),
      JSON.stringify({ ...document, pulls: [{ ...evidence, runId: 0 }] }),
      JSON.stringify({ ...document, pulls: [{ ...evidence, pullRequest: 'x' }] }),
      JSON.stringify({ ...document, pulls: [{ ...evidence, extra: 1 }] }),
      JSON.stringify({ ...document, pulls: [{ ...evidence, headSha: 'x' }] }),
      JSON.stringify({ ...document, pulls: [1] }),
      JSON.stringify({ ...document, skipped: Array.from({ length: 1001 }, (_, index) => fakeSha(String(index))) }),
    ]) {
      const empty = VerificationCache.parse(bad, baseline);
      expect(empty.pull(fakeSha('a')), String(bad)).toBeUndefined();
      expect(empty.isSkipped(fakeSha('a'))).toBe(false);
    }
  });
});
