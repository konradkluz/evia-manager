/**
 * V3 — the release of commit X (EVM-007 AC3; ADR-0018 V3, m2; architect 4, 7; security-engineer A3, B "V3").
 * A run of the workflow with the configured numeric ID with event `push`, head_branch `main` and head_sha X (X is in the
 * history of main by V1 — a tag named `main` is never enough: its run has no successful `publish`). Deterministic choice:
 * the OLDEST push run for X and its NEWEST successful attempt, whose jobs `ci-gate` and `publish` succeeded. Its artifact
 * `release-manifest` (exact name, not expired, of this run and commit; the newest when re-runs made several) is
 * downloaded through the redirect check of github.ts and parsed in memory (zip.ts, manifest.ts).
 * `unusable` = X has no usable release now (no run, still running, publish failed — a re-run may change that);
 * `skipped` = X will never have one: the successful attempt skipped `publish` (no change in apps/, packages/, infra/ or
 * the lockfile — EVM-083), which a re-run repeats; the verifier may remember it (cache.ts). In both cases the verifier
 * looks at an older commit. A missing or forged manifest of a successful publish is a rejection.
 */
import type { AgentConfig } from './config.ts';
import { Rejection, ensure, integer, isRecord, record } from './errors.ts';
import { MAX_ARTIFACT_BYTES, type GitHub } from './github.ts';
import { parseManifest, sha256, type Manifest } from './manifest.ts';
import { jobStates, succeeded } from './pulls.ts';
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

/** The newest successful attempt of a run (from run_attempt down to 1), or null. */
async function successfulAttempt(github: GitHub, runId: number, latest: number): Promise<number | null> {
  for (let attempt = latest; attempt >= 1; attempt -= 1) {
    const { body } = await github.json(`${github.repoPath}/actions/runs/${String(runId)}/attempts/${String(attempt)}`);
    const run = record(body, 'v3-parse');
    if (run['status'] === 'completed' && run['conclusion'] === 'success') return attempt;
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
  if (oldest === undefined || oldest['status'] !== 'completed') return 'unusable';
  const runId = integer(oldest['id'], 'v3-parse');
  const attempt = await successfulAttempt(github, runId, integer(oldest['run_attempt'], 'v3-parse'));
  if (attempt === null) return 'unusable';
  const jobs = await jobStates(github, runId, attempt);
  if (!succeeded(jobs, 'ci-gate')) return 'unusable';
  if (!succeeded(jobs, 'publish')) {
    const publish = jobs.get('publish') ?? [];
    return publish.length > 0 && publish.every((state) => state === 'completed/skipped') ? 'skipped' : 'unusable';
  }
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
