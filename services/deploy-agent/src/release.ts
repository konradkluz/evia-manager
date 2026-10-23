/**
 * V3 — the release of commit X (EVM-007 AC3; ADR-0018 V3, m2; architect 4, 7; security-engineer A3, B "V3").
 * A run of the workflow with the configured numeric ID with event `push`, head_branch `main` and head_sha X (X is in the
 * history of main by V1 — a tag named `main` is never enough: its run has no successful `publish`). Deterministic choice:
 * the OLDEST push run for X and its NEWEST usable attempt (from run_attempt down to 1): the jobs API of that attempt
 * shows `ci-gate` and `publish` completed/success. The status and conclusion of the whole run are NOT a condition:
 * `staging-verify` runs in the same run and waits for this very deployment, so the run is in progress until the release
 * is deployed (and fails when it is not). Both jobs come from the job list of the SAME attempt; jobs carried over by
 * GitHub on a partial re-run are consistent because `needs` is re-evaluated. Exactly one job of each name (a duplicate
 * is a rejection). A `skipped` additionally needs the attempt itself completed/success (a run cancelled after a green
 * `ci-gate` is not final and is never cached). The
 * artifact `release-manifest` (exact name, not expired, of this run and commit; the newest when re-runs made several) is
 * downloaded through the redirect check of github.ts and parsed in memory (zip.ts, manifest.ts).
 * `unusable` = X has no usable release now (no run, a job running, publish failed — a re-run may change that);
 * `skipped` = X will never have one: the attempt skipped `publish` after a green `ci-gate` (no change in apps/, packages/,
 * infra/ or the lockfile — EVM-083), which a re-run repeats; the verifier may remember it (cache.ts). In both cases the
 * verifier looks at an older commit. A missing or forged manifest of a successful publish is a rejection.
 */
import type { AgentConfig } from './config.ts';
import { Rejection, ensure, integer, isRecord, record } from './errors.ts';
import { MAX_ARTIFACT_BYTES, type GitHub } from './github.ts';
import { parseManifest, sha256, type Manifest } from './manifest.ts';
import { jobStates } from './pulls.ts';
import { readSingleEntry } from './zip.ts';

export const MANIFEST_ARTIFACT = 'release-manifest';
export const MANIFEST_FILE = 'release-manifest.json';

export interface Release {
  readonly manifest: Manifest;
  /** The exact text of release-manifest.json. */
  readonly text: string;
  readonly manifestSha256: string;
  readonly runId: number;
}

/** The attempt itself completed with success (needed only to trust a skipped publish: a cancelled run is not final). */
async function attemptSucceeded(github: GitHub, runId: number, attempt: number): Promise<boolean> {
  const { body } = await github.json(`${github.repoPath}/actions/runs/${String(runId)}/attempts/${String(attempt)}`);
  const run = record(body, 'v3-parse');
  return run['status'] === 'completed' && run['conclusion'] === 'success';
}

/**
 * The newest attempt (from `latest` down to 1) whose jobs make a release or a skip; null when none does. Exactly one job
 * named `ci-gate` and one named `publish` per attempt: a duplicate is a rejection, never a pick of the green one.
 */
async function usableAttempt(
  github: GitHub,
  runId: number,
  latest: number,
): Promise<{ attempt: number; kind: 'release' | 'skipped' } | null> {
  for (let attempt = latest; attempt >= 1; attempt -= 1) {
    const jobs = await jobStates(github, runId, attempt);
    const gate = jobs.get('ci-gate') ?? [];
    const publish = jobs.get('publish') ?? [];
    ensure(gate.length <= 1 && publish.length <= 1, 'v3-duplicate-job', `run ${String(runId)} attempt ${String(attempt)}`);
    if (gate[0] !== 'completed/success') continue;
    if (publish[0] === 'completed/success') return { attempt, kind: 'release' };
    if (publish[0] === 'completed/skipped' && (await attemptSucceeded(github, runId, attempt))) return { attempt, kind: 'skipped' };
  }
  return null;
}

export type ReleaseLookup = Release | 'unusable' | 'skipped';

export async function findRelease(github: GitHub, config: AgentConfig, commit: string): Promise<ReleaseLookup> {
  const runs = await github.all(
    `${github.repoPath}/actions/workflows/${String(config.workflowId)}/runs?head_sha=${commit}&event=push&per_page=100`,
    'workflow_runs',
    3,
  );
  const push = runs
    .filter(isRecord)
    .filter(
      (run) =>
        run['workflow_id'] === config.workflowId && run['head_sha'] === commit && run['event'] === 'push' && run['head_branch'] === 'main',
    )
    .sort((a, b) => Number(a['id']) - Number(b['id']));
  const oldest = push[0];
  if (oldest === undefined) return 'unusable';
  const runId = integer(oldest['id'], 'v3-parse');
  const found = await usableAttempt(github, runId, integer(oldest['run_attempt'], 'v3-parse'));
  if (found === null) return 'unusable';
  if (found.kind === 'skipped') return 'skipped';
  const artifacts = await github.all(
    `${github.repoPath}/actions/runs/${String(runId)}/artifacts?name=${MANIFEST_ARTIFACT}&per_page=100`,
    'artifacts',
    3,
  );
  const usable = artifacts
    .filter(isRecord)
    .filter((artifact) => {
      const run = artifact['workflow_run'];
      return (
        artifact['name'] === MANIFEST_ARTIFACT &&
        artifact['expired'] === false &&
        isRecord(run) &&
        run['id'] === runId &&
        run['head_sha'] === commit
      );
    })
    .sort((a, b) => Number(b['id']) - Number(a['id']));
  const artifact = usable[0];
  if (artifact === undefined) throw new Rejection('v3-artifact-missing', `run ${String(runId)}: no release-manifest`);
  const archive = artifact['archive_download_url'];
  ensure(typeof archive === 'string', 'v3-artifact-url', 'archive_download_url');
  const zip = await github.artifactZip(integer(artifact['id'], 'v3-parse'), archive);
  const bytes = readSingleEntry(zip, MANIFEST_FILE, MAX_ARTIFACT_BYTES);
  const manifest = parseManifest(bytes, { commit, composePath: config.composePath, repositories: config.imageRepositories });
  return { manifest, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), manifestSha256: sha256(bytes), runId };
}
