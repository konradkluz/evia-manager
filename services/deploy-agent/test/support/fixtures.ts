/** Shared fixtures of the verifier tests: configuration, the real compose file of the channel, a verify runner. */
import { readFileSync } from 'node:fs';
import type { VerificationCache } from '../../src/cache.ts';
import { parseConfig, type AgentConfig } from '../../src/config.ts';
import { GitHub } from '../../src/github.ts';
import { sha256 } from '../../src/manifest.ts';
import type { RegistryEntry } from '../../src/registry.ts';
import { validateCompose } from '../../src/compose-policy.ts';
import { verify, type Decision } from '../../src/verify.ts';
import { API_REPO, COMPOSE_PATH, OWNER, OWNER_ID, REPO, TOKEN, WEB_REPO, WORKFLOW_ID, digest, type Stub } from './github-stub.ts';

/** The compose file of the channel as committed — the tests prove the real file passes V4. */
export const COMPOSE = readFileSync(new URL('../../../../infra/runtime/compose.staging.yaml', import.meta.url), 'utf8');

export function configText(baseline: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    repository: { owner: OWNER, name: REPO },
    ownerAccountId: OWNER_ID,
    workflowId: WORKFLOW_ID,
    baseline: { commit: baseline, activityEventId: 100 },
    composePath: COMPOSE_PATH,
    imageRepositories: { api: API_REPO, web: WEB_REPO },
    artifactHosts: ['127.0.0.1'],
    requestBudget: 200,
    runtimeNetwork: 'evia-runtime',
    maxRangeCommits: 50,
    ...overrides,
  });
}

export const config = (baseline: string, overrides: Record<string, unknown> = {}): AgentConfig =>
  parseConfig(configText(baseline, overrides));

export function github(stub: Stub, cfg: AgentConfig, options: { timeoutMs?: number } = {}): GitHub {
  return new GitHub({
    baseUrl: stub.base,
    token: TOKEN,
    owner: cfg.repository.owner,
    repo: cfg.repository.name,
    budget: cfg.requestBudget,
    artifactHosts: cfg.artifactHosts,
    allowHttpArtifactHost: true,
    ...options,
  });
}

/** A registry entry as deploy.sh records it after a successful switch. */
export function entry(commit: string, activityEventId: number, baseline: string, manifest: string): RegistryEntry {
  const images = JSON.parse(manifest) as { images: { api: string; web: string } };
  return {
    kind: 'deploy',
    commit,
    manifestSha256: sha256(manifest),
    manifest,
    composeSha256: validateCompose(COMPOSE, { images: images.images, network: 'evia-runtime' }).sha256,
    activityEventId,
    baseline,
    deployedAt: '2026-10-21T08:00:00.000Z',
  };
}

/** The entry deploy.sh appends after a rollback to an earlier deployment. */
export const rolledBack = (target: RegistryEntry): RegistryEntry => ({
  ...target,
  kind: 'rollback',
  deployedAt: '2026-10-21T09:00:00.000Z',
});

export async function run(
  stub: Stub,
  baseline: string,
  registry: RegistryEntry[] = [],
  rollbackTo: string | null = null,
  overrides: Record<string, unknown> = {},
  cache?: VerificationCache,
): Promise<Decision> {
  const cfg = config(baseline, overrides);
  return verify({ github: github(stub, cfg), config: cfg, registry, rollbackTo, ...(cache === undefined ? {} : { cache }) });
}

export const reasons = (decision: Decision): string => decision.reasons.join(' | ');

export { digest };
