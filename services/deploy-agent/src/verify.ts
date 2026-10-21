/**
 * The verification cycle (EVM-007 AC3, AC4; ADR-0018 V0–V4, rollback; architect 4–7, 13; security-engineer B).
 * Fail-closed: any Rejection ends the cycle with `reject` and no change. The result is UNTRUSTED for root: deploy.sh
 * validates it again before it pulls or runs anything.
 *   deploy   — X = the newest commit of the range with a usable release; V0 (whole range to HEAD), V1, V2 (every
 *              commit of the range, also those after X), V3 (X), V4 (compose of X) passed.
 *   rollback — to a commit of the registry: on the administrator's command, or automatically when V0 finds an event
 *              (push, force push …) inside the period already deployed (n5).
 *   none     — nothing to do (up to date, held after a rollback, or no release in the range yet).
 *   reject   — a check failed; nothing changes.
 * Rollback semantics (ADR-0018 "Rollback"; review round 1): the FRONTIER is the newest `deploy` entry of the registry —
 * the end of the verified Activity; a rollback entry never moves it. V0 is anchored on the `deploy` entry before the
 * frontier (or the baseline), so its window covers the period of the frontier (n5); V1 and V2 start at the frontier.
 * After a rollback the channel HOLDS (`none`): it deploys again only a release newer than the frontier (a fix or a
 * revert merged through a pull request), never the commit it rolled back from. After the automatic rollback of n5 the
 * serving version predates the violation and every cycle answers `v0-blocked` until Konrad moves the baseline
 * (runbook incydent-blokada-v0).
 */
import { checkChain, readActivity, type Anchor } from './activity.ts';
import { VerificationCache } from './cache.ts';
import { validateCompose } from './compose-policy.ts';
import type { AgentConfig } from './config.ts';
import { Rejection, ensure, record, string } from './errors.ts';
import type { GitHub } from './github.ts';
import { readHead, readRange, type RangeCommit } from './history.ts';
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
  /** Results that cannot change (cache.ts), updated in place; a fresh cache when absent. */
  readonly cache?: VerificationCache;
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

/** The registry as a cycle sees it: what serves, the frontier and the anchor of V0. */
interface Position {
  readonly current: RegistryEntry | undefined;
  readonly deploys: readonly RegistryEntry[];
  readonly frontier: RegistryEntry | undefined;
  readonly anchorEntry: RegistryEntry | undefined;
}

function position(registry: readonly RegistryEntry[], baseline: string): Position {
  const chain = currentChain(registry, baseline);
  const deploys = chain.filter((entry) => entry.kind === 'deploy');
  return { current: chain.at(-1), deploys, frontier: deploys.at(-1), anchorEntry: deploys.at(-2) };
}

/** The reason of a `none` while the channel holds after a rollback (empty when the frontier serves). */
function held({ current, frontier }: Position): string[] {
  if (current === undefined || frontier === undefined || current.commit === frontier.commit) return [];
  return [`held after the rollback to ${current.commit}: waits for a release newer than ${frontier.commit}`];
}

/** V2 for every commit of the range; a pass is remembered (it cannot change), the squash rule runs every cycle. */
async function checkPulls(github: GitHub, config: AgentConfig, range: readonly RangeCommit[], cache: VerificationCache): Promise<void> {
  for (const commit of range) {
    ensure(commit.parents.length === 1, 'v2-not-squash', `${commit.sha} has ${String(commit.parents.length)} parents`);
    if (cache.pull(commit.sha) !== undefined) continue;
    cache.rememberPull(await checkPullRequest(github, commit, { accountId: config.ownerAccountId, workflowId: config.workflowId }));
  }
}

/** The automatic answer to a V0 violation: a rollback of the frontier (n5) or a block. */
async function onViolation(input: VerifyInput, where: Position, reason: string, tainted: boolean, head: string): Promise<Deployment> {
  const { current, frontier, anchorEntry } = where;
  if (current === undefined || frontier === undefined || !tainted) throw new Rejection('v0-blocked', reason);
  if (anchorEntry === undefined) throw new Rejection('v0-blocked', `${reason}; no earlier deployment to roll back to`);
  if (current.commit !== frontier.commit)
    throw new Rejection('v0-blocked', `${reason}; ${current.commit} (older than the violation) serves until the baseline moves`);
  return rollback(input, anchorEntry, head, `${reason} inside the deployed period — rollback to ${anchorEntry.commit}`);
}

async function cycle(input: VerifyInput, cache: VerificationCache): Promise<Decision> {
  const { github, config } = input;
  const where = position(input.registry, config.baseline.commit);
  const { current, deploys, frontier, anchorEntry } = where;
  const anchor: Anchor = anchorEntry ?? config.baseline;
  const head = await readHead(github);
  const events = await readActivity(github, anchor);
  const v0 = checkChain(events, anchor, config.ownerAccountId);
  let deployed = -1;
  if (frontier !== undefined && frontier.activityEventId !== anchor.activityEventId) {
    deployed = events.findIndex((event) => event.id === frontier.activityEventId);
    ensure(deployed >= 0 && events[deployed]?.after === frontier.commit, 'v0-registry', 'the deployed commit is not in the Activity chain');
  }
  const tainted = v0.violation >= 0 && v0.violation <= deployed;

  if (input.rollbackTo !== null) {
    const target = deploys.find((entry) => entry.commit === input.rollbackTo);
    ensure(target !== undefined, 'rollback-not-in-registry', input.rollbackTo);
    ensure(target.commit !== current?.commit, 'rollback-current', 'the commit is deployed now');
    // Every deploy entry but the frontier is the anchor or older: its V0/V2 window was checked when it was deployed
    // (ADR-0018 "Rollback"); the frontier itself is refused while a violation sits inside its period.
    ensure(!(tainted && target === frontier), 'v0-blocked', `${target.commit} is inside the violated period`);
    return rollback(input, target, head, `rollback on the administrator's command to ${target.commit}`);
  }

  if (v0.violation >= 0) return onViolation(input, where, v0.reason ?? 'v0', tainted, head);
  ensure((events.at(-1)?.after ?? anchor.commit) === head, 'v0-activity-lag', 'the Activity does not reach HEAD yet');

  const range = await readRange(github, frontier?.commit ?? config.baseline.commit, head, config.maxRangeCommits);
  const tail = events.slice(deployed + 1);
  ensure(
    JSON.stringify(tail.map((event) => event.after)) === JSON.stringify(range.map((commit) => commit.sha)),
    'v0-v1-mismatch',
    'one pr_merge per commit of the range expected',
  );
  cache.prune(range.map((commit) => commit.sha));
  const holding = held(where);
  if (range.length === 0) return { decision: 'none', head, reasons: holding.length > 0 ? holding : ['up to date'] };
  await checkPulls(github, config, range, cache);

  for (let index = range.length - 1; index >= 0; index -= 1) {
    const commit = range[index]?.sha ?? '';
    if (cache.isSkipped(commit)) continue;
    const release = await findRelease(github, config, commit);
    if (release === 'skipped') cache.rememberSkipped(commit);
    if (typeof release === 'string') continue;
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
  return { decision: 'none', head, reasons: ['no published release in the range yet', ...holding] };
}

/** One cycle; every Rejection becomes `reject` with its reason (fail-closed). */
export async function verify(input: VerifyInput): Promise<Decision> {
  try {
    return await cycle(input, input.cache ?? new VerificationCache(input.config.baseline.commit));
  } catch (error) {
    if (error instanceof Rejection) return { decision: 'reject', head: null, reasons: [error.message] };
    return { decision: 'reject', head: null, reasons: ['internal-error'] };
  }
}
