/**
 * The verification cycle (EVM-007 AC3, AC4; ADR-0018 V0–V4, rollback; architect 4–7, 13; security-engineer B).
 * Fail-closed: any Rejection ends the cycle with `reject` and no change. The result is UNTRUSTED for root: deploy.sh
 * validates it again before it pulls or runs anything.
 *   deploy   — X = the newest commit of the range with a usable release; V0 (whole range to HEAD), V1, V2 (every
 *              commit of the range, also those after X), V3 (X), V4 (compose of X) passed.
 *   rollback — to a commit of the registry: on the administrator's command, or automatically when V0 finds an event
 *              (push, force push …) inside the period already deployed (n5).
 *   none     — nothing to do (up to date, or no release in the range yet).
 *   reject   — a check failed; nothing changes.
 */
import { checkChain, readActivity, type Anchor } from './activity.ts';
import { validateCompose } from './compose-policy.ts';
import type { AgentConfig } from './config.ts';
import { Rejection, ensure, record, string } from './errors.ts';
import type { GitHub } from './github.ts';
import { readHead, readRange } from './history.ts';
import { parseManifest } from './manifest.ts';
import { checkPullRequest } from './pulls.ts';
import { currentChain, type RegistryEntry } from './registry.ts';
import { findRelease } from './release.ts';
import { MAX_COMPOSE_BYTES } from './compose-policy.ts';

export interface Deployment {
  readonly decision: 'deploy' | 'rollback';
  readonly commit: string;
  readonly manifestSha256: string;
  /** The exact text of release-manifest.json (stored in the registry by root). */
  readonly manifest: string;
  readonly images: { readonly api: string; readonly web: string };
  /** Canonical compose document (JSON text) and its SHA-256. */
  readonly compose: string;
  readonly composeSha256: string;
  readonly activityEventId: number;
  readonly head: string;
  readonly reasons: readonly string[];
}

export interface NoChange {
  readonly decision: 'none' | 'reject';
  readonly head: string | null;
  readonly reasons: readonly string[];
}

export type Decision = Deployment | NoChange;

export interface VerifyInput {
  readonly github: GitHub;
  readonly config: AgentConfig;
  readonly registry: readonly RegistryEntry[];
  /** Commit of the administrator's rollback command, or null. */
  readonly rollbackTo: string | null;
}

/** V4 input: the compose file of the channel at a commit, through the contents API. */
export async function readCompose(github: GitHub, path: string, commit: string): Promise<string> {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const { body } = await github.json(`${github.repoPath}/contents/${encoded}?ref=${commit}`);
  const file = record(body, 'v4-parse');
  ensure(file['type'] === 'file' && file['encoding'] === 'base64' && file['path'] === path, 'v4-parse', 'not a file');
  const size = file['size'];
  ensure(typeof size === 'number' && size <= MAX_COMPOSE_BYTES, 'v4-size', 'compose file too large');
  const bytes = Buffer.from(string(file['content'], 'v4-parse').replace(/\n/g, ''), 'base64');
  ensure(bytes.byteLength === size, 'v4-parse', 'size differs from content');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Rejection('v4-parse', 'not UTF-8');
  }
}

/** A rollback to an entry of the registry: its stored manifest, the compose of its commit checked again (V4). */
async function rollback(input: VerifyInput, target: RegistryEntry, head: string, reason: string): Promise<Deployment> {
  const { github, config } = input;
  const manifest = parseManifest(new TextEncoder().encode(target.manifest), {
    commit: target.commit,
    composePath: config.composePath,
    repositories: config.imageRepositories,
  });
  const compose = validateCompose(await readCompose(github, config.composePath, target.commit), {
    images: manifest.images,
    network: config.runtimeNetwork,
  });
  ensure(compose.sha256 === target.composeSha256, 'rollback-compose', 'the compose of the registry entry differs');
  return {
    decision: 'rollback',
    commit: target.commit,
    manifestSha256: target.manifestSha256,
    manifest: target.manifest,
    images: manifest.images,
    compose: compose.json,
    composeSha256: compose.sha256,
    activityEventId: target.activityEventId,
    head,
    reasons: [reason],
  };
}

async function cycle(input: VerifyInput): Promise<Decision> {
  const { github, config } = input;
  const chain = currentChain(input.registry, config.baseline.commit);
  const current = chain.at(-1);
  const previous = chain.at(-2);
  const anchor: Anchor = previous ?? config.baseline;
  const head = await readHead(github);
  const events = await readActivity(github, anchor);
  const v0 = checkChain(events, anchor, config.ownerAccountId);
  let deployed = -1;
  if (current !== undefined && current.activityEventId !== anchor.activityEventId) {
    deployed = events.findIndex((event) => event.id === current.activityEventId);
    ensure(deployed >= 0 && events[deployed]?.after === current.commit, 'v0-registry', 'the deployed commit is not in the Activity chain');
  }

  if (input.rollbackTo !== null) {
    const target = chain.find((entry) => entry.commit === input.rollbackTo);
    ensure(target !== undefined, 'rollback-not-in-registry', input.rollbackTo);
    ensure(target !== current, 'rollback-current', 'the commit is deployed now');
    // Every other entry is the anchor or older: its V0/V2 window was checked when it was deployed (ADR-0018 "Rollback"),
    // so a violation found now in the window after the anchor never taints it.
    return rollback(input, target, head, `rollback on the administrator's command to ${target.commit}`);
  }

  if (v0.violation >= 0) {
    const reason = v0.reason ?? 'v0';
    if (current !== undefined && v0.violation <= deployed) {
      if (previous === undefined) throw new Rejection('v0-blocked', `${reason}; no earlier deployment to roll back to`);
      return rollback(input, previous, head, `${reason} inside the deployed period — rollback to ${previous.commit}`);
    }
    throw new Rejection('v0-blocked', reason);
  }
  ensure((events.at(-1)?.after ?? anchor.commit) === head, 'v0-activity-lag', 'the Activity does not reach HEAD yet');

  const base = current?.commit ?? config.baseline.commit;
  const range = await readRange(github, base, head, config.maxRangeCommits);
  const tail = events.slice(deployed + 1);
  ensure(
    JSON.stringify(tail.map((event) => event.after)) === JSON.stringify(range.map((commit) => commit.sha)),
    'v0-v1-mismatch',
    'one pr_merge per commit of the range expected',
  );
  if (range.length === 0) return { decision: 'none', head, reasons: ['up to date'] };
  for (const commit of range) await checkPullRequest(github, commit, { accountId: config.ownerAccountId, workflowId: config.workflowId });

  for (let index = range.length - 1; index >= 0; index -= 1) {
    const commit = range[index]?.sha ?? '';
    const release = await findRelease(github, config, commit);
    if (release === null) continue;
    const compose = validateCompose(await readCompose(github, config.composePath, commit), {
      images: release.manifest.images,
      network: config.runtimeNetwork,
    });
    return {
      decision: 'deploy',
      commit,
      manifestSha256: release.manifestSha256,
      manifest: release.text,
      images: release.manifest.images,
      compose: compose.json,
      composeSha256: compose.sha256,
      activityEventId: tail[index]?.id ?? 0,
      head,
      reasons: [`V0–V4 passed for ${commit} (${String(range.length)} commits checked up to HEAD)`],
    };
  }
  return { decision: 'none', head, reasons: ['no published release in the range yet'] };
}

/** One cycle; every Rejection becomes `reject` with its reason (fail-closed). */
export async function verify(input: VerifyInput): Promise<Decision> {
  try {
    return await cycle(input);
  } catch (error) {
    if (error instanceof Rejection) return { decision: 'reject', head: null, reasons: [error.message] };
    return { decision: 'reject', head: null, reasons: ['internal-error'] };
  }
}
