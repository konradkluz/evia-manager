/**
 * The configuration of the VM and the registry of deployments are strict (EVM-007 AC3, AC4; architect 13): a malformed
 * file stops the cycle, never falls back to a default.
 */
import { describe, expect, it } from 'vitest';
import { hostAllowed, parseConfig } from '../src/config.ts';
import { Rejection, array, ensure } from '../src/errors.ts';
import { sha256 } from '../src/manifest.ts';
import { currentChain, parseRegistry } from '../src/registry.ts';
import { fakeSha, manifestText } from './support/github-stub.ts';
import { configText } from './support/fixtures.ts';

const BASELINE = fakeSha('baseline');
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof Rejection) return error.code;
    throw error;
  }
  return 'accepted';
};

describe('EVM-007 AC3: configuration of the VM', () => {
  it('EVM-007 AC3: the test configuration is valid', () => {
    const config = parseConfig(configText(BASELINE));
    expect(config.baseline).toEqual({ commit: BASELINE, activityEventId: 100 });
    expect(config.ownerAccountId).toBe(4242);
  });

  const cases: Array<[string, Record<string, unknown>]> = [
    ['an unknown key', { extra: 1 }],
    ['a login instead of the numeric ID', { ownerAccountId: 'konrad-test' }],
    ['a workflow name instead of its ID', { workflowId: 'ci' }],
    ['ID 0', { ownerAccountId: 0 }],
    ['a short baseline', { baseline: { commit: 'abc', activityEventId: 1 } }],
    ['a baseline without its Activity event', { baseline: { commit: BASELINE } }],
    ['a compose path outside infra/runtime', { composePath: '../../etc/passwd' }],
    ['an image repository of another name', { imageRepositories: { api: 'ghcr.io/x/other', web: 'ghcr.io/x/evia-web' } }],
    ['swapped image repositories', { imageRepositories: { api: 'ghcr.io/x/evia-web', web: 'ghcr.io/x/evia-api' } }],
    ['api.github.com as an artifact host', { artifactHosts: ['api.github.com'] }],
    ['no artifact host', { artifactHosts: [] }],
    ['an artifact host with a scheme', { artifactHosts: ['https://x'] }],
    ['a request budget of 5', { requestBudget: 5 }],
    ['a range limit of 0', { maxRangeCommits: 0 }],
    ['a network name with spaces', { runtimeNetwork: 'a b' }],
    ['a repository with a slash', { repository: { owner: 'a/b', name: 'c' } }],
    ['a repository with an extra key', { repository: { owner: 'a', name: 'c', id: 1 } }],
  ];
  for (const [name, overrides] of cases)
    it(`EVM-007 AC3: ${name} is rejected`, () => {
      expect(code(() => parseConfig(configText(BASELINE, overrides)))).toBe('config');
    });

  it('EVM-007 AC3: text that is not JSON or not an object is rejected', () => {
    expect(code(() => parseConfig('{'))).toBe('config');
    expect(code(() => parseConfig('[]'))).toBe('config');
  });

  it('EVM-007 AC3 (A3): artifact hosts match exactly or as a .suffix of a subdomain', () => {
    expect(hostAllowed('results.blob.core.windows.net', ['.blob.core.windows.net'])).toBe(true);
    expect(hostAllowed('blob.core.windows.net', ['.blob.core.windows.net'])).toBe(false);
    expect(hostAllowed('evilblob.core.windows.net', ['.blob.core.windows.net'])).toBe(false);
    expect(hostAllowed('127.0.0.1', ['127.0.0.1'])).toBe(true);
    expect(hostAllowed('localhost', ['127.0.0.1'])).toBe(false);
  });

  it('EVM-007 AC3: helpers of the checks reject wrong types', () => {
    expect(code(() => array({}, 'x'))).toBe('x');
    expect(
      code(() => {
        ensure(false, 'y');
      }),
    ).toBe('y');
    expect(new Rejection('z').message).toBe('z');
  });
});

describe('EVM-007 AC4: the registry of deployments', () => {
  const manifest = manifestText(fakeSha('c1'));
  const valid = {
    kind: 'deploy',
    commit: fakeSha('c1'),
    manifestSha256: sha256(manifest),
    manifest,
    composeSha256: 'c'.repeat(64),
    activityEventId: 101,
    baseline: BASELINE,
    deployedAt: '2026-10-21T08:00:00.000Z',
  };
  const text = (entries: unknown[]): string => JSON.stringify({ schemaVersion: 1, entries });

  it('EVM-007 AC4: an absent file is an empty registry; a valid entry is read; entries of another baseline are left out', () => {
    expect(parseRegistry(null)).toEqual([]);
    const entries = parseRegistry(text([valid, { ...valid, baseline: fakeSha('old') }]));
    expect(entries.length).toBe(2);
    expect(currentChain(entries, BASELINE)).toEqual([valid]);
    expect(code(() => currentChain(entries, 'x'))).toBe('config');
  });

  it('EVM-007 AC4: a rollback entry that repeats an earlier deployment of the same baseline is read', () => {
    const rollback = { ...valid, kind: 'rollback', deployedAt: '2026-10-21T09:00:00.000Z' };
    expect(parseRegistry(text([valid, rollback])).map((item) => item.kind)).toEqual(['deploy', 'rollback']);
    expect(code(() => parseRegistry(text([valid, { ...rollback, baseline: fakeSha('old') }])))).toBe('registry');
  });

  const cases: Array<[string, unknown]> = [
    ['not JSON', '{'],
    ['another schema version', JSON.stringify({ schemaVersion: 2, entries: [] })],
    ['an entry that is not an object', text([1])],
    ['an entry with an extra key', text([{ ...valid, rollback: true }])],
    ['a manifest that does not match its hash', text([{ ...valid, manifest: `${manifest} ` }])],
    ['a short hash', text([{ ...valid, composeSha256: 'abc' }])],
    ['a short commit', text([{ ...valid, commit: 'abc' }])],
    ['a date that is not a date', text([{ ...valid, deployedAt: 'yesterday' }])],
    ['a negative event ID', text([{ ...valid, activityEventId: -1 }])],
    ['an entry without its kind', text([{ ...valid, kind: undefined }])],
    ['an unknown kind', text([{ ...valid, kind: 'redeploy' }])],
    ['a rollback as the first entry', text([{ ...valid, kind: 'rollback' }])],
    ['a rollback to another Activity event than its deployment', text([valid, { ...valid, kind: 'rollback', activityEventId: 102 }])],
    ['a rollback with another compose than its deployment', text([valid, { ...valid, kind: 'rollback', composeSha256: 'd'.repeat(64) }])],
    ['a rollback that repeats a later entry', text([{ ...valid, kind: 'rollback' }, valid])],
  ];
  for (const [name, content] of cases)
    it(`EVM-007 AC4: a registry with ${name} rejects the cycle`, () => {
      expect(code(() => parseRegistry(String(content)))).toBe('registry');
    });
});
